//! Setup reducers: the policy, its covers and the verification settings. The claims story seeds them once from `bandit-claims setup`.

use super::*;
use crate::roles::*;
use spacetimedb::{ReducerContext, Table, Timestamp};

#[spacetimedb::reducer]
pub fn upsert_insurance_policy(
    ctx: &ReducerContext,
    policy_number: String,
    insurer_name: String,
    fnol_contact: String,
    period_start: Timestamp,
    period_end: Timestamp,
) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if policy_number.trim().is_empty() || period_end <= period_start {
        return Err("a policy needs a number and a period that ends after it starts".into());
    }
    match ctx.db.insurance_policy().policy_number().find(&policy_number) {
        Some(p) => {
            ctx.db.insurance_policy().id().update(InsurancePolicy {
                insurer_name,
                fnol_contact,
                period_start,
                period_end,
                updated_at: ctx.timestamp,
                ..p
            });
        }
        None => {
            ctx.db.insurance_policy().insert(InsurancePolicy {
                id: 0,
                policy_number,
                insurer_name,
                fnol_contact,
                period_start,
                period_end,
                medical_used_cents: 0,
                property_used_cents: 0,
                updated_at: ctx.timestamp,
            });
        }
    }
    Ok(())
}

/// Creates or replaces the cover of one kind under a policy.
#[spacetimedb::reducer]
pub fn upsert_coverage_rule(
    ctx: &ReducerContext,
    policy_number: String,
    cover_kind: String,
    incident_kinds: Vec<String>,
    per_claim_limit_cents: u64,
    aggregate_limit_cents: u64,
    deductible_cents: u64,
    service_window_days: u32,
    active: bool,
) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let policy = ctx.db.insurance_policy().policy_number().find(&policy_number).ok_or_else(|| format!("no policy {policy_number}"))?;
    if hyphenate_core::CoverKind::parse(&cover_kind).is_none() {
        return Err(format!("unknown cover kind {cover_kind}"));
    }
    if let Some(bad) = incident_kinds.iter().find(|k| hyphenate_core::IncidentKind::parse(k).is_none()) {
        return Err(format!("unknown incident kind {bad}"));
    }
    let row = CoverageRuleRow {
        id: 0,
        policy_id: policy.id,
        cover_kind: cover_kind.clone(),
        incident_kinds,
        per_claim_limit_cents,
        aggregate_limit_cents,
        deductible_cents,
        service_window_days,
        active,
        updated_at: ctx.timestamp,
    };
    match ctx.db.coverage_rule().policy_id().filter(policy.id).find(|r| r.cover_kind == cover_kind) {
        Some(old) => {
            ctx.db.coverage_rule().id().update(CoverageRuleRow { id: old.id, ..row });
        }
        None => {
            ctx.db.coverage_rule().insert(row);
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_insurance_settings(
    ctx: &ReducerContext,
    venue_name: String,
    photo_window_secs: i64,
    note_window_secs: i64,
    min_witnesses: u32,
    tz_offset_minutes: i32,
    review_required: bool,
) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let s = settings(ctx);
    ctx.db.insurance_settings().id().update(InsuranceSettings {
        venue_name,
        photo_window_secs,
        note_window_secs,
        min_witnesses,
        tz_offset_minutes,
        review_required,
        ..s
    });
    Ok(())
}
