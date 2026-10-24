//! `claim_review`: the claims agent's verdict on the whole pack.

use claude_client::{Effort, MessageRequest};
use hyphenate_core::Cents;
use hyphenate_core::payloads::ReviewPayload;
use hyphenate_core::review::{AgentReview, validate_review};
use hyphenate_core::schemas::agent_review_schema;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::prompts;
use crate::sink::Finish;

/// Thinking at high effort counts toward the cap, so leave room.
const MAX_TOKENS: u32 = 32_000;

pub async fn run(ctx: &Ctx, job: &JobIn, p: ReviewPayload) -> Result<(), JobError> {
    let tries = review(&ctx.claude, &p, ctx.tz_offset_minutes).await?;
    match &tries.checked {
        Ok(r) => tracing::info!(job_id = job.id, verdict = r.verdict.as_str(), causation = r.causation.as_str(), "review"),
        Err(problems) => tracing::warn!(job_id = job.id, problems = %problems.join("; "), "review still invalid, the module will route it"),
    }
    let review_json = tries.json.to_string();
    ctx.sink.finish(job.id, Finish::ClaimReview { review_json }, tries.calls).await?;
    Ok(())
}

/// The figures a review may print: the four amounts and every line's billed, allowed and covered cents.
pub fn allowed_amounts(p: &ReviewPayload) -> Vec<Cents> {
    let mut allowed = p.amounts.figures().to_vec();
    allowed.extend(p.lines.iter().flat_map(|l| [l.billed_cents, l.allowed_cents, l.covered_cents]));
    allowed
}

pub async fn review<M: Model>(model: &M, p: &ReviewPayload, tz_offset_minutes: i32) -> Result<Tries<AgentReview>, JobError> {
    let seqs: Vec<u32> = p.facts.iter().map(|f| f.seq).collect();
    let allowed = allowed_amounts(p);
    let prompt = prompts::review_prompt(p, tz_offset_minutes);
    let request = || {
        MessageRequest::new()
            .system(prompts::REVIEW_SYSTEM)
            .text(prompt.clone())
            .json_schema(agent_review_schema())
            .max_tokens(MAX_TOKENS)
    };
    let check = |v: &serde_json::Value| {
        let r: AgentReview = serde_json::from_value(v.clone()).map_err(|e| vec![format!("not a review: {e}")])?;
        validate_review(&r, &seqs, &allowed).map(|_| r)
    };
    ask_twice(model, "claim_review", Effort::High, request, check).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use crate::testdata;
    use serde_json::json;

    #[tokio::test]
    async fn an_invented_figure_is_sent_back() {
        let p = testdata::review_payload();
        let bad = json!({
            "verdict": "consistent", "causation": "supported",
            "summary": "Fall in the surge; the bill was $1,308.00 and $12.00 of it is odd.",
            "concerns": [], "innocent_explanations": [], "missing_evidence": [], "cited_fact_ids": [5, 99]
        });
        let mut good = bad.clone();
        good["summary"] = json!("Fall in the surge backed by three witnesses; covered cost $895.00.");
        good["cited_fact_ids"] = json!([5, 14]);
        let model = FakeModel::new(vec![Ok(bad), Ok(good.clone())]);
        let tries = review(&model, &p, -420).await.ok().unwrap();
        assert_eq!(tries.json, good);
        let retry = model.text_of(1);
        assert!(retry.contains("cited fact 99 is not in the pack"), "{retry}");
        assert!(retry.contains("summary figure $12.00 is not one of the claim's amounts"), "{retry}");
        assert!(retry.contains("summary figure $1,308.00"), "the bill's total is not an allowed figure: {retry}");
    }

    #[test]
    fn allowed_amounts_include_the_lines() {
        let p = testdata::review_payload();
        let allowed = allowed_amounts(&p);
        assert!(allowed.starts_with(&[89_500, 89_500, 79_500, 10_000]));
        assert!(allowed.contains(&38_500) && allowed.contains(&27_500) && allowed.contains(&6_800));
    }
}
