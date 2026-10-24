//! A venue setup run inside an in-memory module: the organizer names the event, the worker reports its
//! steps and its find, the organizer shows the found venue, and a run that keeps failing ends failed.

use super::*;
use crate::jobs::*;
use crate::tables::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, Table, Timestamp};

fn id(name: &str) -> Identity {
    Identity::from_claims("bandit-test", name)
}

fn auth(name: &str) -> TestAuth {
    let payload = format!(r#"{{"iss":"bandit-test","sub":"{name}"}}"#);
    TestAuth::from_jwt_payload(payload, ConnectionId::from_u128(name.len() as u128 + 1)).unwrap()
}

struct World {
    t: TestContext,
}

impl World {
    fn new() -> Self {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000));
        t.db.owner().insert(Owner { identity: id("owner") });
        for (who, role) in [("worker", "worker"), ("ops", "ops")] {
            t.db.staff_role().insert(StaffRole { id: 0, identity: id(who), role: role.into(), label: who.into(), granted_by: id("owner"), granted_at: t.clock.now() });
        }
        World { t }
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    fn try_as<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> Result<T, String> {
        self.t.with_reducer_tx(auth(who), f)
    }

    fn lease(&self) -> Job {
        let job = self.t.db.job().iter().filter(|j| j.kind == KIND_VENUE_SETUP && j.status == JobStatus::Queued).max_by_key(|j| j.id).expect("a queued venue setup job");
        self.as_("worker", |ctx| claim_job(ctx, job.id));
        job
    }

    fn setup(&self) -> VenueSetup {
        self.t.db.venue_setup().iter().max_by_key(|s| s.id).expect("a venue setup")
    }

    fn steps(&self, setup_id: u64) -> Vec<String> {
        let mut steps: Vec<VenueSetupStep> = self.t.db.venue_setup_step().setup_id().filter(setup_id).collect();
        steps.sort_by_key(|s| s.id);
        steps.into_iter().map(|s| s.step).collect()
    }
}

fn found(model: bool) -> VenueSetupResult {
    VenueSetupResult {
        event_site: "https://www.calhacks.io/".into(),
        venue_name: "Palace of Fine Arts".into(),
        address: "3601 Lyon St, San Francisco".into(),
        map_url: "https://hive.hackberkeley.org/venue-map".into(),
        method: if model { "three.js scene".into() } else { String::new() },
        model_hash: if model { "a".repeat(64) } else { String::new() },
        layout_hash: if model { "b".repeat(64) } else { String::new() },
        model_bytes: 12_218_964,
        meshes: 106,
        triangles: 115_389,
        places: 374,
        size_x: 213.9,
        size_y: 16.5,
        size_z: 96.7,
        floor_plans: vec!["https://palaceoffinearts.com/plan.pdf".into()],
        sources: vec![Fact { label: "Venue map".into(), value: "https://hive.hackberkeley.org/venue-map".into() }],
    }
}

#[test]
fn a_run_reports_its_steps_and_its_model() {
    let w = World::new();
    assert!(w.try_as("worker", |ctx| start_venue_setup(ctx, "Cal Hacks 13.0".into())).is_err(), "only the organizer starts a setup");
    w.as_("ops", |ctx| start_venue_setup(ctx, "  Cal Hacks 13.0 ".into()));
    let s = w.setup();
    assert_eq!((s.event_name.as_str(), s.status.as_str()), ("Cal Hacks 13.0", RUNNING));
    assert!(w.try_as("ops", |ctx| start_venue_setup(ctx, "cal hacks 13.0".into())).is_err(), "one run per event at a time");

    let job = w.lease();
    let payload: serde_json::Value = serde_json::from_str(&job.payload).unwrap();
    assert_eq!(payload["event_name"], "Cal Hacks 13.0");
    w.as_("worker", |ctx| report_venue_setup_step(ctx, job.id, "Searching".into(), "3 searches".into()));
    w.as_("worker", |ctx| finish_venue_setup(ctx, job.id, found(true)));

    let s = w.setup();
    assert_eq!(s.status, READY);
    assert_eq!(s.model_url, format!("/blobs/{}", "a".repeat(64)));
    assert_eq!(s.layout_url, format!("/blobs/{}", "b".repeat(64)));
    assert_eq!((s.meshes, s.places), (106, 374));
    assert_eq!(w.steps(s.id), ["Queued", "Searching", "Ready"]);
    assert_eq!(w.t.db.job().id().find(job.id).unwrap().status, JobStatus::Done);
    assert!(w.try_as("worker", |ctx| report_venue_setup_step(ctx, job.id, "Late".into(), String::new())).is_err(), "a finished job takes no more steps");

    assert!(w.try_as("worker", |ctx| choose_venue(ctx, s.id)).is_err(), "only the organizer picks the venue");
    w.as_("ops", |ctx| choose_venue(ctx, s.id));
    assert_eq!(w.t.db.chosen_venue().id().find(0).unwrap().setup_id, s.id);
    w.as_("ops", |ctx| choose_venue(ctx, DEFAULT_SETUP));
    assert_eq!(w.t.db.chosen_venue().id().find(0).unwrap().setup_id, DEFAULT_SETUP);
}

#[test]
fn a_venue_without_a_model_cannot_be_shown() {
    let w = World::new();
    w.as_("ops", |ctx| start_venue_setup(ctx, "TreeHacks 2027".into()));
    let job = w.lease();
    w.as_("worker", |ctx| finish_venue_setup(ctx, job.id, found(false)));
    let s = w.setup();
    assert_eq!((s.status.as_str(), s.model_url.as_str()), (NO_MODEL, ""));
    assert!(w.try_as("ops", |ctx| choose_venue(ctx, s.id)).is_err());
}

#[test]
fn a_run_that_keeps_failing_ends_failed() {
    let w = World::new();
    w.as_("ops", |ctx| start_venue_setup(ctx, "Cal Hacks 13.0".into()));
    for attempt in 1..=MAX_ATTEMPTS {
        let job = w.lease();
        w.as_("worker", |ctx| fail_job(ctx, job.id, format!("search failed {attempt}"), None));
        let ready = w.t.db.job().id().find(job.id).unwrap().not_before.unwrap_or(w.t.clock.now());
        w.t.clock.set(ready);
    }
    let s = w.setup();
    assert_eq!((s.status.as_str(), s.error.as_str()), (FAILED, "search failed 3"));
    assert_eq!(w.steps(s.id).last().unwrap(), "Failed");
}
