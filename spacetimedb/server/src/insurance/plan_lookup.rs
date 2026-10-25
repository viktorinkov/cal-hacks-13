//! Plan lookup: an attendee names their insurer and plan instead of uploading its PDF. A worker
//! searches for the plan's public document through Bright Data, Claude picks it among the results
//! and reads what it prints, and the worker keeps the PDF only when the printed insurer and plan
//! match what the attendee typed. Here the PDF lands like an upload: a health plan fills the medical
//! card's insurer and plan; a policy for the attendee's belongings becomes their own policy, with the
//! limit and deductible they typed, because no public form holds a policyholder's own numbers.

use super::documents::{DocumentIn, queue_document_read};
use super::own_policy::{self, AttendeePolicyTerms};
use crate::jobs::{self, *};
use crate::medical::{self, *};
use crate::roles::*;
use crate::social::tables::*;
use crate::view_as::viewed;
use bandit_insurance::policy::{ATTENDEE_POLICY, HEALTH_PLAN};
use serde::{Deserialize, Serialize};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

pub const KIND_PLAN_LOOKUP: &str = "plan_lookup";
/// What the attendee names: their health plan, or the policy that covers their belongings.
pub const HEALTH: &str = "health";
pub const BELONGINGS: &str = "belongings";

pub const SEARCHING: &str = "searching";
pub const FOUND: &str = "found";
pub const NOT_FOUND: &str = "not_found";
pub const WRONG_PLAN: &str = "wrong_plan";
pub const FAILED: &str = "failed";

/// The blob purpose of a plan's public PDF.
pub const PLAN_WORDING: &str = "plan_wording";

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = plan_lookup)]
pub struct PlanLookup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee: Identity,
    /// `health` or `belongings`.
    pub kind: String,
    /// As the attendee typed them.
    pub insurer: String,
    pub plan: String,
    pub state: String,
    /// For `belongings`, from the attendee's declarations page; 0 for `health`.
    pub limit_cents: u64,
    pub deductible_cents: u64,
    /// `searching`, `found`, `not_found`, `wrong_plan` or `failed`.
    pub status: String,
    /// The document the lookup found, and what it prints.
    pub source_url: String,
    pub printed_insurer: String,
    pub printed_plan: String,
    pub plan_year: String,
    pub file_hash: String,
    pub page_count: u32,
    pub job_id: u64,
    /// Why it ended `not_found`, `wrong_plan` or `failed`, in plain words.
    pub note: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// What the worker found. `file_hash` is the PDF it stored; empty unless `status` is `found`.
#[derive(SpacetimeType, Clone, Debug, Default)]
pub struct PlanLookupResult {
    /// `found`, `not_found` or `wrong_plan`.
    pub status: String,
    pub source_url: String,
    pub printed_insurer: String,
    pub printed_plan: String,
    pub plan_year: String,
    pub file_hash: String,
    pub size_bytes: u64,
    pub page_count: u32,
    pub note: String,
}

#[derive(Serialize, Deserialize)]
struct LookupPayload {
    lookup_id: u64,
    kind: String,
    insurer: String,
    plan: String,
    state: String,
}

fn name(what: &str, s: &str) -> Result<String, String> {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() < 2 || s.chars().count() > 80 {
        return Err(format!("type the {what}, 2 to 80 characters"));
    }
    Ok(s)
}

