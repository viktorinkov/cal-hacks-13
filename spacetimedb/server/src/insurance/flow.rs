//! A claim's life: open from a resolved incident (or the attendee's filing, in
//! `filing`), read the medical record, verify in Elastic, Claude investigates
//! and decides, code holds the decision to its limits, the organizer decides
//! what comes to them, pay, reconcile with the insurer.

use super::evidence::*;
use super::*;
use crate::jobs::{self, Job, ModelCallIn, blob_ref, job};
use crate::venue::zone;
use crate::roles::*;
use crate::safety::*;
use bandit_insurance::coverage::{Amounts, compute_amounts};
use bandit_insurance::fee_schedule::{LineDecision, LineOutcome, cover_lines, covered_total};
use bandit_insurance::letters::LetterData;
use bandit_insurance::medical::{ExtractedRecord, ValidRecord, validate_record};
use bandit_insurance::outcome::{Decision, DecisionInput, ReviewGate, decide};
use bandit_insurance::payloads::*;
use bandit_insurance::decision::{AgentDecision, GuardInput, Investigation, guard, validate_review};
use bandit_insurance::rules::{SettlementRule, learned_ceiling, matching_rule, next_version};
use bandit_insurance::{Check, CoverKind};
use spacetimedb::{Identity, ReducerContext, Table};

pub(super) fn claim_by_id(ctx: &ReducerContext, claim_id: u64) -> Result<Claim, String> {
    ctx.db.claim().id().find(claim_id).ok_or_else(|| format!("no claim {claim_id}"))
}

pub(super) fn save(ctx: &ReducerContext, claim: Claim) -> Claim {
    let before = ctx.db.claim().id().find(claim.id);
    let saved = ctx.db.claim().id().update(Claim { updated_at: ctx.timestamp, ..claim });
    crate::live::on_claim_saved(ctx, before.as_ref(), &saved);
    saved
}

fn amounts(claim: &Claim) -> Amounts {
    Amounts {
        cost_cents: claim.cost_cents,
        payout_cents: claim.payout_cents,
        recoverable_cents: claim.recoverable_cents,
        venue_cost_cents: claim.venue_cost_cents,
    }
}

fn with_amounts(claim: Claim, a: Amounts) -> Claim {
    Claim {
        cost_cents: a.cost_cents,
        payout_cents: a.payout_cents,
        recoverable_cents: a.recoverable_cents,
        venue_cost_cents: a.venue_cost_cents,
        ..claim
    }
}

/// Amounts from the current coverage rule: the record's covered lines for an
/// injury, the staff's logged cost (the repair or the item's value) for everything else.
fn current_amounts(ctx: &ReducerContext, claim: &Claim) -> Option<Amounts> {
    let cover = cover_of(claim);
    let rule = policy_rule(ctx, claim.policy_id, cover)?;
    let cost = if cover == CoverKind::MedicalPayments {
        extracted_record(ctx, claim.id).map(|r| r.covered_cents).unwrap_or(0)
    } else {
        logged_cost(ctx, claim.incident_id)
    };
    Some(compute_amounts(cost, &core_rule(&rule), used_cents(ctx, claim)))
}

/// What staff logged on the incident's notes: the repair cost or the item's value.
fn logged_cost(ctx: &ReducerContext, incident_id: u64) -> u64 {
    ctx.db.incident_note().incident_id().filter(incident_id).filter_map(|n| n.cost_cents).sum()
}

/// Posts one journal; refuses one that does not balance.
pub(super) fn post(ctx: &ReducerContext, claim_id: u64, journal: bandit_insurance::ledger::Journal, posted_by: &str) -> Result<(), String> {
    if !journal.is_balanced() {
        return Err(format!("{} does not balance", journal.name));
    }
    if journal.is_empty() {
        return Ok(());
    }
    let s = settings(ctx);
    let journal_id = s.next_journal_id;
    ctx.db.insurance_settings().id().update(InsuranceSettings { next_journal_id: journal_id + 1, ..s });
    for line in journal.lines {
        ctx.db.ledger_entry().insert(LedgerEntry {
            id: 0,
            claim_id,
            journal_id,
            journal: journal.name.clone(),
            account: line.account.as_str().into(),
            debit_cents: line.debit_cents,
            credit_cents: line.credit_cents,
            memo: line.memo,
            posted_at: ctx.timestamp,
            posted_by: posted_by.into(),
        });
    }
    Ok(())
}

/// Opens the claim when a resolved incident of the venue's broken equipment, or
/// of an attendee's stolen or broken belonging, has a logged cost: the venue
/// claims for its equipment, the attendee who wore the band for their belonging. Injury claims
/// wait for the attendee who wore the band to file them (`file_claim`), or
/// staff to file for them.
pub fn on_incident_resolved(ctx: &ReducerContext, incident: &Incident) -> Result<(), String> {
    if incident.kind.is_injury() || ctx.db.claim().incident_id().find(incident.id).is_some() {
        return Ok(());
    }
    let has_cost = ctx.db.incident_note().incident_id().filter(incident.id).any(|n| n.cost_cents.is_some_and(|c| c > 0));
    if !has_cost {
        return Ok(());
    }
    let claimant = match incident.kind {
        IncidentKind::Theft | IncidentKind::Breakage => super::people::wore_band_at(ctx, incident.subject_band, incident.opened_at),
        _ => None,
    };
    open_claim_for(ctx, incident, claimant, String::new()).map(|_| ())
}

/// Opens a claim by hand for a resolved incident the hook skipped.
#[spacetimedb::reducer]
pub fn open_claim(ctx: &ReducerContext, incident_id: u64) -> Result<(), String> {
    require_role(ctx, CLAIM_ROLES)?;
    let incident = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
    if !incident.resolved {
        return Err(format!("incident {incident_id} is not resolved yet"));
    }
    if ctx.db.claim().incident_id().find(incident_id).is_some() {
        return Err(format!("incident {incident_id} already has a claim"));
    }
    let claimant = super::people::wore_band_at(ctx, incident.subject_band, incident.opened_at);
    open_claim_for(ctx, &incident, claimant, String::new()).map(|_| ())
}

