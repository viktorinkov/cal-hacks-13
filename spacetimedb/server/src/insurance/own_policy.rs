//! The attendee's own policy. Its personal property cover pays for the attendee's own belongings stolen
//! (`theft`) or broken by someone else (`breakage`), which the venue's policy excludes as guests' property. Its terms come from the attendee's policy
//! document or a plan lookup; the live run's crowd has neither, so each crowd attendee's terms are drawn
//! once from a generator seeded with their identity, and the same attendee always has the same policy.

use crate::roles::*;
use crate::social::tables::attendee;
use crate::view_as::viewed;
use spacetimedb::rand::rngs::StdRng;
use spacetimedb::rand::{Rng, SeedableRng};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = attendee_policy)]
pub struct AttendeePolicy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub holder: Identity,
    pub insurer_name: String,
    pub policy_number: String,
    /// The personal property cover's limits and deductible; the attendee carries the deductible.
    pub per_claim_limit_cents: u64,
    pub aggregate_limit_cents: u64,
    pub deductible_cents: u64,
    /// Paid so far under the cover, against the aggregate limit.
    pub used_cents: u64,
    /// `document`, `plan_lookup`, or `drawn` for the live run's crowd.
    pub source: String,
    /// The policy document in the blob store and the clause index; empty when none.
    pub document_hash: String,
    pub updated_at: Timestamp,
}

/// The terms of an attendee's own policy, as a reader or a lookup found them.
#[derive(SpacetimeType, Clone, Debug)]
pub struct AttendeePolicyTerms {
    pub insurer_name: String,
    pub policy_number: String,
    pub per_claim_limit_cents: u64,
    pub aggregate_limit_cents: u64,
    pub deductible_cents: u64,
    pub source: String,
    pub document_hash: String,
}

pub fn for_holder(ctx: &ReducerContext, holder: Identity) -> Option<AttendeePolicy> {
    ctx.db.attendee_policy().holder().find(holder)
}

/// Writes the holder's policy, keeping what has been paid under it.
pub fn upsert(ctx: &ReducerContext, holder: Identity, t: AttendeePolicyTerms) -> Result<AttendeePolicy, String> {
    if t.insurer_name.trim().is_empty() || t.policy_number.trim().is_empty() {
        return Err("a policy needs an insurer and a policy number".into());
    }
    if t.per_claim_limit_cents == 0 || t.per_claim_limit_cents > t.aggregate_limit_cents {
        return Err("the per-claim limit is above 0 and at most the yearly limit".into());
    }
    if t.deductible_cents >= t.per_claim_limit_cents {
        return Err("the deductible is below the per-claim limit".into());
    }
    let row = AttendeePolicy {
        id: 0,
        holder,
        insurer_name: t.insurer_name.trim().into(),
        policy_number: t.policy_number.trim().into(),
        per_claim_limit_cents: t.per_claim_limit_cents,
        aggregate_limit_cents: t.aggregate_limit_cents,
        deductible_cents: t.deductible_cents,
        used_cents: 0,
        source: t.source,
        document_hash: t.document_hash.to_lowercase(),
        updated_at: ctx.timestamp,
    };
    Ok(match for_holder(ctx, holder) {
        Some(old) => ctx.db.attendee_policy().id().update(AttendeePolicy { id: old.id, used_cents: old.used_cents, ..row }),
        None => ctx.db.attendee_policy().insert(row),
    })
}

/// The organizer, or the worker that read the policy document or looked the plan up.
#[spacetimedb::reducer]
pub fn upsert_attendee_policy(
    ctx: &ReducerContext,
    holder: Identity,
    insurer_name: String,
    policy_number: String,
    per_claim_limit_cents: u64,
    aggregate_limit_cents: u64,
    deductible_cents: u64,
    source: String,
    document_hash: String,
) -> Result<(), String> {
    require_role(ctx, &["ops", "worker"])?;
    let terms = AttendeePolicyTerms { insurer_name, policy_number, per_claim_limit_cents, aggregate_limit_cents, deductible_cents, source, document_hash };
    upsert(ctx, holder, terms).map(|_| ())
}

const INSURERS: [&str; 4] = ["Golden Gate Mutual", "Bayside Home & Renters", "Pacific Crest Insurance", "Redwood Renters Co."];
const LIMITS: [u64; 3] = [150_000, 250_000, 500_000];
const DEDUCTIBLES: [u64; 3] = [10_000, 25_000, 50_000];

/// The holder's policy; a crowd attendee without one gets theirs drawn now. Anyone else has none until
/// their document is read.
pub fn ensure(ctx: &ReducerContext, holder: Identity) -> Option<AttendeePolicy> {
    if let Some(p) = for_holder(ctx, holder) {
        return Some(p);
    }
    if !ctx.db.attendee().identity().find(holder).is_some_and(|a| a.crowd) {
        return None;
    }
    let bytes = holder.to_byte_array();
    let mut rng = StdRng::seed_from_u64(u64::from_le_bytes(bytes[..8].try_into().unwrap()) ^ u64::from_le_bytes(bytes[24..].try_into().unwrap()));
    let limit = LIMITS[rng.gen_range(0..LIMITS.len())];
    let terms = AttendeePolicyTerms {
        insurer_name: INSURERS[rng.gen_range(0..INSURERS.len())].into(),
        policy_number: format!("PP-{:06}", rng.gen_range(0..1_000_000u32)),
        per_claim_limit_cents: limit,
        aggregate_limit_cents: limit * 4,
        deductible_cents: DEDUCTIBLES[rng.gen_range(0..DEDUCTIBLES.len())],
        source: "drawn".into(),
        document_hash: String::new(),
    };
    upsert(ctx, holder, terms).ok()
}

/// The policy's one cover in the venue policy's shape, so the claim flow computes it the same way.
pub fn cover_rule(p: &AttendeePolicy) -> super::CoverageRuleRow {
    super::CoverageRuleRow {
        id: p.id,
        policy_id: p.id,
        cover_kind: bandit_insurance::CoverKind::PersonalProperty.as_str().into(),
        incident_kinds: vec![bandit_insurance::IncidentKind::Theft.as_str().into(), bandit_insurance::IncidentKind::Breakage.as_str().into()],
        per_claim_limit_cents: p.per_claim_limit_cents,
        aggregate_limit_cents: p.aggregate_limit_cents,
        deductible_cents: p.deductible_cents,
        service_window_days: 0,
        active: true,
        updated_at: p.updated_at,
    }
}

/// The caller's own policy, as their tap page shows it.
#[spacetimedb::view(accessor = my_attendee_policy, public)]
pub fn my_attendee_policy(ctx: &ViewContext) -> Option<AttendeePolicy> {
    ctx.db.attendee_policy().holder().find(viewed(ctx))
}
