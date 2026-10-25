//! Insurance PDFs the Evidence Engine reads: the venue's policy at event
//! setup, and an attendee's health plan. `document_read` splits
//! the PDF into pages, Elastic reads every term with the clause and page it
//! came from, and code checks each term again here before storing it. The
//! organizer confirms the venue's terms, and only then do they set the
//! limits, minimum payout, service window and fee schedule a claim is held to.

use super::*;
use crate::jobs::{self, Job, blob_ref};
use crate::roles::*;
use bandit_insurance::policy::{
    CheckedTerm, DocumentReadPayload, KIND_DOCUMENT_READ, PolicyRead, TermStatus, VENUE_POLICY, check_policy, effective,
};
use bandit_insurance::{CoverKind, policy};
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

/// One insurance PDF and how far its reading got.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = policy_document)]
pub struct PolicyDocument {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// `venue_policy` or `health_plan`.
    pub kind: String,
    /// Whose document it is; `None` for the venue's policy.
    pub attendee: Option<Identity>,
    #[index(btree)]
    pub file_hash: String,
    pub page_count: u32,
    /// `reading`, `read`, `confirmed` or `failed`.
    pub status: String,
    pub job_id: u64,
    /// Clauses found word for word on their pages and indexed for search.
    pub clause_count: u32,
    /// What code dropped from the reader's answer.
    pub dropped: Vec<String>,
    /// Why the reading failed.
    pub error: String,
    /// The `insurance_policy` row the confirmed terms set; 0 until then.
    pub policy_id: u64,
    /// `upload`, `plan_lookup` or `policy_lookup`.
    pub source: String,
    /// Where a looked-up plan document or the venue's liability form came from; empty for an upload.
    pub source_url: String,
    pub uploaded_by: Identity,
    pub uploaded_at: Timestamp,
    pub read_at: Option<Timestamp>,
    pub confirmed_by: Identity,
    pub confirmed_at: Option<Timestamp>,
}

/// One term of a venue policy after code's checks, with the clause it was read from.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = policy_term)]
pub struct PolicyTerm {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub document_id: u64,
    /// Empty for a policy-wide term.
    pub cover_kind: String,
    /// `bandit_insurance::policy` term name, `fee_cap` or `exclusion`.
    pub name: String,
    /// The fee code or the exclusion kind.
    pub code: String,
    /// The value in effect, in code's form.
    pub value: String,
    pub shown: String,
    /// What the policy printed.
    pub read_value: String,
    pub quote: String,
    pub page: u32,
    /// `<sha256>-c<n>` in the policy clause index; empty when the quote is in no clause.
    pub clause_id: String,
    /// `read`, `flagged` or `default`.
    pub status: String,
    pub problem: String,
}

/// One code of a confirmed policy's schedule of benefits.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = fee_schedule_line)]
pub struct FeeScheduleLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub policy_id: u64,
    pub code: String,
    pub description: String,
    pub cap_cents: u64,
}

/// A PDF to read, already in the blob store and registered.
pub struct DocumentIn {
    pub kind: String,
    pub attendee: Option<Identity>,
    pub file_hash: String,
    pub page_count: u32,
    /// `upload` or `plan_lookup`.
    pub source: String,
    pub source_url: String,
}

/// The id a clause has in the policy clause index.
pub fn clause_id(file_hash: &str, n: u32) -> String {
    format!("{file_hash}-c{n}")
}

