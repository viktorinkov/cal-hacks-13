//! `claim_record_extract`: Claude reads the medical record PDF into a structured record.

use claude_client::{Effort, MessageRequest};
use bandit_insurance::medical::{ExtractedRecord, ValidRecord, validate_record};
use bandit_insurance::payloads::RecordExtractPayload;
use bandit_insurance::schemas::medical_record_schema;
use serde_json::Value;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::prompts;
use crate::sink::Finish;

pub async fn run(ctx: &Ctx, job: &JobIn, p: RecordExtractPayload) -> Result<(), JobError> {
    let pdf = ctx.blobs.get(&p.file_hash).map_err(|e| JobError::msg(format!("reading PDF {}: {e}", p.file_hash)))?;
    let tries = read_record(&ctx.claude, &pdf, p.page_count).await?;
    if let Err(problems) = &tries.checked {
        tracing::warn!(job_id = job.id, problems = %problems.join("; "), "record still invalid, the module will route it");
    }
    let record_json = tries.json.to_string();
    ctx.sink.finish(job.id, Finish::MedicalRecord { record_json }, tries.calls).await?;
    Ok(())
}

/// Reads the PDF; a record code rejects is asked for once more.
pub async fn read_record<M: Model>(model: &M, pdf: &[u8], page_count: u32) -> Result<Tries<ValidRecord>, JobError> {
    let request = || {
        MessageRequest::new()
            .system(prompts::EXTRACT_SYSTEM)
            .pdf(pdf)
            .text(prompts::extract_prompt(page_count))
            .json_schema(medical_record_schema())
    };
    ask_twice(model, "claim_record_extract", Effort::Medium, request, |v| check(v, page_count)).await
}

fn check(v: &Value, page_count: u32) -> Result<ValidRecord, Vec<String>> {
    let raw: ExtractedRecord = serde_json::from_value(v.clone()).map_err(|e| vec![format!("not a record: {e}")])?;
    validate_record(raw, page_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;

    fn expected() -> Value {
        serde_json::from_str(include_str!("../../../fixtures/medical-records/expected/urgent-care-wrist.json")).unwrap()
    }

    #[tokio::test]
    async fn a_bad_page_is_sent_back_once() {
        let mut bad = expected();
        bad["encounter"]["page"] = 3.into();
        let model = FakeModel::new(vec![Ok(bad), Ok(expected())]);
        let tries = read_record(&model, b"%PDF-1.7", 2).await.ok().unwrap();
        assert!(tries.checked.is_ok());
        assert_eq!(tries.json, expected());
        assert!(model.text_of(1).contains("encounter page 3 is outside 1..=2"));
        let body = &model.seen.lock().unwrap()[0].1;
        assert_eq!(body["messages"][0]["content"][0]["type"], "document");
        assert_eq!(body["output_config"]["effort"], "medium");
    }
}
