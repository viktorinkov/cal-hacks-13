//! Plan lookup: an attendee names their health insurer and plan instead of uploading its PDF. A
//! worker searches for the plan's public document through Bright Data, and the Evidence Engine
//! selects a source and reads what its PDF prints. The worker keeps the PDF only when its printed
//! insurer and plan match what the attendee typed. Here the PDF lands like an upload and fills the medical
//! card's insurer and plan, with the chunk of the PDF the check cites. A plan another lookup already
//! found is linked at once, with no search.

use super::documents::{DocumentIn, queue_document_read};
use crate::jobs::{self, *};
use crate::medical::{self, *};
use crate::roles::*;
use crate::social::tables::*;
use crate::view_as::viewed;
use bandit_insurance::policy::HEALTH_PLAN;
use bandit_insurance::printed::same_plan_name;
use bandit_insurance::time::civil_from_days;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

pub const KIND_ATTENDEE_POLICY_LOOKUP: &str = "attendee_policy_lookup";
/// Jobs already queued before the attendee lookup received its explicit name.
const LEGACY_KIND_PLAN_LOOKUP: &str = "plan_lookup";

fn is_lookup_kind(kind: &str) -> bool {
    matches!(kind, KIND_ATTENDEE_POLICY_LOOKUP | LEGACY_KIND_PLAN_LOOKUP)
}
/// What the attendee names: their health plan.
pub const HEALTH: &str = "health";

pub const SEARCHING: &str = "searching";
pub const FOUND: &str = "found";
pub const NOT_FOUND: &str = "not_found";
pub const WRONG_PLAN: &str = "wrong_plan";
pub const FAILED: &str = "failed";

/// The blob purpose of a plan's public PDF.
pub const PLAN_WORDING: &str = "plan_wording";
/// The longest chunk text a lookup keeps.
const MAX_MATCH_CHARS: usize = 1000;

/// The chunk of a fetched PDF that a lookup's check cites: the Evidence Engine found it by meaning
/// among the PDF's chunks with what was typed, and it holds the name the check matched.
#[derive(SpacetimeType, Clone, Debug, Default, PartialEq)]
pub struct ChunkMatch {
    /// `<sha256>-p<page>-k<n>` in the clause index.
    pub chunk_id: String,
    pub page: u32,
    pub text: String,
    /// How close in meaning to what was typed.
    pub score: f32,
}

/// The cited chunk a worker sent, its text cut to 1,000 characters; none when it sent none.
pub fn checked_match(m: Option<ChunkMatch>) -> Result<Option<ChunkMatch>, String> {
    let Some(m) = m else { return Ok(None) };
    let id_ok = !m.chunk_id.is_empty() && m.chunk_id.len() <= 200 && m.chunk_id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !id_ok || m.page == 0 || m.text.trim().is_empty() {
        return Err("a cited chunk has an id, a page and its text".into());
    }
    let text = m.text.trim().chars().take(MAX_MATCH_CHARS).collect();
    let score = if m.score.is_finite() { m.score.max(0.0) } else { 0.0 };
    Ok(Some(ChunkMatch { text, score, ..m }))
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = plan_lookup)]
pub struct PlanLookup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee: Identity,
    /// `health`.
    pub kind: String,
    /// As the attendee typed them.
    pub insurer: String,
    pub plan: String,
    pub state: String,
    /// Kept from an earlier design, when a lookup could name a belongings policy; always 0.
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
    /// The lookup that fetched the PDF this one links to, when it named a plan already found; 0 when it searched.
    #[default(0)]
    pub reused_from: u64,
    /// The chunk of the PDF the check cites; none until `found`.
    #[default(None)]
    pub matched_chunk: Option<ChunkMatch>,
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
    /// The chunk the check cites.
    pub matched_chunk: Option<ChunkMatch>,
}

#[derive(serde::Serialize, serde::Deserialize)]
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

/// The calendar year of a time, in UTC: the plan year a lookup's searches ask for.
fn utc_year(t: Timestamp) -> i64 {
    civil_from_days(super::micros(t).div_euclid(86_400_000_000)).0
}

