//! `rule_proposal`: the Evidence Engine counts the organizer's approved precedents of one shape of claim and
//! proposes the payment rule they share, for the organizer to approve. The worker finds each precedent's copy in
//! `bandit-claims`, and the workflow `bandit-propose-rule` has the Elastic agent `bandit-rule-proposer` count those
//! copies with its ES|QL tool and write the rule. Code checks it cites at least three of them, that its ceiling is
//! the highest payout among the cited claims and inside the policy's per-claim limit; the module checks again, and
//! only the organizer can turn it into a rule.

use std::future::Future;
use std::time::{Duration, Instant};

use anyhow::bail;
use bandit_insurance::money::format_cents;
use bandit_insurance::payloads::{KIND_RULE_PROPOSAL, RuleProposalPayload};
use bandit_insurance::rules::{ProposedRule, check_proposal};
use claims_elastic::{ClaimsIndex, Kibana, proposer, reader};
use serde_json::{Value, json};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Answer, Failed, Tries, new_call, truncate};
use crate::prompts;
use crate::sink::Finish;

pub const KIND: &str = KIND_RULE_PROPOSAL;

const POLL_EVERY: Duration = Duration::from_secs(5);
const WORKFLOW_LIMIT: Duration = Duration::from_secs(10 * 60);
/// Longest answer kept in the call record.
const MAX_RESPONSE_CHARS: usize = 20_000;

/// The shape, the policy and the precedents, as the agent reads them.
fn task(p: &RuleProposalPayload, missing: &[u64]) -> String {
    let money = |c: u64| format!("{c} cents ({})", format_cents(c));
    let mut lines = vec![
        format!("Venue: {}, policy {}.", p.venue_name, p.policy_number),
        format!("Shape: {} claims under {} cover.", p.incident_kind, p.cover_kind),
        format!("The cover's per-claim limit: {}. Minimum payout: {}.", money(p.limit_cents), money(p.minimum_payout_cents)),
        match &p.rule_in_force {
            Some(r) => format!("Rule in force: version {}, pays up to {}.", r.version, money(r.ceiling_cents)),
            None => "Rule in force: none.".into(),
        },
        String::new(),
        "Approved precedents, which you may cite:".into(),
    ];
    for a in &p.approved {
        lines.push(format!(
            "- claim {}: {}, {}, payout {}, billed {}, covered {}; diagnoses {}; service codes {}; {}; approved by {} at {}.",
            a.claim_id,
            a.claimant,
            a.zone,
            money(a.payout_cents),
            a.billed_cents,
            a.covered_cents,
            list(&a.diagnoses),
            list(&a.service_codes),
            a.corroboration,
            a.approver,
            a.decided_at
        ));
    }
    lines.push(String::new());
    lines.push("Refused precedents, never cited:".into());
    if p.refused.is_empty() {
        lines.push("- none".into());
    }
    for r in &p.refused {
        lines.push(format!("- claim {}: {}, {}, payout {}; refused because {}", r.claim_id, r.claimant, r.zone, money(r.payout_cents), r.reason));
    }
    if !missing.is_empty() {
        let ids: Vec<String> = missing.iter().map(u64::to_string).collect();
        lines.push(String::new());
        lines.push(format!("Not in the claims index yet, so the tool cannot count them: claims {}.", ids.join(", ")));
    }
    lines.join("\n")
}

fn list(items: &[String]) -> String {
    if items.is_empty() { "none".into() } else { items.join(", ") }
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "propose": {"type": "boolean", "description": "false when the approved claims share no pattern worth a rule"},
            "precedent_claim_ids": {"type": "array", "items": {"type": "integer"}, "description": "the approved claims the rule rests on"},
            "ceiling_cents": {"type": "integer", "description": "the highest payout among the cited claims"},
            "rule": {"type": "string", "description": "the rule in one sentence"},
            "summary": {"type": "string", "description": "why, in at most two sentences"}
        },
        "required": ["propose", "precedent_claim_ids", "ceiling_cents", "rule", "summary"]
    })
}

/// The proposal, or what is wrong with it.
fn check(v: &Value, p: &RuleProposalPayload) -> Result<ProposedRule, Vec<String>> {
    let proposed: ProposedRule = serde_json::from_value(v.clone()).map_err(|e| vec![format!("not a proposal: {e}")])?;
    let offered: Vec<(u64, u64)> = p.approved.iter().map(|a| (a.claim_id, a.payout_cents)).collect();
    check_proposal(&proposed, &offered, p.limit_cents).map(|_| proposed)
}

