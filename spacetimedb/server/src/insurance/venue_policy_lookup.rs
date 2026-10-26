//! Venue policy lookup: the organizer names the venue's insurer and the two coverage forms of its
//! package policy (a liability form such as ISO CG 00 01 and a property form such as CP 00 10), and
//! types the numbers from its declarations page. A worker finds each form's public PDF through Bright
//! Data, Claude picks it among the results and reads the form number it prints, and the worker keeps a
//! PDF only when that number is the one typed. The worker joins the forms into one PDF, and here it is
//! filed as the venue's policy like an upload. When its terms are stored, the typed declarations stand
//! over the terms they name, since no public form prints a policy's own limits.

use super::documents::{DocumentIn, PolicyDocument, queue_document_read};
use super::plan_lookup::{ChunkMatch, checked_match};
use crate::jobs::{self, *};
use crate::roles::*;
use bandit_insurance::policy::{Declarations, VENUE_POLICY};
use serde::{Deserialize, Serialize};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

pub const KIND_VENUE_POLICY_LOOKUP: &str = "venue_policy_lookup";
/// `policy_document.source` of a PDF a venue policy lookup joined.
pub const POLICY_LOOKUP: &str = "policy_lookup";

pub const SEARCHING: &str = "searching";
pub const FOUND: &str = "found";
pub const NOT_FOUND: &str = "not_found";
pub const WRONG_FORM: &str = "wrong_form";
pub const FAILED: &str = "failed";

/// The two parts of a package policy, in the order the joined PDF holds them.
pub const LIABILITY: &str = "liability";
pub const PROPERTY: &str = "property";

/// One coverage form a lookup found.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct PolicyForm {
    /// `liability` or `property`.
    pub part: String,
    pub url: String,
    /// As the form prints them, such as "CG 00 01 04 13" and "COMMERCIAL GENERAL LIABILITY COVERAGE FORM".
    pub form_number: String,
    pub title: String,
    /// The page it starts on in the joined PDF.
    pub first_page: u32,
    pub page_count: u32,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = venue_policy_lookup)]
pub struct VenuePolicyLookup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// As the organizer typed them.
    pub insurer: String,
    pub state: String,
    pub liability_form: String,
    pub property_form: String,
    /// From the declarations page, as typed; the dates as `YYYY-MM-DD`.
    pub policy_number: String,
    pub fnol_contact: String,
    pub period_start: String,
    pub period_end: String,
    pub medical_limit_cents: u64,
    pub medical_aggregate_cents: u64,
    pub property_limit_cents: u64,
    pub property_deductible_cents: u64,
    /// `searching`, `found`, `not_found`, `wrong_form` or `failed`.
    #[index(btree)]
    pub status: String,
    /// Each form found, the liability form first.
    pub forms: Vec<PolicyForm>,
    /// The joined PDF in the blob store.
    pub file_hash: String,
    pub page_count: u32,
    /// The `policy_document` the PDF was filed as; 0 until then.
    #[index(btree)]
    pub document_id: u64,
    pub job_id: u64,
    /// A form that was not found, or why the lookup ended `not_found`, `wrong_form` or `failed`.
    pub note: String,
    pub requested_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    /// The chunk each form's check cites, in the joined PDF; none until `found`.
    #[default(None)]
    pub liability_chunk: Option<ChunkMatch>,
    #[default(None)]
    pub property_chunk: Option<ChunkMatch>,
}

/// What the worker found. `file_hash` is the joined PDF it stored; empty unless `status` is `found`.
#[derive(SpacetimeType, Clone, Debug, Default)]
pub struct VenuePolicyLookupResult {
    /// `found`, `not_found` or `wrong_form`.
    pub status: String,
    pub forms: Vec<PolicyForm>,
    pub file_hash: String,
    pub size_bytes: u64,
    pub page_count: u32,
    pub note: String,
    /// The chunk each form's check cites, in the joined PDF.
    pub liability_chunk: Option<ChunkMatch>,
    pub property_chunk: Option<ChunkMatch>,
}

