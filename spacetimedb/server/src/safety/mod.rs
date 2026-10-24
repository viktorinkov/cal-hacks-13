//! The incident lifecycle on top of band1t's live band rows. A 500 ms watch
//! opens `sos` and `fall` incidents from band flags, freezes a snapshot of the
//! zone in the same transaction, and records every band that shows the light
//! circle (state 4) as a witness. Staff add notes and costs and resolve the
//! incident; resolving hands it to insurance.

use crate::roles::*;
use crate::tables::*;
use crate::venue::zone;
use spacetimedb::{Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, TimeDuration, Timestamp, ViewContext};

pub const S_NEAR_SOS: u8 = 4;
const WATCH_MILLIS: u64 = 500;
/// A flag still set this soon after resolution does not reopen the incident
/// (the `clear` command is still on its way to the band).
const REOPEN_GRACE_MICROS: i64 = 10_000_000;

pub const STAFF_ROLES: &[&str] = &["ops", "medic", "floor_manager", "risk_manager", "adjuster"];

/// Band ids the claims story simulates. No real band carries them (the fleet is
/// 1 to 9, social's simulated crowd starts at 10), so a rehearsal on the live
/// database never touches real hardware or the real bridge.
pub const SIM_BANDS: std::ops::RangeInclusive<u8> = 90..=99;

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum IncidentKind {
    Sos,
    Fall,
    Property,
}

impl IncidentKind {
    pub fn core(self) -> hyphenate_core::IncidentKind {
        match self {
            IncidentKind::Sos => hyphenate_core::IncidentKind::Sos,
            IncidentKind::Fall => hyphenate_core::IncidentKind::Fall,
            IncidentKind::Property => hyphenate_core::IncidentKind::Property,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "sos" => Some(IncidentKind::Sos),
            "fall" => Some(IncidentKind::Fall),
            "property" => Some(IncidentKind::Property),
            _ => None,
        }
    }
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum IncidentStatus {
    Open,
    Responding,
    Resolved,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = incident)]
pub struct Incident {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub kind: IncidentKind,
    pub status: IncidentStatus,
    #[index(btree)]
    pub resolved: bool,
    /// The venue zone, 0 when the band heard no station.
    pub zone_id: u64,
    pub station_id: u8,
    /// The subject band, 0 for property incidents.
    #[index(btree)]
    pub subject_band: u8,
    /// `band`, `ops` or `vision`.
    pub opened_by: String,
    pub opened_at: Timestamp,
    pub last_signal_at: Timestamp,
    pub assigned_medic: Option<Identity>,
    pub resolved_at: Option<Timestamp>,
    pub resolved_by: Option<Identity>,
    pub resolution: String,
    /// `none`, `confirmed` or `not_confirmed`, set by the vision stub.
    pub vision_status: String,
}

/// The zone as it was when the incident opened. Written once.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = incident_snapshot)]
pub struct IncidentSnapshot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub incident_id: u64,
    pub taken_at: Timestamp,
    pub zone_id: u64,
    pub station_id: u8,
    pub band_state: u8,
    pub band_flags: u8,
    pub band_neigh: u8,
    pub band_battery: u8,
    pub band_seen_at: Timestamp,
    /// Online bands at the incident's station, ascending.
    pub bands_present: Vec<u8>,
    pub neigh_mean: f32,
    /// Bands showing the light circle at that instant, ascending.
    pub circle_bands: Vec<u8>,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = incident_band)]
pub struct IncidentBand {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub incident_id: u64,
    pub band_id: u8,
    /// `subject` or `witness`.
    pub role: String,
    pub zone_id: u64,
    /// The subject's signal as this band heard it, 0 when unknown.
    pub rssi: i8,
    pub first_seen_at: Timestamp,
    pub last_seen_at: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = incident_note)]
pub struct IncidentNote {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub incident_id: u64,
    pub author: Identity,
    pub author_role: String,
    pub text: String,
    /// The treatment or repair cost the author logged, in cents.
    pub cost_cents: Option<u64>,
    pub created_at: Timestamp,
}

#[spacetimedb::table(accessor = incident_watch_timer, scheduled(crate::safety::watch_bands))]
pub struct IncidentWatchTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// The first of `roles` the caller holds, or `owner`.
pub fn caller_role(ctx: &ReducerContext, roles: &[&str]) -> String {
    ctx.db
        .staff_role()
        .identity()
        .filter(ctx.sender())
        .map(|r| r.role)
        .find(|r| roles.contains(&r.as_str()))
        .unwrap_or_else(|| "owner".into())
}