/// Opens the claim and builds its first pack. An injury claim then waits for its record.
pub(super) fn open_claim_for(ctx: &ReducerContext, incident: &Incident, claimant: Option<Identity>, statement: String) -> Result<Claim, String> {
    let venue_policy = ctx.db.insurance_policy().iter().max_by_key(|p| p.id).ok_or("no insurance policy is set up")?;
    let kind = incident.kind.core();
    let cover = CoverKind::for_incident(kind);
    let policy_id = if cover.is_attendee_policy() {
        claimant.and_then(|c| super::own_policy::ensure(ctx, c)).map(|p| p.id).unwrap_or(0)
    } else {
        venue_policy.id
    };
    let claimant_name = claimant.map(|c| super::people::display_name(ctx, c)).unwrap_or_default();
    let zone_name = ctx.db.zone().id().find(incident.zone_id).map(|z| z.name).unwrap_or_else(|| "unzoned".into());
    let claim = ctx.db.claim().insert(Claim {
        id: 0,
        incident_id: incident.id,
        incident_kind: kind.as_str().into(),
        cover_kind: cover.as_str().into(),
        claimant,
        claimant_name,
        band_id: incident.subject_band,
        zone_id: incident.zone_id,
        zone_name,
        policy_id,
        status: ClaimStatus::AwaitingRecord,
        status_note: String::new(),
        pack_version: 0,
        pack_hash: String::new(),
        corroboration: String::new(),
        cost_cents: 0,
        payout_cents: 0,
        recoverable_cents: 0,
        venue_cost_cents: 0,
        reserved: false,
        review_verdict: String::new(),
        decided_by: String::new(),
        settlement_rule_id: 0,
        settlement_rule_version: 0,
        routed_to_role: String::new(),
        routed_to: Identity::ZERO,
        routed_to_name: String::new(),
        refusal_reason: String::new(),
        payout_reference: String::new(),
        fnol_hash: String::new(),
        summary_hash: String::new(),
        determination_hash: String::new(),
        recovery_hash: String::new(),
        opened_at: ctx.timestamp,
        decided_at: None,
        settled_at: None,
        reconciled_at: None,
        updated_at: ctx.timestamp,
        statement,
    });
    crate::live::on_claim_saved(ctx, None, &claim);
    let claim = rebuild(ctx, claim)?;
    // Refused, or disputed and already on its way to Claude.
    if claim.status != ClaimStatus::AwaitingRecord || !kind.is_injury() {
        return Ok(claim);
    }
    Ok(save(ctx, Claim { status: ClaimStatus::AwaitingRecord, status_note: "waiting for the medical record".into(), ..claim }))
}

/// Builds the next pack version and moves the claim on: the amounts are
/// fixed, the reserve is posted and, once there is something to pay for,
/// Elastic verification is queued. Disputed evidence does not wait for a
/// medical record: Claude weighs it next, and refuses on the failed check or asks.
pub(super) fn rebuild(ctx: &ReducerContext, claim: Claim) -> Result<Claim, String> {
    let pack = build_pack(ctx, &claim);
    let claim = save(
        ctx,
        Claim {
            pack_version: pack.version,
            pack_hash: pack.hash.clone(),
            corroboration: pack.corroboration.as_str().into(),
            ..claim
        },
    );
    if let Some(staff) = pack.checks.iter().find(|c| c.name == "claimant_not_staff" && c.result == bandit_insurance::CheckResult::Fail) {
        return refuse(ctx, claim, format!("medical payments cover excludes staff: {}", staff.detail), "code");
    }
    let disputed = pack.corroboration == bandit_insurance::Corroboration::Disputed;
    let needs_record = !disputed && cover_of(&claim) == CoverKind::MedicalPayments && extracted_record(ctx, claim.id).is_none();
    if needs_record {
        return Ok(claim);
    }
    let a = current_amounts(ctx, &claim).unwrap_or_else(|| Amounts { cost_cents: logged_cost(ctx, claim.incident_id), ..Default::default() });
    let mut claim = with_amounts(claim, a);
    if !claim.reserved {
        post(ctx, claim.id, bandit_insurance::ledger::reserve(a.payout_cents), "rebuild")?;
        claim.reserved = true;
    }
    let payload = verify_payload(ctx, &claim, &pack.input);
    jobs::enqueue(ctx, KIND_VERIFY, serde_json::to_string(&payload).unwrap(), "claim", claim.id);
    let claim = save(ctx, Claim { status: ClaimStatus::Verifying, status_note: "checking the evidence".into(), ..claim });
    super::charges::on_pack_built(ctx, &claim);
    Ok(claim)
}

fn verify_payload(ctx: &ReducerContext, claim: &Claim, input: &bandit_insurance::evidence::EvidenceInput) -> VerifyPayload {
    let s = settings(ctx);
    let opened = input.incident.opened_at;
    let rec = extracted_record(ctx, claim.id);
    let lines: Vec<ClaimLine> = ctx.db.claim_line().claim_id().filter(claim.id).collect();
    VerifyPayload {
        claim_id: claim.id,
        pack_version: claim.pack_version,
        venue_name: s.venue_name.clone(),
        incident_kind: claim.incident_kind.clone(),
        cover_kind: claim.cover_kind.clone(),
        zone_id: claim.zone_id,
        zone_name: claim.zone_name.clone(),
        incident_at_micros: opened,
        local_time: bandit_insurance::time::local_hms(opened, s.tz_offset_minutes)[..5].to_string(),
        corroboration: claim.corroboration.clone(),
        witness_count: input.witnesses.iter().filter(|w| w.zone_id == claim.zone_id).count() as u32,
        minutes_to_first_note: input.notes.iter().map(|n| (n.created_at - opened) / 60_000_000).min(),
        diagnoses: rec
            .as_ref()
            .map(|r| r.diagnoses.iter().map(|d| d.split_once(' ').map(|(c, t)| (c.to_string(), t.to_string())).unwrap_or((d.clone(), String::new()))).collect())
            .unwrap_or_default(),
        service_codes: lines.iter().map(|l| l.code.clone()).collect(),
        record_hash: rec.as_ref().map(|r| r.file_hash.clone()).unwrap_or_default(),
        billed_cents: rec.as_ref().map(|r| r.billed_cents).unwrap_or(0),
        covered_cents: rec.as_ref().map(|r| r.covered_cents).unwrap_or(0),
        payout_cents: claim.payout_cents,
        property_description: if cover_of(claim) != CoverKind::MedicalPayments {
            input.notes.iter().map(|n| n.text.clone()).collect::<Vec<_>>().join(" ")
        } else {
            String::new()
        },
        cost_cents: if cover_of(claim) != CoverKind::MedicalPayments { claim.cost_cents } else { 0 },
        responsible_named: input.responsible.is_some(),
        attendee_policy_hash: attendee_policy_hash(ctx, claim),
    }
}

/// The document of the attendee's own policy, for the clause search; empty when none is on file.
fn attendee_policy_hash(ctx: &ReducerContext, claim: &Claim) -> String {
    if !cover_of(claim).is_attendee_policy() {
        return String::new();
    }
    ctx.db.attendee_policy().id().find(claim.policy_id).map(|p| p.document_hash).unwrap_or_default()
}

