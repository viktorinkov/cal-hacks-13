//! `claim_review`: Claude investigates the claim and decides it.
//!
//! Claude gets a brief (the claim, the amounts code fixed, the policy, an index
//! of the evidence and the checks by name) and opens the evidence itself with
//! tools, one source at a time: the band, the light circle, the security
//! cameras, the medic's notes, the hospital report, the check details, and the
//! Evidence Engine's decided past claims (a semantic search with Claude's own
//! query, and ES|QL counts by outcome). It then decides pay, refuse or ask the
//! organizer. Every tool call is reported to the module as a step of the
//! decision history while the investigation runs; code validates the decision
//! here (one more try on a rejected answer) and again in the module, which
//! holds it to the limits in `bandit_insurance::decision::guard`.

use bandit_bindings::ModelCallIn;
use bandit_insurance::decision::{AgentDecision, EvidenceSource, Investigation, Step, required_reading, validate_decision};
use bandit_insurance::money::format_cents;
use bandit_insurance::payloads::ReviewPayload;
use bandit_insurance::schemas::agent_decision_schema;
use bandit_insurance::{Fact, Source};
use claims_elastic::{OutcomeStats, SimilarClaim};
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
/// Past claims a search returns.
const SEARCH_K: usize = 5;
/// The call record's kind for every turn.
const KIND: &str = "claim_investigation";

/// The evidence sources `read_evidence` opens, and the fact sources behind each.
const READABLE: [(EvidenceSource, &[Source]); 7] = [
    (EvidenceSource::Band, &[Source::BandReport, Source::IncidentSnapshot, Source::Presence]),
    (EvidenceSource::LightCircle, &[Source::LightCircle]),
    (EvidenceSource::Camera, &[Source::VisionAssessment]),
    (EvidenceSource::Medic, &[Source::StaffNote]),
    (EvidenceSource::HospitalReport, &[Source::MedicalRecord]),
    (EvidenceSource::Zone, &[Source::ZoneContext]),
    (EvidenceSource::Policy, &[Source::Policy]),
];

/// The Evidence Engine's searches over decided past claims. Tests use a fake.
pub trait PastClaims: Sync {
    fn search(&self, query: &str, exclude_claim_id: i64) -> impl Future<Output = anyhow::Result<Vec<SimilarClaim>>> + Send;
    fn stats(&self, incident_kind: &str) -> impl Future<Output = anyhow::Result<Vec<OutcomeStats>>> + Send;
}

/// The real Evidence Engine, when Elastic is set up.
pub struct Elastic<'a>(pub &'a Ctx);

impl PastClaims for Elastic<'_> {
    async fn search(&self, query: &str, exclude_claim_id: i64) -> anyhow::Result<Vec<SimilarClaim>> {
        let es = self.0.elastic().await.map_err(|e| anyhow::anyhow!(e.error))?;
        es.similar_claims(query, exclude_claim_id, SEARCH_K).await
    }

    async fn stats(&self, incident_kind: &str) -> anyhow::Result<Vec<OutcomeStats>> {
        let es = self.0.elastic().await.map_err(|e| anyhow::anyhow!(e.error))?;
        es.outcome_stats(incident_kind).await
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

/// The figures a decision may print: the four amounts and every line's billed, allowed and covered cents.
pub fn allowed_amounts(p: &ReviewPayload) -> Vec<bandit_insurance::Cents> {
    let mut allowed = p.amounts.figures().to_vec();
    allowed.extend(p.lines.iter().flat_map(|l| [l.billed_cents, l.allowed_cents, l.covered_cents]));
    allowed
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
             (the bands that lit up around the person), camera (security camera sightings), medic (the medic's notes), \
             hospital_report (the report's facts, its itemized bill as the fee schedule decided it, and its own words), \
             zone, or policy.",
            object(json!({"source": {"type": "string", "enum": readable}, "reason": reason}), &["source", "reason"]),
        )
        .tool(
            "read_checks",
            "Read what each code and Evidence Engine check compared, with both values, and its result.",
            object(json!({"reason": reason}), &["reason"]),
        )
        .tool(
            "search_past_claims",
            "Evidence Engine semantic search: the decided past claims at this venue closest in meaning to your query, with \
             their outcome, payout and de-identified narrative. Write the query as a pattern, never with a person's name.",
            object(
                json!({"query": {"type": "string", "description": "for example: ankle sprain at the main stage, urgent care visit the next day"}, "reason": reason}),
                &["query", "reason"],
            ),
        )
        .tool(
            "past_claim_stats",
            "Evidence Engine ES|QL: how decided past claims of one incident kind ended, counted by outcome with the median \
             and largest payout.",
            object(json!({"incident_kind": {"type": "string", "enum": ["sos", "fall", "property"]}, "reason": reason}), &["incident_kind", "reason"]),
        )
}

