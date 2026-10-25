//! Leaving early: an attendee who goes home before the doors close. Their night ends when they walk out of a
//! door: `left_at` is set, their band goes quiet, and their recap and merch open at once while the event goes
//! on for everyone else. Someone of the crowd first walks alone from where they stand to the nearest door;
//! anyone else is out at once. A new live run, or reopening the event, brings everyone back.

use crate::live::{band_place, record};
use crate::roles::require_role;
use crate::social::crowd;
use crate::social::tables::*;
use crate::tables::*;
use crate::venue::{venue_spot, VenueSpot};
use crate::view_as::viewed;
use crate::web::event_state;
use spacetimedb::{Identity, ReducerContext, Table, Timestamp, ViewContext};

/// One attendee who left before the event ended.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = departure, public)]
pub struct Departure {
    #[primary_key]
    pub attendee: Identity,
    /// Their graph node id, as `board_attendees` has it.
    pub node_id: u64,
    pub name: String,
    /// The band they wore, 0 for none.
    #[index(btree)]
    pub band_id: u32,
    /// The exit they leave by, empty when the venue has no exits on its floor.
    pub door: String,
    pub station_id: u8,
    pub x_m: f32,
    pub y_m: f32,
    /// When they set off.
    pub asked_at: Timestamp,
    /// When they walked out: the end of the event for them. Empty while someone of the crowd walks to the door.
    pub left_at: Option<Timestamp>,
    /// Who sent them: their own name, the organizer's, or "live run".
    pub by: String,
}

/// The caller goes home now, from their tap page.
#[spacetimedb::reducer]
pub fn leave_event(ctx: &ReducerContext) -> Result<(), String> {
    let me = ctx.db.attendee().identity().find(ctx.sender()).ok_or("tap your band first")?;
    let by = if me.display_name.is_empty() { "the attendee".to_string() } else { me.display_name.clone() };
    depart(ctx, me.identity, &by)
}

/// The organizer sends one attendee home early, from the Live tab's person panel.
#[spacetimedb::reducer]
pub fn leave_early(ctx: &ReducerContext, node_id: u64) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let a = ctx.db.attendee().node_id().find(node_id).ok_or("no such attendee")?;
    depart(ctx, a.identity, &crate::safety::caller_name(ctx))
}

/// `who` leaves the event: someone of the crowd sets off for the nearest door, anyone else is out at once.
pub fn depart(ctx: &ReducerContext, who: Identity, by: &str) -> Result<(), String> {
    if ctx.db.event_state().id().find(0).is_some_and(|e| e.ended) {
        return Err("the event has already ended".into());
    }
    let a = ctx.db.attendee().identity().find(who).ok_or("no such attendee")?;
    let name = if a.display_name.is_empty() { "someone".to_string() } else { a.display_name.clone() };
    if ctx.db.departure().attendee().find(who).is_some() {
        return Err(format!("{name} already left"));
    }
    let member = ctx.db.crowd_member().identity().find(who);
    let band_id = match &member {
        Some(m) => m.band_id,
        None => ctx.db.band_owner().owner().find(who).map(|o| u32::from(o.band_id)).unwrap_or(0),
    };
    if band_id != 0 && crate::live::down_bands(ctx).iter().any(|d| d.band_id == band_id) {
        return Err(format!("{name} is down: the medic is with them"));
    }
    let mut row = Departure {
        attendee: who,
        node_id: a.node_id,
        name,
        band_id,
        door: String::new(),
        station_id: 0,
        x_m: 0.0,
        y_m: 0.0,
        asked_at: ctx.timestamp,
        left_at: None,
        by: by.to_string(),
    };
    if let Some(door) = member.as_ref().and_then(|m| crowd::send_home(ctx, m)) {
        row.door = nearest_exit(ctx, door.0, door.1).map(|s| s.name).unwrap_or_default();
        (row.x_m, row.y_m, row.station_id) = door;
        ctx.db.departure().insert(row);
        return Ok(());
    }
    if let Some(b) = ctx.db.band().id().find(band_id) {
        if let Some(s) = nearest_exit(ctx, b.x_m, b.y_m) {
            (row.door, row.station_id, row.x_m, row.y_m) = (s.name, s.station_id, s.x_m, s.y_m);
        }
        ctx.db.band_place().band_id().delete(band_id);
        crate::ingest::leave_zone(ctx, band_id);
        ctx.db.band().id().update(Band { online: false, last_seen: ctx.timestamp, ..b });
    }
    let row = ctx.db.departure().insert(row);
    walked_out(ctx, row);
    Ok(())
}

/// They are out of the door: their night ends now, and their shopping agent runs.
pub fn walked_out(ctx: &ReducerContext, d: Departure) {
    let d = ctx.db.departure().attendee().update(Departure { left_at: Some(ctx.timestamp), ..d });
    let door = if d.door.is_empty() { String::new() } else { format!(" by the {}", d.door) };
    record(ctx, 0, 0, "venue", "Doors", format!("{} left early{door}", d.name), "their night has ended: their recap and merch open on their band's link".into());
    crate::merch::on_attendee_left(ctx, d.attendee);
}

/// True once `who` has walked out of the event.
pub fn left(ctx: &ReducerContext, who: Identity) -> bool {
    ctx.db.departure().attendee().find(who).is_some_and(|d| d.left_at.is_some())
}

/// True once the wearer of `band_id` has walked out of the event.
pub fn band_left(ctx: &ReducerContext, band_id: u32) -> bool {
    ctx.db.departure().band_id().filter(band_id).any(|d| d.left_at.is_some())
}

/// Everyone is back for a new run of the event.
pub fn clear(ctx: &ReducerContext) {
    for d in ctx.db.departure().iter().collect::<Vec<_>>() {
        ctx.db.departure().attendee().delete(d.attendee);
    }
}

/// The exit nearest to a point on the floor.
fn nearest_exit(ctx: &ReducerContext, x: f32, y: f32) -> Option<VenueSpot> {
    ctx.db
        .venue_spot()
        .iter()
        .filter(|s| s.kind == "exit")
        .min_by(|a, b| ((a.x_m - x).powi(2) + (a.y_m - y).powi(2)).total_cmp(&((b.x_m - x).powi(2) + (b.y_m - y).powi(2))))
}

/// The caller's departure, so the tap page opens the recap once they have left.
#[spacetimedb::view(accessor = my_departure, public)]
pub fn my_departure(ctx: &ViewContext) -> Option<Departure> {
    ctx.db.departure().attendee().find(viewed(ctx))
}