/// Files the medical record PDF (already in the blob store) for an injury claim.
#[spacetimedb::reducer]
pub fn submit_medical_record(ctx: &ReducerContext, claim_id: u64, file_hash: String, page_count: u32) -> Result<(), String> {
    require_role(ctx, &["medic", "ops"])?;
    let claim = claim_by_id(ctx, claim_id)?;
    if claim.status != ClaimStatus::AwaitingRecord {
        return Err(format!("claim {claim_id} is not waiting for a medical record"));
    }
    let file_hash = file_hash.to_lowercase();
    if ctx.db.blob_ref().hash().find(&file_hash).is_none() {
        return Err("register the PDF with register_blob first".into());
    }
    if page_count == 0 {
        return Err("a record has at least one page".into());
    }
    let record = insert_record(ctx, claim_id, file_hash.clone(), page_count);
    let payload = RecordExtractPayload { claim_id, record_id: record.id, file_hash, page_count };
    let job_id = jobs::enqueue(ctx, KIND_RECORD_EXTRACT, serde_json::to_string(&payload).unwrap(), "claim", claim_id);
    ctx.db.medical_record().id().update(MedicalRecord { job_id, ..record });
    save(ctx, Claim { status: ClaimStatus::ReadingRecord, status_note: "reading the medical record".into(), ..claim });
    Ok(())
}

/// A record row for a file in the blob store, before anything is read from it.
pub(super) fn insert_record(ctx: &ReducerContext, claim_id: u64, file_hash: String, page_count: u32) -> MedicalRecord {
    ctx.db.medical_record().insert(MedicalRecord {
        id: 0,
        claim_id,
        file_hash,
        page_count,
        status: "reading".into(),
        job_id: 0,
        model_call_id: 0,
        document_kind: String::new(),
        patient_name: String::new(),
        provider_name: String::new(),
        date_of_service: String::new(),
        invoice_number: String::new(),
        reason_for_visit: String::new(),
        history: String::new(),
        diagnoses: Vec::new(),
        billed_cents: 0,
        covered_cents: 0,
        dropped: Vec::new(),
        record_json: String::new(),
        submitted_by: ctx.sender(),
        submitted_at: ctx.timestamp,
        extracted_at: None,
    })
}

/// The worker's reading of the record. Code validates it, decides which
/// service lines are covered and for how much, and rebuilds the pack.
#[spacetimedb::reducer]
pub fn apply_medical_record(ctx: &ReducerContext, job_id: u64, record_json: String, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let p: RecordExtractPayload = serde_json::from_str(&job.payload).map_err(|e| e.to_string())?;
    let call_id = jobs::record_call(ctx, job_id, &call);
    let claim = claim_by_id(ctx, p.claim_id)?;
    let record = ctx.db.medical_record().id().find(p.record_id).ok_or("no record")?;
    let parsed = serde_json::from_str::<ExtractedRecord>(&record_json)
        .map_err(|e| vec![format!("not a record: {e}")])
        .and_then(|raw| validate_record(raw, p.page_count));
    let valid = match parsed {
        Ok(v) => v,
        Err(reasons) => {
            ctx.db.medical_record().id().update(MedicalRecord { status: "failed".into(), model_call_id: call_id, dropped: reasons.clone(), ..record });
            jobs::finish(ctx, job, "record rejected");
            route(ctx, claim, format!("medical record rejected: {}", reasons.join("; ")));
            return Ok(());
        }
    };
    jobs::finish(ctx, job, "record extracted");
    apply_record(ctx, claim, record, &valid, call_id)
}

/// Stores a validated record on its claim: code decides which service lines
/// are covered and for how much, then the pack is rebuilt.
pub(super) fn apply_record(ctx: &ReducerContext, claim: Claim, record: MedicalRecord, valid: &ValidRecord, call_id: u64) -> Result<(), String> {
    let s = settings(ctx);
    let incident = ctx.db.incident().id().find(claim.incident_id).ok_or("no incident")?;
    let incident_date = bandit_insurance::time::local_date(micros(incident.opened_at), s.tz_offset_minutes);
    let window = policy_rule(ctx, claim.policy_id, cover_of(&claim)).map(|r| r.service_window_days).unwrap_or(0);
    let lines = cover_lines(valid, &incident_date, window);
    for l in &lines {
        ctx.db.claim_line().insert(ClaimLine {
            id: 0,
            claim_id: claim.id,
            record_id: record.id,
            line_no: l.line_no,
            code: l.code.clone(),
            description: l.description.clone(),
            service_date: l.service_date.clone(),
            units: l.units,
            billed_cents: l.billed_cents,
            allowed_cents: l.allowed_cents,
            covered_cents: l.covered_cents,
            outcome: l.outcome.as_str().into(),
            reason: l.reason.clone(),
            page: l.page,
        });
    }
    let r = &valid.record;
    ctx.db.medical_record().id().update(MedicalRecord {
        status: "extracted".into(),
        model_call_id: call_id,
        document_kind: r.document_kind.clone(),
        patient_name: r.patient.name.clone(),
        provider_name: r.provider.name.clone(),
        date_of_service: r.encounter.date_of_service.clone(),
        invoice_number: r.invoice_number.clone(),
        reason_for_visit: r.encounter.reason_for_visit.clone(),
        history: r.encounter.history.clone(),
        diagnoses: r.diagnoses.iter().map(|d| format!("{} {}", d.code, d.description)).collect(),
        billed_cents: r.total_billed_cents,
        covered_cents: covered_total(&lines),
        dropped: valid.dropped.clone(),
        record_json: serde_json::to_string(r).unwrap(),
        extracted_at: Some(ctx.timestamp),
        ..record
    });
    if let Some(r) = ctx.db.medical_record().id().find(record.id) {
        crate::live::record_read(ctx, &claim, &r);
    }
    rebuild(ctx, claim)?;
    Ok(())
}

/// Elastic's verdict on the evidence document and the policy clauses it found for the claim.
#[spacetimedb::reducer]
pub fn submit_claim_checks(ctx: &ReducerContext, job_id: u64, checks: Vec<CheckIn>, clauses: Vec<ClauseIn>) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let p: VerifyPayload = serde_json::from_str(&job.payload).map_err(|e| e.to_string())?;
    let claim = claim_by_id(ctx, p.claim_id)?;
    jobs::finish(ctx, job, format!("{} checks, {} clauses", checks.len(), clauses.len()));
    if claim.pack_version != p.pack_version || claim.status != ClaimStatus::Verifying {
        return Ok(());
    }
    for c in &checks {
        let result = match c.result.as_str() {
            "pass" => bandit_insurance::CheckResult::Pass,
            "fail" => bandit_insurance::CheckResult::Fail,
            _ => bandit_insurance::CheckResult::Info,
        };
        let check = Check { name: c.name.clone(), result, detail: c.detail.clone(), reader: bandit_insurance::Reader::Elastic };
        store_check(ctx, claim.id, claim.pack_version, &check);
    }
    let failed: Vec<String> = checks.iter().filter(|c| c.result == "fail").map(|c| c.name.replace('_', " ")).collect();
    crate::live::checks_done(ctx, &claim, &failed, clauses.len());
    for k in clauses {
        ctx.db.claim_clause().insert(ClaimClause {
            id: 0,
            claim_id: claim.id,
            pack_version: claim.pack_version,
            clause_id: k.clause_id,
            policy: k.policy,
            section: k.section,
            page: k.page,
            text: k.text,
            score: k.score,
        });
    }
    queue_review(ctx, claim);
    Ok(())
}

