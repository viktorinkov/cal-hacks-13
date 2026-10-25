//! The incident lifecycle on top of band1t's live band rows. A 500 ms watch
//! opens `sos` and `fall` incidents from band flags, freezes a snapshot of the
//! zone in the same transaction, and records every band that shows the light
//! circle (state 4) as a witness. Staff add notes and costs and resolve the
//! incident; resolving a property incident opens the venue's claim, and an
//! injury waits for the attendee who wore the band to file theirs.

use crate::roles::*;
use crate::tables::*;
use crate::live::band_place;
use crate::venue::zone;
use crate::view_as::viewed;
use spacetimedb::{Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, TimeDuration, Timestamp, ViewContext};

pub const S_NEAR_SOS: u8 = 4;
const WATCH_MILLIS: u64 = 500;
/// A flag still set this soon after resolution does not reopen the incident
/// (the `clear` command is still on its way to the band).
const REOPEN_GRACE_MICROS: i64 = 10_000_000;

pub const STAFF_ROLES: &[&str] = &["ops", "medic"];

/// The test bands: no radio carries them (the fleet is 1 to 9, the crowd starts
/// at 100), so the claims story and a tester's tap link on the live database
/// never touch real hardware or the real bridge.
pub const TEST_BANDS: std::ops::RangeInclusive<u8> = 90..=99;

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum IncidentKind {
    Sos,
    Fall,
    Property,
}

