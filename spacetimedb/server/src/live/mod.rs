//! The live run: the whole event on the venue's 3D floor, from doors open to doors closed. The crowd walks in
//! through the doors, sits at the hacker tables and visits the sponsor tables, the stage and the food line. Every
//! minute or so someone falls, presses SOS or knocks equipment over: their band raises it, the bands around them
//! light the circle and the crowd steps back, and the incident goes through the medic, the claim and the
//! Decision Engine exactly as a radio band's would. At the end time the doors close: the crowd walks out, the
//! bands go quiet and the event ends, which turns every band's link into its recap.
//!
//! `bandit-claims live` plays the floor staff for the run (the medic, the organizer's cost notes, the camera);
//! it reads each incident's plan from `live_plan`. `incident_marker` puts every incident on the 3D floor, and
//! `decision` is the history of who decided what and why, from the band to the payout.
//!
//! Presenters place their own bands on the floor with `place_band`: a radio band keeps reporting through the
//! bridge and stands where it was placed, so it meets the crowd there and its SOS or fall opens an incident on
//! that spot.

pub mod log;
mod script;

pub use log::*;

use crate::roles::require_role;
use crate::insurance::settlement_rule;
use crate::safety::{self, IncidentKind, IncidentStatus, incident};
use crate::social::crowd::{self, MAX_CROWD};
use crate::social::tables::*;
use crate::tables::*;
use crate::venue::{nearest_station, place_name, venue_spot, zone_for_station};
use crate::web::event_state;
use spacetimedb::rand::rngs::StdRng;
use spacetimedb::rand::{Rng, SeedableRng};
use spacetimedb::{Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, TimeDuration, Timestamp};

const TICK_MILLIS: u64 = 1_000;
/// The first incident comes once the crowd has reached its tables (a fall among people still walking in
/// would have its circle in another zone); the next ones this far apart, in seconds.
const FIRST_INCIDENT_SECS: i64 = 60;
const INCIDENT_GAP_SECS: (i64, i64) = (70, 95);
/// The crowd takes this long to walk out once the doors close, before the bands go quiet.
const WALK_OUT_SECS: i64 = 25;
/// The doors stay closed at most this long waiting for the medic to resolve the last incidents.
const CLOSE_WAIT_SECS: i64 = 120;
/// A test band that stops reporting goes offline after 5 s; the run reports placed test bands every tick.
const TEST_BAND_FIRST: u32 = 90;

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LivePhase {
    Idle,
    /// Doors open: the crowd moves and incidents happen.
    Running,
    /// Doors closed: no new incidents, the crowd walks out and the medic finishes.
    Closing,
    /// The bands are quiet and the event has ended.
    Ended,
}

/// One row, id 0: the run the 3D page shows.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = live_run, public)]
pub struct LiveRun {
    #[primary_key]
    pub id: u8,
    pub phase: LivePhase,
    pub crowd: u16,
    /// How many times faster than the clock the crowd moves between spots.
    pub pace: u8,
    pub started_at: Timestamp,
    pub ends_at: Timestamp,
    pub closing_at: Option<Timestamp>,
    pub ended_at: Option<Timestamp>,
    pub next_incident_at: Timestamp,
    /// How many incidents the run has staged: its place in the script.
    pub step: u16,
    /// Who falls, where and when comes from a random number generator seeded with this, so a run can be
    /// played again exactly.
    pub seed: u64,
    pub started_by: Identity,
}

/// One row, id 0, while the run is paused: the crowd stands still and no incident is staged. Resuming moves
/// the run's clock on by the time it was paused.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = live_pause, public)]
pub struct LivePause {
    #[primary_key]
    pub id: u8,
    pub paused_at: Timestamp,
    pub paused_by: Identity,
}

#[spacetimedb::table(accessor = live_run_timer, scheduled(crate::live::live_tick))]
pub struct LiveRunTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// What the floor staff do about an incident the run staged, read by `bandit-claims live`.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = live_plan, public)]
pub struct LivePlan {
    #[primary_key]
    pub incident_id: u64,
    /// The clinic record template the medic files once the claim opens, empty when there is no claim.
    pub record: String,
    /// The medic's note on scene, or the organizer's note on the damage; empty when nobody writes one.
    pub note: String,
    pub resolution: String,
    /// The repair cost the organizer logs on property damage, in cents.
    pub cost_cents: u64,
    /// Whether a camera sees the damage.
    pub camera: bool,
}