fn queue_review(ctx: &ReducerContext, claim: Claim) {
    let payload = review_payload(ctx, &claim);
    jobs::enqueue(ctx, KIND_REVIEW, serde_json::to_string(&payload).unwrap(), "claim", claim.id);
    save(ctx, Claim { status: ClaimStatus::Reviewing, status_note: "reviewing the claim".into(), ..claim });
}

fn core_lines(ctx: &ReducerContext, claim_id: u64) -> Vec<LineDecision> {
    let mut rows: Vec<ClaimLine> = ctx.db.claim_line().claim_id().filter(claim_id).collect();
    rows.sort_by_key(|l| l.line_no);
    rows.into_iter()
        .map(|l| LineDecision {
            line_no: l.line_no,
            code: l.code,
            description: l.description,
            service_date: l.service_date,
            units: l.units,
            billed_cents: l.billed_cents,
            allowed_cents: l.allowed_cents,
            covered_cents: l.covered_cents,
            outcome: match l.outcome.as_str() {
                "covered" => LineOutcome::Covered,
                "reduced" => LineOutcome::Reduced,
                _ => LineOutcome::Excluded,
            },
            reason: l.reason,
            page: l.page,
        })
        .collect()
}

fn policy_summary(ctx: &ReducerContext, claim: &Claim) -> String {
    let Some(r) = policy_rule(ctx, claim.policy_id, cover_of(claim)) else {
        if cover_of(claim).is_attendee_policy() {
            return "The venue's general liability policy excludes guests' property and property in the venue's care, custody or control, so it does not pay for an attendee's own belongings; the attendee has no policy of their own on file, so the organizer decides.".into();
        }
        return "no cover".into();
    };
    let f = bandit_insurance::money::format_cents;
    if cover_of(claim).is_attendee_policy() {
        let p = ctx.db.attendee_policy().id().find(claim.policy_id);
        return format!(
            "The attendee's own policy ({}, {}), personal property cover: pays for the attendee's own belongings stolen or broken away from home, up to {} per claim and {} a year, less a {} deductible the attendee carries. The venue's general liability policy excludes guests' property.",
            p.as_ref().map(|p| p.insurer_name.clone()).unwrap_or_default(),
            p.as_ref().map(|p| p.policy_number.clone()).unwrap_or_default(),
            f(r.per_claim_limit_cents),
            f(r.aggregate_limit_cents),
            f(r.deductible_cents)
        );
    }
    if cover_of(claim) == CoverKind::MedicalPayments {
        format!(
            "Venue general liability, medical payments cover: pays reasonable first-aid and medical costs for a guest hurt on the venue's premises during the event, no fault needed, up to {} per claim and {} for the event, services within {} days of the incident, each service capped by the venue fee schedule. It does not pay for injuries that happened elsewhere or before the event.",
            f(r.per_claim_limit_cents),
            f(r.aggregate_limit_cents),
            r.service_window_days
        )
    } else {
        format!(
            "Venue general liability, property cover: pays repair or replacement of the venue's own equipment damaged during the event, up to {} per claim, after a {} deductible the venue carries.",
            f(r.per_claim_limit_cents),
            f(r.deductible_cents)
        )
    }
}

fn review_payload(ctx: &ReducerContext, claim: &Claim) -> ReviewPayload {
    let s = settings(ctx);
    let opened = ctx.db.incident().id().find(claim.incident_id).map(|i| micros(i.opened_at)).unwrap_or(0);
    let rec = extracted_record(ctx, claim.id);
    let mut clauses: Vec<ClauseRef> = ctx
        .db
        .claim_clause()
        .claim_id()
        .filter(claim.id)
        .filter(|k| k.pack_version == claim.pack_version)
        .map(|k| ClauseRef { clause_id: k.clause_id, policy: k.policy, section: k.section, page: k.page, text: k.text, score: k.score })
        .collect();
    clauses.sort_by(|a, b| b.score.total_cmp(&a.score));
    ReviewPayload {
        claim_id: claim.id,
        pack_version: claim.pack_version,
        pack_hash: claim.pack_hash.clone(),
        incident_kind: claim.incident_kind.clone(),
        cover_kind: claim.cover_kind.clone(),
        zone_name: claim.zone_name.clone(),
        incident_time: bandit_insurance::time::local_datetime(opened, s.tz_offset_minutes),
        claimant_name: claim.claimant_name.clone(),
        corroboration: claim.corroboration.clone(),
        facts: pack_facts(ctx, claim.id, claim.pack_version),
        checks: pack_checks(ctx, claim.id, claim.pack_version),
        amounts: amounts(claim),
        lines: core_lines(ctx, claim.id),
        record_history: rec.as_ref().map(|r| r.history.clone()).unwrap_or_default(),
        record_reason: rec.as_ref().map(|r| r.reason_for_visit.clone()).unwrap_or_default(),
        clauses,
        policy_summary: policy_summary(ctx, claim),
        claimant_statement: claim.statement.clone(),
        charge: super::charges::brief(ctx, claim),
        attendee_policy_hash: attendee_policy_hash(ctx, claim),
    }
}

/// A step of Claude's investigation, while it runs: what it read and what the
/// Evidence Engine found, for the decision history.
#[spacetimedb::reducer]
pub fn report_claim_step(ctx: &ReducerContext, job_id: u64, actor: String, what: String, why: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    if job.kind != KIND_REVIEW {
        return Err(format!("job {job_id} is not a claim investigation"));
    }
    if !["Claude", "Evidence Engine"].contains(&actor.as_str()) {
        return Err(format!("{actor:?} does not investigate claims"));
    }
    let claim = claim_by_id(ctx, job.subject_id)?;
    if claim.status != ClaimStatus::Reviewing {
        return Ok(());
    }
    let cut = |s: String, n: usize| if s.chars().count() > n { s.chars().take(n).collect::<String>() + "…" } else { s };
    crate::live::record(ctx, claim.incident_id, claim.id, &actor, &actor, cut(what, 200), cut(why, 600));
    Ok(())
}

