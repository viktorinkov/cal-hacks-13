//! What the plain web pages read and write beyond the feature views: the claims board for staff,
//! an attendee's own claims and Nessie wallet, and merch orders from the recap.
//! Staff here means the module owner or anyone holding a staff role.

use crate::insurance::*;
use crate::roles::*;
use crate::safety::*;
use crate::tables::*;
use spacetimedb::{Identity, RawQuery, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

fn is_staff(ctx: &ViewContext) -> bool {
    ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| STAFF_ROLES.contains(&r.role.as_str()))
}

fn staff_query<T>(ctx: &ViewContext, table: &str) -> RawQuery<T> {
    let filter = if is_staff(ctx) { "" } else { " WHERE id = 0" };
    RawQuery::new(format!("SELECT * FROM {table}{filter}"))
}

/// Every claim, for the claims screens.
#[spacetimedb::view(accessor = claims_board, public)]
pub fn claims_board(ctx: &ViewContext) -> Vec<Claim> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim().routed_to().filter(Identity::ZERO..).collect()
}

#[spacetimedb::view(accessor = board_facts, public)]
pub fn board_facts(ctx: &ViewContext) -> Vec<EvidenceFact> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.evidence_fact().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_checks, public)]
pub fn board_checks(ctx: &ViewContext) -> Vec<ClaimCheck> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_check().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_lines, public)]
pub fn board_lines(ctx: &ViewContext) -> Vec<ClaimLine> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_line().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_reviews, public)]
pub fn board_reviews(ctx: &ViewContext) -> Vec<ClaimReview> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_review().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_precedents, public)]
pub fn board_precedents(ctx: &ViewContext) -> Vec<ClaimPrecedent> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.claim_precedent().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_records, public)]
pub fn board_records(ctx: &ViewContext) -> Vec<MedicalRecord> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.medical_record().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_approvals, public)]
pub fn board_approvals(ctx: &ViewContext) -> Vec<Approval> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.approval().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_ledger, public)]
pub fn board_ledger(ctx: &ViewContext) -> Vec<LedgerEntry> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.ledger_entry().claim_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = board_notes, public)]
pub fn board_notes(ctx: &ViewContext) -> Vec<IncidentNote> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.incident_note().incident_id().filter(0u64..).collect()
}

/// The learned settlement rules, every version.
#[spacetimedb::view(accessor = board_rules, public)]
pub fn board_rules(ctx: &ViewContext) -> RawQuery<SettlementRuleRow> {
    staff_query(ctx, "settlement_rule")
}

#[spacetimedb::view(accessor = board_policies, public)]
pub fn board_policies(ctx: &ViewContext) -> RawQuery<InsurancePolicy> {
    staff_query(ctx, "insurance_policy")
}

/// The authority matrix: who approves up to which amount.
#[spacetimedb::view(accessor = board_authority, public)]
pub fn board_authority(ctx: &ViewContext) -> RawQuery<AuthorityLimitRow> {
    let filter = if is_staff(ctx) { "" } else { " WHERE rank = 255" };
    RawQuery::new(format!("SELECT * FROM authority_limit{filter}"))
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct MyClaim {
    pub id: u64,
    pub incident_kind: String,
    pub zone_name: String,
    pub status: ClaimStatus,
    pub status_note: String,
    pub payout_cents: u64,
    pub payout_reference: String,
    pub opened_at: Timestamp,
    pub settled_at: Option<Timestamp>,
}

/// The caller's own claims, as the claimant sees them: status and payout, no evidence.
#[spacetimedb::view(accessor = my_claims, public)]
pub fn my_claims(ctx: &ViewContext) -> Vec<MyClaim> {
    let me = ctx.sender();
    ctx.db
        .claim()
        .routed_to()
        .filter(Identity::ZERO..)
        .filter(|c| c.claimant == Some(me))
        .map(|c| MyClaim {
            id: c.id,
            incident_kind: c.incident_kind,
            zone_name: c.zone_name,
            status: c.status,
            status_note: c.status_note,
            payout_cents: c.payout_cents,
            payout_reference: c.payout_reference,
            opened_at: c.opened_at,
            settled_at: c.settled_at,
        })
        .collect()
}

/// The attendee's Nessie wallet. It is the account claim payouts go into.
#[spacetimedb::view(accessor = my_wallet, public)]
pub fn my_wallet(ctx: &ViewContext) -> Option<ClaimantAccount> {
    ctx.db.claimant_account().identity().find(ctx.sender())
}

/// Every wallet, for bandit-api (role `api`).
#[spacetimedb::view(accessor = wallets, public)]
pub fn wallets(ctx: &ViewContext) -> RawQuery<ClaimantAccount> {
    let api = ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| r.role == "api");
    let filter = if api { "" } else { " WHERE customer_id = ''" };
    RawQuery::new(format!("SELECT * FROM claimant_account{filter}"))
}

/// bandit-api opened a funded Nessie wallet for the attendee at sign-up.
#[spacetimedb::reducer]
pub fn set_wallet(ctx: &ReducerContext, identity: Identity, customer_id: String, account_id: String) -> Result<(), String> {
    require_role(ctx, &["api"])?;
    if ctx.db.claimant_account().identity().find(identity).is_some() {
        return Ok(());
    }
    ctx.db.claimant_account().insert(ClaimantAccount { identity, customer_id, account_id, created_at: ctx.timestamp });
    Ok(())
}

/// A merch item bought from the recap: a template with the attendee's photo, paid through Nessie.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = merch_order)]
pub struct MerchOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee: Identity,
    /// The template file in assets/merch, for example tee_spacetimedb.png.
    pub template: String,
    pub product: String,
    pub photo_id: u64,
    pub amount_cents: u64,
    pub nessie_purchase_id: String,
    pub created_at: Timestamp,
}

#[spacetimedb::reducer]
pub fn record_merch_order(
    ctx: &ReducerContext,
    attendee: Identity,
    template: String,
    product: String,
    photo_id: u64,
    amount_cents: u64,
    nessie_purchase_id: String,
) -> Result<(), String> {
    require_role(ctx, &["api"])?;
    ctx.db.merch_order().insert(MerchOrder {
        id: 0,
        attendee,
        template,
        product,
        photo_id,
        amount_cents,
        nessie_purchase_id,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[spacetimedb::view(accessor = my_merch_orders, public)]
pub fn my_merch_orders(ctx: &ViewContext) -> Vec<MerchOrder> {
    ctx.db.merch_order().attendee().filter(ctx.sender()).collect()
}

/// Every merch order, for bandit-api, which shows them on the recap.
#[spacetimedb::view(accessor = merch_orders, public)]
pub fn merch_orders(ctx: &ViewContext) -> Vec<MerchOrder> {
    let api = ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| r.role == "api");
    if !api {
        return Vec::new();
    }
    ctx.db.merch_order().attendee().filter(Identity::ZERO..).collect()
}
