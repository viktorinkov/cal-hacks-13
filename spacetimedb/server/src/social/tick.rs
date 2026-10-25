//! The social tick turns band1t's live band rows into memories, once a second.
//!
//! This file is the swappable seam between "where are the bands and who is near whom" and the social layer.
//! It reads three band1t tables and nothing else from the hardware side:
//! - `event` (kind Press): the button press that completes a band claim;
//! - `zone_visit`: a band's stay in one station's zone, which becomes a `visit`;
//! - `encounter`: two bands hearing each other up close, which becomes a `social_encounter`.
//! If the bands or Leo's cameras end up reporting location differently, only this file changes.

use super::graph::{link_met, link_visited};
use super::logic::*;
use super::onboarding::complete_claim;
use super::tables::*;
use crate::tables::{encounter, event, radio_id, zone_visit, Encounter, EventKind, ZoneVisit};
use crate::venue::zone_for_station;
use spacetimedb::{Identity, ReducerContext, ScheduleAt, Table, Timestamp};
use std::collections::HashMap;

/// Start the tick once; called from the first band claim, which is where social activity begins.
pub fn ensure_tick(ctx: &ReducerContext) {
    if ctx.db.social_tick_timer().count() == 0 {
        ctx.db.social_tick_timer().insert(SocialTickTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_millis(TICK_MILLIS).into()),
        });
    }
}

#[spacetimedb::reducer]
pub fn social_tick(ctx: &ReducerContext, _timer: SocialTickTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("social_tick is internal".into());
    }
    read_presses(ctx);
    expire_claims(ctx);
    update_visits(ctx);
    update_encounters(ctx);
    Ok(())
}

/// A press on a band inside its claim window completes the claim.
fn read_presses(ctx: &ReducerContext) {
    for claim in ctx.db.band_claim().iter().collect::<Vec<_>>() {
        let pressed = ctx.db.event().band_id().filter(claim.band_id).any(|e| {
            e.kind == EventKind::Press && micros(e.at) >= micros(claim.started_at) && micros(e.at) <= micros(claim.expires_at)
        });
        if pressed {
            complete_claim(ctx, claim);
        }
    }
}

fn expire_claims(ctx: &ReducerContext) {
    let now = micros(ctx.timestamp);
    for c in ctx.db.band_claim().iter().filter(|c| micros(c.expires_at) < now).collect::<Vec<_>>() {
        ctx.db.band_claim().band_id().delete(c.band_id);
    }
}

fn zone_of_station(ctx: &ReducerContext, station: u8) -> u64 {
    zone_for_station(ctx, station).map(|z| z.id).unwrap_or(0)
}

/// Every stay of an owned band that lasted long enough is a visit; findable visitors who overlap share it.
/// Only the stays still running are read, plus the visits whose stay ended since the last tick.
fn update_visits(ctx: &ReducerContext) {
    let mut zones: HashMap<u8, u64> = HashMap::new();
    for v in ctx.db.visit().open().filter(true).collect::<Vec<_>>() {
        match ctx.db.zone_visit().id().find(v.zone_visit_id) {
            Some(zv) if zv.open => {}
            Some(zv) => write_visit(ctx, &zv, &mut zones),
            None => {
                ctx.db.visit().zone_visit_id().update(Visit { ended_at: Some(v.updated_at), open: false, ..v });
            }
        }
    }
    for zv in ctx.db.zone_visit().open().filter(true).collect::<Vec<_>>() {
        // A running visit is rewritten at most every REFRESH_SECONDS.
        if ctx.db.visit().zone_visit_id().find(zv.id).is_some_and(|v| v.open && !stale(v.updated_at, ctx.timestamp)) {
            continue;
        }
        write_visit(ctx, &zv, &mut zones);
    }
}

/// Who wears a band and since when: the owner of a radio or test band, the attendee of a crowd band.
pub fn wearer(ctx: &ReducerContext, band_id: u32) -> Option<(Identity, Timestamp)> {
    match radio_id(band_id) {
        Some(id) => ctx.db.band_owner().band_id().find(id).map(|o| (o.owner, o.claimed_at)),
        None => ctx.db.crowd_member().band_id().find(band_id).map(|m| (m.identity, m.joined_at)),
    }
}

fn write_visit(ctx: &ReducerContext, zv: &ZoneVisit, zones: &mut HashMap<u8, u64>) {
    let Some((who, since)) = wearer(ctx, zv.band_id) else {
        return;
    };
    let zone_id = *zones.entry(zv.zone).or_insert_with(|| zone_of_station(ctx, zv.zone));
    if zone_id == 0 {
        return;
    }
    let (start, end) = visit_window(zv.entered, zv.left, since, ctx.timestamp);
    let secs = (micros(end) - micros(start)) / 1_000_000;
    if secs < VISIT_MIN_SECONDS {
        return;
    }
    let row = Visit {
        zone_visit_id: zv.id,
        attendee: who,
        zone_id,
        band_id: zv.band_id,
        started_at: start,
        ended_at: zv.left,
        minutes: secs as f32 / 60.0,
        updated_at: ctx.timestamp,
        booth_id: zv.booth_id,
        open: zv.open,
    };
    let visit = match ctx.db.visit().zone_visit_id().find(zv.id) {
        None => ctx.db.visit().insert(row),
        Some(old)
            if old.ended_at != row.ended_at
                || old.started_at != row.started_at
                || (row.open && stale(old.updated_at, ctx.timestamp)) =>
        {
            ctx.db.visit().zone_visit_id().update(row)
        }
        Some(_) => return,
    };
    let Some(a) = ctx.db.attendee().identity().find(visit.attendee).filter(|a| a.findable) else {
        return;
    };
    link_visited(ctx, visit.attendee, visit.zone_id, visit.booth_id);
    // Shared visits are between people who tapped their bands; the crowd only meets people up close.
    if !a.crowd {
        update_shared_visits(ctx, &visit);
    }
}

