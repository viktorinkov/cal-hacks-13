use super::*;
use crate::jobs::*;
use crate::roles::*;
use crate::tables::*;
use crate::venue::tables::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, TimeDuration};

fn identity(name: &str) -> Identity {
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
        t.db.owner().insert(Owner { identity: identity("owner") });
        for (who, role) in [("ops", "ops"), ("worker", "worker"), ("other-worker", "worker")] {
            t.db.staff_role().insert(StaffRole {
                id: 0,
                identity: identity(who),
                role: role.into(),
                label: who.into(),
                granted_by: identity("owner"),
                granted_at: t.clock.now(),
            });
        }
        Self { t }
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.try_as(who, f).unwrap()
    }

    fn try_as<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> Result<T, String> {
        self.t.with_reducer_tx(auth(who), f)
    }

    fn run(&self) -> EventImport {
        self.t.db.event_import().iter().max_by_key(|run| run.id).unwrap()
    }

    fn job(&self) -> Job {
        self.t.db.job().iter().filter(|job| job.kind == KIND_EVENT_IMPORT).max_by_key(|job| job.id).unwrap()
    }

    fn lease(&self) -> Job {
        let job = self.job();
        self.as_("worker", |ctx| claim_job(ctx, job.id));
        job
    }

    fn start(&self) -> EventImport {
        self.as_("ops", |ctx| start_event_import(ctx, EVENT_SLUG.into()));
        self.run()
    }

    fn steps(&self, import_id: u64) -> Vec<String> {
        let mut rows: Vec<_> = self.t.db.event_import_step().import_id().filter(import_id).collect();
        rows.sort_by_key(|row| row.id);
        rows.into_iter().map(|row| row.step).collect()
    }
}

fn bundle(run: &EventImport) -> EventBundle {
    EventBundle {
        run_id: run.run_id.clone(),
        organizer: "bandit-organize".into(),
        bundle_hash: "a".repeat(64),
        venue: VenueIn {
            source_key: format!("event:{}", run.event_slug),
            name: EVENT_NAME.into(),
            venue_name: "Palace of Fine Arts".into(),
            address: "3601 Lyon St, San Francisco".into(),
            latitude: 37.802,
            longitude: -122.449,
            website: "https://www.calhacks.io/".into(),
            timezone: "America/Los_Angeles".into(),
            starts_at: None,
            ends_at: None,
            description: "Cal Hacks 13.0".into(),
            facts: Vec::new(),
            source_url: "https://www.calhacks.io/".into(),
            fetched_at: run.created_at,
        },
        zones: Vec::new(),
        organizations: Vec::new(),
        people: Vec::new(),
        booths: Vec::new(),
        schedule: Vec::new(),
    }
}

#[test]
fn organizer_starts_a_configured_import_and_worker_commits_it_once() {
    let w = World::new();
    assert!(w.try_as("worker", |ctx| start_event_import(ctx, EVENT_SLUG.into())).is_err());
    assert!(w.try_as("visitor", |ctx| start_event_import(ctx, EVENT_SLUG.into())).is_err());
    assert!(w.try_as("ops", |ctx| start_event_import(ctx, "../calhacks-13".into())).is_err());
    let run = w.start();
    assert_eq!(run.run_id, format!("calhacks-13-import-{}", run.id));
    assert_eq!(run.status, RUNNING);
    assert_eq!(run.requested_by, identity("ops"));
    assert!(w.try_as("ops", |ctx| start_event_import(ctx, EVENT_SLUG.into())).is_err());
    let payload: serde_json::Value = serde_json::from_str(&w.job().payload).unwrap();
    assert_eq!(payload["import_id"], run.id);
    assert_eq!(payload["event_slug"], EVENT_SLUG);
    assert_eq!(payload["run_id"], run.run_id);
    let queued_job_id = w.job().id;
    assert!(w.try_as("worker", |ctx| finish_event_import(ctx, queued_job_id, bundle(&run))).is_err());
    assert!(w.try_as("worker", |ctx| super::super::import::import_event(ctx, bundle(&run))).is_err());

    let job = w.lease();
    assert!(w.try_as("ops", |ctx| report_event_import_step(ctx, job.id, "Fetching".into(), String::new())).is_err());
    assert!(w.try_as("other-worker", |ctx| finish_event_import(ctx, job.id, bundle(&run))).is_err());
    w.as_("worker", |ctx| report_event_import_step(ctx, job.id, "Fetching".into(), "Reading event pages".into()));
    w.as_("worker", |ctx| finish_event_import(ctx, job.id, bundle(&run)));
    let saved = w.run();
    assert_eq!(saved.status, READY);
    assert_ne!(saved.venue_id, 0);
    assert_eq!(saved.counts[0], SectionCount { section: "venue".into(), inserted: 1, updated: 0 });
    assert_eq!(w.steps(run.id), ["Queued", "Fetching", "Ready"]);
    assert_eq!(w.t.db.import_run().count(), 1);
    assert_eq!(w.job().status, JobStatus::Done);
    assert!(w.try_as("worker", |ctx| finish_event_import(ctx, job.id, bundle(&run))).is_err());
    assert!(w.try_as("worker", |ctx| report_event_import_step(ctx, job.id, "Late".into(), String::new())).is_err());
    assert_eq!(w.t.db.import_run().count(), 1);

    let next = w.start();
    let next_job = w.lease();
    w.as_("worker", |ctx| finish_event_import(ctx, next_job.id, bundle(&next)));
    assert_eq!(w.t.db.venue().count(), 1, "reimport preserves the venue identity");
    assert_eq!(w.run().counts[0].inserted, 0);
}

