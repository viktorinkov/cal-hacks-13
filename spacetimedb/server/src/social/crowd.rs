//! A simulated crowd: fake, findable attendees wearing simulated bands (ids 10 to 89), moving between
//! the venue's station zones in small groups. Their bands write the same band1t `zone_visit` and
//! `encounter` rows a real band does, so the social tick turns them into visits, encounters and graph
//! links exactly like real ones and the big-screen graph looks like an event instead of nine people.

use super::graph::relink;
use super::logic::*;
use super::tables::*;
use super::tick::ensure_tick;
use crate::roles::require_role;
use crate::tables::{band, encounter, pair_key, zone_visit, Encounter, ZoneVisit};
use crate::venue::{organization, zone};
use spacetimedb::rand::Rng;
use spacetimedb::{Identity, ReducerContext, ScheduleAt, Table, Timestamp};

pub const FIRST_SIM_BAND: u8 = 10;
/// Bands 90 to 99 belong to the insurance demo's simulated bands.
pub const LAST_SIM_BAND: u8 = 89;
const FIRST_DEMO_BAND: u8 = 90;
const LAST_DEMO_BAND: u8 = 99;
const CROWD_TICK_SECONDS: u64 = 5;
/// Each tick two people spend together counts this many seconds, so links appear within a minute.
const TOGETHER_SECONDS_PER_TICK: u32 = 30;
const GROUP_SIZE: u8 = 3;
/// Chance per tick that two strangers in the same zone talk.
const STRANGER_CHANCE: f64 = 0.15;

const FIRST_NAMES: &[&str] = &[
    "Maya", "Ethan", "Priya", "Lucas", "Sofia", "Noah", "Aisha", "Diego", "Hana", "Marcus", "Elena", "Kenji",
    "Chloe", "Omar", "Zoe", "Ravi", "Isabel", "Tyler", "Mei", "Jonah", "Amara", "Leo", "Nina", "Caleb", "Yara",
    "Felix", "Grace", "Mateo", "Lena", "Sam",
];
const LAST_NAMES: &[&str] = &[
    "Chen", "Patel", "Garcia", "Kim", "Nguyen", "Okafor", "Silva", "Novak", "Haddad", "Rossi", "Tanaka", "Moreno",
    "Fischer", "Adeyemi", "Larsen", "Kaur", "Dubois", "Ivanova", "Mensah", "Park",
];
/// Public Instagram accounts of well-known people, used as the fake attendees' socials for the demo.
const INSTAGRAM: &[&str] = &[
    "viktorinkovski", "zuck", "mosseri", "cristiano", "leomessi", "selenagomez", "therock", "arianagrande",
    "taylorswift", "zendaya", "kevinhart4real", "badgalriri", "beyonce", "kimkardashian", "kyliejenner",
    "justinbieber", "neymarjr", "jlo", "shakira", "billieeilish", "dualipa", "champagnepapi", "kingjames",
    "serenawilliams", "chrishemsworth", "tomholland2013", "emmawatson", "willsmith", "mrbeast", "lewishamilton",
    "ladygaga", "edsheeran", "brunomars", "oprah", "theweeknd", "vancityreynolds", "michelleobama", "stephencurry30",
    "harrystyles", "katyperry", "nickiminaj", "kendalljenner", "sabrinacarpenter", "oliviarodrigo", "postmalone",
    "snoopdogg", "jenniferaniston", "gal_gadot", "priyankachopra", "virat.kohli",
];

fn crowd_identity(band_id: u8) -> Identity {
    Identity::from_claims("bandit-crowd", &format!("band-{band_id}"))
}

fn stations(ctx: &ReducerContext) -> Vec<u8> {
    let mut s: Vec<u8> = ctx.db.zone().iter().map(|z| z.station_id).filter(|s| *s != 0).collect();
    s.sort_unstable();
    s.dedup();
    s
}

fn enter(ctx: &ReducerContext, band_id: u8, station: u8, entered: Timestamp) {
    for open in ctx.db.zone_visit().band_id().filter(band_id).filter(|v| v.left.is_none()).collect::<Vec<_>>() {
        ctx.db.zone_visit().id().update(ZoneVisit { left: Some(ctx.timestamp), ..open });
    }
    ctx.db.zone_visit().insert(ZoneVisit { id: 0, band_id, zone: station, entered, left: None });
}

fn later(ctx: &ReducerContext, min_minutes: i64, max_minutes: i64) -> Timestamp {
    ctx.timestamp + seconds(ctx.rng().gen_range(min_minutes * 60..max_minutes * 60))
}