pub fn zone_id_for_station(ctx: &ReducerContext, station_id: u8) -> u64 {
    crate::venue::zone_for_station(ctx, station_id).map(|z| z.id).unwrap_or(0)
}

/// Opens an incident and freezes its snapshot in the same transaction.
pub fn open(ctx: &ReducerContext, kind: IncidentKind, zone_id: u64, station_id: u8, band_id: u8, opened_by: &str) -> Incident {
    let incident = ctx.db.incident().insert(Incident {
        id: 0,
        kind,
        status: IncidentStatus::Open,
        resolved: false,
        zone_id,
        station_id,
        subject_band: band_id,
        opened_by: opened_by.into(),
        opened_at: ctx.timestamp,
        last_signal_at: ctx.timestamp,
        assigned_medic: None,
        resolved_at: None,
        resolved_by: None,
        resolution: String::new(),
        vision_status: "none".into(),
    });
    let online: Vec<Band> = ctx.db.band().iter().filter(|b| b.online).collect();
    let mut present: Vec<&Band> = online.iter().filter(|b| station_id != 0 && b.zone == station_id).collect();
    present.sort_by_key(|b| b.id);
    let neigh_mean = if present.is_empty() {
        0.0
    } else {
        present.iter().map(|b| b.neigh as f32).sum::<f32>() / present.len() as f32
    };
    let mut circle: Vec<u8> = online.iter().filter(|b| b.state == S_NEAR_SOS).map(|b| b.id).collect();
    circle.sort();
    let subject = online.iter().find(|b| band_id != 0 && b.id == band_id);
    ctx.db.incident_snapshot().insert(IncidentSnapshot {
        id: 0,
        incident_id: incident.id,
        taken_at: ctx.timestamp,
        zone_id,
        station_id,
        band_state: subject.map(|b| b.state).unwrap_or(0),
        band_flags: subject.map(|b| b.flags).unwrap_or(0),
        band_neigh: subject.map(|b| b.neigh).unwrap_or(0),
        band_battery: subject.map(|b| b.bat).unwrap_or(0),
        band_seen_at: subject.map(|b| b.last_seen).unwrap_or(ctx.timestamp),
        bands_present: present.iter().map(|b| b.id).collect(),
        neigh_mean,
        circle_bands: circle,
    });
    if let Some(b) = subject {
        ctx.db.incident_band().insert(IncidentBand {
            id: 0,
            incident_id: incident.id,
            band_id: b.id,
            role: "subject".into(),
            zone_id,
            rssi: 0,
            first_seen_at: ctx.timestamp,
            last_seen_at: ctx.timestamp,
        });
    }
    incident
}

fn active_band_incident(ctx: &ReducerContext, band_id: u8) -> Option<Incident> {
    ctx.db
        .incident()
        .subject_band()
        .filter(band_id)
        .filter(|i| !i.resolved && i.kind != IncidentKind::Property)
        .max_by_key(|i| i.id)
}

fn resolved_moments_ago(ctx: &ReducerContext, band_id: u8) -> bool {
    ctx.db.incident().subject_band().filter(band_id).any(|i| {
        i.resolved_at
            .is_some_and(|t| ctx.timestamp.duration_since(t).is_some_and(|d| d.as_micros() < REOPEN_GRACE_MICROS as u128))
    })
}