/// The attendee names their plan; a worker looks for its public document.
#[spacetimedb::reducer]
pub fn look_up_plan(
    ctx: &ReducerContext,
    kind: String,
    insurer: String,
    plan: String,
    state: String,
    limit_cents: u64,
    deductible_cents: u64,
) -> Result<(), String> {
    let me = ctx.sender();
    if kind != HEALTH && kind != BELONGINGS {
        return Err("kind is health or belongings".into());
    }
    if ctx.db.band_owner().owner().find(me).is_none() {
        return Err("claim your band first".into());
    }
    let insurer = name("insurer", &insurer)?;
    let plan = name("plan", &plan)?;
    let state = state.trim().to_ascii_uppercase();
    if state.len() != 2 || !state.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("type your state as two letters, such as CA".into());
    }
    let (limit_cents, deductible_cents) = if kind == BELONGINGS {
        if limit_cents == 0 {
            return Err("type your personal property limit from your declarations page".into());
        }
        if deductible_cents >= limit_cents {
            return Err("the deductible must be below the limit".into());
        }
        (limit_cents, deductible_cents)
    } else {
        (0, 0)
    };
    if ctx.db.plan_lookup().attendee().filter(me).any(|l| l.kind == kind && l.status == SEARCHING) {
        return Err("already looking up your plan".into());
    }
    let row = ctx.db.plan_lookup().insert(PlanLookup {
        id: 0,
        attendee: me,
        kind: kind.clone(),
        insurer: insurer.clone(),
        plan: plan.clone(),
        state: state.clone(),
        limit_cents,
        deductible_cents,
        status: SEARCHING.into(),
        source_url: String::new(),
        printed_insurer: String::new(),
        printed_plan: String::new(),
        plan_year: String::new(),
        file_hash: String::new(),
        page_count: 0,
        job_id: 0,
        note: String::new(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    let payload = serde_json::to_string(&LookupPayload { lookup_id: row.id, kind, insurer, plan, state }).map_err(|e| e.to_string())?;
    let job_id = jobs::enqueue(ctx, KIND_PLAN_LOOKUP, payload, "plan_lookup", row.id);
    ctx.db.plan_lookup().id().update(PlanLookup { job_id, ..row });
    Ok(())
}

fn is_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

/// The worker's result: the plan's PDF, checked against what the attendee typed, or why there is none.
#[spacetimedb::reducer]
pub fn finish_plan_lookup(ctx: &ReducerContext, job_id: u64, result: PlanLookupResult, call: Option<ModelCallIn>) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    if let Some(call) = &call {
        jobs::record_call(ctx, job_id, call);
    }
    let lookup = ctx.db.plan_lookup().id().find(job.subject_id).ok_or("no such plan lookup")?;
    if result.status != FOUND {
        if result.status != NOT_FOUND && result.status != WRONG_PLAN {
            return Err("status is found, not_found or wrong_plan".into());
        }
        let status = result.status.clone();
        ctx.db.plan_lookup().id().update(PlanLookup {
            status: result.status,
            source_url: result.source_url,
            note: result.note,
            updated_at: ctx.timestamp,
            ..lookup
        });
        jobs::finish(ctx, job, status);
        return Ok(());
    }
    if !is_hash(&result.file_hash) {
        return Err("the PDF's hash must be a hex SHA-256".into());
    }
    let file_hash = result.file_hash.to_lowercase();
    if ctx.db.blob_ref().hash().find(&file_hash).is_none() {
        ctx.db.blob_ref().insert(BlobRef {
            id: 0,
            hash: file_hash.clone(),
            owner: Some(lookup.attendee),
            access: "owner_only".into(),
            purpose: PLAN_WORDING.into(),
            content_type: "application/pdf".into(),
            size_bytes: result.size_bytes,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    }
    let found = PlanLookup {
        status: FOUND.into(),
        source_url: result.source_url,
        printed_insurer: result.printed_insurer,
        printed_plan: result.printed_plan,
        plan_year: result.plan_year,
        file_hash,
        page_count: result.page_count.max(1),
        note: String::new(),
        updated_at: ctx.timestamp,
        ..lookup
    };
    if found.kind == HEALTH {
        land_health_plan(ctx, &found);
    } else {
        land_own_policy(ctx, &found)?;
    }
    // The Evidence Engine reads the found PDF like an upload; a document it can't take still leaves the lookup found.
    let read = DocumentIn {
        kind: if found.kind == HEALTH { HEALTH_PLAN } else { ATTENDEE_POLICY }.into(),
        attendee: Some(found.attendee),
        file_hash: found.file_hash.clone(),
        page_count: found.page_count,
        source: KIND_PLAN_LOOKUP.into(),
        source_url: found.source_url.clone(),
    };
    if let Err(e) = queue_document_read(ctx, read) {
        log::warn!("plan lookup {}: not read: {e}", found.id);
    }
    ctx.db.plan_lookup().id().update(found);
    jobs::finish(ctx, job, FOUND);
    Ok(())
}

/// What the PDF prints, or what the attendee typed when it prints nothing there.
fn printed_or(printed: &str, typed: &str) -> String {
    if printed.trim().is_empty() { typed.to_string() } else { printed.trim().to_string() }
}

/// A found health plan fills an empty insurer and plan on the medical card, from what it prints.
fn land_health_plan(ctx: &ReducerContext, l: &PlanLookup) {
    let insurer = printed_or(&l.printed_insurer, &l.insurer);
    let plan = printed_or(&l.printed_plan, &l.plan);
    match ctx.db.medical_card().attendee().find(l.attendee) {
        Some(card) if !card.insurer.is_empty() => {}
        Some(card) => {
            ctx.db.medical_card().attendee().update(MedicalCard { insurer, plan, updated_at: ctx.timestamp, ..card });
        }
        None => {
            ctx.db.medical_card().insert(MedicalCard { insurer, plan, ..medical::empty_card(l.attendee, ctx.timestamp) });
        }
    }
}

/// A found belongings policy becomes the attendee's own policy: the printed insurer and plan, and the
/// limit and deductible they typed, since the public form prints neither. The plan's name stands in
/// for the policy number, which only their declarations page prints.
fn land_own_policy(ctx: &ReducerContext, l: &PlanLookup) -> Result<(), String> {
    let terms = AttendeePolicyTerms {
        insurer_name: printed_or(&l.printed_insurer, &l.insurer),
        policy_number: printed_or(&l.printed_plan, &l.plan),
        per_claim_limit_cents: l.limit_cents,
        aggregate_limit_cents: l.limit_cents,
        deductible_cents: l.deductible_cents,
        source: KIND_PLAN_LOOKUP.into(),
        document_hash: l.file_hash.clone(),
    };
    own_policy::upsert(ctx, l.attendee, terms).map(|_| ())
}

/// A lookup job gave up after its last attempt.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_PLAN_LOOKUP {
        return;
    }
    if let Some(l) = ctx.db.plan_lookup().id().find(job.subject_id).filter(|l| l.status == SEARCHING) {
        ctx.db.plan_lookup().id().update(PlanLookup { status: FAILED.into(), note: job.error.clone(), updated_at: ctx.timestamp, ..l });
    }
}

#[spacetimedb::view(accessor = my_plan_lookups, public)]
pub fn my_plan_lookups(ctx: &ViewContext) -> Vec<PlanLookup> {
    ctx.db.plan_lookup().attendee().filter(viewed(ctx)).collect()
}

#[cfg(test)]
mod tests;
