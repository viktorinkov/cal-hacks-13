//! `rule_proposal`: Claude reads the approved precedents of one shape of claim and proposes the payment
//! rule they share, for the organizer to approve. Code checks it cites at least three of them, that its
//! ceiling is the highest payout among the cited claims and inside the policy's per-claim limit; the module
//! checks again, and only the organizer can turn it into a rule.

use bandit_insurance::payloads::{KIND_RULE_PROPOSAL, RuleProposalPayload};
use bandit_insurance::rules::{ProposedRule, check_proposal};
use claude_client::{Effort, MessageRequest};
use serde_json::{Value, json};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::prompts::escape;
use crate::sink::Finish;

pub const KIND: &str = KIND_RULE_PROPOSAL;

const SYSTEM: &str = "You are the insurance Decision Engine of BandIt, which settles injury and property claims at a live \
event. The organizer has approved several claims of the same shape (incident kind and cover) one by one. Your job is to \
propose one general payment rule they share, so the next alike claim is paid without waiting for a person. The organizer \
approves or rejects your proposal; you never approve it.\n\
Rules:\n\
- Cite at least three claims from `approved`, by `claim_id`, that share one pattern: the same kind of injury and \
treatment, at alike amounts. Leave out a claim that does not fit.\n\
- The ceiling is the highest `payout_cents` among the claims you cite, never more, and never above `limit_cents`.\n\
- `rule` is one sentence the organizer approves, for example \"Pay first-aid wrist sprains from falls under medical \
payments cover up to $180.00 when the evidence is corroborated and every check passes.\"\n\
- `summary` says in at most two sentences why, using only facts from the data: the diagnoses, the treatment, the \
amounts and who approved them. Mention a refused claim of the same shape when it matters.\n\
- When the approved claims share no pattern worth a rule, answer `propose: false` with the reason in `summary`.\n\
- Never invent claims, amounts or diagnoses.";

fn prompt(p: &RuleProposalPayload) -> String {
    let data = serde_json::to_string_pretty(p).unwrap_or_default();
    format!("<precedents>\n{}\n</precedents>\n\nPropose the rule.", escape(&data))
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "propose": {"type": "boolean"},
            "precedent_claim_ids": {"type": "array", "items": {"type": "integer"}},
            "ceiling_cents": {"type": "integer"},
            "rule": {"type": "string"},
            "summary": {"type": "string"}
        },
        "required": ["propose", "precedent_claim_ids", "ceiling_cents", "rule", "summary"],
        "additionalProperties": false
    })
}

/// The proposal, or what is wrong with it.
fn check(v: &Value, p: &RuleProposalPayload) -> Result<ProposedRule, Vec<String>> {
    let proposed: ProposedRule = serde_json::from_value(v.clone()).map_err(|e| vec![format!("not a proposal: {e}")])?;
    let offered: Vec<(u64, u64)> = p.approved.iter().map(|a| (a.claim_id, a.payout_cents)).collect();
    check_proposal(&proposed, &offered, p.limit_cents).map(|_| proposed)
}

pub async fn propose<M: Model>(model: &M, p: &RuleProposalPayload) -> Result<Tries<ProposedRule>, JobError> {
    let request = || MessageRequest::new().system(SYSTEM).text(prompt(p)).json_schema(schema());
    ask_twice(model, KIND, Effort::Medium, request, |v| check(v, p)).await
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: RuleProposalPayload) -> Result<(), JobError> {
    let tries = propose(&ctx.claude, &p).await?;
    let proposed = tries.checked.map_err(|e| JobError { error: e.join("; "), calls: tries.calls.clone() })?;
    tracing::info!(job_id = job.id, proposal_id = p.proposal_id, propose = proposed.propose, ceiling = proposed.ceiling_cents, "rule proposed");
    let proposal_json = serde_json::to_string(&proposed).map_err(|e| JobError::msg(format!("encoding the proposal: {e}")))?;
    ctx.sink.finish(job.id, Finish::RuleProposal { proposal_json }, tries.calls).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use bandit_insurance::payloads::ApprovedPrecedent;

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
            refused: vec![],
        }
    }

    fn answer(ids: &[u64], ceiling: u64) -> Value {
        json!({"propose": true, "precedent_claim_ids": ids, "ceiling_cents": ceiling, "rule": "Pay first-aid wrist sprains up to $180.00.", "summary": "Three alike sprains."})
    }

    #[tokio::test]
    async fn a_ceiling_above_the_precedents_is_asked_again() {
        let model = FakeModel::new(vec![Ok(answer(&[2, 4, 7], 25_000)), Ok(answer(&[2, 4, 7], 18_000))]);
        let tries = propose(&model, &payload()).await.ok().unwrap();
        let p = tries.checked.unwrap();
        assert_eq!((p.ceiling_cents, p.precedent_claim_ids.clone()), (18_000, vec![2, 4, 7]));
        assert_eq!(model.calls(), 2);
        assert!(model.text_of(0).contains("Sprain of right wrist"));
        assert!(model.text_of(1).contains("the ceiling must be 18000 cents"), "{}", model.text_of(1));
    }

    #[test]
    fn two_precedents_make_no_rule() {
        let problems = check(&answer(&[2, 4], 18_000), &payload()).unwrap_err();
        assert!(problems[0].contains("at least 3"), "{problems:?}");
    }
}
