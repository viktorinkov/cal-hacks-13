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
use crate::tables::{encounter, event, zone_visit, EventKind, ZoneVisit};
use crate::venue::{zone, zone_for_station};
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
    let owners: Vec<BandOwner> = ctx.db.band_owner().iter().collect();
    let findable: HashMap<Identity, bool> = ctx.db.attendee().iter().map(|a| (a.identity, a.findable)).collect();
    update_visits(ctx, &owners, &findable);
    update_encounters(ctx, &owners, &findable);
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
fn update_visits(ctx: &ReducerContext, owners: &[BandOwner], findable: &HashMap<Identity, bool>) {
    for owner in owners {
        for zv in ctx.db.zone_visit().band_id().filter(owner.band_id).collect::<Vec<ZoneVisit>>() {
            let zone_id = zone_of_station(ctx, zv.zone);
            if zone_id == 0 {
                continue;
            }
            let (start, end) = visit_window(zv.entered, zv.left, owner.claimed_at, ctx.timestamp);
            let secs = (micros(end) - micros(start)) / 1_000_000;
            if secs < VISIT_MIN_SECONDS {
                continue;
            }
            let row = Visit {
                zone_visit_id: zv.id,
                attendee: owner.owner,
                zone_id,
                band_id: owner.band_id,
                started_at: start,
                ended_at: zv.left,
                minutes: secs as f32 / 60.0,
                updated_at: ctx.timestamp,
            };
            let visit = match ctx.db.visit().zone_visit_id().find(zv.id) {
                None => ctx.db.visit().insert(row),
                Some(old)
                    if old.ended_at != row.ended_at
                        || old.started_at != row.started_at
                        || (row.ended_at.is_none() && stale(old.updated_at, ctx.timestamp)) =>
                {
                    ctx.db.visit().zone_visit_id().update(row)
                }
                Some(_) => continue,
            };
            if findable.get(&visit.attendee).copied().unwrap_or(false) {
                link_visited(ctx, visit.attendee, visit.zone_id);
                update_shared_visits(ctx, &visit, findable);
            }
        }
    }
}

fn stale(updated_at: Timestamp, now: Timestamp) -> bool {
    micros(now) - micros(updated_at) >= REFRESH_SECONDS * 1_000_000
}

fn stay(v: &Visit, now: Timestamp) -> (Timestamp, Timestamp) {
    (v.started_at, v.ended_at.unwrap_or(now))
}

fn update_shared_visits(ctx: &ReducerContext, v: &Visit, findable: &HashMap<Identity, bool>) {
    let others: Vec<Visit> = ctx
        .db
        .visit()
        .zone_id()
        .filter(v.zone_id)
        .filter(|o| o.attendee != v.attendee && findable.get(&o.attendee).copied().unwrap_or(false))
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

/// Pairs of owned bands that band1t saw close together become encounters once both owners are findable.
/// Only time after that moment counts, so bands sitting together before they were handed out don't meet.
fn update_encounters(ctx: &ReducerContext, owners: &[BandOwner], findable: &HashMap<Identity, bool>) {
    let owner_of: HashMap<u8, Identity> = owners.iter().map(|o| (o.band_id, o.owner)).collect();
    let is_findable = |who: &Identity| findable.get(who).copied().unwrap_or(false);
    for owner in owners {
        for enc in ctx.db.encounter().band_a().filter(owner.band_id).collect::<Vec<_>>() {
            let Some(other) = owner_of.get(&enc.band_b).copied() else {
                continue;
            };
            if !is_findable(&owner.owner) || !is_findable(&other) {
                continue;
            }
            let (attendee_a, attendee_b) = ordered(owner.owner, other);
            match ctx.db.social_encounter().band_pair().find(enc.key) {
                None => {
                    let station = ctx
                        .db
                        .zone_visit()
                        .band_id()
                        .filter(owner.band_id)
                        .find(|v| v.left.is_none())
                        .map(|v| v.zone)
                        .unwrap_or(0);
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
                        continue;
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
    }
}

/// Owned bands whose stay covered `at` in the zone, longest stay first. Used to suggest who is in a photo.
pub fn bands_in_zone_at(ctx: &ReducerContext, zone_id: u64, at: Timestamp) -> Vec<BandOwner> {
    let Some(station) = ctx.db.zone().id().find(zone_id).map(|z| z.station_id) else {
        return Vec::new();
    };
    let t = micros(at);
    let mut present: Vec<(i64, BandOwner)> = ctx
        .db
        .band_owner()
        .iter()
        .filter_map(|o| {
            let stay = ctx.db.zone_visit().band_id().filter(o.band_id).find(|v| {
                v.zone == station && micros(v.entered) <= t && v.left.is_none_or(|l| micros(l) >= t)
            })?;
            Some((micros(stay.entered), o))
        })
        .collect();
    present.sort_by_key(|(entered, _)| *entered);
    present.into_iter().map(|(_, o)| o).collect()
}