/// Every incident on the 3D floor, whoever opened it: where, who, and how far along it is.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = incident_marker, public)]
pub struct IncidentMarker {
    #[primary_key]
    pub incident_id: u64,
    /// `fall`, `sos` or `property`.
    pub kind: String,
    #[index(btree)]
    pub band_id: u32,
    /// Who wears the band, empty for property.
    pub person: String,
    pub x_m: f32,
    pub y_m: f32,
    pub station_id: u8,
    /// Where it happened in words: "table 112", "the Anthropic table", "the stage".
    pub place: String,
    /// `open`, `responding` or `resolved`.
    #[index(btree)]
    pub status: String,
    pub medic: String,
    pub opened_at: Timestamp,
    pub responding_at: Option<Timestamp>,
    pub resolved_at: Option<Timestamp>,
    pub claim_id: u64,
    /// The claim's status in words, empty without a claim.
    pub claim_status: String,
    pub payout_cents: u64,
}

/// A presenter's band placed on the floor: it stands here whatever its radio zone says.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = band_place, public)]
pub struct BandPlace {
    #[primary_key]
    pub band_id: u32,
    pub x_m: f32,
    pub y_m: f32,
    pub station_id: u8,
    pub label: String,
    pub placed_by: Identity,
    pub placed_at: Timestamp,
}

fn seconds(n: i64) -> TimeDuration {
    TimeDuration::from_micros(n * 1_000_000)
}

pub fn run(ctx: &ReducerContext) -> Option<LiveRun> {
    ctx.db.live_run().id().find(0)
}

/// True while the run is paused.
pub fn paused(ctx: &ReducerContext) -> bool {
    ctx.db.live_pause().id().find(0).is_some()
}

/// How many times faster than the clock the crowd moves: the run's pace while the doors are open, else 1.
pub fn pace(ctx: &ReducerContext) -> f32 {
    match run(ctx) {
        Some(r) if r.phase == LivePhase::Running => r.pace.max(1) as f32,
        _ => 1.0,
    }
}

/// True while the doors are closed and the crowd walks out.
pub fn leaving(ctx: &ReducerContext) -> bool {
    run(ctx).is_some_and(|r| r.phase == LivePhase::Closing)
}

/// A crowd band that is down: its incident, where it lies, and whether it fell or pressed SOS.
pub struct Down {
    pub incident_id: u64,
    pub band_id: u32,
    pub x_m: f32,
    pub y_m: f32,
    pub zone_id: u64,
    pub fall: bool,
}

/// Every band with an incident still open that the crowd steps back from, the crowd's own and the
/// presenters' alike.
pub fn down_bands(ctx: &ReducerContext) -> Vec<Down> {
    ctx.db
        .incident_marker()
        .iter()
        .filter(|m| m.status != "resolved" && m.band_id != 0 && m.kind != "property")
        .map(|m| Down {
            incident_id: m.incident_id,
            band_id: m.band_id,
            x_m: m.x_m,
            y_m: m.y_m,
            zone_id: safety::zone_id_for_station(ctx, m.station_id),
            fall: m.kind == "fall",
        })
        .collect()
}