/// Opens incidents from band flags and records light-circle witnesses.
#[spacetimedb::reducer]
pub fn watch_bands(ctx: &ReducerContext, _timer: IncidentWatchTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("watch_bands is internal".into());
    }
    let online: Vec<Band> = ctx.db.band().iter().filter(|b| b.online).collect();
    for b in online.iter().filter(|b| b.sos || b.fall) {
        match active_band_incident(ctx, b.id) {
            Some(i) => {
                ctx.db.incident().id().update(Incident { last_signal_at: ctx.timestamp, ..i });
            }
            None if resolved_moments_ago(ctx, b.id) => {}
            None => {
                let kind = if b.fall { IncidentKind::Fall } else { IncidentKind::Sos };
                open(ctx, kind, zone_id_for_station(ctx, b.zone), b.zone, b.id, "band");
            }
        }
    }
    let active: Vec<Incident> = ctx
        .db
        .incident()
        .resolved()
        .filter(false)
        .filter(|i| i.kind != IncidentKind::Property && i.subject_band != 0)
        .collect();
    if active.is_empty() {
        return Ok(());
    }
    for b in online.iter().filter(|b| b.state == S_NEAR_SOS) {
        let zone_id = zone_id_for_station(ctx, b.zone);
        let Some(incident) = active
            .iter()
            .filter(|i| i.zone_id == zone_id)
            .max_by_key(|i| i.id)
            .or_else(|| active.iter().max_by_key(|i| i.id))
        else {
            continue;
        };
        let existing = ctx.db.incident_band().incident_id().filter(incident.id).find(|r| r.band_id == b.id);
        match existing {
            Some(r) => {
                ctx.db.incident_band().id().update(IncidentBand { last_seen_at: ctx.timestamp, ..r });
            }
            None => {
                let rssi = ctx
                    .db
                    .link()
                    .from_id()
                    .filter(b.id)
                    .find(|l| l.to_id == incident.subject_band)
                    .map(|l| l.rssi)
                    .unwrap_or(0);
                ctx.db.incident_band().insert(IncidentBand {
                    id: 0,
                    incident_id: incident.id,
                    band_id: b.id,
                    role: "witness".into(),
                    zone_id,
                    rssi,
                    first_seen_at: ctx.timestamp,
                    last_seen_at: ctx.timestamp,
                });
            }
        }
    }
    Ok(())
}

/// A simulated band's beacon, written the way band1t's ingest writes a real
/// one (the band row, plus `event` rows when SOS, fall or press rise), but only
/// for `SIM_BANDS` and only by the `simulator` role.
#[spacetimedb::reducer]
pub fn report_sim_band(ctx: &ReducerContext, band_id: u8, station_id: u8, state: u8, neigh: u8, sos: bool, fall: bool, press: bool) -> Result<(), String> {
    require_role(ctx, &["simulator"])?;
    if !SIM_BANDS.contains(&band_id) {
        return Err(format!("simulated bands are {} to {}", SIM_BANDS.start(), SIM_BANDS.end()));
    }
    let flags = sos as u8 * F_SOS | fall as u8 * F_FALL | press as u8 * F_PRESS | F_MPU | F_MOTOR;
    let prev = ctx.db.band().id().find(band_id);
    let row = Band {
        id: band_id,
        state,
        flags,
        neigh,
        zone: station_id,
        bat: 90,
        find: 0,
        rssi: -55,
        seq: prev.as_ref().map(|b| b.seq.wrapping_add(1)).unwrap_or(1),
        sos,
        fall,
        pressed: press,
        low_battery: false,
        has_mpu: true,
        has_motor: true,
        online: true,
        last_seen: ctx.timestamp,
    };
    let was = |f: fn(&Band) -> bool| prev.as_ref().is_some_and(f);
    if sos && !was(|b| b.sos) {
        crate::log_event(ctx, band_id, EventKind::SosRaised, "simulated");
    }
    if fall && !was(|b| b.fall) {
        crate::log_event(ctx, band_id, EventKind::Fall, "simulated");
    }
    if press && !was(|b| b.pressed) {
        crate::log_event(ctx, band_id, EventKind::Press, "simulated");
    }
    if prev.as_ref().is_none_or(|b| b.zone != station_id || !b.online) {
        for v in ctx.db.zone_visit().band_id().filter(band_id).filter(|v| v.left.is_none()).collect::<Vec<_>>() {
            ctx.db.zone_visit().id().update(ZoneVisit { left: Some(ctx.timestamp), ..v });
        }
        if station_id != 0 {
            ctx.db.zone_visit().insert(ZoneVisit { id: 0, band_id, zone: station_id, entered: ctx.timestamp, left: None });
        }
    }
    if prev.is_some() {
        ctx.db.band().id().update(row);
    } else {
        ctx.db.band().insert(row);
    }
    Ok(())
}

/// Starts the 500 ms band watch. Idempotent; `bandit-claims setup` calls it once.
#[spacetimedb::reducer]
pub fn start_safety_watch(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if ctx.db.incident_watch_timer().count() == 0 {
        ctx.db.incident_watch_timer().insert(IncidentWatchTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_millis(WATCH_MILLIS).into()),
        });
    }
    Ok(())
}

