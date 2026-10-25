//! What the plain web pages read beyond the feature views: whether the event has ended, the claims
//! board for staff and an attendee's own claims. Staff here means the module owner or anyone holding
//! a staff role.

use crate::insurance::*;
use crate::roles::*;
use crate::safety::*;
use crate::social::tables::*;
use crate::venue::*;
use crate::tables::*;
use spacetimedb::{Identity, RawQuery, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

/// One row, id 0. Once the host ends the event, the band's link shows the recap instead of the live view.
#[spacetimedb::table(accessor = event_state, public)]
pub struct EventState {
    #[primary_key]
    pub id: u8,
    pub ended: bool,
    pub ended_at: Option<Timestamp>,
    pub ended_by: Identity,
}

fn set_ended(ctx: &ReducerContext, ended: bool) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    set_ended_by(ctx, ended)
}

/// Ends or reopens the event as the caller, with no role check: the live run's clock ends it.
pub fn set_ended_by(ctx: &ReducerContext, ended: bool) -> Result<(), String> {
    let row = EventState { id: 0, ended, ended_at: ended.then_some(ctx.timestamp), ended_by: ctx.sender() };
    if ctx.db.event_state().id().find(0).is_some() {
        ctx.db.event_state().id().update(row);
    } else {
        ctx.db.event_state().insert(row);
    }
    if ended {
        crate::merch::on_event_ended(ctx);
    }
    Ok(())
}

/// The host's "Event ended" button.
#[spacetimedb::reducer]
pub fn end_event(ctx: &ReducerContext) -> Result<(), String> {
    set_ended(ctx, true)
}

/// Back to the live event, for running it again.
#[spacetimedb::reducer]
pub fn reopen_event(ctx: &ReducerContext) -> Result<(), String> {
    set_ended(ctx, false)
}

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

#[derive(SpacetimeType, Clone, Debug)]
pub struct AttendeeOut {
    pub node_id: u64,
    pub display_name: String,
    /// 0 when the attendee wears no band.
    pub band_id: u32,
    pub findable: bool,
    /// One of the crowd's attendees.
    pub crowd: bool,
    pub organization: String,
    pub handles: Vec<crate::social::views::HandleOut>,
    pub created_at: Timestamp,
}

/// Everyone who joined, for the host portal.
#[spacetimedb::view(accessor = board_attendees, public)]
pub fn board_attendees(ctx: &ViewContext) -> Vec<AttendeeOut> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db
        .attendee()
        .person_id()
        .filter(0u64..)
        .map(|a| AttendeeOut {
            node_id: a.node_id,
            band_id: ctx
                .db
                .band_owner()
                .owner()
                .find(a.identity)
                .map(|o| o.band_id.into())
                .or_else(|| ctx.db.crowd_member().identity().find(a.identity).map(|m| m.band_id))
                .unwrap_or(0),
            findable: a.findable,
            crowd: a.crowd,
            organization: ctx.db.organization().id().find(a.organization_id).map(|o| o.name).unwrap_or_default(),
            handles: ctx
                .db
                .social_handle()
                .owner()
                .filter(a.identity)
                .map(|h| crate::social::views::HandleOut { platform: h.platform, handle: h.handle })
                .collect(),
            display_name: a.display_name,
            created_at: a.created_at,
        })
        .collect()
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct BoardPhoto {
    pub id: u64,
    pub url: String,
    pub taken_at: Timestamp,
    pub zone_name: String,
    pub caption: String,
    /// The graph nodes of the findable people the bands put in it.
    pub node_ids: Vec<u64>,
    /// The people Claude counted in it, once it has read the photo.
    pub people_count: u32,
    pub read: bool,
}

/// Every event photo with the people in it, for the host portal's photos and event graph.
#[spacetimedb::view(accessor = board_photos, public)]
pub fn board_photos(ctx: &ViewContext) -> Vec<BoardPhoto> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db
        .photo()
        .zone_id()
        .filter(0u64..)
        .map(|p| BoardPhoto {
            node_ids: ctx
                .db
                .photo_tag()
                .photo_id()
                .filter(p.id)
                .filter_map(|t| ctx.db.attendee().identity().find(t.attendee).filter(|a| a.findable).map(|a| a.node_id))
                .collect(),
            zone_name: ctx.db.zone().id().find(p.zone_id).map(|z| z.name).unwrap_or_default(),
            id: p.id,
            url: p.url,
            taken_at: p.taken_at,
            caption: p.caption,
            people_count: p.people_count,
            read: p.features_call_id != 0,
        })
        .collect()
}
