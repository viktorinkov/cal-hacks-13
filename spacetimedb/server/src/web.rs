//! What the plain web pages read beyond the feature views: whether the event has ended, the claims
//! board for staff, and an attendee's own incidents and claims. Staff here means the module owner or
//! anyone holding a staff role.

use crate::insurance::*;
use crate::roles::*;
use crate::safety::*;
use crate::social::tables::*;
use crate::venue::*;
use crate::tables::*;
use crate::view_as::viewed;
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
    ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| STAFF_ROLES.contains(&r.role.as_str()))
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

#[spacetimedb::view(accessor = board_clinic_reports, public)]
pub fn board_clinic_reports(ctx: &ViewContext) -> Vec<ClinicReport> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.clinic_report().claim_id().filter(0u64..).collect()
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

/// Each policy's covers: limits, deductible, minimum payout and service window.
#[spacetimedb::view(accessor = board_covers, public)]
pub fn board_covers(ctx: &ViewContext) -> RawQuery<CoverageRuleRow> {
    staff_query(ctx, "coverage_rule")
}

/// Uploaded insurance PDFs and how far their reading got.
#[spacetimedb::view(accessor = board_policy_documents, public)]
pub fn board_policy_documents(ctx: &ViewContext) -> RawQuery<PolicyDocument> {
    staff_query(ctx, "policy_document")
}

/// Every term read from a venue policy, with its quote, page and checks.
#[spacetimedb::view(accessor = board_policy_terms, public)]
pub fn board_policy_terms(ctx: &ViewContext) -> RawQuery<PolicyTerm> {
    staff_query(ctx, "policy_term")
}

/// The confirmed policies' schedules of benefits.
#[spacetimedb::view(accessor = board_fee_schedule, public)]
pub fn board_fee_schedule(ctx: &ViewContext) -> RawQuery<FeeScheduleLine> {
    staff_query(ctx, "fee_schedule_line")
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
    pub incident_id: u64,
    pub statement: String,
}

/// The caller's own claims, as the claimant sees them: status and payout, no evidence.
#[spacetimedb::view(accessor = my_claims, public)]
pub fn my_claims(ctx: &ViewContext) -> Vec<MyClaim> {
    let me = viewed(ctx);
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
            incident_id: c.incident_id,
            statement: c.statement,
        })
        .collect()
}

fn kind_name(kind: IncidentKind) -> String {
    kind.core().as_str().into()
}

fn zone_name(ctx: &ViewContext, zone_id: u64) -> String {
    ctx.db.zone().id().find(zone_id).map(|z| z.name).unwrap_or_else(|| "unzoned".into())
}

fn claim_id_for(ctx: &ViewContext, incident_id: u64) -> u64 {
    ctx.db.claim().incident_id().find(incident_id).map(|c| c.id).unwrap_or(0)
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct MyIncident {
    pub incident_id: u64,
    /// `sos` or `fall`.
    pub kind: String,
    pub zone_name: String,
    pub opened_at: Timestamp,
    pub resolved: bool,
    pub resolved_at: Option<Timestamp>,
    pub resolution: String,
    /// 0 until a claim is filed.
    pub claim_id: u64,
}

/// SOS and fall incidents on the band the caller wears, since they claimed it: what they can file a claim for.
#[spacetimedb::view(accessor = my_incidents, public)]
pub fn my_incidents(ctx: &ViewContext) -> Vec<MyIncident> {
    let Some(own) = ctx.db.band_owner().owner().find(viewed(ctx)) else {
        return Vec::new();
    };
    ctx.db
        .incident()
        .subject_band()
        .filter(u32::from(own.band_id))
        .filter(|i| i.kind.is_injury() && i.opened_at >= own.claimed_at)
        .map(|i| MyIncident {
            incident_id: i.id,
            kind: kind_name(i.kind),
            zone_name: zone_name(ctx, i.zone_id),
            opened_at: i.opened_at,
            resolved: i.resolved,
            resolved_at: i.resolved_at,
            resolution: i.resolution,
            claim_id: claim_id_for(ctx, i.id),
        })
        .collect()
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UnclaimedInjury {
    pub incident_id: u64,
    /// `sos` or `fall`.
    pub kind: String,
    pub zone_name: String,
    pub band_id: u32,
    pub wearer_name: String,
    pub opened_at: Timestamp,
    pub resolved_at: Option<Timestamp>,
    /// The staff notes, oldest first.
    pub notes: Vec<String>,
}

/// Resolved SOS and fall incidents whose wearer has not filed a claim yet, for staff to file for them.
#[spacetimedb::view(accessor = unclaimed_injuries, public)]
pub fn unclaimed_injuries(ctx: &ViewContext) -> Vec<UnclaimedInjury> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db
        .incident()
        .subject_band()
        .filter(1u32..)
        .filter(|i| i.resolved && i.kind.is_injury() && claim_id_for(ctx, i.id) == 0)
        .filter_map(|i| {
            let wearer = ctx.db.band_owner().band_id().find(radio_id(i.subject_band)?).filter(|o| o.claimed_at <= i.opened_at)?;
            let mut notes: Vec<IncidentNote> = ctx.db.incident_note().incident_id().filter(i.id).collect();
            notes.sort_by_key(|n| n.id);
            Some(UnclaimedInjury {
                incident_id: i.id,
                kind: kind_name(i.kind),
                zone_name: zone_name(ctx, i.zone_id),
                band_id: i.subject_band,
                wearer_name: ctx.db.attendee().identity().find(wearer.owner).map(|a| a.display_name).unwrap_or_default(),
                opened_at: i.opened_at,
                resolved_at: i.resolved_at,
                notes: notes.into_iter().map(|n| n.text).collect(),
            })
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
