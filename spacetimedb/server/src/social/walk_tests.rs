//! The crowd on the real Cal Hacks floor in an in-memory module: it walks in through the doors, walks the aisles
//! from spot to spot at walking speed and never through a table or a wall, stays with someone who is down,
//! walks out of the doors when they close, and lets someone who leaves early walk out alone. Everyone working the
//! event wears a band too, except the medics.

use super::tables::*;
use crate::departure::departure;
use crate::safety::incident;
use crate::live::*;
use crate::roles::*;
use crate::tables::*;
use crate::venue::floor::*;
use crate::venue::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, ReducerContext, ScheduleAt, Table, TimeDuration, Timestamp};
use std::collections::HashMap;

const TICK: i64 = 2_000_000;
/// The fastest walker at the fastest walk pace covers this much in one crowd tick, with a little slack.
const MAX_STEP_M: f32 = 1.5 * super::walks::MAX_WALK_PACE * 2.0 + 0.3;

fn id(name: &str) -> Identity {
    Identity::from_claims("bandit-test", name)
}

fn auth(name: &str) -> TestAuth {
    let payload = format!(r#"{{"iss":"bandit-test","sub":"{name}"}}"#);
    TestAuth::from_jwt_payload(payload, ConnectionId::from_u128(name.len() as u128 + 1)).unwrap()
}

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap()
}

struct World {
    t: TestContext,
    floor: Floor,
}

impl World {
    /// The venue's zones with their stations, one booth per sponsor of the floor's sponsor tables, the floor's
    /// spots and its walkable grid.
    fn new() -> World {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000));
        t.db.owner().insert(Owner { identity: id("owner") });
        t.db.staff_role().insert(StaffRole { id: 0, identity: id("ops"), role: "ops".into(), label: "ops".into(), granted_by: id("owner"), granted_at: t.clock.now() });
        let mut zones = HashMap::new();
        for (n, (kind, name)) in [("floor", "Hacking floor"), ("sponsor", "Sponsor tables"), ("stage", "Stage"), ("food", "Food"), ("entrance", "Entrance")].into_iter().enumerate() {
            let z = t.db.zone().insert(Zone {
                id: 0,
                source_key: format!("zone:{kind}"),
                venue_id: 1,
                name: name.into(),
                kind: kind.into(),
                station_id: 101 + n as u8,
                plan_x_m: 0.0,
                plan_y_m: 0.0,
                area_sq_m: 400.0,
                capacity: 500,
                exit_colour: 0,
                description: String::new(),
                updated_at: t.clock.now(),
            });
            zones.insert(kind, z.id);
        }
        let spots = json(include_str!("../../../../web/venue/spots.json"));
        let spots = spots.as_array().unwrap();
        let mut sponsors: Vec<&str> = spots.iter().filter(|s| s["kind"] == "sponsor_table").map(|s| s["name"].as_str().unwrap()).collect();
        sponsors.dedup();
        for (n, name) in sponsors.iter().enumerate() {
            let org = t.db.organization().insert(Organization {
                id: 0,
                source_key: format!("org:{n}"),
                venue_id: 1,
                name: name.to_string(),
                kind: "sponsor".into(),
                sponsor_tier: if n % 4 == 0 { "Golden Bear".into() } else { "Silver".into() },
                website: String::new(),
                domain: String::new(),
                logo_url: String::new(),
                description: String::new(),
                category: String::new(),
                tags: vec![["ai", "data", "fintech", "devtools"][n % 4].into()],
                industry: String::new(),
                headquarters: String::new(),
                size_range: String::new(),
                founded_year: 0,
                linkedin_url: String::new(),
                prizes: vec![],
                source_url: String::new(),
                fetched_at: t.clock.now(),
                updated_at: t.clock.now(),
                crunchbase_url: String::new(),
                funding_summary: String::new(),
            });
            t.db.booth().insert(Booth {
                id: 0,
                source_key: format!("booth:{n}"),
                venue_id: 1,
                zone_id: zones["sponsor"],
                organization_id: org.id,
                booth_number: String::new(),
                name: name.to_string(),
                kind: "sponsor".into(),
                description: String::new(),
                tags: vec![],
                plan_x_m: 0.0,
                plan_y_m: 0.0,
                placement: String::new(),
                source_url: String::new(),
                fetched_at: t.clock.now(),
                updated_at: t.clock.now(),
            });
        }
        let rows: Vec<VenueSpotIn> = spots
            .iter()
            .map(|s| VenueSpotIn {
                kind: s["kind"].as_str().unwrap().into(),
                name: s["name"].as_str().unwrap().into(),
                number: s["number"].as_u64().unwrap() as u32,
                x: s["x"].as_f64().unwrap() as f32,
                z: s["z"].as_f64().unwrap() as f32,
                angle: s["angle"].as_f64().unwrap() as f32,
            })
            .collect();
        t.with_reducer_tx(auth("ops"), |ctx| load_venue_spots(ctx, rows)).unwrap();
        let f = json(include_str!("../../../../web/venue/floor.json"));
        let floor = VenueFloorIn {
            x0: f["x0"].as_f64().unwrap() as f32,
            z0: f["z0"].as_f64().unwrap() as f32,
            cell: f["cell"].as_f64().unwrap() as f32,
            cols: f["cols"].as_u64().unwrap() as u32,
            rows: f["rows"].as_u64().unwrap() as u32,
            runs: f["runs"].as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u32).collect(),
        };
        t.with_reducer_tx(auth("ops"), |ctx| load_venue_floor(ctx, floor)).unwrap();
        let floor = Floor::from_row(&t.db.venue_floor().id().find(0).unwrap());
        World { t, floor }
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    fn tick(&self) {
        self.t.clock.advance(TimeDuration::from_micros(TICK));
        let timer = CrowdTimer { scheduled_id: 0, scheduled_at: ScheduleAt::Time(self.t.clock.now()) };
        self.t.with_reducer_tx(TestAuth::internal(), |ctx| super::crowd::crowd_tick(ctx, timer)).unwrap();
    }

    /// Every crowd band: where it stands and whether it is in the venue.
    fn bands(&self) -> HashMap<u32, (f32, f32, bool)> {
        self.t.db.band().iter().filter(|b| b.id >= FIRST_CROWD_BAND).map(|b| (b.id, (b.x_m, b.y_m, b.online))).collect()
    }

    /// Ticks for `secs` seconds and checks every step: nobody in the venue stands where nobody can, and nobody
    /// moves faster than a walk. Returns how far each band walked.
    fn walk_for(&self, secs: i64, walked: &mut HashMap<u32, f32>) {
        let mut before = self.bands();
        for _ in 0..secs * 1_000_000 / TICK {
            self.tick();
            let now = self.bands();
            for (band, &(x, y, on)) in &now {
                if !on {
                    continue;
                }
                assert!(self.floor.walkable((x, y)), "band {band} stands at ({x}, {y}), where nobody can");
                if let Some(&(px, py, true)) = before.get(band) {
                    let step = ((x - px).powi(2) + (y - py).powi(2)).sqrt();
                    assert!(step <= MAX_STEP_M, "band {band} moved {step} m in one tick, from ({px}, {py}) to ({x}, {y})");
                    *walked.entry(*band).or_default() += step;
                }
            }
            before = now;
        }
    }
}

