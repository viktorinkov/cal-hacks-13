//! `claim_review`: Claude investigates the claim and decides it.
//!
//! Claude gets a brief (the claim, the amounts code fixed, the policy, the
//! clauses the Evidence Engine found, the charge staff proposed, an index of
//! the evidence and the checks by name) and opens the evidence itself with
//! tools, one source at a time: the band, the light circle, the security
//! cameras, the staff notes, the hospital report, the person security named,
//! the check details, and the clauses of the venue's policy and, for an injury,
//! the attendee's health plan (the Evidence Engine's semantic search with
//! Claude's own query, and one clause in full). It then decides pay, refuse or
//! ask the organizer, and recommends a charge or none when someone was named.
//! Every tool call is reported to the module as a step of the decision history
//! while the investigation runs; code validates the decision here (one more try
//! on a rejected answer) and again in the module, which holds it to the limits
//! in `bandit_insurance::decision::guard`.

use bandit_bindings::ModelCallIn;
use bandit_insurance::decision::{AgentDecision, Choice, EvidenceSource, Investigation, Step, validate_review};
use bandit_insurance::money::format_cents;
use bandit_insurance::payloads::{ClauseRef, ReviewPayload};
use bandit_insurance::schemas::agent_decision_schema;
use bandit_insurance::{Fact, Source};
use claims_elastic::ClauseHit;
use claude_client::{Effort, MessageRequest, ToolUse};
use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedSender;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::Model;
use crate::prompts;
use crate::sink::Finish;

/// Thinking at high effort counts toward the cap, so leave room.
const MAX_TOKENS: u32 = 32_000;
/// Turns Claude may spend calling tools before it must decide.
const TOOL_TURNS: usize = 8;
/// Tries at a valid decision after the first.
const RETRIES: usize = 1;
/// Clauses a policy search returns.
const SEARCH_K: usize = 5;
/// The call record's kind for every turn.
const KIND: &str = "claim_investigation";

/// The evidence sources `read_evidence` opens, and the fact sources behind each.
const READABLE: [(EvidenceSource, &[Source]); 8] = [
    (EvidenceSource::Band, &[Source::BandReport, Source::IncidentSnapshot, Source::Presence]),
    (EvidenceSource::LightCircle, &[Source::LightCircle]),
    (EvidenceSource::Camera, &[Source::VisionAssessment]),
    (EvidenceSource::Medic, &[Source::StaffNote]),
    (EvidenceSource::HospitalReport, &[Source::MedicalRecord]),
    (EvidenceSource::Zone, &[Source::ZoneContext]),
    (EvidenceSource::Policy, &[Source::Policy]),
    (EvidenceSource::Responsible, &[Source::ResponsibleParty]),
];

/// The Evidence Engine's policy clauses. Tests use a fake.
pub trait PolicyClauses: Sync {
    /// The clauses of one policy closest in meaning to `query`: `venue`, or
    /// `attendee` with the attendee's health plan document.
    fn search(&self, query: &str, policy: &str, document_hash: Option<&str>) -> impl Future<Output = anyhow::Result<Vec<ClauseHit>>> + Send;
    /// One clause in full; `None` when there is no such clause.
    fn read(&self, clause_id: &str) -> impl Future<Output = anyhow::Result<Option<ClauseHit>>> + Send;
}

/// The real Evidence Engine, when Elastic is set up.
pub struct Elastic<'a>(pub &'a Ctx);

impl PolicyClauses for Elastic<'_> {
    async fn search(&self, query: &str, policy: &str, document_hash: Option<&str>) -> anyhow::Result<Vec<ClauseHit>> {
        let es = self.0.elastic().await.map_err(|e| anyhow::anyhow!(e.error))?;
        es.search_policy_clauses(query, policy, document_hash, &[], SEARCH_K).await
    }

    async fn read(&self, clause_id: &str) -> anyhow::Result<Option<ClauseHit>> {
        let es = self.0.elastic().await.map_err(|e| anyhow::anyhow!(e.error))?;
        es.read_clause(clause_id).await
    }
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: ReviewPayload) -> Result<(), JobError> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Step>();
    let work = async move { investigate(&ctx.claude, &Elastic(ctx), &p, ctx.tz_offset_minutes, &tx).await };
    let report = async {
        while let Some(step) = rx.recv().await {
            if let Err(e) = ctx.sink.claim_step(job.id, &step).await {
                tracing::warn!(job_id = job.id, error = %format!("{e:#}"), "could not report a step");
            }
        }
    };
    let (done, ()) = tokio::join!(work, report);
    let done = done?;
    match &done.checked {
        Ok(d) => tracing::info!(job_id = job.id, decision = d.decision.as_str(), steps = done.investigation.steps.len(), "decided"),
        Err(problems) => tracing::warn!(job_id = job.id, problems = %problems.join("; "), "decision still invalid, the module will route it"),
    }
    let review_json = serde_json::to_string(&done.investigation).map_err(|e| JobError::msg(e.to_string()))?;
    ctx.sink.finish(job.id, Finish::ClaimReview { review_json }, done.calls).await?;
    Ok(())
}