/// What the organizer types from the declarations page.
#[derive(SpacetimeType, Clone, Debug, Default)]
pub struct DeclarationsIn {
    pub policy_number: String,
    pub fnol_contact: String,
    pub period_start: String,
    pub period_end: String,
    pub medical_limit_cents: u64,
    pub medical_aggregate_cents: u64,
    pub property_limit_cents: u64,
    pub property_deductible_cents: u64,
}

#[derive(Serialize, Deserialize)]
struct LookupPayload {
    lookup_id: u64,
    insurer: String,
    state: String,
    liability_form: String,
    property_form: String,
}

fn words(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn text(what: &str, s: &str, min: usize, max: usize) -> Result<String, String> {
    let s = words(s);
    if s.chars().count() < min || s.chars().count() > max {
        return Err(format!("type the {what}, {min} to {max} characters"));
    }
    Ok(s)
}

/// A form number as the declarations' forms schedule prints it: letters, digits and spaces.
fn form_number(what: &str, s: &str) -> Result<String, String> {
    let s = words(s).to_ascii_uppercase();
    let ok = (4..=24).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ') && s.chars().any(|c| c.is_ascii_digit());
    if !ok {
        return Err(format!("type the {what} form number from the declarations, such as CG 00 01"));
    }
    Ok(s)
}

impl VenuePolicyLookup {
    /// The typed declarations, as the policy's terms take them.
    pub fn declarations(&self) -> Declarations {
        Declarations {
            insurer_name: self.insurer.clone(),
            policy_number: self.policy_number.clone(),
            fnol_contact: self.fnol_contact.clone(),
            period_start: self.period_start.clone(),
            period_end: self.period_end.clone(),
            medical_limit_cents: self.medical_limit_cents,
            medical_aggregate_cents: self.medical_aggregate_cents,
            property_limit_cents: self.property_limit_cents,
            property_deductible_cents: self.property_deductible_cents,
        }
    }
}

/// The organizer names the venue's policy; a worker looks for its two forms.
#[spacetimedb::reducer]
pub fn look_up_venue_policy(
    ctx: &ReducerContext,
    insurer: String,
    state: String,
    liability_form: String,
    property_form: String,
    declarations: DeclarationsIn,
) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let insurer = text("insurer", &insurer, 2, 80)?;
    let state = state.trim().to_ascii_uppercase();
    if state.len() != 2 || !state.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("type the venue's state as two letters, such as CA".into());
    }
    let liability_form = form_number("liability", &liability_form)?;
    let property_form = form_number("property", &property_form)?;
    let d = declarations;
    let row = VenuePolicyLookup {
        id: 0,
        insurer: insurer.clone(),
        state: state.clone(),
        liability_form: liability_form.clone(),
        property_form: property_form.clone(),
        policy_number: text("policy number", &d.policy_number, 1, 60)?,
        fnol_contact: text("claims contact", &d.fnol_contact, 3, 120)?,
        period_start: d.period_start.trim().into(),
        period_end: d.period_end.trim().into(),
        medical_limit_cents: d.medical_limit_cents,
        medical_aggregate_cents: d.medical_aggregate_cents,
        property_limit_cents: d.property_limit_cents,
        property_deductible_cents: d.property_deductible_cents,
        status: SEARCHING.into(),
        forms: Vec::new(),
        file_hash: String::new(),
        page_count: 0,
        document_id: 0,
        job_id: 0,
        note: String::new(),
        requested_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        liability_chunk: None,
        property_chunk: None,
    };
    if let Some(problem) = row.declarations().problem() {
        return Err(problem);
    }
    if ctx.db.venue_policy_lookup().status().filter(SEARCHING).next().is_some() {
        return Err("already looking up the venue's policy".into());
    }
    let row = ctx.db.venue_policy_lookup().insert(row);
    let payload = LookupPayload { lookup_id: row.id, insurer, state, liability_form, property_form };
    let payload = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let job_id = jobs::enqueue(ctx, KIND_VENUE_POLICY_LOOKUP, payload, "venue_policy_lookup", row.id);
    ctx.db.venue_policy_lookup().id().update(VenuePolicyLookup { job_id, ..row });
    Ok(())
}