/// What a tool call returned, and its step for the decision history.
struct Ran {
    text: String,
    is_error: bool,
    step: Step,
    read: Option<EvidenceSource>,
}

fn str_input<'a>(t: &'a ToolUse, key: &str) -> &'a str {
    t.input.get(key).and_then(Value::as_str).unwrap_or_default().trim()
}

fn step(actor: &str, action: &str, summary: String, detail: &str, fact_ids: Vec<u32>) -> Step {
    Step { actor: actor.into(), action: action.into(), summary, detail: detail.into(), fact_ids }
}

/// Parts of the claimant's name that a de-identified query must not contain.
fn name_parts(name: &str) -> Vec<String> {
    name.split_whitespace().filter(|w| w.chars().count() >= 3).map(str::to_lowercase).collect()
}

async fn run_tool<E: PastClaims>(t: &ToolUse, p: &ReviewPayload, evidence: &E, tz: i32) -> Ran {
    let reason = str_input(t, "reason");
    let error = |text: String| Ran { text: text.clone(), is_error: true, step: step("Claude", &t.name, format!("{} failed", t.name), &text, vec![]), read: None };
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
                _ => {}
            }
            let ids: Vec<u32> = facts.iter().map(|f| f.seq).collect();
            let summary = match facts.len() {
                0 => format!("Read {}: nothing on file", source.label()),
                n => format!("Read {}: {n} fact(s)", source.label()),
            };
            Ran { text: prompts::tool_block(source.as_str(), lines), is_error: false, step: step("Claude", "read_evidence", summary, reason, ids), read: Some(source) }
        }
        "read_checks" => {
            let failed: Vec<&str> = p.checks.iter().filter(|c| c.result == bandit_insurance::CheckResult::Fail).map(|c| c.name.as_str()).collect();
            let summary = if failed.is_empty() {
                format!("Read the checks: none of {} failed", p.checks.len())
            } else {
                format!("Read the checks: {} failed ({})", failed.len(), failed.join(", "))
            };
            let lines = p.checks.iter().map(|c| format!("{} (reader {})", c.line(), c.reader.as_str()));
            Ran { text: prompts::tool_block("checks", lines), is_error: false, step: step("Claude", "read_checks", summary, reason, vec![]), read: Some(EvidenceSource::Checks) }
        }
        "search_past_claims" => {
            let query = str_input(t, "query");
            if query.is_empty() || query.chars().count() > 300 {
                return error("write a query of 1 to 300 characters".into());
            }
            let lower = query.to_lowercase();
            if name_parts(&p.claimant_name).iter().any(|n| lower.contains(n.as_str())) {
                return error("the query names the claimant; the Evidence Engine holds no names, so describe the pattern instead".into());
            }
            match evidence.search(query, p.claim_id as i64).await {
                Ok(found) => {
                    let refused = found.iter().filter(|c| c.outcome == "refused").count();
                    let summary = format!("Searched past claims for \"{query}\": {} found, {refused} refused", found.len());
                    let lines = found.iter().map(|c| {
                        format!("{} (similarity {:.2}): {}, outcome {}, paid {}: {}", c.doc_id, c.score, c.incident_kind, c.outcome, format_cents(c.payout_cents.max(0) as u64), c.narrative)
                    });
                    Ran { text: prompts::tool_block("past_claims", lines), is_error: false, step: step("Evidence Engine", "search_past_claims", summary, reason, vec![]), read: Some(EvidenceSource::PastClaims) }
                }
                Err(e) => {
                    let lines = p.precedents.iter().map(|r| format!("{} (similarity {:.2}): outcome {}, paid {}: {}", r.reference, r.score, r.outcome, format_cents(r.payout_cents), r.narrative));
                    let text = format!("The Evidence Engine is unavailable ({e:#}). The claims it ranked when the claim was checked:\n{}", prompts::tool_block("past_claims", lines));
                    Ran { text, is_error: true, step: step("Evidence Engine", "search_past_claims", "The Evidence Engine search failed".into(), &format!("{e:#}"), vec![]), read: Some(EvidenceSource::PastClaims) }
                }
            }
        }
        "past_claim_stats" => {
            let kind = str_input(t, "incident_kind");
            if !["sos", "fall", "property"].contains(&kind) {
                return error(format!("unknown incident kind {kind:?}"));
            }
            match evidence.stats(kind).await {
                Ok(rows) => {
                    let parts: Vec<String> = rows
                        .iter()
                        .map(|r| format!("{} {} (median {}, largest {})", r.claims, r.outcome, format_cents(r.median_paid_cents.max(0) as u64), format_cents(r.max_paid_cents.max(0) as u64)))
                        .collect();
                    let summary = if parts.is_empty() { format!("Past {kind} claims: none decided yet") } else { format!("Past {kind} claims: {}", parts.join(", ")) };
                    Ran { text: prompts::tool_block("past_claim_stats", parts), is_error: false, step: step("Evidence Engine", "past_claim_stats", summary, reason, vec![]), read: Some(EvidenceSource::PastClaims) }
                }
                Err(e) => Ran {
                    text: format!("The Evidence Engine is unavailable: {e:#}"),
                    is_error: true,
                    step: step("Evidence Engine", "past_claim_stats", "The Evidence Engine count failed".into(), &format!("{e:#}"), vec![]),
                    read: None,
                },
            }
        }
        other => error(format!("there is no tool {other}")),
    }
}