/// Asks once; when code rejects the answer, asks once more with the answer and the problems. `ask` gets the
/// try's number and, on the second try, the note to add to the task.
pub async fn propose<F, Fut>(p: &RuleProposalPayload, mut ask: F) -> Result<Tries<ProposedRule>, JobError>
where
    F: FnMut(u32, Option<String>) -> Fut,
    Fut: Future<Output = Result<Answer, Failed>>,
{
    let mut calls = Vec::new();
    let first = ask(1, None).await.map_err(|f| JobError::from_call(f, &mut calls))?;
    calls.push(first.call);
    let checked = check(&first.json, p);
    let Err(problems) = checked else {
        return Ok(Tries { json: first.json, checked, calls });
    };
    tracing::info!(proposal_id = p.proposal_id, problems = %problems.join("; "), "proposal rejected, asking again");
    let second = ask(2, Some(prompts::retry_note(&first.json, &problems))).await.map_err(|f| JobError::from_call(f, &mut calls))?;
    calls.push(second.call);
    let checked = check(&second.json, p);
    Ok(Tries { json: second.json, checked, calls })
}

/// Each precedent's newest copy in the claims index, and the claims that have none. An approved claim whose
/// letters have not yet recorded its outcome gets the organizer's approval on its copy, so it is counted.
async fn copies(es: &ClaimsIndex, p: &RuleProposalPayload) -> anyhow::Result<(Vec<String>, Vec<u64>)> {
    let approved = p.approved.iter().map(|a| (a.claim_id, Some(a.payout_cents)));
    let refused = p.refused.iter().map(|r| (r.claim_id, None));
    let (mut doc_ids, mut missing) = (Vec::new(), Vec::new());
    for (claim_id, approved_payout) in approved.chain(refused) {
        let Some(copy) = es.newest_copy(claim_id as i64).await? else {
            missing.push(claim_id);
            continue;
        };
        if let Some(payout) = approved_payout.filter(|_| copy.outcome.is_empty()) {
            es.set_outcome(copy.claim_id, copy.pack_version, "approved", payout).await?;
        }
        doc_ids.push(copy.doc_id);
    }
    Ok((doc_ids, missing))
}

/// One run of `bandit-propose-rule`, and its record as a model call: the agent, the connector it ran on, the time
/// the run took and its answer.
async fn run_agent(es: &ClaimsIndex, kibana: &Kibana, proposal_id: u64, doc_ids: &str, try_no: u32, task: String) -> Result<Answer, Failed> {
    let key = format!("proposal-{proposal_id}-{try_no}");
    let inputs = json!({
        "proposal_key": key,
        "claims_index": es.index(),
        "doc_ids": doc_ids,
        "task": task,
        "schema": schema().to_string(),
        "proposals_index": es.proposals_index(),
    });
    let mut call = new_call(if try_no == 1 { KIND } else { "rule_proposal_retry" });
    call.model_requested = proposer::AGENT.into();
    call.request_hash = claude_client::request_hash(&inputs);
    let started = Instant::now();
    let saved = async {
        es.delete_rule_answer(&key).await?;
        let execution = kibana.run_workflow(proposer::WORKFLOW, inputs).await?;
        tracing::info!(proposal_id, try_no, execution = %execution, "{} started", proposer::WORKFLOW);
        let done = kibana.wait_for(&execution, POLL_EVERY, WORKFLOW_LIMIT).await?;
        if done["status"] != "completed" {
            bail!("{} execution {execution} {}", proposer::WORKFLOW, reader::failure(&done));
        }
        es.rule_answer(&key).await
    }
    .await;
    call.latency_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
    match saved {
        Ok(saved) => {
            call.status = "ok".into();
            call.model_used = saved["model"].as_str().unwrap_or_default().into();
            call.stop_reason = "completed".into();
            (call.input_tokens, call.output_tokens) = tokens(&saved["usage"]);
            call.response = truncate(&saved["answer"].to_string(), MAX_RESPONSE_CHARS);
            Ok(Answer { json: saved["answer"].clone(), call })
        }
        Err(e) => {
            call.status = "error".into();
            call.error = format!("{e:#}");
            Err(Failed { error: call.error.clone(), call })
        }
    }
}