/// Starts the event on the 3D floor: `crowd` people walk in through the doors, incidents start after half a
/// minute, and the doors close after `minutes`. `pace` speeds up how often people move (1 is real time).
/// `fresh` clears the decision history and retires the learned settlement rules first, so the organizer
/// teaches the Decision Engine again. `seed` seeds who falls, where and when; 0 picks a new one.
#[spacetimedb::reducer]
pub fn start_live_run(ctx: &ReducerContext, crowd_size: u16, minutes: u16, pace: u8, fresh: bool, seed: u64) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if crowd_size == 0 || crowd_size > MAX_CROWD {
        return Err(format!("the crowd is 1 to {MAX_CROWD} people"));
    }
    if minutes == 0 {
        return Err("the run lasts at least a minute".into());
    }
    if fresh {
        for d in ctx.db.decision().iter().collect::<Vec<_>>() {
            ctx.db.decision().id().delete(d.id);
        }
        for r in ctx.db.settlement_rule().iter().filter(|r| r.status == "active").collect::<Vec<_>>() {
            ctx.db.settlement_rule().id().update(crate::insurance::SettlementRuleRow { status: "retired".into(), ..r });
        }
    }
    // Incidents a previous run left open are closed, so this run starts with a clear floor.
    for m in ctx.db.incident_marker().iter().filter(|m| m.status != "resolved").collect::<Vec<_>>() {
        if let Some(i) = ctx.db.incident().id().find(m.incident_id) {
            ctx.db.incident().id().update(safety::Incident {
                status: IncidentStatus::Resolved,
                resolved: true,
                resolved_at: Some(ctx.timestamp),
                resolution: "closed when a new live run started".into(),
                ..i
            });
        }
        ctx.db.incident_marker().incident_id().update(IncidentMarker { status: "resolved".into(), resolved_at: Some(ctx.timestamp), ..m });
    }
    ctx.db.live_pause().id().delete(0);
    crate::web::set_ended_by(ctx, false)?;
    crowd::start(ctx, crowd_size, pace.max(1) as f32)?;
    walk_in(ctx);
    safety::ensure_watch(ctx);
    let row = LiveRun {
        id: 0,
        phase: LivePhase::Running,
        crowd: crowd_size,
        pace: pace.max(1),
        started_at: ctx.timestamp,
        ends_at: ctx.timestamp + seconds(minutes as i64 * 60),
        closing_at: None,
        ended_at: None,
        next_incident_at: ctx.timestamp + seconds(FIRST_INCIDENT_SECS),
        step: 0,
        seed: if seed == 0 { ctx.rng().r#gen::<u64>().max(1) } else { seed },
        started_by: ctx.sender(),
    };
    match run(ctx) {
        Some(_) => ctx.db.live_run().id().update(row),
        None => ctx.db.live_run().insert(row),
    };
    for t in ctx.db.live_run_timer().iter().collect::<Vec<_>>() {
        ctx.db.live_run_timer().scheduled_id().delete(t.scheduled_id);
    }
    ctx.db.live_run_timer().insert(LiveRunTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(std::time::Duration::from_millis(TICK_MILLIS).into()),
    });
    record(
        ctx,
        0,
        0,
        "venue",
        "Doors",
        format!("Doors open: {crowd_size} people walk in"),
        format!("the event runs {minutes} minutes; every band reports where it is, how crowded it is around it and whether its wearer fell"),
    );
    Ok(())
}

/// Closes the doors now instead of at the end time.
#[spacetimedb::reducer]
pub fn end_live_run(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let r = run(ctx).ok_or("no live run")?;
    if r.phase != LivePhase::Running {
        return Err("the doors are already closed".into());
    }
    close_doors(ctx, r);
    Ok(())
}

/// Pauses the run: the crowd stands still, no new incident happens and the clock stops. The medic still
/// finishes what is open.
#[spacetimedb::reducer]
pub fn pause_live_run(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let r = run(ctx).ok_or("no live run")?;
    if !matches!(r.phase, LivePhase::Running | LivePhase::Closing) {
        return Err("the run is not going".into());
    }
    if paused(ctx) {
        return Err("the run is already paused".into());
    }
    ctx.db.live_pause().insert(LivePause { id: 0, paused_at: ctx.timestamp, paused_by: ctx.sender() });
    record(ctx, 0, 0, "venue", &safety::caller_name(ctx), "Paused".into(), "the crowd stands still and no new incident happens until the run resumes".into());
    Ok(())
}

/// Resumes a paused run where it stopped: the end time, the next incident and every team's next move move on
/// by the time it was paused.
#[spacetimedb::reducer]
pub fn resume_live_run(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let p = ctx.db.live_pause().id().find(0).ok_or("the run is not paused")?;
    ctx.db.live_pause().id().delete(0);
    let gap = TimeDuration::from_micros(safety::micros_between(p.paused_at, ctx.timestamp));
    if let Some(r) = run(ctx) {
        ctx.db.live_run().id().update(LiveRun {
            ends_at: r.ends_at + gap,
            next_incident_at: r.next_incident_at + gap,
            closing_at: r.closing_at.map(|t| t + gap),
            ..r
        });
    }
    for g in ctx.db.crowd_group().iter().collect::<Vec<_>>() {
        ctx.db.crowd_group().id().update(CrowdGroup { next_move_at: g.next_move_at + gap, ..g });
    }
    record(ctx, 0, 0, "venue", &safety::caller_name(ctx), "Resumed".into(), format!("paused for {} s", gap.to_micros() / 1_000_000));
    Ok(())
}