/// The newest lookup that already found the plan `l` names: the same state and calendar year, and
/// the same telling words of insurer and plan as it was typed or as its PDF prints them.
fn found_before(ctx: &ReducerContext, l: &PlanLookup) -> Option<PlanLookup> {
    let year = utc_year(l.created_at);
    ctx.db
        .plan_lookup()
        .iter()
        .filter(|f| f.kind == l.kind && f.status == FOUND && f.state == l.state && utc_year(f.created_at) == year)
        .filter(|f| {
            same_plan_name(&l.insurer, &l.plan, &f.insurer, &f.plan) || same_plan_name(&l.insurer, &l.plan, &f.printed_insurer, &f.printed_plan)
        })
        .filter(|f| is_hash(&f.file_hash) && ctx.db.blob_ref().hash().find(&f.file_hash).is_some())
        .max_by_key(|f| f.id)
}

/// The attendee names their health plan. A plan another lookup already found is found at once with
/// its PDF and reading; otherwise a worker looks for its public document.
#[spacetimedb::reducer]
pub fn look_up_plan(ctx: &ReducerContext, insurer: String, plan: String, state: String) -> Result<(), String> {
    let me = ctx.sender();
    let kind = HEALTH.to_string();
    if ctx.db.band_owner().owner().find(me).is_none() {
        return Err("claim your band first".into());
    }
    let insurer = name("insurer", &insurer)?;
    let plan = name("plan", &plan)?;
    let state = state.trim().to_ascii_uppercase();
    if state.len() != 2 || !state.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("type your state as two letters, such as CA".into());
    }
    let (limit_cents, deductible_cents) = (0, 0);
    if ctx.db.plan_lookup().attendee().filter(me).any(|l| l.kind == kind && l.status == SEARCHING) {
        return Err("already looking up your plan".into());
    }
    let typed = PlanLookup {
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
        reused_from: 0,
        matched_chunk: None,
    };
    if let Some(f) = found_before(ctx, &typed) {
        let found = ctx.db.plan_lookup().insert(PlanLookup {
            status: FOUND.into(),
            source_url: f.source_url,
            printed_insurer: f.printed_insurer,
            printed_plan: f.printed_plan,
            plan_year: f.plan_year,
            file_hash: f.file_hash,
            page_count: f.page_count,
            reused_from: if f.reused_from != 0 { f.reused_from } else { f.id },
            matched_chunk: f.matched_chunk,
            ..typed
        });
        land(ctx, &found);
        return Ok(());
    }
    let row = ctx.db.plan_lookup().insert(typed);
    let payload = serde_json::to_string(&LookupPayload { lookup_id: row.id, kind, insurer, plan, state }).map_err(|e| e.to_string())?;
    let job_id = jobs::enqueue(ctx, KIND_ATTENDEE_POLICY_LOOKUP, payload, "plan_lookup", row.id);
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
    if !is_lookup_kind(&job.kind) {
        return Err("not an attendee policy lookup job".into());
    }
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
    let matched_chunk = checked_match(result.matched_chunk)?;
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
        matched_chunk,
        ..lookup
    };
    land(ctx, &found);
    ctx.db.plan_lookup().id().update(found);
    jobs::finish(ctx, job, FOUND);
    Ok(())
}

/// A found plan fills the medical card and goes to the Evidence Engine like an upload. A PDF already
/// read is not read again; a document it can't take still leaves the lookup found.
fn land(ctx: &ReducerContext, found: &PlanLookup) {
    land_health_plan(ctx, found);
    let read = DocumentIn {
        kind: HEALTH_PLAN.into(),
        attendee: Some(found.attendee),
        file_hash: found.file_hash.clone(),
        page_count: found.page_count,
        source: KIND_ATTENDEE_POLICY_LOOKUP.into(),
        source_url: found.source_url.clone(),
    };
    if let Err(e) = queue_document_read(ctx, read) {
        log::warn!("plan lookup {}: not read: {e}", found.id);
    }
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

/// A lookup job gave up after its last attempt.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if !is_lookup_kind(&job.kind) {
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