/// The finished investigation and what code made of its last answer.
pub struct Done {
    pub investigation: Investigation,
    pub checked: Result<AgentDecision, Vec<String>>,
    pub calls: Vec<ModelCallIn>,
}

fn facts_of<'a>(p: &'a ReviewPayload, source: EvidenceSource) -> Vec<&'a Fact> {
    let kinds = READABLE.iter().find(|(s, _)| *s == source).map(|(_, k)| *k).unwrap_or(&[]);
    p.facts.iter().filter(|f| kinds.contains(&f.source)).collect()
}

fn tools(request: MessageRequest) -> MessageRequest {
    let reason = json!({"type": "string", "description": "why you are opening this, in one sentence for the decision history"});
    let readable: Vec<&str> = READABLE.iter().map(|(s, _)| s.as_str()).collect();
    let object = |props: Value, required: &[&str]| json!({"type": "object", "properties": props, "required": required, "additionalProperties": false});
    request
        .tool(
            "read_evidence",
            "Read every fact of one evidence source: band (the subject band's reports and where it had been), light_circle \
             (the bands that lit up around the person), camera (security camera sightings), medic (the staff notes: the \
             medic's, or security's report and its cost note), hospital_report (the report's facts, its itemized bill as the \
             fee schedule decided it, and its own words), zone, policy (the venue's cover on this claim: its medical payments \
             cover for an injury, its property policy for property, a theft or a breakage), or responsible (the person security \
             named as having broken or taken it, and code's checks of their band).",
            object(json!({"source": {"type": "string", "enum": readable}, "reason": reason}), &["source", "reason"]),
        )
        .tool(
            "read_checks",
            "Read what each code and Evidence Engine check compared, with both values, and its result.",
            object(json!({"reason": reason}), &["reason"]),
        )
        .tool(
            "search_policy",
            "Evidence Engine semantic search: the clauses of the venue's policy (venue) or, for an injury, of the attendee's \
             health plan (attendee) closest in meaning to your query, each with its id, section, page and text. Write the query \
             in the policy's terms, never with a person's name.",
            object(
                json!({
                    "query": {"type": "string", "description": "for example: injury that began before the event; theft of property of others in the insured's care"},
                    "policy": {"type": "string", "enum": ["venue", "attendee"]},
                    "reason": reason
                }),
                &["query", "policy", "reason"],
            ),
        )
        .tool(
            "read_clause",
            "Read one policy clause in full, by the clause_id a search or the brief showed, with its policy, section and page.",
            object(json!({"clause_id": {"type": "string"}, "reason": reason}), &["clause_id", "reason"]),
        )
}

/// What a tool call returned, and its step for the decision history.
struct Ran {
    text: String,
    is_error: bool,
    step: Step,
    read: Option<EvidenceSource>,
    /// Ids of the clauses the call showed.
    clauses: Vec<String>,
}

fn str_input<'a>(t: &'a ToolUse, key: &str) -> &'a str {
    t.input.get(key).and_then(Value::as_str).unwrap_or_default().trim()
}

fn step(actor: &str, action: &str, summary: String, detail: &str, fact_ids: Vec<u32>) -> Step {
    Step { actor: actor.into(), action: action.into(), summary, detail: detail.into(), fact_ids }
}

/// The words of a text, lowercased.
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

/// The parts of the claimant's and the named person's names that a
/// de-identified query must not contain.
fn name_parts(p: &ReviewPayload) -> Vec<String> {
    let named = p.charge.as_ref().map(|c| c.attendee_name.as_str());
    let in_facts = p.facts.iter().filter(|f| f.source == Source::ResponsibleParty && f.key == "responsible_name").map(|f| f.value.as_str());
    let mut parts: Vec<String> = std::iter::once(p.claimant_name.as_str())
        .chain(named)
        .chain(in_facts)
        .flat_map(words)
        .filter(|w| w.chars().count() >= 3)
        .collect();
    parts.sort();
    parts.dedup();
    parts
}

/// The claim's own policy document for `policy`: the venue's confirmed policy
/// PDF (none for the seeded policy, whose clauses are all the venue's), the
/// attendee's health plan document when on file.
fn document_of<'a>(p: &'a ReviewPayload, policy: &str) -> Option<&'a str> {
    match policy {
        "attendee" => Some(p.attendee_policy_hash.trim()).filter(|h| !h.is_empty()),
        _ => Some(p.venue_policy_hash.trim()).filter(|h| !h.is_empty()),
    }
}