fn is_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

/// The worker's result: the forms it found, joined into one PDF, or why there is none.
#[spacetimedb::reducer]
pub fn finish_venue_policy_lookup(ctx: &ReducerContext, job_id: u64, result: VenuePolicyLookupResult, call: Option<ModelCallIn>) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    if let Some(call) = &call {
        jobs::record_call(ctx, job_id, call);
    }
    let lookup = ctx.db.venue_policy_lookup().id().find(job.subject_id).ok_or("no such venue policy lookup")?;
    if result.status != FOUND {
        if result.status != NOT_FOUND && result.status != WRONG_FORM {
            return Err("status is found, not_found or wrong_form".into());
        }
        let status = result.status.clone();
        ctx.db.venue_policy_lookup().id().update(VenuePolicyLookup { status: result.status, note: result.note, updated_at: ctx.timestamp, ..lookup });
        jobs::finish(ctx, job, status);
        return Ok(());
    }
    if !is_hash(&result.file_hash) {
        return Err("the PDF's hash must be a hex SHA-256".into());
    }
    if result.forms.is_empty() || result.forms.iter().any(|f| f.part != LIABILITY && f.part != PROPERTY) {
        return Err("a found policy names its forms, each liability or property".into());
    }
    let liability_chunk = checked_match(result.liability_chunk)?;
    let property_chunk = checked_match(result.property_chunk)?;
    let file_hash = result.file_hash.to_lowercase();
    if ctx.db.blob_ref().hash().find(&file_hash).is_none() {
        ctx.db.blob_ref().insert(BlobRef {
            id: 0,
            hash: file_hash.clone(),
            owner: None,
            access: "staff".into(),
            purpose: "policy".into(),
            content_type: "application/pdf".into(),
            size_bytes: result.size_bytes,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    }
    let source_url = result.forms.iter().find(|f| f.part == LIABILITY).or(result.forms.first()).map(|f| f.url.clone()).unwrap_or_default();
    let page_count = result.page_count.max(1);
    // The Evidence Engine reads the joined PDF like an uploaded policy; one it can't take still leaves the lookup found.
    let read = DocumentIn {
        kind: VENUE_POLICY.into(),
        attendee: None,
        file_hash: file_hash.clone(),
        page_count,
        source: POLICY_LOOKUP.into(),
        source_url,
    };
    let (document_id, note) = match queue_document_read(ctx, read) {
        Ok(id) => (id, result.note),
        Err(e) => (0, [result.note, format!("Not read: {e}.")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ")),
    };
    ctx.db.venue_policy_lookup().id().update(VenuePolicyLookup {
        status: FOUND.into(),
        forms: result.forms,
        file_hash,
        page_count,
        document_id,
        note,
        updated_at: ctx.timestamp,
        liability_chunk,
        property_chunk,
        ..lookup
    });
    jobs::finish(ctx, job, FOUND);
    Ok(())
}

/// The typed declarations of the lookup that filed this document, if a lookup did.
pub fn declarations_for(ctx: &ReducerContext, doc: &PolicyDocument) -> Option<Declarations> {
    if doc.kind != VENUE_POLICY || doc.source != POLICY_LOOKUP {
        return None;
    }
    ctx.db.venue_policy_lookup().document_id().filter(doc.id).next().map(|l| l.declarations())
}

/// A lookup job gave up after its last attempt.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_VENUE_POLICY_LOOKUP {
        return;
    }
    if let Some(l) = ctx.db.venue_policy_lookup().id().find(job.subject_id).filter(|l| l.status == SEARCHING) {
        ctx.db.venue_policy_lookup().id().update(VenuePolicyLookup { status: FAILED.into(), note: job.error.clone(), updated_at: ctx.timestamp, ..l });
    }
}

#[cfg(test)]
mod tests;