/// Stores the document and queues `document_read`. Other features call this
/// for a PDF they put in the blob store, in the same transaction.
pub fn queue_document_read(ctx: &ReducerContext, d: DocumentIn) -> Result<u64, String> {
    if !policy::DOCUMENT_KINDS.contains(&d.kind.as_str()) {
        return Err(format!("unknown document kind {}", d.kind));
    }
    let hash = d.file_hash.trim().to_lowercase();
    if ctx.db.blob_ref().hash().find(&hash).is_none() {
        return Err(format!("no stored file {hash}"));
    }
    if !(1..=50).contains(&d.page_count) {
        return Err("a policy document has 1 to 50 pages".into());
    }
    let doc = ctx.db.policy_document().insert(PolicyDocument {
        id: 0,
        kind: d.kind.clone(),
        attendee: d.attendee,
        file_hash: hash.clone(),
        page_count: d.page_count,
        status: "reading".into(),
        job_id: 0,
        clause_count: 0,
        dropped: Vec::new(),
        error: String::new(),
        policy_id: 0,
        source: d.source,
        source_url: d.source_url,
        uploaded_by: ctx.sender(),
        uploaded_at: ctx.timestamp,
        read_at: None,
        confirmed_by: Identity::ZERO,
        confirmed_at: None,
    });
    let payload = DocumentReadPayload { document_id: doc.id, kind: d.kind, file_hash: hash, page_count: d.page_count };
    let job_id = jobs::enqueue(ctx, KIND_DOCUMENT_READ, serde_json::to_string(&payload).unwrap(), "policy_document", doc.id);
    ctx.db.policy_document().id().update(PolicyDocument { job_id, ..doc });
    Ok(doc.id)
}

/// The organizer uploads the venue's policy at event setup (after `POST /api/blobs?purpose=policy`).
#[spacetimedb::reducer]
pub fn submit_policy_document(ctx: &ReducerContext, file_hash: String, page_count: u32) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    queue_document_read(
        ctx,
        DocumentIn { kind: VENUE_POLICY.into(), attendee: None, file_hash, page_count, source: "upload".into(), source_url: String::new() },
    )
    .map(|_| ())
}

/// The worker hands back what the Evidence Engine read and the PDF's text
/// layer, one string per page. Code checks every term against the pages here
/// again, so a term is stored only as code judged it.
#[spacetimedb::reducer]
pub fn apply_document_terms(ctx: &ReducerContext, job_id: u64, read_json: String, pages: Vec<String>) -> Result<(), String> {
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let doc = ctx.db.policy_document().id().find(job.subject_id).ok_or("no policy document for this job")?;
    let read: PolicyRead = serde_json::from_str(&read_json).map_err(|e| format!("the reader's answer is not a policy read: {e}"))?;
    let mut checked = check_policy(&read, &pages);
    // A policy found by its forms takes the organizer's typed declarations over the terms they name.
    if let Some(d) = super::venue_policy_lookup::declarations_for(ctx, &doc) {
        bandit_insurance::policy::apply_declarations(&mut checked.terms, &d);
    }
    for old in ctx.db.policy_term().document_id().filter(doc.id) {
        ctx.db.policy_term().id().delete(old.id);
    }
    if doc.kind == VENUE_POLICY {
        for t in &checked.terms {
            ctx.db.policy_term().insert(PolicyTerm {
                id: 0,
                document_id: doc.id,
                cover_kind: t.cover.clone(),
                name: t.name.clone(),
                code: t.code.clone(),
                value: t.value.clone(),
                shown: t.shown.clone(),
                read_value: t.read_value.clone(),
                quote: t.quote.clone(),
                page: t.page,
                clause_id: if t.clause > 0 { clause_id(&doc.file_hash, t.clause) } else { String::new() },
                status: t.status.as_str().into(),
                problem: t.problem.clone(),
            });
        }
    }
    let flagged = checked.terms.iter().filter(|t| t.status == TermStatus::Flagged).count();
    let summary = format!("{} terms, {flagged} flagged, {} clauses", checked.terms.len(), checked.clauses.len());
    ctx.db.policy_document().id().update(PolicyDocument {
        status: "read".into(),
        clause_count: checked.clauses.len() as u32,
        dropped: checked.dropped,
        read_at: Some(ctx.timestamp),
        ..doc
    });
    jobs::finish(ctx, job, summary);
    Ok(())
}