/// Claude's investigation and decision. Code validates the decision again,
/// then holds it to its limits (`decision::guard`): Claude pays inside the
/// authority a learned rule gives and refuses on failed checks; anything else
/// goes to the organizer. An invalid decision is set aside and the claim is
/// decided as if Claude were unavailable.
#[spacetimedb::reducer]
pub fn submit_claim_review(ctx: &ReducerContext, job_id: u64, review_json: String, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let p: ReviewPayload = serde_json::from_str(&job.payload).map_err(|e| e.to_string())?;
    let call_id = jobs::record_call(ctx, job_id, &call);
    jobs::finish(ctx, job, "decision received");
    let claim = claim_by_id(ctx, p.claim_id)?;
    if claim.pack_version != p.pack_version || claim.status != ClaimStatus::Reviewing {
        return Ok(());
    }
    let checked: Result<AgentDecision, Vec<String>> = serde_json::from_str::<Investigation>(&review_json)
        .map_err(|e| vec![format!("not an investigation: {e}")])
        .and_then(|inv| {
            let d: AgentDecision = serde_json::from_value(inv.decision).map_err(|e| vec![format!("not a decision: {e}")])?;
            validate_review(&d, &p, &inv.sources_read, &inv.clauses_seen).map(|_| d)
        });
    let verdict = checked.as_ref().map(|d| d.decision.as_str().to_string()).unwrap_or_else(|_| "invalid".into());
    let d = checked.as_ref().ok();
    ctx.db.claim_review().insert(ClaimReview {
        id: 0,
        claim_id: claim.id,
        pack_version: claim.pack_version,
        verdict: verdict.clone(),
        causation: d.map(|d| d.causation.as_str().to_string()).unwrap_or_default(),
        summary: d.map(|d| d.summary.clone()).unwrap_or_default(),
        concerns: d
            .map(|d| d.concerns.iter().map(|c| format!("{}: {} {:?}", c.kind, c.detail, c.fact_ids)).collect())
            .unwrap_or_default(),
        innocent_explanations: d.map(|d| d.innocent_explanations.clone()).unwrap_or_default(),
        missing_evidence: d.map(|d| d.missing_evidence.clone()).unwrap_or_default(),
        cited_fact_ids: d.map(|d| d.cited_fact_ids.clone()).unwrap_or_default(),
        rejected: checked.as_ref().err().cloned().unwrap_or_default(),
        model_call_id: call_id,
        created_at: ctx.timestamp,
    });
    let claim = save(ctx, Claim { review_verdict: verdict, ..claim });
    if checked.is_ok() {
        let raw: Option<serde_json::Value> = serde_json::from_str::<Investigation>(&review_json).ok().map(|inv| inv.decision);
        super::charges::recommended(ctx, &claim, raw.as_ref().and_then(|v| v.get("charge")));
    }
    match checked {
        Ok(d) => decide_with_claude(ctx, claim, &d),
        Err(problems) => {
            crate::live::set_aside(ctx, &claim, &problems);
            decide_claim(ctx, claim, ReviewGate::Missing)
        }
    }
}

fn core_rules(ctx: &ReducerContext) -> Vec<SettlementRule> {
    ctx.db
        .settlement_rule()
        .iter()
        .filter_map(|r| {
            Some(SettlementRule {
                rule_id: r.id,
                incident_kind: bandit_insurance::IncidentKind::parse(&r.incident_kind)?,
                cover_kind: CoverKind::parse(&r.cover_kind)?,
                zone_id: r.zone_id,
                requires_corroborated: r.requires_corroborated,
                ceiling_cents: r.ceiling_cents,
                version: r.version,
                active: r.status == "active",
            })
        })
        .collect()
}

fn corroboration_of(claim: &Claim) -> bandit_insurance::Corroboration {
    match claim.corroboration.as_str() {
        "corroborated" => bandit_insurance::Corroboration::Corroborated,
        "disputed" => bandit_insurance::Corroboration::Disputed,
        _ => bandit_insurance::Corroboration::Uncorroborated,
    }
}

/// Why nothing of this claim's occurrence settles on its own, when enough people were hurt in it.
fn mass_occurrence(ctx: &ReducerContext, claim: &Claim) -> Option<String> {
    let occurrence = occurrence(ctx, claim.incident_id);
    (occurrence.len() >= MASS_OCCURRENCE).then(|| {
        format!(
            "{} people hurt in {} within 5 minutes: auto-settle is off and the organizer decides every claim of the occurrence",
            occurrence.len(),
            claim.zone_name
        )
    })
}

/// Why an attendee's stolen or broken belonging goes to the organizer whatever is decided: they have no
/// policy of their own on file, and the venue's policy excludes guests' property.
fn no_own_policy(ctx: &ReducerContext, claim: &Claim) -> Option<String> {
    (cover_of(claim).is_attendee_policy() && ctx.db.attendee_policy().id().find(claim.policy_id).is_none()).then(|| {
        "an attendee's own belonging: the venue's policy excludes guests' property and the attendee has no policy of their own on file, so the organizer decides".to_string()
    })
}

/// Claude's valid decision, held to its limits.
fn decide_with_claude(ctx: &ReducerContext, claim: Claim, d: &AgentDecision) -> Result<(), String> {
    if let Some(reason) = no_own_policy(ctx, &claim) {
        route(ctx, claim, reason);
        return Ok(());
    }
    let checks = pack_checks(ctx, claim.id, claim.pack_version);
    let rules = core_rules(ctx);
    let guarded = guard(
        d,
        &GuardInput {
            has_cover: policy_rule(ctx, claim.policy_id, cover_of(&claim)).is_some_and(|r| r.active),
            corroboration: corroboration_of(&claim),
            amounts: amounts(&claim),
            checks: &checks,
            rule: matching_rule(&rules, kind_of(&claim), cover_of(&claim), claim.zone_id),
            mass_occurrence: mass_occurrence(ctx, &claim),
        },
    );
    apply(ctx, claim, guarded.decision, guarded.decided_by)
}

/// The code-only decision, when Claude is unavailable or its decision was set aside.
fn decide_claim(ctx: &ReducerContext, claim: Claim, review: ReviewGate) -> Result<(), String> {
    if let Some(reason) = no_own_policy(ctx, &claim) {
        route(ctx, claim, reason);
        return Ok(());
    }
    let checks = pack_checks(ctx, claim.id, claim.pack_version);
    let rules = core_rules(ctx);
    let decision = decide(&DecisionInput {
        has_cover: policy_rule(ctx, claim.policy_id, cover_of(&claim)).is_some_and(|r| r.active),
        corroboration: corroboration_of(&claim),
        amounts: amounts(&claim),
        checks: &checks,
        review,
        review_required: settings(ctx).review_required,
        rule: matching_rule(&rules, kind_of(&claim), cover_of(&claim), claim.zone_id),
    });
    if let (Some(reason), false) = (mass_occurrence(ctx, &claim), matches!(decision, Decision::Refuse { .. })) {
        route(ctx, claim, reason);
        return Ok(());
    }
    let by = if matches!(decision, Decision::AutoSettle { .. }) { "rule" } else { "code" };
    apply(ctx, claim, decision, by)
}