impl IncidentKind {
    pub fn core(self) -> bandit_insurance::IncidentKind {
        match self {
            IncidentKind::Sos => bandit_insurance::IncidentKind::Sos,
            IncidentKind::Fall => bandit_insurance::IncidentKind::Fall,
            IncidentKind::Property => bandit_insurance::IncidentKind::Property,
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
    pub subject_band: u32,
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
    /// Online bands at the incident's station (the crowd's within 10 m of the subject), ascending.
    pub bands_present: Vec<u32>,
    pub neigh_mean: f32,
    /// Bands showing the light circle at that instant, ascending.
    pub circle_bands: Vec<u32>,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = incident_band)]
pub struct IncidentBand {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub incident_id: u64,
    pub band_id: u32,
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

/// The crowd's bands this close to the subject count as present at the incident, in metres.
const PRESENT_M: f32 = 10.0;

/// Opens an incident, freezes its snapshot in the same transaction and puts it on the 3D floor: at `at`, else
/// where the subject band stands, else at the station's spot.
pub fn open(ctx: &ReducerContext, kind: IncidentKind, zone_id: u64, station_id: u8, band_id: u32, opened_by: &str, at: Option<(f32, f32)>) -> Incident {
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
    // Radio and test bands count at the whole station; the crowd only near the subject, where its bands hear it.
    let online: Vec<Band> = ctx.db.band().iter().filter(|b| b.online).collect();
    let subject = online.iter().find(|b| band_id != 0 && b.id == band_id);
    let (x, y) = at.or(subject.map(|b| (b.x_m, b.y_m))).unwrap_or_else(|| crate::venue::station_spot(ctx, station_id));
    let near = |b: &Band| (b.x_m - x).powi(2) + (b.y_m - y).powi(2) <= PRESENT_M * PRESENT_M;
    let counts = |b: &Band| if b.id < FIRST_CROWD_BAND { station_id != 0 && b.zone == station_id } else { near(b) };
    let mut present: Vec<&Band> = online.iter().filter(|b| counts(b)).collect();
    present.sort_by_key(|b| b.id);
    let neigh_mean = if present.is_empty() {
        0.0
    } else {
        present.iter().map(|b| b.neigh as f32).sum::<f32>() / present.len() as f32
    };
    let mut circle: Vec<u32> = online.iter().filter(|b| b.state == S_NEAR_SOS && (b.id < FIRST_CROWD_BAND || near(b))).map(|b| b.id).collect();
    circle.sort();
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
    if subject.is_some() {
        ctx.db.incident_band().insert(IncidentBand {
            id: 0,
            incident_id: incident.id,
            band_id,
            role: "subject".into(),
            zone_id,
            rssi: 0,
            first_seen_at: ctx.timestamp,
            last_seen_at: ctx.timestamp,
        });
    }
    crate::live::mark(ctx, &incident, x, y);
    incident
}

/// Records a band in the light circle around an incident, or refreshes when it was last seen there.
pub fn witness(ctx: &ReducerContext, incident: &Incident, band_id: u32, zone_id: u64, rssi: i8) {
    match ctx.db.incident_band().incident_id().filter(incident.id).find(|r| r.band_id == band_id) {
        Some(r) => {
            ctx.db.incident_band().id().update(IncidentBand { last_seen_at: ctx.timestamp, ..r });
        }
        None => {
            ctx.db.incident_band().insert(IncidentBand {
                id: 0,
                incident_id: incident.id,
                band_id,
                role: "witness".into(),
                zone_id,
                rssi,
                first_seen_at: ctx.timestamp,
                last_seen_at: ctx.timestamp,
            });
        }
    }
}

fn active_band_incident(ctx: &ReducerContext, band_id: u32) -> Option<Incident> {
    ctx.db
        .incident()
        .subject_band()
        .filter(band_id)
        .filter(|i| !i.resolved && i.kind != IncidentKind::Property)
        .max_by_key(|i| i.id)
}

fn resolved_moments_ago(ctx: &ReducerContext, band_id: u32) -> bool {
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
    let online: Vec<(u32, Band)> = ctx.db.band().iter().filter(|b| b.id < FIRST_CROWD_BAND).filter(|b| b.online).map(|b| (b.id, b)).collect();
    for (id, b) in online.iter().filter(|(_, b)| b.sos || b.fall) {
        match active_band_incident(ctx, *id) {
            Some(i) => {
                ctx.db.incident().id().update(Incident { last_signal_at: ctx.timestamp, ..i });
            }
            None if resolved_moments_ago(ctx, *id) => {}
            None => {
                let kind = if b.fall { IncidentKind::Fall } else { IncidentKind::Sos };
                let incident = open(ctx, kind, zone_id_for_station(ctx, b.zone), b.zone, *id, "band", None);
                let who = crate::insurance::people::wearer(ctx, *id).map(|(_, n)| n).unwrap_or_else(|| "someone".into());
                let place = crate::venue::place_name(ctx, b.x_m, b.y_m);
                let what = if b.fall { format!("Fall detected: {who} at {place}") } else { format!("SOS: {who} pressed the button at {place}") };
                crate::live::record(ctx, incident.id, 0, "band", &crate::band_code::band_code(*id), what, "a radio band raised it; the bands around light the circle".into());
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
    for (id, b) in online.iter().filter(|(_, b)| b.state == S_NEAR_SOS) {
        let zone_id = zone_id_for_station(ctx, b.zone);
        let Some(incident) = active
            .iter()
            .filter(|i| i.zone_id == zone_id)
            .max_by_key(|i| i.id)
            .or_else(|| active.iter().max_by_key(|i| i.id))
        else {
            continue;
        };
        let rssi = match (radio_id(*id), radio_id(incident.subject_band)) {
            (Some(from), Some(to)) => ctx.db.link().from_id().filter(from).find(|l| l.to_id == to).map(|l| l.rssi).unwrap_or(0),
            _ => 0,
        };
        witness(ctx, incident, *id, zone_id, rssi);
    }
    Ok(())
}

/// A test band's beacon, written the way band1t's ingest writes a radio one
/// (the band row, plus `event` rows when SOS, fall or press rise), but only
/// for `TEST_BANDS` and only by the `tester` role.
#[spacetimedb::reducer]
pub fn report_test_band(ctx: &ReducerContext, band_id: u8, station_id: u8, state: u8, neigh: u8, sos: bool, fall: bool, press: bool) -> Result<(), String> {
    require_role(ctx, &["tester"])?;
    if !TEST_BANDS.contains(&band_id) {
        return Err(format!("test bands are {} to {}", TEST_BANDS.start(), TEST_BANDS.end()));
    }
    // A band whose wearer went home is out of reach of the venue's stations.
    if crate::departure::band_left(ctx, band_id.into()) {
        return Ok(());
    }
    let flags = sos as u8 * F_SOS | fall as u8 * F_FALL | press as u8 * F_PRESS | F_MPU | F_MOTOR;
    let id = u32::from(band_id);
    let prev = ctx.db.band().id().find(id);
    // Test bands stand a step apart around their zone's centre, so each shows on the venue map.
    let (cx, cy) = crate::venue::station_spot(ctx, station_id);
    let slot = (band_id - TEST_BANDS.start()) as f32;
    // A band a presenter placed on the 3D floor stays where they put it.
    let (x_m, y_m) = match ctx.db.band_place().band_id().find(id) {
        Some(p) => (p.x_m, p.y_m),
        None => (cx + (slot % 5.0 - 2.0) * 1.5, cy + (slot / 5.0).floor() * 1.5 - 0.75),
    };
    let row = Band {
        id,
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
        x_m,
        y_m,
        booth_id: 0,
    };
    let was = |f: fn(&Band) -> bool| prev.as_ref().is_some_and(f);
    if sos && !was(|b| b.sos) {
        crate::log_event(ctx, band_id, EventKind::SosRaised, "test band");
    }
    if fall && !was(|b| b.fall) {
        crate::log_event(ctx, band_id, EventKind::Fall, "test band");
    }
    if press && !was(|b| b.pressed) {
        crate::log_event(ctx, band_id, EventKind::Press, "test band");
    }
    if prev.as_ref().is_none_or(|b| b.zone != station_id || !b.online) {
        crate::ingest::leave_zone(ctx, id);
        if station_id != 0 {
            crate::ingest::open_stay(ctx, id, station_id, 0);
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
    ensure_watch(ctx);
    Ok(())
}

pub fn ensure_watch(ctx: &ReducerContext) {
    if ctx.db.incident_watch_timer().count() == 0 {
        ctx.db.incident_watch_timer().insert(IncidentWatchTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_millis(WATCH_MILLIS).into()),
        });
    }
}

/// Staff open an incident by hand: the property-damage button, or an injury
/// nobody's band flagged. `band_id` 0 means no band.
#[spacetimedb::reducer]
pub fn open_incident(ctx: &ReducerContext, kind: String, zone_id: u64, band_id: u32, note: String) -> Result<(), String> {
    require_role(ctx, &["ops", "medic"])?;
    let kind = IncidentKind::parse(&kind).ok_or_else(|| format!("unknown incident kind {kind}"))?;
    let zone = ctx.db.zone().id().find(zone_id).ok_or_else(|| format!("no zone {zone_id}"))?;
    let incident = open(ctx, kind, zone.id, zone.station_id, band_id, "ops", None);
    let what = match kind {
        IncidentKind::Property => format!("Damage reported in {}", zone.name),
        _ => format!("Injury reported in {}", zone.name),
    };
    crate::live::record(ctx, incident.id, 0, "organizer", &caller_name(ctx), what, note.clone());
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
    let first = i.assigned_medic.is_none();
    ctx.db.incident().id().update(Incident { status: IncidentStatus::Responding, assigned_medic: Some(ctx.sender()), ..i });
    if first {
        crate::live::responding(ctx, incident_id, &caller_name(ctx));
    }
    Ok(())
}

/// The caller's staff label ("Ari Ramos", "Ops desk"), else their role.
pub fn caller_name(ctx: &ReducerContext) -> String {
    ctx.db
        .staff_role()
        .identity()
        .filter(ctx.sender())
        .find(|r| STAFF_ROLES.contains(&r.role.as_str()) && !r.label.is_empty())
        .map(|r| r.label)
        .unwrap_or_else(|| caller_role(ctx, STAFF_ROLES))
}

fn add_note(ctx: &ReducerContext, incident_id: u64, text: String, cost_cents: Option<u64>) {
    let role = caller_role(ctx, STAFF_ROLES);
    crate::live::noted(ctx, incident_id, &caller_name(ctx), &role, &text, cost_cents);
    ctx.db.incident_note().insert(IncidentNote {
        id: 0,
        incident_id,
        author: ctx.sender(),
        author_role: role,
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
/// venue's property claim when a repair cost was logged. SOS and fall claims
/// are not opened here: the wearer files them (`file_claim`).
#[spacetimedb::reducer]
pub fn resolve_incident(ctx: &ReducerContext, incident_id: u64, resolution: String) -> Result<(), String> {
    require_role(ctx, &["ops", "medic"])?;
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
        resolution: resolution.clone(),
        ..i
    });
    crate::live::resolved(ctx, incident_id, &caller_name(ctx), &caller_role(ctx, STAFF_ROLES), &resolution);
    if let Some(radio) = radio_id(band_id).filter(|b| *b != 0 && !TEST_BANDS.contains(b)) {
        crate::commands::enqueue(ctx, radio, "clear", 0, 0);
    }
    crate::insurance::on_incident_resolved(ctx, &resolved)
}

fn is_staff(ctx: &ViewContext) -> bool {
    ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| STAFF_ROLES.contains(&r.role.as_str()))
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