/// Every person of the crowd starts at a door, so the first tick walks them to their tables.
fn walk_in(ctx: &ReducerContext) {
    let doors: Vec<(f32, f32, u8)> =
        ctx.db.venue_spot().kind().filter("entrance").map(|s| (s.x_m, s.y_m, s.station_id)).collect();
    if doors.is_empty() {
        return;
    }
    let mut rng = ctx.rng();
    for m in ctx.db.crowd_member().iter() {
        let (x, y, station) = doors[rng.gen_range(0..doors.len())];
        let row = Band {
            id: m.band_id,
            state: 0,
            flags: F_MPU | F_MOTOR,
            neigh: 0,
            zone: station,
            bat: 255,
            find: 0,
            rssi: -60,
            seq: 1,
            sos: false,
            fall: false,
            pressed: false,
            low_battery: false,
            has_mpu: true,
            has_motor: true,
            online: true,
            last_seen: ctx.timestamp,
            x_m: x + rng.gen_range(-1.5..1.5),
            y_m: y + rng.gen_range(-1.5..1.5),
            booth_id: 0,
        };
        if ctx.db.band().id().find(m.band_id).is_some() {
            ctx.db.band().id().update(row);
        } else {
            ctx.db.band().insert(row);
        }
    }
}

fn close_doors(ctx: &ReducerContext, r: LiveRun) {
    ctx.db.live_run().id().update(LiveRun { phase: LivePhase::Closing, closing_at: Some(ctx.timestamp), ..r });
    crowd::head_for_exits(ctx);
    let open = ctx.db.incident_marker().status().filter("open").count()
        + ctx.db.incident_marker().status().filter("responding").count();
    let why = if open == 0 {
        "everyone walks to the nearest door; no incident is still open".to_string()
    } else {
        format!("everyone walks to the nearest door; the medic finishes the {open} open incident{}", if open == 1 { "" } else { "s" })
    };
    record(ctx, 0, 0, "venue", "Doors", "Doors closed".into(), why);
}

/// The run's clock, once a second: the next incident when it is due, the doors at the end time, and the end
/// of the event once the crowd is out.
#[spacetimedb::reducer]
pub fn live_tick(ctx: &ReducerContext, _timer: LiveRunTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("live_tick is internal".into());
    }
    let Some(r) = run(ctx) else { return Ok(()) };
    report_placed_test_bands(ctx);
    if paused(ctx) {
        return Ok(());
    }
    match r.phase {
        LivePhase::Running if ctx.timestamp >= r.ends_at => close_doors(ctx, r),
        LivePhase::Running if ctx.timestamp >= r.next_incident_at => {
            let step = r.step;
            let mut rng = step_rng(r.seed, step);
            let gap = rng.gen_range(INCIDENT_GAP_SECS.0..=INCIDENT_GAP_SECS.1);
            ctx.db.live_run().id().update(LiveRun { step: step + 1, next_incident_at: ctx.timestamp + seconds(gap), ..r });
            script::stage(ctx, step, &mut rng);
        }
        LivePhase::Closing => {
            let since = r.closing_at.map(|t| safety::micros_between(t, ctx.timestamp) / 1_000_000).unwrap_or(0);
            let open = ctx.db.incident_marker().iter().any(|m| m.status != "resolved");
            if since >= WALK_OUT_SECS && (!open || since >= CLOSE_WAIT_SECS) {
                finish(ctx, r);
            }
        }
        _ => {}
    }
    Ok(())
}