fn apply(ctx: &ReducerContext, claim: Claim, decision: Decision, decided_by: &str) -> Result<(), String> {
    match decision {
        Decision::Refuse { reason } => refuse(ctx, claim, reason, decided_by).map(|_| ()),
        Decision::Route { reason } => {
            route(ctx, claim, reason);
            Ok(())
        }
        Decision::AutoSettle { rule_id, rule_version } => {
            let claim = save(ctx, Claim { decided_by: decided_by.into(), settlement_rule_id: rule_id, settlement_rule_version: rule_version, ..claim });
            settle(ctx, claim, "auto_settled")
        }
    }
}

/// With this many people hurt in one occurrence, the organizer decides every claim.
const MASS_OCCURRENCE: usize = 3;

/// The name every routed claim waits for.
const ORGANIZER: &str = "Organizer";

/// Sends the claim to the organizer: anyone with `ops`, after the event.
pub(super) fn route(ctx: &ReducerContext, claim: Claim, reason: String) {
    save(
        ctx,
        Claim {
            status: ClaimStatus::Routed,
            status_note: reason,
            routed_to_role: "ops".into(),
            routed_to: Identity::ZERO,
            routed_to_name: ORGANIZER.into(),
            ..claim
        },
    );
}

/// The person deciding, for the approval and the learned rule: their `ops` label, else "Organizer".
fn organizer_name(ctx: &ReducerContext) -> String {
    ctx.db.staff_role().identity().filter(ctx.sender()).find(|r| r.role == "ops").map(|r| r.label).unwrap_or_else(|| ORGANIZER.into())
}

fn refuse(ctx: &ReducerContext, claim: Claim, reason: String, decided_by: &str) -> Result<Claim, String> {
    if claim.reserved {
        post(ctx, claim.id, bandit_insurance::ledger::reserve_reversal(claim.payout_cents), decided_by)?;
    }
    Ok(save(
        ctx,
        Claim {
            status: ClaimStatus::Refused,
            status_note: reason.clone(),
            refusal_reason: reason,
            reserved: false,
            decided_by: decided_by.into(),
            decided_at: Some(ctx.timestamp),
            routed_to: Identity::ZERO,
            ..claim
        },
    ))
}

/// Posts the receivable and counts the payout against the aggregate. An
/// injury payout is then deposited into the claimant's Nessie account; a
/// property payout goes to the venue's repair vendor and is booked at once.
fn settle(ctx: &ReducerContext, claim: Claim, outcome: &str) -> Result<(), String> {
    post(ctx, claim.id, bandit_insurance::ledger::receivable(claim.recoverable_cents), outcome)?;
    if cover_of(&claim).is_attendee_policy() {
        if let Some(p) = ctx.db.attendee_policy().id().find(claim.policy_id) {
            ctx.db.attendee_policy().id().update(AttendeePolicy { used_cents: p.used_cents + claim.payout_cents, updated_at: ctx.timestamp, ..p });
        }
    } else if let Some(p) = ctx.db.insurance_policy().id().find(claim.policy_id) {
        let p = match cover_of(&claim) {
            CoverKind::MedicalPayments => InsurancePolicy { medical_used_cents: p.medical_used_cents + claim.payout_cents, ..p },
            _ => InsurancePolicy { property_used_cents: p.property_used_cents + claim.payout_cents, ..p },
        };
        ctx.db.insurance_policy().id().update(InsurancePolicy { updated_at: ctx.timestamp, ..p });
    }
    let claim = save(ctx, Claim { decided_at: Some(ctx.timestamp), routed_to: Identity::ZERO, ..claim });
    if cover_of(&claim) == CoverKind::Property {
        return paid(ctx, claim, "repair vendor".into(), outcome);
    }
    let account = claim.claimant.and_then(|c| ctx.db.claimant_account().identity().find(c));
    let payload = PayoutPayload {
        claim_id: claim.id,
        claimant: claim.claimant.map(|c| c.to_hex().to_string()).unwrap_or_default(),
        claimant_name: claim.claimant_name.clone(),
        customer_id: account.as_ref().map(|a| a.customer_id.clone()).unwrap_or_default(),
        account_id: account.as_ref().map(|a| a.account_id.clone()).unwrap_or_default(),
        payout_cents: claim.payout_cents,
        memo: format!("BandIt claim {} payout", claim.id),
    };
    jobs::enqueue(ctx, KIND_PAYOUT, serde_json::to_string(&payload).unwrap(), "claim", claim.id);
    let note = format!("{outcome}; paying {} into the claimant's wallet", bandit_insurance::money::format_cents(claim.payout_cents));
    save(ctx, Claim { status: ClaimStatus::Paying, status_note: note, ..claim });
    Ok(())
}

/// Books the claimant payment (J3), marks the claim settled and queues the letters.
fn paid(ctx: &ReducerContext, claim: Claim, reference: String, outcome: &str) -> Result<(), String> {
    post(ctx, claim.id, bandit_insurance::ledger::claimant_payment(claim.payout_cents), outcome)?;
    let note = match claim.decided_by.as_str() {
        "rule" => format!("settled automatically under rule v{}", claim.settlement_rule_version),
        "claude" => format!("paid on Claude's decision, inside the authority of rule v{}", claim.settlement_rule_version),
        _ => format!("approved by {}", claim.routed_to_name),
    };
    let claim = save(
        ctx,
        Claim { status: ClaimStatus::Settled, status_note: note, payout_reference: reference, settled_at: Some(ctx.timestamp), ..claim },
    );
    let outcome = if matches!(claim.decided_by.as_str(), "rule" | "claude") { "auto_settled" } else { "approved" };
    let payload = DraftPayload { claim_id: claim.id, pack_version: claim.pack_version, outcome: outcome.into(), letter: letter_data(ctx, &claim, "", "") };
    jobs::enqueue(ctx, KIND_DRAFT, serde_json::to_string(&payload).unwrap(), "claim", claim.id);
    Ok(())
}

/// The worker's Nessie deposit for an injury payout.
#[spacetimedb::reducer]
pub fn record_claim_payout(ctx: &ReducerContext, job_id: u64, customer_id: String, account_id: String, deposit_id: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let claim = claim_by_id(ctx, job.subject_id)?;
    jobs::finish(ctx, job, deposit_id.clone());
    if claim.status != ClaimStatus::Paying {
        return Ok(());
    }
    if let Some(identity) = claim.claimant {
        if ctx.db.claimant_account().identity().find(identity).is_none() {
            ctx.db.claimant_account().insert(ClaimantAccount { identity, customer_id, account_id, created_at: ctx.timestamp });
        }
        crate::wallet::on_payout(ctx, identity, claim.id, claim.payout_cents, deposit_id.clone());
    }
    paid(ctx, claim, format!("Nessie deposit {deposit_id}"), "record_claim_payout")
}