fn stale(updated_at: Timestamp, now: Timestamp) -> bool {
    micros(now) - micros(updated_at) >= REFRESH_SECONDS * 1_000_000
}

fn stay(v: &Visit, now: Timestamp) -> (Timestamp, Timestamp) {
    (v.started_at, v.ended_at.unwrap_or(now))
}

fn update_shared_visits(ctx: &ReducerContext, v: &Visit) {
    let others: Vec<Visit> = ctx
        .db
        .visit()
        .zone_id()
        .filter(v.zone_id)
        .filter(|o| o.attendee != v.attendee)
        .filter(|o| ctx.db.attendee().identity().find(o.attendee).is_some_and(|a| a.findable && !a.crowd))
        .collect();
    for other in others {
        let (secs, started_at) = overlap(stay(v, ctx.timestamp), stay(&other, ctx.timestamp));
        if secs < SHARED_VISIT_MIN_SECONDS {
            continue;
        }
        let ((attendee_a, visit_a), (attendee_b, visit_b)) = if v.attendee <= other.attendee {
            ((v.attendee, v.zone_visit_id), (other.attendee, other.zone_visit_id))
        } else {
            ((other.attendee, other.zone_visit_id), (v.attendee, v.zone_visit_id))
        };
        let row = SharedVisit {
            id: 0,
            attendee_a,
            attendee_b,
            zone_id: v.zone_id,
            visit_a,
            visit_b,
            started_at,
            overlap_minutes: secs as f32 / 60.0,
            updated_at: ctx.timestamp,
        };
        match ctx.db.shared_visit().attendee_a().filter(attendee_a).find(|s| s.visit_a == visit_a && s.visit_b == visit_b) {
            Some(old) => {
                ctx.db.shared_visit().id().update(SharedVisit { id: old.id, ..row });
            }
            None => {
                ctx.db.shared_visit().insert(row);
            }
        }
    }
}

/// Pairs of worn bands that band1t saw close together become encounters once both wearers are findable.
/// Read here for the radio and test bands, whose ids are always the lower of a pair; the crowd's own pairs
/// are synced by the crowd tick as it writes them.
fn update_encounters(ctx: &ReducerContext) {
    let findable = |who: Identity| ctx.db.attendee().identity().find(who).is_some_and(|a| a.findable);
    for owner in ctx.db.band_owner().iter().collect::<Vec<_>>() {
        if !findable(owner.owner) {
            continue;
        }
        for enc in ctx.db.encounter().band_a().filter(u32::from(owner.band_id)).collect::<Vec<_>>() {
            let Some((other, _)) = wearer(ctx, enc.band_b) else {
                continue;
            };
            if findable(other) {
                sync_encounter(ctx, &enc, owner.owner, other);
            }
        }
    }
}

/// Writes the social encounter of two findable owners from their bands' band1t encounter. Only time after
/// the first sync counts, so bands sitting together before they were handed out don't meet.
pub fn sync_encounter(ctx: &ReducerContext, enc: &Encounter, a: Identity, b: Identity) {
    let (attendee_a, attendee_b) = ordered(a, b);
    match ctx.db.social_encounter().band_pair().find(enc.key) {
        None => {
            let station = ctx.db.zone_visit().band_id().filter(enc.band_a).find(|v| v.open).map(|v| v.zone).unwrap_or(0);
            ctx.db.social_encounter().insert(SocialEncounter {
                id: 0,
                band_pair: enc.key,
                attendee_a,
                attendee_b,
                zone_id: zone_of_station(ctx, station),
                baseline_seconds: enc.seconds_close,
                seconds_together: 0,
                started_at: ctx.timestamp,
                last_seen_at: enc.last_seen,
                met: false,
                updated_at: ctx.timestamp,
            });
        }
        Some(se) => {
            let together = enc.seconds_close.saturating_sub(se.baseline_seconds);
            let met = together >= ENCOUNTER_MIN_SECONDS;
            if together == se.seconds_together || (met == se.met && !stale(se.updated_at, ctx.timestamp)) {
                return;
            }
            let se = ctx.db.social_encounter().id().update(SocialEncounter {
                seconds_together: together,
                last_seen_at: enc.last_seen,
                met,
                updated_at: ctx.timestamp,
                ..se
            });
            if se.met {
                link_met(ctx, se.attendee_a, se.attendee_b, together as f32 / 60.0);
            }
        }
    }
}
