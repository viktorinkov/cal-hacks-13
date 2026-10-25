//! The crowd on the real Cal Hacks floor in an in-memory module: it walks in through the doors, walks the aisles
//! from spot to spot at walking speed and never through a table or a wall, stays with someone who is down, and
//! walks out of the doors when they close.

use super::tables::*;
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