/// Queues the Nessie deposit again after it failed.
#[spacetimedb::reducer]
pub fn retry_claim_payout(ctx: &ReducerContext, claim_id: u64) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let claim = claim_by_id(ctx, claim_id)?;
    if claim.status != ClaimStatus::Paying {
        return Err(format!("claim {claim_id} is not waiting for its payout"));
    }
    let last = ctx.db.job().kind().filter(KIND_PAYOUT).filter(|j| j.subject_id == claim_id).max_by_key(|j| j.id).ok_or("no payout job")?;
    jobs::enqueue(ctx, KIND_PAYOUT, last.payload, "claim", claim_id);
    save(ctx, Claim { status_note: "payout queued again".into(), ..claim });
    Ok(())
}

fn decision_text(ctx: &ReducerContext, claim: &Claim) -> String {
    match claim.decided_by.as_str() {
        "rule" => {
            let rule = ctx.db.settlement_rule().id().find(claim.settlement_rule_id);
            match rule {
                Some(r) => format!("settled automatically under rule v{}, approved by {} ({})", r.version, r.approver_name, r.approver_role),
                None => "settled automatically under a learned rule".into(),
            }
        }
        "claude" if claim.status != ClaimStatus::Refused => match ctx.db.settlement_rule().id().find(claim.settlement_rule_id) {
            Some(r) => format!(
                "paid by the insurance Decision Engine inside the {} authority of rule v{}, which {} ({}) approved",
                bandit_insurance::money::format_cents(r.ceiling_cents),
                r.version,
                r.approver_name,
                r.approver_role
            ),
            None => "paid by the insurance Decision Engine inside a learned rule".into(),
        },
        "approver" => format!("approved by {} ({})", claim.routed_to_name, claim.routed_to_role),
        _ => claim.status_note.clone(),
    }
}

fn letter_data(ctx: &ReducerContext, claim: &Claim, counterparty_name: &str, counterparty_contact: &str) -> LetterData {
    let s = settings(ctx);
    let opened = ctx.db.incident().id().find(claim.incident_id).map(|i| micros(i.opened_at)).unwrap_or(0);
    let (policy_number, insurer_name, fnol_contact) = if cover_of(claim).is_attendee_policy() {
        let p = ctx.db.attendee_policy().id().find(claim.policy_id);
        (p.as_ref().map(|p| p.policy_number.clone()).unwrap_or_default(), p.map(|p| p.insurer_name).unwrap_or_default(), String::new())
    } else {
        let p = ctx.db.insurance_policy().id().find(claim.policy_id);
        (
            p.as_ref().map(|p| p.policy_number.clone()).unwrap_or_default(),
            p.as_ref().map(|p| p.insurer_name.clone()).unwrap_or_default(),
            p.map(|p| p.fnol_contact).unwrap_or_default(),
        )
    };
    LetterData {
        claim_id: claim.id,
        pack_sha256: claim.pack_hash.clone(),
        policy_number,
        insurer_name,
        fnol_contact,
        venue_name: s.venue_name.clone(),
        claimant_name: claim.claimant_name.clone(),
        incident_kind: claim.incident_kind.clone(),
        zone_name: claim.zone_name.clone(),
        incident_time: bandit_insurance::time::local_datetime(opened, s.tz_offset_minutes),
        amounts: amounts(claim),
        decision_text: decision_text(ctx, claim),
        fact_lines: pack_facts(ctx, claim.id, claim.pack_version)
            .iter()
            .map(|f| format!("[{}] {} = {}", f.seq, f.key, f.value))
            .collect(),
        counterparty_name: counterparty_name.into(),
        counterparty_contact: counterparty_contact.into(),
        related_claims: related_claims(ctx, claim),
    }
}

/// The other claims of a mass occurrence, for the one notice that lists everyone.
fn related_claims(ctx: &ReducerContext, claim: &Claim) -> Vec<String> {
    let occurrence = occurrence(ctx, claim.incident_id);
    if occurrence.len() < MASS_OCCURRENCE {
        return Vec::new();
    }
    occurrence
        .iter()
        .filter(|i| i.id != claim.incident_id)
        .map(|i| match ctx.db.claim().incident_id().find(i.id) {
            Some(c) => format!("claim {}: {}, {}, {}", c.id, c.claimant_name, c.incident_kind, c.status_note),
            None => format!("incident {}: band {}, no claim yet", i.id, i.subject_band),
        })
        .collect()
}