fn checked_term(t: &PolicyTerm) -> CheckedTerm {
    CheckedTerm {
        cover: t.cover_kind.clone(),
        name: t.name.clone(),
        code: t.code.clone(),
        value: t.value.clone(),
        shown: t.shown.clone(),
        read_value: t.read_value.clone(),
        quote: t.quote.clone(),
        page: t.page,
        clause: 0,
        status: match t.status.as_str() {
            "read" => TermStatus::Read,
            "flagged" => TermStatus::Flagged,
            "typed" => TermStatus::Typed,
            _ => TermStatus::Default,
        },
        problem: t.problem.clone(),
    }
}

/// Local midnight of a `YYYY-MM-DD` date.
fn local_midnight(date: &str, tz_offset_minutes: i32) -> Option<Timestamp> {
    let days = bandit_insurance::time::parse_date(date)?;
    let (y, m, d) = bandit_insurance::time::civil_from_days(days);
    Some(timestamp(bandit_insurance::time::micros_at(y, m, d, 0, 0, 0, tz_offset_minutes)))
}

/// The organizer confirms the terms they saw: they become the event's policy,
/// its two covers and its fee schedule, and new claims take this policy.
#[spacetimedb::reducer]
pub fn confirm_policy_terms(ctx: &ReducerContext, document_id: u64) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let doc = ctx.db.policy_document().id().find(document_id).ok_or_else(|| format!("no policy document {document_id}"))?;
    if doc.kind != VENUE_POLICY {
        return Err("only the venue's policy sets the event's terms".into());
    }
    if doc.status != "read" && doc.status != "confirmed" {
        return Err(format!("the policy is {}, not read yet", doc.status));
    }
    let terms: Vec<CheckedTerm> = ctx.db.policy_term().document_id().filter(doc.id).map(|t| checked_term(&t)).collect();
    let p = effective(&terms);
    let tz = settings(ctx).tz_offset_minutes;
    let stated = (local_midnight(&p.period_start, tz), local_midnight(&p.period_end, tz));
    let existing = ctx.db.insurance_policy().policy_number().find(&p.policy_number);
    let (period_start, period_end, period_checked) = match stated {
        // The period's last day is covered to its end.
        (Some(start), Some(end)) => (start, end + spacetimedb::TimeDuration::from_micros(24 * 3600 * 1_000_000), true),
        _ => match &existing {
            Some(old) => (old.period_start, old.period_end, false),
            None => (ctx.timestamp, ctx.timestamp + spacetimedb::TimeDuration::from_micros(365 * 24 * 3600 * 1_000_000), false),
        },
    };
    let row = InsurancePolicy {
        id: 0,
        policy_number: p.policy_number.clone(),
        insurer_name: p.insurer_name.clone(),
        fnol_contact: p.fnol_contact.clone(),
        period_start,
        period_end,
        medical_used_cents: 0,
        property_used_cents: 0,
        updated_at: ctx.timestamp,
        other_insurance: p.other_insurance.clone(),
        staff_excluded: p.exclusions.iter().any(|e| e == "staff"),
        period_checked,
    };
    let policy = match existing {
        Some(old) => ctx.db.insurance_policy().id().update(InsurancePolicy {
            id: old.id,
            medical_used_cents: old.medical_used_cents,
            property_used_cents: old.property_used_cents,
            ..row
        }),
        None => ctx.db.insurance_policy().insert(row),
    };
    for c in &p.covers {
        let rule = c.rule();
        let row = CoverageRuleRow {
            id: 0,
            policy_id: policy.id,
            cover_kind: c.cover.as_str().into(),
            incident_kinds: rule.incident_kinds.iter().map(|k| k.as_str().to_string()).collect(),
            per_claim_limit_cents: c.per_claim_limit_cents,
            aggregate_limit_cents: c.aggregate_limit_cents,
            deductible_cents: c.deductible_cents,
            service_window_days: c.service_window_days,
            active: true,
            updated_at: ctx.timestamp,
            minimum_payout_cents: c.minimum_payout_cents,
        };
        match ctx.db.coverage_rule().policy_id().filter(policy.id).find(|r| r.cover_kind == c.cover.as_str()) {
            Some(old) => {
                ctx.db.coverage_rule().id().update(CoverageRuleRow { id: old.id, ..row });
            }
            None => {
                ctx.db.coverage_rule().insert(row);
            }
        }
    }
    for old in ctx.db.fee_schedule_line().policy_id().filter(policy.id) {
        ctx.db.fee_schedule_line().id().delete(old.id);
    }
    for l in &p.fee_schedule {
        ctx.db.fee_schedule_line().insert(FeeScheduleLine {
            id: 0,
            policy_id: policy.id,
            code: l.code.clone(),
            description: l.description.clone(),
            cap_cents: l.max_allowed_cents,
        });
    }
    ctx.db.policy_document().id().update(PolicyDocument {
        status: "confirmed".into(),
        policy_id: policy.id,
        confirmed_by: ctx.sender(),
        confirmed_at: Some(ctx.timestamp),
        ..doc
    });
    Ok(())
}

