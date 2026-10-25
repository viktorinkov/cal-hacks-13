//! `clinic_report`: Claude writes the hospital's report for the case the module
//! drew, code checks it against the case, and the rendered text is stored for staff.

use bandit_insurance::clinic::{REPORT_PAGES, Scenario, check_report, render_text};
use bandit_insurance::medical::{ExtractedRecord, validate_record};
use bandit_insurance::payloads::ClinicPayload;
use bandit_insurance::schemas::medical_record_schema;
use claude_client::{Effort, MessageRequest};
use serde_json::Value;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::prompts;
use crate::sink::Finish;

pub async fn run(ctx: &Ctx, job: &JobIn, p: ClinicPayload) -> Result<(), JobError> {
    let Tries { checked, calls, .. } = write_report(&ctx.claude, &p).await?;
    let record = match checked {
        Ok(r) => r,
        Err(problems) => return Err(JobError { error: format!("hospital report still off its case: {}", problems.join("; ")), calls }),
    };
    let text = render_text(&record);
    let blob = ctx.blobs.put(text.as_bytes()).map_err(|e| JobError::msg(format!("storing the hospital report: {e}")))?;
    ctx.sink.register_text(&blob, "hospital_report").await?;
    tracing::info!(job_id = job.id, claim_id = p.claim_id, scenario = %p.scenario, provider = %record.provider.name, "hospital report written");
    let record_json = serde_json::to_string(&record).map_err(|e| JobError::msg(format!("encoding the hospital report: {e}")))?;
    ctx.sink.finish(job.id, Finish::ClinicReport { record_json, file_hash: blob.sha256 }, calls).await?;
    Ok(())
}

/// Writes the report; one that is off its case is sent back once with the problems.
pub async fn write_report<M: Model>(model: &M, p: &ClinicPayload) -> Result<Tries<ExtractedRecord>, JobError> {
    let case = Scenario::parse(&p.scenario).ok_or_else(|| JobError::msg(format!("unknown hospital report case {}", p.scenario)))?;
    let prompt = prompts::clinic_prompt(p, case);
    let request = || MessageRequest::new().system(prompts::CLINIC_SYSTEM).text(prompt.clone()).json_schema(medical_record_schema());
    let check = |v: &Value| {
        let record: ExtractedRecord = serde_json::from_value(v.clone()).map_err(|e| vec![format!("not a record: {e}")])?;
        check_report(p, &record)?;
        validate_record(record, REPORT_PAGES).map(|v| v.record)
    };
    ask_twice(model, "clinic_report", Effort::Medium, request, check).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use crate::testdata;

    /// The urgent care record of the fixtures, dated `date` throughout.
    fn report(date: &str) -> Value {
        let mut v: Value = serde_json::from_str(include_str!("../../../fixtures/medical-records/expected/urgent-care-wrist.json")).unwrap();
        v["encounter"]["date_of_service"] = date.into();
        for s in v["services"].as_array_mut().unwrap() {
            s["date_of_service"] = date.into();
        }
        v
    }

    #[tokio::test]
    async fn a_report_off_the_visit_date_is_sent_back() {
        let p = testdata::clinic_payload();
        let model = FakeModel::new(vec![Ok(report("2026-10-23")), Ok(report("2026-10-24"))]);
        let tries = write_report(&model, &p).await.ok().unwrap();
        assert_eq!(tries.json, report("2026-10-24"));
        let record = tries.checked.unwrap();
        assert_eq!((record.patient.name.as_str(), record.encounter.date_of_service.as_str()), ("Jordan Alvarez", "2026-10-24"));
        assert_eq!(tries.calls.len(), 2);
        let first = model.text_of(0);
        assert!(first.contains("<case>\nThe report matches the incident") && first.contains("visit date: 2026-10-24"), "{first}");
        assert!(first.contains(&p.statement) && first.contains(&p.medic_notes[0]), "{first}");
        let retry = model.text_of(1);
        assert!(retry.contains("the visit date must be 2026-10-24, not 2026-10-23"), "{retry}");
        assert!(render_text(&record).contains("Patient: Jordan Alvarez"));
    }
}
