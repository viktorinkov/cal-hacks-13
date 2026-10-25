//! The owner's "View as" on the organizer portal. The portal opens a fresh identity, the viewer, and
//! the owner points it at a person: every view the viewer reads then answers for that person, so their
//! pages show live with their data. The viewer holds nothing of its own, so it can change nothing of theirs.

use crate::roles::*;
use crate::social::tables::*;
use crate::tables::*;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

#[spacetimedb::table(accessor = viewing_as)]
pub struct ViewingAs {
    #[primary_key]
    pub viewer: Identity,
    pub target: Identity,
    pub by: Identity,
    pub at: Timestamp,
}

/// Whom a view answers for: the caller, or the person the owner pointed this viewer at.
pub fn viewed(ctx: &ViewContext) -> Identity {
    let sender = ctx.sender();
    ctx.db.viewing_as().viewer().find(sender).map(|v| v.target).unwrap_or(sender)
}

/// The same for a reducer: only the bandit-api session the recap reads with uses it.
pub fn acting_for(ctx: &ReducerContext) -> Identity {
    let sender = ctx.sender();
    ctx.db.viewing_as().viewer().find(sender).map(|v| v.target).unwrap_or(sender)
}

/// The owner points a fresh identity at a person. The viewer must hold nothing: no owner row, role,
/// profile or band, so a real account is never turned into someone else.
#[spacetimedb::reducer]
pub fn view_as(ctx: &ReducerContext, viewer: Identity, target: Identity) -> Result<(), String> {
    if !is_owner(ctx) {
        return Err("only the owner can view as someone".into());
    }
    let blank = ctx.db.owner().identity().find(viewer).is_none()
        && ctx.db.staff_role().identity().filter(viewer).next().is_none()
        && ctx.db.attendee().identity().find(viewer).is_none()
        && ctx.db.band_owner().owner().find(viewer).is_none();
    if !blank {
        return Err("the viewer must be a fresh identity".into());
    }
    let row = ViewingAs { viewer, target, by: ctx.sender(), at: ctx.timestamp };
    if ctx.db.viewing_as().viewer().find(viewer).is_some() {
        ctx.db.viewing_as().viewer().update(row);
    } else {
        ctx.db.viewing_as().insert(row);
    }
    Ok(())
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ViewablePerson {
    pub identity: Identity,
    pub name: String,
    /// attendee, ops, medic or photographer.
    pub role: String,
    /// The band they wear, 0 for none.
    pub band_id: u32,
    pub crowd: bool,
}

/// The staff roles a person can be viewed as, beside attendee.
const VIEWED_ROLES: &[&str] = &["ops", "medic", "photographer"];

/// Everyone the owner can view as: the staff by role, then every attendee. Empty for everyone else.
#[spacetimedb::view(accessor = view_as_people, public)]
pub fn view_as_people(ctx: &ViewContext) -> Vec<ViewablePerson> {
    if ctx.db.owner().identity().find(ctx.sender()).is_none() {
        return Vec::new();
    }
    let band = |who: Identity| {
        ctx.db
            .band_owner()
            .owner()
            .find(who)
            .map(|o| o.band_id.into())
            .or_else(|| ctx.db.crowd_member().identity().find(who).map(|m| m.band_id))
            .unwrap_or(0)
    };
    let staff = ctx.db.staff_role().identity().filter(Identity::ZERO..).filter(|r| VIEWED_ROLES.contains(&r.role.as_str())).map(|r| {
        let name = ctx.db.attendee().identity().find(r.identity).map(|a| a.display_name).filter(|n| !n.is_empty()).unwrap_or(r.label);
        ViewablePerson { identity: r.identity, name, role: r.role, band_id: band(r.identity), crowd: false }
    });
    let attendees = ctx.db.attendee().person_id().filter(0u64..).map(|a| ViewablePerson {
        identity: a.identity,
        name: a.display_name,
        role: "attendee".into(),
        band_id: band(a.identity),
        crowd: a.crowd,
    });
    staff.chain(attendees).collect()
}