/// The organizer checks the claim; the reducer fails closed when the
/// amount or the pack on their screen is no longer current.
fn approver_check(ctx: &ReducerContext, claim: &Claim, pack_hash_seen: &str) -> Result<(), String> {
    if claim.status != ClaimStatus::Routed {
        return Err(format!("claim {} is not waiting for a person", claim.id));
    }
    let is_assignee = claim.routed_to != Identity::ZERO && claim.routed_to == ctx.sender();
    let holds_role = claim.routed_to == Identity::ZERO && has_role(ctx, &[claim.routed_to_role.as_str()]);
    if !(is_assignee || holds_role || is_owner(ctx)) {
        return Err(format!("claim {} is waiting for {} ({})", claim.id, claim.routed_to_name, claim.routed_to_role));
    }
    if pack_hash_seen != claim.pack_hash {
        return Err(format!("stale: the evidence pack is now {}", bandit_insurance::pack::short_sha(&claim.pack_hash)));
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn approve_claim(
    ctx: &ReducerContext,
    claim_id: u64,
    amount_seen_cents: u64,
    pack_hash_seen: String,
    requested_ceiling_cents: Option<u64>,
    learn: bool,
) -> Result<(), String> {
    let claim = claim_by_id(ctx, claim_id)?;
    approver_check(ctx, &claim, &pack_hash_seen)?;
    let now = current_amounts(ctx, &claim).ok_or("no cover for this claim")?;
    if now.payout_cents != claim.payout_cents || amount_seen_cents != claim.payout_cents {
        return Err(format!("stale: the payout is now {}", bandit_insurance::money::format_cents(now.payout_cents)));
    }
    let approver_name = organizer_name(ctx);
    let approval = ctx.db.approval().insert(Approval {
        id: 0,
        claim_id,
        approver: ctx.sender(),
        approver_name: approver_name.clone(),
        approver_role: claim.routed_to_role.clone(),
        decision: "approve".into(),
        amount_seen_cents,
        pack_hash_seen,
        learn,
        requested_ceiling_cents,
        reason: String::new(),
        decided_at: ctx.timestamp,
    });
    let rules = core_rules(ctx);
    let covered_already = matching_rule(&rules, kind_of(&claim), cover_of(&claim), 0).is_some_and(|r| r.ceiling_cents >= claim.payout_cents);
    let mut taught: Option<(u32, u64)> = None;
    if learn && !covered_already {
        let kind = kind_of(&claim);
        let cover = cover_of(&claim);
        let version = next_version(&rules, kind, cover, 0);
        for old in ctx.db.settlement_rule().iter().filter(|r| r.status == "active" && r.incident_kind == kind.as_str() && r.cover_kind == cover.as_str() && r.zone_id == 0) {
            ctx.db.settlement_rule().id().update(SettlementRuleRow { status: "superseded".into(), ..old });
        }
        ctx.db.settlement_rule().insert(SettlementRuleRow {
            id: 0,
            incident_kind: kind.as_str().into(),
            cover_kind: cover.as_str().into(),
            zone_id: 0,
            requires_corroborated: true,
            ceiling_cents: {
                let c = learned_ceiling(requested_ceiling_cents, claim.payout_cents, None);
                taught = Some((version, c));
                c
            },
            approver: ctx.sender(),
            approver_name: approver_name.clone(),
            approver_role: claim.routed_to_role.clone(),
            approval_id: approval.id,
            version,
            status: "active".into(),
            created_at: ctx.timestamp,
        });
    }
    crate::live::approved(ctx, &claim, &approver_name, taught);
    let claim = save(ctx, Claim { decided_by: "approver".into(), routed_to_name: approver_name, ..claim });
    settle(ctx, claim, "approved")
}

#[spacetimedb::reducer]
pub fn refuse_claim(ctx: &ReducerContext, claim_id: u64, pack_hash_seen: String, reason: String) -> Result<(), String> {
    let claim = claim_by_id(ctx, claim_id)?;
    approver_check(ctx, &claim, &pack_hash_seen)?;
    if reason.trim().is_empty() {
        return Err("a refusal needs a reason".into());
    }
    let approver_name = organizer_name(ctx);
    ctx.db.approval().insert(Approval {
        id: 0,
        claim_id,
        approver: ctx.sender(),
        approver_name: approver_name.clone(),
        approver_role: claim.routed_to_role.clone(),
        decision: "refuse".into(),
        amount_seen_cents: claim.payout_cents,
        pack_hash_seen,
        learn: false,
        requested_ceiling_cents: None,
        reason: reason.clone(),
        decided_at: ctx.timestamp,
    });
    refuse(ctx, claim, format!("refused by {approver_name}: {reason}"), "approver").map(|_| ())
}

/// The insurer's payment closes the receivable (J4).
#[spacetimedb::reducer]
pub fn record_insurer_payment(ctx: &ReducerContext, claim_id: u64, amount_cents: u64, reference: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let claim = claim_by_id(ctx, claim_id)?;
    if claim.status != ClaimStatus::Settled {
        return Err(format!("claim {claim_id} is not settled"));
    }
    post(ctx, claim_id, bandit_insurance::ledger::insurer_payment(amount_cents, claim.recoverable_cents), "record_insurer_payment")?;
    save(
        ctx,
        Claim {
            status: ClaimStatus::Reconciled,
            status_note: format!("insurer paid {} ({reference})", bandit_insurance::money::format_cents(amount_cents)),
            reconciled_at: Some(ctx.timestamp),
            ..claim
        },
    );
    Ok(())
}

/// Asks Claude for a recovery letter to whoever was handling the damaged equipment.
#[spacetimedb::reducer]
pub fn request_recovery_letter(ctx: &ReducerContext, claim_id: u64, counterparty_name: String, counterparty_contact: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let claim = claim_by_id(ctx, claim_id)?;
    if cover_of(&claim) != CoverKind::Property || !matches!(claim.status, ClaimStatus::Settled | ClaimStatus::Reconciled) {
        return Err(format!("claim {claim_id} is not a settled property claim"));
    }
    let payload = RecoveryPayload { claim_id, letter: letter_data(ctx, &claim, &counterparty_name, &counterparty_contact) };
    jobs::enqueue(ctx, KIND_RECOVERY, serde_json::to_string(&payload).unwrap(), "claim", claim_id);
    Ok(())
}

/// The drafted letters, already in the blob store.
#[spacetimedb::reducer]
pub fn attach_claim_letters(
    ctx: &ReducerContext,
    job_id: u64,
    fnol_hash: String,
    summary_hash: String,
    determination_hash: String,
    call: Option<ModelCallIn>,
) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    if let Some(call) = &call {
        jobs::record_call(ctx, job_id, call);
    }
    let claim = claim_by_id(ctx, job.subject_id)?;
    jobs::finish(ctx, job, "letters attached");
    save(ctx, Claim { fnol_hash, summary_hash, determination_hash, ..claim });
    Ok(())
}

#[spacetimedb::reducer]
pub fn attach_recovery_letter(ctx: &ReducerContext, job_id: u64, recovery_hash: String, call: Option<ModelCallIn>) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    if let Some(call) = &call {
        jobs::record_call(ctx, job_id, call);
    }
    let claim = claim_by_id(ctx, job.subject_id)?;
    jobs::finish(ctx, job, "recovery letter attached");
    save(ctx, Claim { recovery_hash, ..claim });
    Ok(())
}

/// A claims job that ran out of attempts: the flow carries on without that
/// helper, and anything that needs judgment goes to a person.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if !INSURANCE_KINDS.contains(&job.kind.as_str()) {
        return;
    }
    super::charges::on_job_dead(ctx, job);
    let Some(claim) = ctx.db.claim().id().find(job.subject_id) else {
        return;
    };
    match job.kind.as_str() {
        KIND_RECORD_EXTRACT if claim.status == ClaimStatus::ReadingRecord => {
            if let Some(r) = ctx.db.medical_record().claim_id().filter(claim.id).find(|r| r.status == "reading") {
                ctx.db.medical_record().id().update(MedicalRecord { status: "failed".into(), ..r });
            }
            route(ctx, claim, "the medical record could not be read; a person must enter it".into());
        }
        KIND_CLINIC if claim.status == ClaimStatus::AwaitingRecord => {
            if let Some(r) = ctx.db.clinic_report().claim_id().filter(claim.id).find(|r| r.job_id == job.id) {
                ctx.db.clinic_report().id().update(ClinicReport { status: "failed".into(), problems: vec![job.error.clone()], ..r });
            }
            route(ctx, claim, "the hospital report did not arrive; a person must file the record".into());
        }
        KIND_VERIFY if claim.status == ClaimStatus::Verifying => {
            store_check(ctx, claim.id, claim.pack_version, &Check::info("elastic", "Elastic was unavailable; no validation or policy clauses").by(bandit_insurance::Reader::Elastic));
            queue_review(ctx, claim);
        }
        KIND_PAYOUT if claim.status == ClaimStatus::Paying => {
            save(ctx, Claim { status_note: format!("the payout failed: {}; retry_claim_payout queues it again", job.error), ..claim });
        }
        KIND_REVIEW if claim.status == ClaimStatus::Reviewing => {
            let claim = save(ctx, Claim { review_verdict: "unavailable".into(), ..claim });
            let _ = decide_claim(ctx, claim, ReviewGate::Missing);
        }
        _ => {}
    }
}