#[test]
fn the_crowd_walks_in_walks_the_aisles_and_walks_out() {
    let w = World::new();
    w.as_("ops", |ctx| start_live_run(ctx, 300, 12, 8, false, 42));
    let walks: Vec<CrowdWalk> = w.t.db.crowd_walk().iter().collect();
    assert_eq!(walks.len(), 300, "everyone walks in");
    for c in &walks {
        let pts: Vec<(f32, f32)> = c.path.chunks_exact(2).map(|p| (p[0], p[1])).collect();
        assert!(pts.windows(2).all(|s| w.floor.clear(s[0], s[1])), "band {} walks through something: {pts:?}", c.band_id);
    }
    assert!(w.bands().values().all(|&(_, _, on)| !on), "nobody is in before they walk in");

    let mut walked = HashMap::new();
    w.walk_for(90, &mut walked);
    let out: Vec<String> = w
        .bands()
        .iter()
        .filter(|b| !b.1.2)
        .map(|(id, b)| format!("{id} at {b:?} walk {:?} now {:?}", w.t.db.crowd_walk().band_id().find(*id), w.t.clock.now()))
        .collect();
    assert!(out.is_empty(), "everyone is in after a minute and a half: {out:#?}");

    w.walk_for(240, &mut walked);
    let moved = walked.values().filter(|&&m| m > 5.0).count();
    assert!(moved >= 280, "{moved} of 300 walked somewhere");
    let teams_walking = w.t.db.crowd_walk().iter().filter(|c| c.arrives_at > w.t.clock.now()).count();
    assert!(teams_walking > 0 && teams_walking < 200, "some walk while others stay: {teams_walking}");

    w.as_("ops", end_live_run);
    w.walk_for(120, &mut walked);
    assert!(!w.t.with_reducer_tx(TestAuth::internal(), |ctx| Ok::<_, String>(super::crowd::walking(ctx))).unwrap());
    assert_eq!(w.bands().values().filter(|b| b.2).count(), 0, "everyone walked out of a door");
}

