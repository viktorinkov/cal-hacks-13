//! `clinic_report`: an Elastic Workflow writes the hospital's report for the
//! case the module drew. Code checks it against that case and prints a PDF:
//! the clinical note on page 1, the itemized bill on page 2. Filing it queues a
//! separate `document_read` job, which reads the PDF through the Evidence Engine.

use bandit_insurance::clinic::{REPORT_PAGES, Scenario, check_report, printed_pages};
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
    let model = ctx.elastic_model().await?;
    let Tries { checked, calls, .. } = write_report(&model, &p).await?;
    let record = match checked {
        Ok(r) => r,
        Err(problems) => return Err(JobError { error: format!("hospital report still off its case: {}", problems.join("; ")), calls }),
    };
    let pdf = crate::print::text_pdf(&printed_pages(&record)).map_err(|e| JobError { error: format!("printing the hospital report: {e:#}"), calls: calls.clone() })?;
    let blob = ctx.blobs.put(&pdf).map_err(|e| JobError { error: format!("storing the hospital report: {e}"), calls: calls.clone() })?;
    ctx.sink.register_staff(&blob, "hospital_report", "application/pdf").await?;
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
        let pdf = crate::print::text_pdf(&printed_pages(&record)).unwrap();
        assert_eq!(crate::document::page_count(&pdf), REPORT_PAGES);
        let note = lopdf::Document::load_mem(&pdf).unwrap().extract_text(&[1]).unwrap();
        assert!(note.contains("Patient: Jordan Alvarez"), "{note}");
    }

    #[tokio::test]
    async fn an_unknown_case_never_reaches_the_writer() {
        let mut p = testdata::clinic_payload();
        p.scenario = "unrecognized".into();
        let model = FakeModel::default();
        let error = write_report(&model, &p).await.err().unwrap();
        assert!(error.error.contains("unknown hospital report case unrecognized"));
        assert!(error.calls.is_empty());
        assert_eq!(model.calls(), 0);
    }

    #[tokio::test]
    async fn a_writer_cannot_replace_the_seeded_case_with_a_matching_report() {
        let mut p = testdata::clinic_payload();
        p.scenario = "hurt_at_home".into();
        let model = FakeModel::new(vec![Ok(report(&p.visit_date)), Ok(report(&p.visit_date))]);
        let tries = write_report(&model, &p).await.ok().unwrap();
        let problems = tries.checked.unwrap_err();
        assert!(problems.iter().any(|p| p.contains("history must say the injury happened at home")), "{problems:?}");
        assert_eq!(tries.calls.len(), 2);
        assert_eq!(tries.calls[0].kind, "clinic_report");
        assert_eq!(tries.calls[1].kind, "clinic_report_retry");
        assert!(model.text_of(0).contains("The patient was hurt at home"));
        assert!(model.text_of(1).contains("history must say the injury happened at home"));
    }

    #[tokio::test]
    async fn a_retry_failure_keeps_both_call_records() {
        let p = testdata::clinic_payload();
        let model = FakeModel::new(vec![Ok(report("2026-10-23")), Err("workflow timed out".into())]);
        let error = write_report(&model, &p).await.err().unwrap();
        assert_eq!(error.error, "workflow timed out");
        assert_eq!(error.calls.len(), 2);
        assert_eq!(error.calls[0].kind, "clinic_report");
        assert_eq!(error.calls[1].kind, "clinic_report_retry");
        assert_eq!(error.calls[1].status, "error");
    }

}