/// The policy new claims take: the one the newest confirmed venue policy set,
/// else the newest policy row (the seeded one).
pub fn current_policy(ctx: &ReducerContext) -> Option<InsurancePolicy> {
    let confirmed = ctx
        .db
        .policy_document()
        .iter()
        .filter(|d| d.kind == VENUE_POLICY && d.status == "confirmed")
        .max_by_key(|d| d.confirmed_at.map(micros).unwrap_or(0));
    confirmed
        .and_then(|d| ctx.db.insurance_policy().id().find(d.policy_id))
        .or_else(|| ctx.db.insurance_policy().iter().max_by_key(|p| p.id))
}

/// The SHA-256 of the confirmed venue policy PDF behind a policy row; empty for the seeded policy.
pub fn venue_policy_hash(ctx: &ReducerContext, policy_id: u64) -> String {
    ctx.db
        .policy_document()
        .iter()
        .filter(|d| d.kind == VENUE_POLICY && d.status == "confirmed" && d.policy_id == policy_id)
        .max_by_key(|d| d.confirmed_at.map(micros).unwrap_or(0))
        .map(|d| d.file_hash)
        .unwrap_or_default()
}

/// The policy's schedule of benefits, or the default schedule when it states none.
pub fn fee_schedule_for(ctx: &ReducerContext, policy_id: u64) -> Vec<bandit_insurance::fee_schedule::FeeLine> {
    let lines: Vec<_> = ctx
        .db
        .fee_schedule_line()
        .policy_id()
        .filter(policy_id)
        .map(|l| bandit_insurance::fee_schedule::FeeLine { code: l.code, description: l.description, max_allowed_cents: l.cap_cents })
        .collect();
    if lines.is_empty() { bandit_insurance::fee_schedule::default_schedule() } else { lines }
}

/// The cover's minimum payout under the claim's policy.
pub fn minimum_payout(ctx: &ReducerContext, policy_id: u64, cover: CoverKind) -> u64 {
    super::evidence::policy_rule(ctx, policy_id, cover).map(|r| r.minimum_payout_cents).unwrap_or(0)
}

/// Whether the claim's incident falls in the policy period, when the policy states one.
pub fn in_period(ctx: &ReducerContext, policy_id: u64, at: Timestamp) -> bool {
    ctx.db.insurance_policy().id().find(policy_id).is_none_or(|p| !p.period_checked || (p.period_start <= at && at < p.period_end))
}

/// A dead `document_read` marks its document failed.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_DOCUMENT_READ {
        return;
    }
    if let Some(doc) = ctx.db.policy_document().id().find(job.subject_id).filter(|d| d.status == "reading") {
        ctx.db.policy_document().id().update(PolicyDocument { status: "failed".into(), error: job.error.clone(), ..doc });
    }
}
