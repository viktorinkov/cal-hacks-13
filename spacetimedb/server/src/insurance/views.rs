//! What approvers see. Claim tables are private; these views return rows only
//! to the person a claim waits for, or to staff for a claim they name.

use super::*;
use crate::roles::*;
use crate::tables::*;
use crate::view_as::viewed;
use spacetimedb::{RawQuery, ViewContext};

fn is_claims_staff(ctx: &ViewContext) -> bool {
    ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| CLAIM_ROLES.contains(&r.role.as_str()))
}

/// Claims waiting for the caller: the named approver's queue.
#[spacetimedb::view(accessor = my_claim_queue, public)]
pub fn my_claim_queue(ctx: &ViewContext) -> Vec<Claim> {
    ctx.db.claim().routed_to().filter(viewed(ctx)).collect()
}

#[spacetimedb::view(accessor = claim_facts, public)]
pub fn claim_facts(ctx: &ViewContext, claim_id: u64) -> Vec<EvidenceFact> {
    if !is_claims_staff(ctx) {
        return Vec::new();
    }
    ctx.db.evidence_fact().claim_id().filter(claim_id).collect()
}

#[spacetimedb::view(accessor = claim_checks, public)]
pub fn claim_checks(ctx: &ViewContext, claim_id: u64) -> Vec<ClaimCheck> {
    if !is_claims_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_check().claim_id().filter(claim_id).collect()
}

#[spacetimedb::view(accessor = claim_lines, public)]
pub fn claim_lines(ctx: &ViewContext, claim_id: u64) -> Vec<ClaimLine> {
    if !is_claims_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_line().claim_id().filter(claim_id).collect()
}

#[spacetimedb::view(accessor = claim_reviews, public)]
pub fn claim_reviews(ctx: &ViewContext, claim_id: u64) -> Vec<ClaimReview> {
    if !is_claims_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_review().claim_id().filter(claim_id).collect()
}

#[spacetimedb::view(accessor = claim_ledger, public)]
pub fn claim_ledger(ctx: &ViewContext, claim_id: u64) -> Vec<LedgerEntry> {
    if !is_claims_staff(ctx) {
        return Vec::new();
    }
    ctx.db.ledger_entry().claim_id().filter(claim_id).collect()
}

#[spacetimedb::view(accessor = claim_clauses, public)]
pub fn claim_clauses(ctx: &ViewContext, claim_id: u64) -> Vec<ClaimClause> {
    if !is_claims_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_clause().claim_id().filter(claim_id).collect()
}

/// Every attendee's own policy on file, for the organizer deciding a claim on an attendee's own things.
#[spacetimedb::view(accessor = board_attendee_policies, public)]
pub fn board_attendee_policies(ctx: &ViewContext) -> RawQuery<AttendeePolicy> {
    let filter = if is_claims_staff(ctx) { "" } else { " WHERE id = 0" };
    RawQuery::new(format!("SELECT * FROM attendee_policy{filter}"))
}