/// True when a clause belongs to a policy on this claim: the venue's, or this attendee's health plan.
fn on_this_claim(c: &ClauseHit, p: &ReviewPayload) -> bool {
    match c.policy.as_str() {
        "venue" => document_of(p, "venue").is_none_or(|h| c.document_hash == h),
        "attendee" => document_of(p, "attendee").is_some_and(|h| c.document_hash == h),
        _ => false,
    }
}

fn whose(policy: &str) -> &'static str {
    if policy == "attendee" { "the attendee's health plan" } else { "the venue's policy" }
}

fn line_of(c: &ClauseHit, score: bool, max: usize) -> String {
    prompts::clause_line(&c.clause_id, &c.policy, &c.section, c.page, score.then_some(c.score), &c.text, max)
}

fn from_ref(c: &ClauseRef) -> ClauseHit {
    ClauseHit { clause_id: c.clause_id.clone(), policy: c.policy.clone(), section: c.section.clone(), page: c.page, text: c.text.clone(), score: c.score, ..Default::default() }
}

/// `exclusions, subrogation`: the sections of the clauses found, once each.
fn sections_of(found: &[ClauseHit]) -> String {
    let mut out: Vec<String> = Vec::new();
    for c in found {
        let s = c.section.replace('_', " ");
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out.join(", ")
}

async fn run_tool<E: PolicyClauses>(t: &ToolUse, p: &ReviewPayload, evidence: &E, tz: i32) -> Ran {
    let reason = str_input(t, "reason");
    let error = |text: String| Ran {
        text: text.clone(),
        is_error: true,
        step: step("Claude", &t.name, format!("{} failed", t.name), &text, vec![]),
        read: None,
        clauses: vec![],
    };
    match t.name.as_str() {
        "read_evidence" => {
            let Some(source) = EvidenceSource::parse(str_input(t, "source")).filter(|s| READABLE.iter().any(|(r, _)| r == s)) else {
                return error(format!("unknown source {:?}", str_input(t, "source")));
            };
            let facts = facts_of(p, source);
            let mut lines: Vec<String> = facts.iter().map(|f| prompts::fact_line(f, tz)).collect();
            match source {
                EvidenceSource::HospitalReport if !p.lines.is_empty() || !p.record_history.is_empty() => lines.extend(prompts::hospital_report_lines(p)),
                EvidenceSource::Policy => lines.push(p.policy_summary.clone()),
                EvidenceSource::Responsible => {
                    if let Some(c) = &p.charge {
                        lines.push(format!("proposed charge: {} to {} (band {}), named by {}", format_cents(c.amount_cents), c.attendee_name, c.band_id, c.named_by_role));
                        lines.extend(c.checks.iter().map(|k| format!("check {}", k.line())));
                    }
                }
                _ => {}
            }
            let ids: Vec<u32> = facts.iter().map(|f| f.seq).collect();
            let summary = match facts.len() {
                0 => format!("Read {}: nothing on file", source.label()),
                n => format!("Read {}: {n} fact(s)", source.label()),
            };
            Ran { text: prompts::tool_block(source.as_str(), lines), is_error: false, step: step("Claude", "read_evidence", summary, reason, ids), read: Some(source), clauses: vec![] }
        }
        "read_checks" => {
            let failed: Vec<&str> = p.checks.iter().filter(|c| c.result == bandit_insurance::CheckResult::Fail).map(|c| c.name.as_str()).collect();
            let summary = if failed.is_empty() {
                format!("Read the checks: none of {} failed", p.checks.len())
            } else {
                format!("Read the checks: {} failed ({})", failed.len(), failed.join(", "))
            };
            let lines = p.checks.iter().map(|c| format!("{} (reader {})", c.line(), c.reader.as_str()));
            Ran { text: prompts::tool_block("checks", lines), is_error: false, step: step("Claude", "read_checks", summary, reason, vec![]), read: Some(EvidenceSource::Checks), clauses: vec![] }
        }
        "search_policy" => {
            let (query, policy) = (str_input(t, "query"), str_input(t, "policy"));
            if query.is_empty() || query.chars().count() > 300 {
                return error("write a query of 1 to 300 characters".into());
            }
            if !["venue", "attendee"].contains(&policy) {
                return error(format!("policy {policy:?} is not venue or attendee"));
            }
            let names = name_parts(p);
            if words(query).iter().any(|w| names.contains(w)) {
                return error("the query names a person; the policies hold no names, so describe what happened in the policy's terms".into());
            }
            let document = document_of(p, policy);
            if policy == "attendee" && (document.is_none() || !prompts::is_injury(p)) {
                let (text, summary) = if prompts::is_injury(p) {
                    ("No health plan of the attendee's is on file for this claim, so there are no attendee clauses to search.", "No health plan on file to search")
                } else {
                    ("The attendee's health plan answers injuries only. This claim is the venue's own loss: search policy venue.", "The attendee's health plan does not answer the venue's loss")
                };
                let s = step("Evidence Engine", "search_policy", summary.into(), reason, vec![]);
                return Ran { text: text.into(), is_error: false, step: s, read: Some(EvidenceSource::PolicyClauses), clauses: vec![] };
            }
            match evidence.search(query, policy, document).await {
                Ok(found) => {
                    let found: Vec<ClauseHit> = found.into_iter().filter(|c| c.policy == policy && on_this_claim(c, p)).collect();
                    let summary = match found.len() {
                        0 => format!("Searched {} for \"{query}\": no clause found", whose(policy)),
                        n => format!("Searched {} for \"{query}\": {n} clause(s) ({})", whose(policy), sections_of(&found)),
                    };
                    let lines = found.iter().map(|c| line_of(c, true, prompts::CLAUSE_EXCERPT));
                    Ran {
                        text: prompts::tool_block("policy_clauses", lines),
                        is_error: false,
                        step: step("Evidence Engine", "search_policy", summary, reason, vec![]),
                        read: Some(EvidenceSource::PolicyClauses),
                        clauses: found.iter().map(|c| c.clause_id.clone()).collect(),
                    }
                }
                Err(e) => {
                    let kept: Vec<ClauseHit> = p.clauses.iter().filter(|c| c.policy == policy).map(from_ref).collect();
                    let text = format!(
                        "The Evidence Engine is unavailable ({e:#}). The clauses it found when the claim was checked:\n{}",
                        prompts::tool_block("policy_clauses", kept.iter().map(|c| line_of(c, true, prompts::CLAUSE_EXCERPT)))
                    );
                    let s = step("Evidence Engine", "search_policy", "The Evidence Engine search failed".into(), &format!("{e:#}"), vec![]);
                    Ran { text, is_error: true, step: s, read: Some(EvidenceSource::PolicyClauses), clauses: vec![] }
                }
            }
        }
        "read_clause" => {
            let id = str_input(t, "clause_id");
            if id.is_empty() || id.chars().count() > 200 {
                return error("give the clause_id of a clause the brief or a search showed".into());
            }
            let stored = p.clauses.iter().find(|c| c.clause_id == id).map(from_ref);
            let clause = match evidence.read(id).await {
                Ok(Some(c)) if on_this_claim(&c, p) => c,
                Ok(Some(_)) => return error(format!("clause {id} is not in this claim's policies")),
                Ok(None) => match stored {
                    Some(c) => c,
                    None => return error(format!("there is no clause {id}")),
                },
                Err(e) => match stored {
                    Some(c) => c,
                    None => return error(format!("the Evidence Engine is unavailable ({e:#}), and the brief has no clause {id}")),
                },
            };
            let summary = format!("Read clause {}: {}, {}, page {}", clause.clause_id, whose(&clause.policy), clause.section.replace('_', " "), clause.page);
            Ran {
                text: prompts::tool_block("clause", [line_of(&clause, false, usize::MAX)]),
                is_error: false,
                step: step("Claude", "read_clause", summary, reason, vec![]),
                read: Some(EvidenceSource::PolicyClauses),
                clauses: vec![clause.clause_id],
            }
        }
        other => error(format!("there is no tool {other}")),
    }
}

/// Runs the investigation: tool turns until Claude answers, at most
/// `TOOL_TURNS` of them, then validation with `RETRIES` more tries. Each step
/// goes to `steps` as it happens. A failed call is a `JobError` with every call made.
pub async fn investigate<M: Model, E: PolicyClauses>(model: &M, evidence: &E, p: &ReviewPayload, tz: i32, steps: &UnboundedSender<Step>) -> Result<Done, JobError> {
    let sources: Vec<(&str, usize)> = READABLE.iter().map(|(s, _)| (s.as_str(), facts_of(p, *s).len())).collect();
    let mut request = tools(MessageRequest::new())
        .system(prompts::INVESTIGATE_SYSTEM)
        .text(prompts::brief_prompt(p, &sources))
        .json_schema(agent_decision_schema())
        .max_tokens(MAX_TOKENS);
    let mut calls: Vec<ModelCallIn> = Vec::new();
    let mut all_steps: Vec<Step> = Vec::new();
    let mut read: Vec<EvidenceSource> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let emit = |s: Step, all: &mut Vec<Step>| {
        let _ = steps.send(s.clone());
        all.push(s);
    };
    let (mut tool_turns, mut retries) = (0, 0);
    loop {
        let turn = model.turn(KIND, Effort::High, request.clone()).await.map_err(|f| JobError::from_call(f, &mut calls))?;
        calls.push(turn.call);
        // Past the last tool turn a tool call is no answer, so it falls through to validation.
        if !turn.tool_uses.is_empty() && tool_turns < TOOL_TURNS {
            tool_turns += 1;
            request = request.next_turn(&turn.content);
            for t in &turn.tool_uses {
                let ran = run_tool(t, p, evidence, tz).await;
                if let Some(s) = ran.read
                    && !read.contains(&s)
                {
                    read.push(s);
                }
                for id in ran.clauses {
                    if !seen.contains(&id) {
                        seen.push(id);
                    }
                }
                emit(ran.step, &mut all_steps);
                request = request.tool_result(&t.id, ran.text, ran.is_error);
            }
            if tool_turns >= TOOL_TURNS {
                request = request.tool_choice_none().text("You have used every investigation turn. Decide now in the schema.");
            }
            continue;
        }
        let answer = turn.json.clone().unwrap_or(Value::Null);
        let checked = serde_json::from_value::<AgentDecision>(answer.clone())
            .map_err(|e| vec![format!("not a decision: {e}")])
            .and_then(|d| validate_review(&d, p, &read, &seen).map(|_| d));
        if let (Err(problems), true) = (&checked, retries < RETRIES) {
            retries += 1;
            tracing::info!(problems = %problems.join("; "), "decision rejected, asking again");
            request = request.next_turn(&turn.content).text(prompts::retry_note(&answer, problems));
            continue;
        }
        if let Ok(d) = &checked {
            for f in &d.findings {
                emit(step("Claude", "weigh", f.headline(), &f.detail, f.fact_ids.clone()), &mut all_steps);
            }
            if !d.trusted_source.trim().is_empty() {
                emit(step("Claude", "weigh", "Weighed the sources that disagree".into(), d.trusted_source.trim(), vec![]), &mut all_steps);
            }
            if let Some(c) = &d.charge {
                let summary = if c.recommend { "Recommends charging the person named" } else { "Recommends no charge" };
                emit(step("Claude", "recommend", summary.into(), c.reason.trim(), c.fact_ids.clone()), &mut all_steps);
            }
            let summary = match d.decision {
                Choice::Pay => format!("Decided to pay {}", format_cents(p.amounts.payout_cents)),
                Choice::Refuse => "Decided to refuse".to_string(),
                Choice::AskOrganizer => "Decided to ask the organizer".to_string(),
            };
            emit(step("Claude", "decide", summary, &d.summary, d.cited_fact_ids.clone()), &mut all_steps);
        }
        let investigation = Investigation { decision: answer, steps: all_steps, sources_read: read, clauses_seen: seen };
        return Ok(Done { investigation, checked, calls });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use crate::testdata;

    /// The Evidence Engine with one venue exclusion for an injury, the venue's
    /// property clauses on theft, an attendee's health plan clause, and a clause
    /// of somebody else's plan.
    struct FakeEvidence;

    fn clause(id: &str, policy: &str, document_hash: &str, section: &str, text: &str) -> ClauseHit {
        ClauseHit { clause_id: id.into(), policy: policy.into(), document_hash: document_hash.into(), section: section.into(), page: 5, text: text.into(), score: 0.81 }
    }

    impl PolicyClauses for FakeEvidence {
        async fn search(&self, query: &str, policy: &str, document_hash: Option<&str>) -> anyhow::Result<Vec<ClauseHit>> {
            let theft = ["stolen", "theft", "recover"].iter().any(|w| query.contains(w));
            Ok(match (policy, document_hash) {
                ("venue", _) if theft => vec![
                    clause("9f2c-c12", "venue", "9f2c", "exclusions", "We will not pay for loss by unexplained disappearance or shortage found upon taking inventory."),
                    clause("9f2c-c14", "venue", "9f2c", "subrogation", "If we pay for a loss, the insured's right to recover from anyone who caused it passes to us."),
                ],
                ("venue", _) => vec![clause("9f2c-c5", "venue", "9f2c", "exclusions", &format!("matched {query}: injury that began before the event"))],
                ("attendee", Some(h)) => vec![clause("4b1e-c4", "attendee", h, "other_insurance", "This plan pays after any medical payments coverage.")],
                _ => vec![],
            })
        }

        async fn read(&self, clause_id: &str) -> anyhow::Result<Option<ClauseHit>> {
            Ok(match clause_id {
                "9f2c-c5" => Some(clause("9f2c-c5", "venue", "9f2c", "exclusions", "We will not pay for bodily injury that began before the event.")),
                "77aa-c1" => Some(clause("77aa-c1", "attendee", "77aa", "insuring_agreement", "Somebody else's health plan.")),
                _ => None,
            })
        }
    }

    fn tool(id: &str, name: &str, input: Value) -> Value {
        json!({"id": id, "name": name, "input": input})
    }

    fn reads(sources: &[&str]) -> Value {
        let calls: Vec<Value> = sources.iter().enumerate().map(|(i, s)| tool(&format!("t{i}"), "read_evidence", json!({"source": s, "reason": "check it"}))).collect();
        json!({ "_tools": calls })
    }

    fn pay(p: &ReviewPayload) -> Value {
        json!({
            "decision": "pay", "causation": "supported",
            "summary": "The band, three witnesses and the urgent care report agree on a fall at the main stage; covered cost $895.00.",
            "findings": [{"source": "light_circle", "stance": "supports", "detail": "three witnesses in zone", "fact_ids": [p.facts[0].seq]}],
            "trusted_source": "", "concerns": [], "innocent_explanations": [], "missing_evidence": [],
            "refusal_checks": [], "question": "", "cited_fact_ids": [p.facts[0].seq],
            "cited_clause_ids": ["9f2c-c3"], "charge": null
        })
    }

    async fn run_with(model: &FakeModel, p: &ReviewPayload) -> (Done, Vec<Step>) {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let done = investigate(model, &FakeEvidence, p, -420, &tx).await.ok().unwrap();
        drop(tx);
        let mut live = Vec::new();
        while let Some(s) = rx.recv().await {
            live.push(s);
        }
        (done, live)
    }

    #[tokio::test]
    async fn claude_reads_the_evidence_then_decides() {
        let mut p = testdata::review_payload();
        p.checks.retain(|c| c.result != bandit_insurance::CheckResult::Fail);
        let mut answer = pay(&p);
        answer["cited_clause_ids"] = json!(["9f2c-c3", "9f2c-c5"]);
        let model = FakeModel::new(vec![
            Ok(reads(&["band", "light_circle", "hospital_report"])),
            Ok(json!({"_tools": [tool("s1", "search_policy", json!({"query": "injury that began before the event", "policy": "venue", "reason": "is it excluded"})),
                                 tool("s2", "read_clause", json!({"clause_id": "9f2c-c5", "reason": "read the exclusion in full"}))]})),
            Ok(answer),
        ]);
        let (done, live) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        assert_eq!(done.calls.len(), 3);
        assert_eq!(done.investigation.sources_read, [EvidenceSource::Band, EvidenceSource::LightCircle, EvidenceSource::HospitalReport, EvidenceSource::PolicyClauses]);
        assert_eq!(done.investigation.clauses_seen, ["9f2c-c5"]);
        let summaries: Vec<&str> = live.iter().map(|s| s.summary.as_str()).collect();
        assert!(summaries[1].starts_with("Read the light circle: "), "{summaries:?}");
        assert_eq!(summaries[3], "Searched the venue's policy for \"injury that began before the event\": 1 clause(s) (exclusions)");
        assert_eq!(summaries[4], "Read clause 9f2c-c5: the venue's policy, exclusions, page 5");
        assert_eq!(summaries[5], "The light circle supports the claim");
        assert_eq!(summaries[6], "Decided to pay $895.00");
        assert_eq!(live, done.investigation.steps, "every step was reported live");
        assert_eq!((live[3].actor.as_str(), live[4].actor.as_str()), ("Evidence Engine", "Claude"));

        let body = model.body(1);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[1]["role"], "assistant");
        let results = messages[2]["content"].as_array().unwrap();
        assert_eq!(results.len(), 3, "one tool_result per call, in one user turn");
        assert!(results[2]["content"].as_str().unwrap().contains("history of present illness"), "{}", results[2]);
        let tools: Vec<&str> = body["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(tools, ["read_evidence", "read_checks", "search_policy", "read_clause"]);
        let clause = model.body(2)["messages"].as_array().unwrap()[4]["content"][1]["content"].as_str().unwrap().to_string();
        assert!(clause.starts_with("<clause>\n9f2c-c5 (venue policy, exclusions, page 5): We will not pay"), "{clause}");
    }

    #[tokio::test]
    async fn a_pay_without_reading_is_sent_back() {
        let mut p = testdata::review_payload();
        p.checks.retain(|c| c.result != bandit_insurance::CheckResult::Fail);
        let model = FakeModel::new(vec![Ok(pay(&p)), Ok(reads(&["band", "light_circle", "hospital_report"])), Ok(pay(&p))]);
        let (done, _) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        let retry = model.body(1);
        let note = retry["messages"].as_array().unwrap().last().unwrap()["content"][0]["text"].as_str().unwrap().to_string();
        assert!(note.contains("pay without reading the light circle"), "{note}");
    }

    #[tokio::test]
    async fn a_clause_nobody_found_is_sent_back() {
        let mut p = testdata::review_payload();
        p.checks.retain(|c| c.result != bandit_insurance::CheckResult::Fail);
        let mut made_up = pay(&p);
        made_up["cited_clause_ids"] = json!(["9f2c-c3", "4b1e-c4"]);
        let model = FakeModel::new(vec![Ok(reads(&["band", "light_circle", "hospital_report"])), Ok(made_up), Ok(pay(&p))]);
        let (done, _) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        let note = model.body(2)["messages"].as_array().unwrap().last().unwrap()["content"][0]["text"].as_str().unwrap().to_string();
        assert!(note.contains("cited clause 4b1e-c4 is not one the Evidence Engine found for this claim"), "{note}");
    }

    #[tokio::test]
    async fn a_theft_from_the_venue_reads_its_property_policy_and_recommends_a_charge() {
        let p = testdata::theft_review_payload();
        let camera = p.facts.iter().find(|f| f.key == "vision_confirmed").unwrap().seq;
        let at_spot = p.facts.iter().find(|f| f.key == "band_at_spot").unwrap().seq;
        let answer = json!({
            "decision": "pay", "causation": "supported",
            "summary": "The camera saw the sponsor's display laptop lifted from its booth, and the venue's property policy covers theft of property in its care; the insurer pays $799.00 and the venue carries its $500.00 deductible.",
            "findings": [
                {"source": "camera", "stance": "supports", "detail": "a person lifts a laptop from the booth table", "fact_ids": [camera]},
                {"source": "responsible", "stance": "supports", "detail": "band 41 was at the spot", "fact_ids": [at_spot]}
            ],
            "trusted_source": "", "concerns": [], "innocent_explanations": [], "missing_evidence": [],
            "refusal_checks": [], "question": "", "cited_fact_ids": [camera],
            "cited_clause_ids": ["9f2c-c11"],
            "charge": {"recommend": true, "reason": "The camera and band 41 place the person named at the booth when it was taken; the subrogation clause lets the insurer recover, so charge $1,299.00.",
                       "fact_ids": [camera, at_spot], "clause_ids": ["9f2c-c14"]}
        });
        let model = FakeModel::new(vec![
            Ok(reads(&["camera", "policy", "responsible"])),
            Ok(json!({"_tools": [tool("s1", "search_policy", json!({"query": "laptop stolen from a sponsor's booth", "policy": "venue", "reason": "what the property policy says on theft"}))]})),
            Ok(answer),
        ]);
        let (done, live) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        assert_eq!(done.investigation.clauses_seen, ["9f2c-c12", "9f2c-c14"]);
        let summaries: Vec<&str> = live.iter().map(|s| s.summary.as_str()).collect();
        assert_eq!(summaries[1], "Read the policy: 6 fact(s)");
        assert_eq!(summaries[2], "Read the attendee named: 6 fact(s)");
        assert_eq!(summaries[3], "Searched the venue's policy for \"laptop stolen from a sponsor's booth\": 2 clause(s) (exclusions, subrogation)");
        assert!(summaries.contains(&"Recommends charging the person named"), "{summaries:?}");
        let policy = model.body(1)["messages"].as_array().unwrap()[2]["content"][1]["content"].as_str().unwrap().to_string();
        assert!(policy.contains("policy/cover_kind = property") && policy.contains("after a $500.00 deductible the venue carries"), "{policy}");
        let responsible = model.body(1)["messages"].as_array().unwrap()[2]["content"][2]["content"].as_str().unwrap().to_string();
        assert!(responsible.contains("responsible_party/band_at_spot = yes") && responsible.contains("check responsible_at_spot: pass"), "{responsible}");
        let brief = model.text_of(0);
        assert!(brief.contains("<charge>") && brief.contains("9f2c-c14 (venue policy, subrogation"), "{brief}");
        assert!(!brief.contains("attendee policy"), "a theft from the venue has no attendee's policy: {brief}");
    }

    #[tokio::test]
    async fn a_named_person_without_a_recommendation_is_sent_back() {
        let p = testdata::theft_review_payload();
        let camera = p.facts.iter().find(|f| f.key == "vision_confirmed").unwrap().seq;
        let ask = |charge: Value| {
            json!({
                "decision": "ask_organizer", "causation": "unclear", "summary": "The camera saw the laptop taken, but was the sponsor's booth staffed?",
                "findings": [{"source": "camera", "stance": "supports", "detail": "seen", "fact_ids": [camera]}], "trusted_source": "",
                "concerns": [], "innocent_explanations": [], "missing_evidence": [], "refusal_checks": [],
                "question": "Was the sponsor's booth staffed when the laptop went?", "cited_fact_ids": [], "cited_clause_ids": [], "charge": charge
            })
        };
        let model = FakeModel::new(vec![
            Ok(reads(&["camera", "responsible"])),
            Ok(ask(Value::Null)),
            Ok(ask(json!({"recommend": false, "reason": "the camera does not show a face", "fact_ids": [], "clause_ids": []}))),
        ]);
        let (done, _) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        let note = model.body(2)["messages"].as_array().unwrap().last().unwrap()["content"][0]["text"].as_str().unwrap().to_string();
        assert!(note.contains("security named someone, so charge needs your recommendation"), "{note}");
    }

    #[tokio::test]
    async fn names_never_reach_the_evidence_engine() {
        let p = testdata::review_payload();
        let first = p.claimant_name.split_whitespace().next().unwrap().to_string();
        let t = ToolUse { id: "s".into(), name: "search_policy".into(), input: json!({"query": format!("{first} fell at the stage"), "policy": "venue", "reason": "r"}) };
        let ran = run_tool(&t, &p, &FakeEvidence, -420).await;
        assert!(ran.is_error && ran.text.contains("names a person"), "{}", ran.text);

        let theft = testdata::theft_review_payload();
        let t = ToolUse { id: "s".into(), name: "search_policy".into(), input: json!({"query": "laptop taken by patel", "policy": "venue", "reason": "r"}) };
        assert!(run_tool(&t, &theft, &FakeEvidence, -420).await.is_error, "the person named is a name too");
        let t = ToolUse { id: "s".into(), name: "search_policy".into(), input: json!({"query": "the insurer's recovery from the person who caused a loss", "policy": "venue", "reason": "r"}) };
        let ran = run_tool(&t, &theft, &FakeEvidence, -420).await;
        assert!(!ran.is_error && ran.clauses.len() == 2, "{}", ran.text);
    }

    #[tokio::test]
    async fn only_this_claims_policies_can_be_read() {
        let p = testdata::theft_review_payload();
        let read = |id: &str| ToolUse { id: "r".into(), name: "read_clause".into(), input: json!({"clause_id": id, "reason": "r"}) };
        let other = run_tool(&read("77aa-c1"), &p, &FakeEvidence, -420).await;
        assert!(other.is_error && other.text.contains("not in this claim's policies"), "{}", other.text);
        let stored = run_tool(&read("9f2c-c11"), &p, &FakeEvidence, -420).await;
        assert!(!stored.is_error && stored.text.contains("loss of covered property by theft"), "a clause the brief lists, read from the claim: {}", stored.text);
        let missing = run_tool(&read("0000-c1"), &p, &FakeEvidence, -420).await;
        assert!(missing.is_error && missing.text.contains("there is no clause 0000-c1"));

        let search = |policy: &str| ToolUse { id: "s".into(), name: "search_policy".into(), input: json!({"query": "urgent care", "policy": policy, "reason": "r"}) };
        let venues_loss = run_tool(&search("attendee"), &p, &FakeEvidence, -420).await;
        assert!(!venues_loss.is_error && venues_loss.text.contains("answers injuries only") && venues_loss.clauses.is_empty(), "{}", venues_loss.text);

        let mut injury = testdata::review_payload();
        injury.attendee_policy_hash.clear();
        let none = run_tool(&search("attendee"), &injury, &FakeEvidence, -420).await;
        assert!(!none.is_error && none.text.contains("No health plan of the attendee's is on file"), "{}", none.text);
        injury.attendee_policy_hash = "4b1e".into();
        let plan = run_tool(&search("attendee"), &injury, &FakeEvidence, -420).await;
        assert_eq!((plan.clauses.as_slice(), plan.step.summary.as_str()), (&["4b1e-c4".to_string()][..], "Searched the attendee's health plan for \"urgent care\": 1 clause(s) (other insurance)"));
    }

    #[tokio::test]
    async fn the_last_turn_has_no_tools() {
        let mut p = testdata::review_payload();
        p.checks.retain(|c| c.result != bandit_insurance::CheckResult::Fail);
        let mut answers: Vec<Result<Value, String>> = (0..TOOL_TURNS).map(|_| Ok(reads(&["zone"]))).collect();
        answers.push(Ok(json!({"decision": "ask_organizer", "causation": "unclear", "summary": "Not enough to decide.",
            "findings": [{"source": "zone", "stance": "neutral", "detail": "zone only", "fact_ids": []}], "trusted_source": "",
            "concerns": [], "innocent_explanations": [], "missing_evidence": [], "refusal_checks": [],
            "question": "Can you check the camera?", "cited_fact_ids": [], "cited_clause_ids": [], "charge": null})));
        let model = FakeModel::new(answers);
        let (done, _) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        let last = model.body(TOOL_TURNS);
        assert_eq!(last["tool_choice"], json!({"type": "none"}));
    }
}