#[test]
fn result_must_match_the_leased_import_and_expired_workers_cannot_write() {
    let w = World::new();
    let run = w.start();
    let job = w.lease();
    let mut wrong_run = bundle(&run);
    wrong_run.run_id.push_str("-old");
    assert!(w.try_as("worker", |ctx| finish_event_import(ctx, job.id, wrong_run)).is_err());
    let mut wrong_event = bundle(&run);
    wrong_event.venue.source_key = "event:another-event".into();
    assert!(w.try_as("worker", |ctx| finish_event_import(ctx, job.id, wrong_event)).is_err());
    for (kind, subject) in [("venue_setup", KIND_EVENT_IMPORT), (KIND_EVENT_IMPORT, "venue_setup")] {
        let unrelated = w.as_("ops", |ctx| Ok(enqueue(ctx, kind, "{}".into(), subject, run.id)));
        w.as_("worker", |ctx| claim_job(ctx, unrelated));
        assert!(w.try_as("worker", |ctx| report_event_import_step(ctx, unrelated, "Wrong job".into(), String::new())).is_err());
        assert!(w.try_as("worker", |ctx| finish_event_import(ctx, unrelated, bundle(&run))).is_err());
    }
    w.t.clock.set(w.t.clock.now() + TimeDuration::from_micros(LEASE_MICROS + 1));
    assert!(w.try_as("worker", |ctx| report_event_import_step(ctx, job.id, "Expired".into(), String::new())).is_err());
    assert!(w.try_as("worker", |ctx| finish_event_import(ctx, job.id, bundle(&run))).is_err());
    assert_eq!(w.t.db.venue().count(), 0);
    assert_eq!(w.steps(run.id), ["Queued"]);
    assert_eq!(w.run().status, RUNNING);
}

#[test]
fn invalid_references_roll_back_the_import_and_leave_the_job_retryable() {
    let w = World::new();
    let run = w.start();
    let job = w.lease();
    let mut invalid = bundle(&run);
    invalid.people.push(PersonIn {
        source_key: "person:speaker".into(),
        display_name: "Alex Speaker".into(),
        kind: "speaker".into(),
        role: "Speaker".into(),
        title: String::new(),
        organization_key: "organization:missing".into(),
        bio: String::new(),
        headshot_url: String::new(),
        links: Vec::new(),
        source_url: "https://www.calhacks.io/".into(),
        fetched_at: run.created_at,
    });
    assert!(w.try_as("worker", |ctx| finish_event_import(ctx, job.id, invalid)).unwrap_err().contains("unknown organization"));
    assert_eq!(w.t.db.venue().count(), 0, "a later broken reference rolls back the preceding venue insert");
    assert_eq!(w.t.db.import_run().count(), 0);
    assert_eq!(w.job().status, JobStatus::Leased);
    assert_eq!(w.run().status, RUNNING);
    w.as_("worker", |ctx| finish_event_import(ctx, job.id, bundle(&run)));
    assert_eq!(w.run().status, READY);
}

#[test]
fn exhausted_retries_report_failure_and_allow_a_new_import() {
    let w = World::new();
    let run = w.start();
    for attempt in 1..=MAX_ATTEMPTS {
        let job = w.lease();
        w.as_("worker", |ctx| fail_job(ctx, job.id, format!("fetch failed {attempt}"), None));
        w.t.clock.set(w.job().not_before.unwrap_or(w.t.clock.now()));
    }
    assert_eq!(w.run().status, FAILED);
    assert_eq!(w.run().error, "fetch failed 3");
    assert_eq!(w.job().status, JobStatus::Dead);
    assert_eq!(w.steps(run.id), ["Queued", "Failed"]);
    assert_ne!(w.start().id, run.id);
}