/// Staff open an incident by hand: the property-damage button, or an injury
/// nobody's band flagged. `band_id` 0 means no band.
#[spacetimedb::reducer]
pub fn open_incident(ctx: &ReducerContext, kind: String, zone_id: u64, band_id: u8, note: String) -> Result<(), String> {
    require_role(ctx, &["ops", "floor_manager", "risk_manager", "medic"])?;
    let kind = IncidentKind::parse(&kind).ok_or_else(|| format!("unknown incident kind {kind}"))?;
    let zone = ctx.db.zone().id().find(zone_id).ok_or_else(|| format!("no zone {zone_id}"))?;
    let incident = open(ctx, kind, zone.id, zone.station_id, band_id, "ops");
    if !note.trim().is_empty() {
        add_note(ctx, incident.id, note, None);
    }
    Ok(())
}

/// A medic takes the incident.
#[spacetimedb::reducer]
pub fn assign_medic(ctx: &ReducerContext, incident_id: u64) -> Result<(), String> {
    require_role(ctx, &["medic"])?;
    let i = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
    if i.resolved {
        return Err(format!("incident {incident_id} is resolved"));
    }
    ctx.db.incident().id().update(Incident { status: IncidentStatus::Responding, assigned_medic: Some(ctx.sender()), ..i });
    Ok(())
}

fn add_note(ctx: &ReducerContext, incident_id: u64, text: String, cost_cents: Option<u64>) {
    ctx.db.incident_note().insert(IncidentNote {
        id: 0,
        incident_id,
        author: ctx.sender(),
        author_role: caller_role(ctx, STAFF_ROLES),
        text,
        cost_cents,
        created_at: ctx.timestamp,
    });
}

/// A note, optionally with the treatment or repair cost in cents.
#[spacetimedb::reducer]
pub fn add_incident_note(ctx: &ReducerContext, incident_id: u64, text: String, cost_cents: Option<u64>) -> Result<(), String> {
    require_role(ctx, STAFF_ROLES)?;
    if ctx.db.incident().id().find(incident_id).is_none() {
        return Err(format!("no incident {incident_id}"));
    }
    if text.trim().is_empty() {
        return Err("a note needs text".into());
    }
    add_note(ctx, incident_id, text, cost_cents);
    Ok(())
}

/// Closes the incident, releases the subject band's SOS latch, and opens the
/// insurance claim when the incident qualifies.
#[spacetimedb::reducer]
pub fn resolve_incident(ctx: &ReducerContext, incident_id: u64, resolution: String) -> Result<(), String> {
    require_role(ctx, &["ops", "medic", "floor_manager"])?;
    let i = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
    if i.resolved {
        return Err(format!("incident {incident_id} is already resolved"));
    }
    let band_id = i.subject_band;
    let resolved = ctx.db.incident().id().update(Incident {
        status: IncidentStatus::Resolved,
        resolved: true,
        resolved_at: Some(ctx.timestamp),
        resolved_by: Some(ctx.sender()),
        resolution,
        ..i
    });
    if band_id != 0 && !SIM_BANDS.contains(&band_id) {
        crate::commands::enqueue(ctx, band_id, "clear", 0, 0);
    }
    crate::insurance::on_incident_resolved(ctx, &resolved)
}

fn is_staff(ctx: &ViewContext) -> bool {
    ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| STAFF_ROLES.contains(&r.role.as_str()))
}

/// Incidents not yet resolved, for staff screens.
#[spacetimedb::view(accessor = open_incidents, public)]
pub fn open_incidents(ctx: &ViewContext) -> Vec<Incident> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.incident().resolved().filter(false).collect()
}

/// The subject and witness bands of one incident, for staff screens.
#[spacetimedb::view(accessor = incident_bands, public)]
pub fn incident_bands(ctx: &ViewContext, incident_id: u64) -> Vec<IncidentBand> {
    if !is_staff(ctx) {
        return Vec::new();
    }
    ctx.db.incident_band().incident_id().filter(incident_id).collect()
}

/// Elapsed time between two timestamps in microseconds, 0 when reversed.
pub fn micros_between(a: Timestamp, b: Timestamp) -> i64 {
    (b.to_micros_since_unix_epoch() - a.to_micros_since_unix_epoch()).max(0)
}

pub fn after(t: Timestamp, micros: i64) -> Timestamp {
    t + TimeDuration::from_micros(micros)
}