/// Input and output tokens from the agent's usage, when it reports them.
fn tokens(usage: &Value) -> (u32, u32) {
    let first = |keys: &[&str]| keys.iter().find_map(|k| usage[*k].as_u64()).unwrap_or(0).min(u32::MAX as u64) as u32;
    (first(&["input_tokens", "inputTokens", "prompt_tokens"]), first(&["output_tokens", "outputTokens", "completion_tokens"]))
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: RuleProposalPayload) -> Result<(), JobError> {
    let (es, kibana) = ctx.proposer().await?;
    let (doc_ids, missing) = copies(es, &p).await?;
    if !missing.is_empty() {
        tracing::warn!(job_id = job.id, proposal_id = p.proposal_id, ?missing, "precedents with no copy in the claims index");
    }
    let doc_ids = doc_ids.join(",");
    let base = task(&p, &missing);
    let tries = propose(&p, |try_no, note| {
        let task = note.map_or_else(|| base.clone(), |n| format!("{base}\n\n{n}"));
        run_agent(es, kibana, p.proposal_id, &doc_ids, try_no, task)
    })
    .await?;
    let proposed = tries.checked.map_err(|e| JobError { error: e.join("; "), calls: tries.calls.clone() })?;
    tracing::info!(job_id = job.id, proposal_id = p.proposal_id, propose = proposed.propose, ceiling = proposed.ceiling_cents, "rule proposed");
    let proposal_json = serde_json::to_string(&proposed).map_err(|e| JobError::msg(format!("encoding the proposal: {e}")))?;
    ctx.sink.finish(job.id, Finish::RuleProposal { proposal_json }, tries.calls).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bandit_insurance::payloads::{ApprovedPrecedent, RefusedPrecedent};
    use std::sync::Mutex;

    fn payload() -> RuleProposalPayload {
        let precedent = |claim_id: u64, claimant: &str| ApprovedPrecedent {
            claim_id,
            claimant: claimant.into(),
            zone: "Sponsor row".into(),
            payout_cents: 18_000,
            billed_cents: 18_000,
            covered_cents: 18_000,
            diagnoses: vec!["S63.501A Sprain of right wrist, initial encounter".into()],
            service_codes: vec!["99211".into(), "A9273".into()],
            corroboration: "corroborated".into(),
            approver: "Ops desk".into(),
            decided_at: "2026-10-24 22:40".into(),
        };
        RuleProposalPayload {
            proposal_id: 1,
            venue_name: "Cal Hacks 13.0".into(),
            incident_kind: "fall".into(),
            cover_kind: "medical_payments".into(),
            policy_number: "GL-2026-04417".into(),
            limit_cents: 500_000,
            minimum_payout_cents: 0,
            rule_in_force: None,
            approved: vec![precedent(2, "Maya Chen"), precedent(4, "Sam Patel"), precedent(7, "Lee Park")],
            refused: vec![RefusedPrecedent { claim_id: 5, claimant: "Jordan Alvarez".into(), zone: "Food line".into(), payout_cents: 9_500, reason: "hurt at home".into() }],
        }
    }

    fn answer(ids: &[u64], ceiling: u64) -> Value {
        json!({"propose": true, "precedent_claim_ids": ids, "ceiling_cents": ceiling, "rule": "Pay first-aid wrist sprains up to $180.00.", "summary": "Three alike sprains."})
    }

    /// Serves `answers` in order and keeps each try's number and note.
    async fn propose_with(answers: Vec<Value>) -> (Result<Tries<ProposedRule>, JobError>, Vec<(u32, Option<String>)>) {
        let answers = Mutex::new(answers.into_iter());
        let seen = Mutex::new(Vec::new());
        let tries = propose(&payload(), |try_no, note| {
            seen.lock().unwrap().push((try_no, note));
            let json = answers.lock().unwrap().next().unwrap();
            async move { Ok(Answer { json, call: new_call(KIND) }) }
        })
        .await;
        (tries, seen.into_inner().unwrap())
    }

    #[tokio::test]
    async fn a_ceiling_above_the_precedents_is_asked_again() {
        let (tries, seen) = propose_with(vec![answer(&[2, 4, 7], 25_000), answer(&[2, 4, 7], 18_000)]).await;
        let tries = tries.ok().unwrap();
        let p = tries.checked.unwrap();
        assert_eq!((p.ceiling_cents, p.precedent_claim_ids.clone(), tries.calls.len()), (18_000, vec![2, 4, 7], 2));
        assert_eq!((seen[0].0, seen[0].1.is_none(), seen[1].0), (1, true, 2));
        let note = seen[1].1.as_deref().unwrap();
        assert!(note.contains("the ceiling must be 18000 cents") && note.contains("25000"), "{note}");
    }

    #[tokio::test]
    async fn a_good_answer_is_asked_once() {
        let (tries, seen) = propose_with(vec![answer(&[2, 4, 7], 18_000)]).await;
        assert_eq!((tries.ok().unwrap().calls.len(), seen.len()), (1, 1));
    }

    #[test]
    fn two_precedents_make_no_rule() {
        let problems = check(&answer(&[2, 4], 18_000), &payload()).unwrap_err();
        assert!(problems[0].contains("at least 3"), "{problems:?}");
    }

    #[test]
    fn the_task_lists_every_precedent_with_its_people() {
        let t = task(&payload(), &[9]);
        assert!(t.contains("Shape: fall claims under medical_payments cover."), "{t}");
        assert!(t.contains("per-claim limit: 500000 cents ($5,000.00)"), "{t}");
        assert!(t.contains("- claim 2: Maya Chen, Sponsor row, payout 18000 cents ($180.00)"), "{t}");
        assert!(t.contains("diagnoses S63.501A Sprain of right wrist, initial encounter; service codes 99211, A9273; corroborated; approved by Ops desk"), "{t}");
        assert!(t.contains("- claim 5: Jordan Alvarez, Food line, payout 9500 cents ($95.00); refused because hurt at home"), "{t}");
        assert!(t.contains("cannot count them: claims 9."), "{t}");
    }

    #[test]
    fn tokens_come_from_whichever_names_the_usage_uses() {
        assert_eq!(tokens(&json!({"input_tokens": 1200, "output_tokens": 80, "connectorId": "x"})), (1200, 80));
        assert_eq!(tokens(&json!({"connectorId": "x"})), (0, 0));
    }
}