/// The generator for incident number `step`: the same seed and step always draw the same person, spot and gap.
fn step_rng(seed: u64, step: u16) -> StdRng {
    StdRng::seed_from_u64(seed ^ (step as u64 + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

/// The bands go quiet, the event ends and the run stops.
fn finish(ctx: &ReducerContext, r: LiveRun) {
    crowd::stop(ctx);
    let _ = crate::web::set_ended_by(ctx, true);
    for t in ctx.db.live_run_timer().iter().collect::<Vec<_>>() {
        ctx.db.live_run_timer().scheduled_id().delete(t.scheduled_id);
    }
    ctx.db.live_run().id().update(LiveRun { phase: LivePhase::Ended, ended_at: Some(ctx.timestamp), ..r.clone() });
    let markers: Vec<IncidentMarker> = ctx.db.incident_marker().iter().filter(|m| m.opened_at >= r.started_at).collect();
    let claims = markers.iter().filter(|m| m.claim_id != 0).count();
    let settled = markers.iter().filter(|m| m.claim_status == "paid" || m.claim_status == "paid by the insurer").count();
    let waiting = markers.iter().filter(|m| m.claim_status == "waiting for the organizer").count();
    let refused = markers.iter().filter(|m| m.claim_status == "refused").count();
    let paid: u64 = markers.iter().filter(|m| m.claim_status.starts_with("paid")).map(|m| m.payout_cents).sum();
    record(
        ctx,
        0,
        0,
        "venue",
        "Event",
        "The event ended: every band's link now opens its recap".into(),
        format!(
            "{} incidents, {claims} claims: {settled} paid ({}), {refused} refused, {waiting} waiting for the organizer to decide after the event",
            markers.len(),
            bandit_insurance::money::format_cents(paid)
        ),
    );
}

/// Placed test bands report from their spot every tick, the way a worn band reports through the radio.
fn report_placed_test_bands(ctx: &ReducerContext) {
    for p in ctx.db.band_place().iter() {
        if !(TEST_BAND_FIRST..FIRST_CROWD_BAND).contains(&p.band_id) {
            continue;
        }
        let Some(b) = ctx.db.band().id().find(p.band_id) else { continue };
        if ctx.db.event_state().id().find(0).is_some_and(|e| e.ended) {
            continue;
        }
        ctx.db.band().id().update(Band { online: true, last_seen: ctx.timestamp, x_m: p.x_m, y_m: p.y_m, zone: p.station_id, ..b });
    }
}

/// Puts a presenter's band (1 to 99) on the floor at a spot clicked on the 3D venue.
#[spacetimedb::reducer]
pub fn place_band(ctx: &ReducerContext, band_id: u32, x_m: f32, y_m: f32, label: String) -> Result<(), String> {
    require_role(ctx, &["ops", "tester"])?;
    if radio_id(band_id).is_none() || band_id == 0 {
        return Err("place a radio or test band, 1 to 99".into());
    }
    if !x_m.is_finite() || !y_m.is_finite() {
        return Err("not a spot on the floor".into());
    }
    let station_id = nearest_station(ctx, x_m, y_m);
    let row = BandPlace { band_id, x_m, y_m, station_id, label: label.trim().to_string(), placed_by: ctx.sender(), placed_at: ctx.timestamp };
    if ctx.db.band_place().band_id().find(band_id).is_some() {
        ctx.db.band_place().band_id().update(row);
    } else {
        ctx.db.band_place().insert(row);
    }
    // The band moves at once; a radio band's zone stays what its radio hears unless it hears none.
    let prev = ctx.db.band().id().find(band_id);
    let test_band = band_id >= TEST_BAND_FIRST;
    let zone = match &prev {
        Some(b) if !test_band && b.zone != 0 => b.zone,
        _ => station_id,
    };
    match prev {
        Some(b) => {
            if b.zone != zone {
                crate::ingest::leave_zone(ctx, band_id);
                crate::ingest::open_stay(ctx, band_id, zone, 0);
            }
            ctx.db.band().id().update(Band {
                x_m,
                y_m,
                zone,
                online: b.online || test_band,
                last_seen: if test_band { ctx.timestamp } else { b.last_seen },
                ..b
            });
        }
        None if test_band => {
            crate::ingest::open_stay(ctx, band_id, zone, 0);
            ctx.db.band().insert(Band {
                id: band_id,
                state: 0,
                flags: F_MPU | F_MOTOR,
                neigh: 0,
                zone,
                bat: 90,
                find: 0,
                rssi: -55,
                seq: 1,
                sos: false,
                fall: false,
                pressed: false,
                low_battery: false,
                has_mpu: true,
                has_motor: true,
                online: true,
                last_seen: ctx.timestamp,
                x_m,
                y_m,
                booth_id: 0,
            });
        }
        None => {}
    }
    let who = crate::insurance::people::wearer(ctx, band_id).map(|(_, n)| n).filter(|n| !n.is_empty());
    let name = who.unwrap_or_else(|| if label.trim().is_empty() { format!("band {}", crate::band_code::band_code(band_id)) } else { label.trim().to_string() });
    record(ctx, 0, 0, "venue", "Presenter", format!("{name} joined the floor at {}", place_name(ctx, x_m, y_m)), "a real band, placed on the 3D venue; it meets the crowd around it".into());
    Ok(())
}

/// Hands a presenter's band (1 to 99) to the attendee who wears it, as tapping it would: `node_id` picks an
/// attendee, 0 adds a new one named `name`. Whoever wore the band before lets it go, and so does any band the
/// attendee wore.
#[spacetimedb::reducer]
pub fn give_band(ctx: &ReducerContext, band_id: u32, node_id: u64, name: String) -> Result<(), String> {
    require_role(ctx, &["ops", "tester"])?;
    let radio = radio_id(band_id).filter(|b| *b != 0).ok_or("give a radio or test band, 1 to 99")?;
    let who = if node_id != 0 {
        ctx.db.attendee().node_id().find(node_id).ok_or("no such attendee")?
    } else {
        let a = ctx.db.attendee().insert(Attendee {
            identity: Identity::from_claims("bandit-staff", &format!("attendee-{}", micros(ctx.timestamp))),
            node_id: 0,
            display_name: crate::social::logic::clean_name(&name)?,
            photo_url: String::new(),
            findable: true,
            person_id: 0,
            organization_id: 0,
            crowd: false,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
        crate::social::graph::relink(ctx, &a);
        a
    };
    ctx.db.band_claim().band_id().delete(radio);
    ctx.db.band_owner().band_id().delete(radio);
    ctx.db.band_owner().owner().delete(who.identity);
    ctx.db.band_owner().insert(BandOwner { band_id: radio, owner: who.identity, claimed_at: ctx.timestamp });
    Ok(())
}

/// Takes a presenter's band off the floor: it goes back to standing at its radio zone.
#[spacetimedb::reducer]
pub fn unplace_band(ctx: &ReducerContext, band_id: u32) -> Result<(), String> {
    require_role(ctx, &["ops", "tester"])?;
    ctx.db.band_place().band_id().delete(band_id);
    Ok(())
}

/// Where a radio band stands: its placed spot, else its zone's spot. The zone stays the radio's, unless the
/// radio hears no station.
pub fn radio_band_spot(ctx: &ReducerContext, band_id: u32, zone: u8) -> (f32, f32, u8) {
    match ctx.db.band_place().band_id().find(band_id) {
        Some(p) => (p.x_m, p.y_m, if zone == 0 { p.station_id } else { zone }),
        None => {
            let (x, y) = crate::venue::station_spot(ctx, zone);
            (x, y, zone)
        }
    }
}

/// Puts a new incident on the floor. Called by the safety system for every incident it opens.
pub fn mark(ctx: &ReducerContext, incident: &safety::Incident, x_m: f32, y_m: f32) {
    let kind = match incident.kind {
        IncidentKind::Fall => "fall",
        IncidentKind::Sos => "sos",
        IncidentKind::Property => "property",
    };
    let person = if incident.subject_band == 0 {
        String::new()
    } else {
        crate::insurance::people::wearer(ctx, incident.subject_band).map(|(_, n)| n).unwrap_or_default()
    };
    let place = {
        let p = place_name(ctx, x_m, y_m);
        if p.is_empty() { zone_for_station(ctx, incident.station_id).map(|z| z.name).unwrap_or_default() } else { p }
    };
    ctx.db.incident_marker().insert(IncidentMarker {
        incident_id: incident.id,
        kind: kind.into(),
        band_id: incident.subject_band,
        person,
        x_m,
        y_m,
        station_id: incident.station_id,
        place,
        status: "open".into(),
        medic: String::new(),
        opened_at: incident.opened_at,
        responding_at: None,
        resolved_at: None,
        claim_id: 0,
        claim_status: String::new(),
        payout_cents: 0,
    });
}