/// Add `size` fake attendees and start moving them. Run once after the venue is imported.
#[spacetimedb::reducer]
pub fn start_crowd(ctx: &ReducerContext, size: u8) -> Result<(), String> {
    require_role(ctx, &["ops", "simulator"])?;
    let stations = stations(ctx);
    if stations.is_empty() {
        return Err("import the venue first: the crowd moves between zones that have a station".into());
    }
    let orgs: Vec<u64> = ctx.db.organization().iter().map(|o| o.id).collect();
    let last = (FIRST_SIM_BAND as u16 + size as u16).min(LAST_SIM_BAND as u16 + 1) as u8;
    for band_id in FIRST_SIM_BAND..last {
        if ctx.db.band_owner().band_id().find(band_id).is_some() {
            continue;
        }
        let i = (band_id - FIRST_SIM_BAND) as usize;
        let who = crowd_identity(band_id);
        let group_id = (i / GROUP_SIZE as usize) as u8;
        let a = ctx.db.attendee().insert(Attendee {
            identity: who,
            node_id: 0,
            display_name: format!("{} {}", FIRST_NAMES[i % FIRST_NAMES.len()], LAST_NAMES[(i * 7) % LAST_NAMES.len()]),
            photo_url: format!("https://i.pravatar.cc/300?img={}", i % 70 + 1),
            findable: true,
            person_id: 0,
            organization_id: if orgs.is_empty() { 0 } else { orgs[i % orgs.len()] },
            simulated: true,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
        ctx.db.band_owner().insert(BandOwner { band_id, owner: who, claimed_at: ctx.timestamp - seconds(600) });
        ctx.db.social_handle().insert(SocialHandle {
            id: 0,
            owner: who,
            platform: "instagram".into(),
            handle: INSTAGRAM[i % INSTAGRAM.len()].into(),
            updated_at: ctx.timestamp,
        });
        let station = stations[group_id as usize % stations.len()];
        enter(ctx, band_id, station, ctx.timestamp - seconds(180));
        ctx.db.crowd_member().insert(CrowdMember { band_id, group_id, station, next_move_at: later(ctx, 2, 6) });
        relink(ctx, &a);
    }
    ensure_tick(ctx);
    if ctx.db.crowd_timer().count() == 0 {
        ctx.db.crowd_timer().insert(CrowdTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_secs(CROWD_TICK_SECONDS).into()),
        });
    }
    Ok(())
}

/// Two simulated bands spent this tick close together, as band1t's radio encounter would record it.
fn together(ctx: &ReducerContext, a: u8, b: u8) {
    let key = pair_key(a, b);
    match ctx.db.encounter().key().find(key) {
        Some(e) => {
            ctx.db.encounter().key().update(Encounter {
                last_seen: ctx.timestamp,
                seconds_close: e.seconds_close + TOGETHER_SECONDS_PER_TICK,
                ..e
            });
        }
        None => {
            ctx.db.encounter().insert(Encounter {
                key,
                band_a: a.min(b),
                band_b: a.max(b),
                first_seen: ctx.timestamp,
                last_seen: ctx.timestamp,
                seconds_close: 0,
                best_rssi: -50,
            });
        }
    }
}

/// Freeze the crowd where it is; its memories and links stay.
#[spacetimedb::reducer]
pub fn stop_crowd(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops", "simulator"])?;
    for t in ctx.db.crowd_timer().iter().collect::<Vec<_>>() {
        ctx.db.crowd_timer().scheduled_id().delete(t.scheduled_id);
    }
    for m in ctx.db.crowd_member().iter().collect::<Vec<_>>() {
        for open in ctx.db.zone_visit().band_id().filter(m.band_id).filter(|v| v.left.is_none()).collect::<Vec<_>>() {
            ctx.db.zone_visit().id().update(ZoneVisit { left: Some(ctx.timestamp), ..open });
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn crowd_tick(ctx: &ReducerContext, _timer: CrowdTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("crowd_tick is internal".into());
    }
    let stations = stations(ctx);
    let mut members: Vec<CrowdMember> = ctx.db.crowd_member().iter().collect();
    members.sort_by_key(|m| m.band_id);

    // Groups move together once their leader's time is up.
    let leaders: Vec<CrowdMember> = members
        .iter()
        .filter(|m| members.iter().all(|o| o.group_id != m.group_id || o.band_id >= m.band_id))
        .filter(|m| micros(m.next_move_at) <= micros(ctx.timestamp))
        .cloned()
        .collect();
    for leader in leaders {
        let station = stations[ctx.rng().gen_range(0..stations.len())];
        let next_move_at = later(ctx, 3, 8);
        for m in members.iter_mut().filter(|m| m.group_id == leader.group_id) {
            if m.station != station {
                enter(ctx, m.band_id, station, ctx.timestamp);
            }
            m.station = station;
            m.next_move_at = next_move_at;
            ctx.db.crowd_member().band_id().update(m.clone());
        }
    }

    // Friends in the same zone stay close; strangers in the same zone sometimes talk.
    for (i, a) in members.iter().enumerate() {
        for b in &members[i + 1..] {
            if a.station == b.station && (a.group_id == b.group_id || ctx.rng().gen_bool(STRANGER_CHANCE)) {
                together(ctx, a.band_id, b.band_id);
            }
        }
    }

    // Claimed demo bands (90 to 99, reported through report_sim_band) stay and mix with the crowd
    // at whatever station they report, so a recap can be tried without hardware.
    let demo: Vec<(u8, u8)> = (FIRST_DEMO_BAND..=LAST_DEMO_BAND)
        .filter(|id| ctx.db.band_owner().band_id().find(id).is_some())
        .filter_map(|id| ctx.db.band().id().find(id))
        .filter(|b| b.online && b.zone != 0)
        .map(|b| (b.id, b.zone))
        .collect();
    for &(band_id, station) in &demo {
        let open = ctx.db.zone_visit().band_id().filter(band_id).find(|v| v.left.is_none()).map(|v| v.zone);
        if open != Some(station) {
            enter(ctx, band_id, station, ctx.timestamp);
        }
        for m in members.iter().filter(|m| m.station == station) {
            together(ctx, band_id, m.band_id);
        }
    }
    for (i, &(a, station)) in demo.iter().enumerate() {
        for &(b, _) in demo[i + 1..].iter().filter(|(_, s)| *s == station) {
            together(ctx, a, b);
        }
    }
    Ok(())
}