/// Runs the investigation: tool turns until Claude answers, at most
/// `TOOL_TURNS` of them, then validation with `RETRIES` more tries. Each step
/// goes to `steps` as it happens. A failed call is a `JobError` with every call made.
pub async fn investigate<M: Model, E: PastClaims>(model: &M, evidence: &E, p: &ReviewPayload, tz: i32, steps: &UnboundedSender<Step>) -> Result<Done, JobError> {
    let seqs: Vec<u32> = p.facts.iter().map(|f| f.seq).collect();
    let allowed = allowed_amounts(p);
    let must = required_reading(p);
    let sources: Vec<(&str, usize)> = READABLE.iter().map(|(s, _)| (s.as_str(), facts_of(p, *s).len())).collect();
    let mut request = tools(MessageRequest::new())
        .system(prompts::INVESTIGATE_SYSTEM)
        .text(prompts::brief_prompt(p, &sources))
        .json_schema(agent_decision_schema())
        .max_tokens(MAX_TOKENS);
    let mut calls: Vec<ModelCallIn> = Vec::new();
    let mut all_steps: Vec<Step> = Vec::new();
    let mut read: Vec<EvidenceSource> = Vec::new();
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
            .and_then(|d| validate_decision(&d, &seqs, &p.checks, &allowed, &read, &must).map(|_| d));
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
            let summary = match d.decision {
                bandit_insurance::decision::Choice::Pay => format!("Decided to pay {}", format_cents(p.amounts.payout_cents)),
                bandit_insurance::decision::Choice::Refuse => "Decided to refuse".to_string(),
                bandit_insurance::decision::Choice::AskOrganizer => "Decided to ask the organizer".to_string(),
            };
            emit(step("Claude", "decide", summary, &d.summary, d.cited_fact_ids.clone()), &mut all_steps);
        }
        return Ok(Done { investigation: Investigation { decision: answer, steps: all_steps, sources_read: read }, checked, calls });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use crate::testdata;

    struct FakeEvidence;

    impl PastClaims for FakeEvidence {
        async fn search(&self, query: &str, _: i64) -> anyhow::Result<Vec<SimilarClaim>> {
            Ok(vec![SimilarClaim {
                doc_id: "history-04".into(),
                outcome: "refused".into(),
                narrative: format!("matched {query}"),
                score: 0.88,
                incident_kind: "fall".into(),
                ..Default::default()
            }])
        }

        async fn stats(&self, _: &str) -> anyhow::Result<Vec<OutcomeStats>> {
            Ok(vec![OutcomeStats { outcome: "approved".into(), claims: 12, median_paid_cents: 18_000, max_paid_cents: 89_500 }])
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
            "refusal_checks": [], "question": "", "cited_fact_ids": [p.facts[0].seq]
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
        let model = FakeModel::new(vec![
            Ok(reads(&["band", "light_circle", "hospital_report"])),
            Ok(json!({"_tools": [tool("s1", "search_past_claims", json!({"query": "wrist sprain after a fall at the main stage", "reason": "how were these decided"})),
                                 tool("s2", "past_claim_stats", json!({"incident_kind": "fall", "reason": "base rates"}))]})),
            Ok(pay(&p)),
        ]);
        let (done, live) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        assert_eq!(done.calls.len(), 3);
        assert_eq!(done.investigation.sources_read, [EvidenceSource::Band, EvidenceSource::LightCircle, EvidenceSource::HospitalReport, EvidenceSource::PastClaims]);
        let summaries: Vec<&str> = live.iter().map(|s| s.summary.as_str()).collect();
        assert!(summaries[1].starts_with("Read the light circle: "), "{summaries:?}");
        assert_eq!(summaries[3], "Searched past claims for \"wrist sprain after a fall at the main stage\": 1 found, 1 refused");
        assert_eq!(summaries[4], "Past fall claims: 12 approved (median $180.00, largest $895.00)");
        assert_eq!(summaries[5], "The light circle supports the claim");
        assert_eq!(summaries[6], "Decided to pay $895.00");
        assert_eq!(live, done.investigation.steps, "every step was reported live");
        assert_eq!(live[3].actor, "Evidence Engine");

        let body = model.body(1);
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[1]["role"], "assistant");
        let results = messages[2]["content"].as_array().unwrap();
        assert_eq!(results.len(), 3, "one tool_result per call, in one user turn");
        assert!(results[2]["content"].as_str().unwrap().contains("history of present illness"), "{}", results[2]);
        assert_eq!(body["tools"].as_array().unwrap().len(), 4);
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
    async fn names_never_reach_the_evidence_engine() {
        let p = testdata::review_payload();
        let first = p.claimant_name.split_whitespace().next().unwrap().to_string();
        let t = ToolUse { id: "s".into(), name: "search_past_claims".into(), input: json!({"query": format!("{first} fell at the stage"), "reason": "r"}) };
        let ran = run_tool(&t, &p, &FakeEvidence, -420).await;
        assert!(ran.is_error && ran.text.contains("names the claimant"), "{}", ran.text);
    }

    #[tokio::test]
    async fn the_last_turn_has_no_tools() {
        let mut p = testdata::review_payload();
        p.checks.retain(|c| c.result != bandit_insurance::CheckResult::Fail);
        let mut answers: Vec<Result<Value, String>> = (0..TOOL_TURNS).map(|_| Ok(reads(&["zone"]))).collect();
        answers.push(Ok(json!({"decision": "ask_organizer", "causation": "unclear", "summary": "Not enough to decide.",
            "findings": [{"source": "zone", "stance": "neutral", "detail": "zone only", "fact_ids": []}], "trusted_source": "",
            "concerns": [], "innocent_explanations": [], "missing_evidence": [], "refusal_checks": [],
            "question": "Can you check the camera?", "cited_fact_ids": []})));
        let model = FakeModel::new(answers);
        let (done, _) = run_with(&model, &p).await;
        assert!(done.checked.is_ok(), "{:?}", done.checked);
        let last = model.body(TOOL_TURNS);
        assert_eq!(last["tool_choice"], json!({"type": "none"}));
    }
}