#[test]
fn a_team_stays_with_someone_who_is_down_and_they_walk_back_to_it() {
    let w = World::new();
    w.as_("ops", |ctx| start_live_run(ctx, 120, 12, 8, false, 7));
    let mut walked = HashMap::new();
    w.walk_for(120, &mut walked);
    // Someone of a team of several who stands still falls where they stand.
    let now = w.t.clock.now();
    let members: Vec<CrowdMember> = w.t.db.crowd_member().iter().collect();
    let still = |m: &CrowdMember| w.t.db.crowd_walk().band_id().find(m.band_id).is_some_and(|c| c.arrives_at < now);
    let m = members
        .iter()
        .find(|m| still(m) && members.iter().filter(|o| o.group_id == m.group_id).count() >= 2 && w.t.db.crowd_group().id().find(m.group_id).unwrap().staff_booth == 0)
        .expect("a hacker standing with a team")
        .clone();
    let b = w.t.db.band().id().find(m.band_id).unwrap();
    let (bx, by, zone) = (b.x_m, b.y_m, b.zone);
    w.t.db.band().id().update(Band { fall: true, state: 3, ..b });
    w.t.db.incident_marker().insert(IncidentMarker {
        incident_id: 1,
        kind: "fall".into(),
        band_id: m.band_id,
        person: String::new(),
        x_m: bx,
        y_m: by,
        station_id: zone,
        place: String::new(),
        status: "open".into(),
        medic: String::new(),
        opened_at: now,
        responding_at: None,
        resolved_at: None,
        claim_id: 0,
        claim_status: String::new(),
        payout_cents: 0,
    });
    let g = w.t.db.crowd_group().id().find(m.group_id).unwrap();
    w.t.db.crowd_group().id().update(CrowdGroup { next_move_at: now, ..g.clone() });
    w.walk_for(60, &mut walked);
    let down = w.t.db.band().id().find(m.band_id).unwrap();
    assert_eq!((down.x_m, down.y_m, down.fall), (bx, by, true), "they stay where they fell");
    assert_eq!(w.t.db.crowd_group().id().find(m.group_id).unwrap(), CrowdGroup { next_move_at: now, ..g.clone() }, "the team waits");

    // The medic is done: they get up and the team walks on with them.
    let marker = w.t.db.incident_marker().incident_id().find(1).unwrap();
    w.t.db.incident_marker().incident_id().update(IncidentMarker { status: "resolved".into(), ..marker });
    w.tick();
    let up = w.t.db.band().id().find(m.band_id).unwrap();
    assert!(!up.fall);
    let walk = w.t.db.crowd_walk().band_id().find(m.band_id).unwrap();
    assert_eq!((walk.path[0], walk.path[1]), (bx, by), "they walk on from where they fell");
    assert!(w.t.db.crowd_group().id().find(m.group_id).unwrap().next_move_at > now, "the team moved on");
    w.walk_for(60, &mut walked);
}

#[test]
fn someone_who_leaves_early_walks_alone_to_the_nearest_door_and_is_out() {
    let w = World::new();
    w.as_("ops", |ctx| start_live_run(ctx, 120, 12, 8, false, 11));
    let mut walked = HashMap::new();
    w.walk_for(90, &mut walked);
    let members: Vec<CrowdMember> = w.t.db.crowd_member().iter().collect();
    let m = members
        .iter()
        .find(|m| members.iter().filter(|o| o.group_id == m.group_id).count() >= 2 && w.t.db.crowd_group().id().find(m.group_id).unwrap().staff_booth == 0)
        .expect("a hacker in a team of several")
        .clone();
    let node = w.t.db.attendee().identity().find(m.identity).unwrap().node_id;
    w.as_("ops", |ctx| crate::departure::leave_early(ctx, node));
    let d = w.t.db.departure().attendee().find(m.identity).unwrap();
    assert!(d.left_at.is_none() && !d.door.is_empty(), "they walk to a door first: {d:?}");
    let walk = w.t.db.crowd_walk().band_id().find(m.band_id).unwrap();
    let pts: Vec<(f32, f32)> = walk.path.chunks_exact(2).map(|p| (p[0], p[1])).collect();
    assert!(pts.windows(2).all(|s| w.floor.clear(s[0], s[1])), "they walk around everything: {pts:?}");
    assert_eq!(pts.last(), Some(&(d.x_m, d.y_m)), "to the door");

    // Their team moves on without them, and they walk out of the door.
    let g = w.t.db.crowd_group().id().find(m.group_id).unwrap();
    w.t.db.crowd_group().id().update(CrowdGroup { next_move_at: w.t.clock.now(), ..g });
    w.walk_for(120, &mut walked);
    assert_eq!(w.t.db.crowd_walk().band_id().find(m.band_id).unwrap(), walk, "the team never took them along");
    assert!(w.t.db.departure().attendee().find(m.identity).unwrap().left_at.is_some(), "out of the door");
    assert!(!w.t.db.band().id().find(m.band_id).unwrap().online, "their band went quiet");
    assert!(w.t.db.decision().iter().any(|e| e.what.contains("left early by the")), "the run's history says so");
    let err = w.t.with_reducer_tx(auth("ops"), |ctx| crate::departure::leave_early(ctx, node)).unwrap_err();
    assert!(err.contains("already left"), "{err}");
}

