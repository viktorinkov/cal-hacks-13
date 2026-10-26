//! Filing an injury claim: the attendee who wore the band writes what happened,
//! or staff file for them, and the hospital report then arrives on its own.
//! Which report the hospital sends is drawn with the module's seeded generator
//! (`clinic::Scenario`); the worker writes it and code rejects one off its case.

use super::flow::*;
use super::*;
use crate::jobs::{self, ModelCallIn, blob_ref};
use crate::roles::*;
use crate::safety::*;
use bandit_insurance::clinic::{REPORT_PAGES, Scenario, check_report};
use bandit_insurance::medical::{ExtractedRecord, validate_record};
use bandit_insurance::payloads::*;
use spacetimedb::rand::Rng;
use spacetimedb::{ReducerContext, Table};

const MAX_STATEMENT_CHARS: usize = 2000;

/// The staff's report choices; `pdf` requests no report, a person files the record PDF.
const REPORT_CHOICES: [&str; 4] = ["matches", "mismatch", "random", "pdf"];

/// The attendee files the claim for an injury on the band they wore, in their own words.
#[spacetimedb::reducer]
pub fn file_claim(ctx: &ReducerContext, incident_id: u64, statement: String) -> Result<(), String> {
    file(ctx, incident_id, statement, "random", true)
}

/// Staff file the claim for the wearer, choosing which hospital report comes back:
/// `matches`, `mismatch`, `random`, or `pdf` for none (a person files the record).
#[spacetimedb::reducer]
pub fn file_claim_for_wearer(ctx: &ReducerContext, incident_id: u64, statement: String, report: String) -> Result<(), String> {
    require_role(ctx, &["ops", "medic"])?;
    file(ctx, incident_id, statement, &report, false)
}

/// Opens the injury claim for whoever wore the incident's band when it opened,
/// with their statement, then requests the hospital report unless `report` is `pdf`.
fn file(ctx: &ReducerContext, incident_id: u64, statement: String, report: &str, own: bool) -> Result<(), String> {
    let statement = statement.trim().to_string();
    let chars = statement.chars().count();
    if chars == 0 || chars > MAX_STATEMENT_CHARS {
        return Err(format!("the statement is 1 to {MAX_STATEMENT_CHARS} characters"));
    }
    if !REPORT_CHOICES.contains(&report) {
        return Err(format!("report is matches, mismatch, random or pdf, not {report}"));
    }
    let incident = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
    if !incident.resolved {
        return Err(format!("incident {incident_id} is not resolved yet"));
    }
    if !incident.kind.is_injury() || incident.subject_band == 0 {
        return Err(format!("incident {incident_id} is not an injury on a band"));
    }
    let wearer = super::people::wore_band_at(ctx, incident.subject_band, incident.opened_at)
        .ok_or_else(|| format!("nobody wore band {} when incident {incident_id} opened", incident.subject_band))?;
    if own && wearer != ctx.sender() {
        return Err(format!("only the person who wore band {} can file this claim", incident.subject_band));
    }
    if ctx.db.claim().incident_id().find(incident_id).is_some() {
        return Err(format!("incident {incident_id} already has a claim"));
    }
    let claim = open_claim_for(ctx, &incident, Some(wearer), statement)?;
    if claim.status != ClaimStatus::AwaitingRecord || report == "pdf" {
        return Ok(());
    }
    let claim = save(ctx, Claim { status_note: "waiting for the hospital report".into(), ..claim });
    request_report(ctx, &claim, &incident, report)
}

/// Draws the hospital's report with one roll of the seeded generator and queues the worker that writes it.
fn request_report(ctx: &ReducerContext, claim: &Claim, incident: &Incident, choice: &str) -> Result<(), String> {
    let roll: u32 = ctx.rng().r#gen();
    let scenario = Scenario::pick(choice, roll)?;
    let s = settings(ctx);
    let opened = micros(incident.opened_at);
    let incident_date = bandit_insurance::time::local_date(opened, s.tz_offset_minutes);
    let visit_date = scenario.visit_date(&incident_date, roll);
    let report = ctx.db.clinic_report().insert(ClinicReport {
        id: 0,
        claim_id: claim.id,
        scenario: scenario.as_str().into(),
        choice: choice.into(),
        visit_date: visit_date.clone(),
        status: "requested".into(),
        job_id: 0,
        provider_name: String::new(),
        file_hash: String::new(),
        problems: Vec::new(),
        model_call_id: 0,
        requested_by: ctx.sender(),
        requested_at: ctx.timestamp,
        received_at: None,
    });
    let mut notes: Vec<IncidentNote> = ctx.db.incident_note().incident_id().filter(incident.id).collect();
    notes.sort_by_key(|n| n.id);
    let payload = ClinicPayload {
        claim_id: claim.id,
        report_id: report.id,
        scenario: scenario.as_str().into(),
        visit_date,
        incident_date,
        incident_time: bandit_insurance::time::local_hms(opened, s.tz_offset_minutes)[..5].to_string(),
        incident_kind: claim.incident_kind.clone(),
        venue_name: s.venue_name.clone(),
        zone_name: claim.zone_name.clone(),
        claimant_name: claim.claimant_name.clone(),
        statement: claim.statement.clone(),
        medic_notes: notes.into_iter().map(|n| n.text).collect(),
    };
    let job_id = jobs::enqueue(ctx, KIND_CLINIC, serde_json::to_string(&payload).unwrap(), "claim", claim.id);
    ctx.db.clinic_report().id().update(ClinicReport { job_id, ..report });
    Ok(())
}

/// The worker's hospital report: the record it wrote and the report's PDF in
/// the blob store. Code checks the report follows its case, then the Evidence
/// Engine reads the PDF like any hospital report, and what it reads is the
/// claim's medical record.
#[spacetimedb::reducer]
pub fn file_clinic_report(ctx: &ReducerContext, job_id: u64, record_json: String, file_hash: String, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let p: ClinicPayload = serde_json::from_str(&job.payload).map_err(|e| e.to_string())?;
    let call_id = jobs::record_call(ctx, job_id, &call);
    let claim = claim_by_id(ctx, p.claim_id)?;
    let report = ctx.db.clinic_report().id().find(p.report_id).ok_or("no report")?;
    if claim.status != ClaimStatus::AwaitingRecord {
        jobs::finish(ctx, job, "the claim no longer waits for the report");
        return Ok(());
    }
    let file_hash = file_hash.to_lowercase();
    if ctx.db.blob_ref().hash().find(&file_hash).is_none() {
        return Err(format!("no stored file {file_hash}"));
    }
    let checked = serde_json::from_str::<ExtractedRecord>(&record_json)
        .map_err(|e| vec![format!("not a record: {e}")])
        .and_then(|record| check_report(&p, &record).map(|_| record))
        .and_then(|record| validate_record(record, REPORT_PAGES));
    let valid = match checked {
        Ok(v) => v,
        Err(problems) => {
            ctx.db.clinic_report().id().update(ClinicReport { status: "failed".into(), file_hash, problems: problems.clone(), model_call_id: call_id, ..report });
            jobs::finish(ctx, job, "report rejected");
            route(ctx, claim, format!("the hospital report could not be read: {}", problems.join("; ")));
            return Ok(());
        }
    };
    ctx.db.clinic_report().id().update(ClinicReport {
        status: "received".into(),
        provider_name: valid.record.provider.name.clone(),
        file_hash: file_hash.clone(),
        model_call_id: call_id,
        received_at: Some(ctx.timestamp),
        ..report
    });
    jobs::finish(ctx, job, "report received");
    read_report(ctx, claim, file_hash, REPORT_PAGES);
    Ok(())
}