#[test]
fn everyone_at_the_event_wears_a_band_but_the_medics() {
    let w = World::new();
    let org = w.t.db.organization().iter().next().unwrap();
    w.t.db.person().insert(Person {
        id: 0,
        source_key: "person:eno".into(),
        venue_id: 1,
        display_name: "Eno Reyes".into(),
        kind: "speaker".into(),
        role: "opening speaker".into(),
        title: "Founder".into(),
        organization_id: org.id,
        bio: String::new(),
        headshot_url: String::new(),
        links: vec![],
        source_url: String::new(),
        fetched_at: w.t.clock.now(),
        updated_at: w.t.clock.now(),
    });
    w.as_("ops", |ctx| start_live_run(ctx, 300, 12, 8, false, 42));
    let mut roles: HashMap<String, usize> = HashMap::new();
    for m in w.t.db.crowd_member().iter() {
        *roles.entry(role_of(&w.t.db.crowd_group().id().find(m.group_id).unwrap()).to_string()).or_default() += 1;
    }
    let count = |r: &str| roles.get(r).copied().unwrap_or(0);
    assert_eq!((count(BOOTH_STAFF), count(ORGANIZER), count(PHOTOGRAPHER), count(SPEAKER)), (30, 3, 2, 1));
    assert_eq!(count(HACKER), 300 - 36);

    let people = crate::web::board_attendees(&w.t.view_context(auth("ops")));
    assert_eq!(people.len(), 300, "every one of them has a band and a role");
    let speaker = people.iter().find(|a| a.role == SPEAKER).unwrap();
    assert_eq!((speaker.display_name.as_str(), speaker.organization.as_str()), ("Eno Reyes", org.name.as_str()));
    assert!(speaker.band_id >= FIRST_CROWD_BAND && speaker.handles.is_empty(), "the speaker wears a band, with no made-up socials");
    assert_eq!(people.iter().filter(|a| a.role == ORGANIZER).count(), 3);

    // Only hackers are the ones who fall, press SOS or go home early.
    let mut walked = HashMap::new();
    w.walk_for(240, &mut walked);
    for i in w.t.db.incident().iter().filter(|i| i.subject_band >= FIRST_CROWD_BAND) {
        let m = w.t.db.crowd_member().band_id().find(i.subject_band).unwrap();
        assert_eq!(role_of(&w.t.db.crowd_group().id().find(m.group_id).unwrap()), HACKER, "incident {} happened to a hacker", i.id);
    }
}

#[test]
fn a_band_placed_at_a_sponsor_table_stands_at_its_booth() {
    let w = World::new();
    let sponsor_tables: Vec<VenueSpot> = w.t.db.venue_spot().iter().filter(|s| s.kind == "sponsor_table" && s.booth_id != 0).collect();
    let first = sponsor_tables[0].clone();
    let other = sponsor_tables.iter().find(|s| s.booth_id != first.booth_id).unwrap().clone();
    let table = w.t.db.venue_spot().iter().find(|s| s.kind == "table").unwrap();
    let open = || w.t.db.zone_visit().band_id().filter(95u32).filter(|v| v.open).map(|v| (v.zone, v.booth_id)).collect::<Vec<_>>();

    w.as_("ops", |ctx| place_band(ctx, 95, first.x_m, first.y_m, "Ana".into()));
    assert_eq!(w.t.db.band().id().find(95).unwrap().booth_id, first.booth_id);
    assert_eq!(open(), vec![(first.station_id, first.booth_id)], "the stay names the table's booth");

    w.t.clock.advance(TimeDuration::from_micros(60_000_000));
    w.as_("ops", |ctx| place_band(ctx, 95, other.x_m, other.y_m, "Ana".into()));
    assert_eq!(open(), vec![(other.station_id, other.booth_id)], "another table in the same zone starts a new stay");
    assert_eq!(w.t.db.zone_visit().band_id().filter(95u32).count(), 2);

    w.as_("ops", |ctx| place_band(ctx, 95, table.x_m, table.y_m, "Ana".into()));
    assert_eq!(open(), vec![(table.station_id, 0)], "a hacker table names no booth");
    assert_eq!(w.t.db.band().id().find(95).unwrap().booth_id, 0);
}
