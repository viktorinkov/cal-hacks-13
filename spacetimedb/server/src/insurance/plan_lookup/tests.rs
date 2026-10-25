//! A plan lookup inside an in-memory module: the attendee names their plan, the worker finds its PDF
//! or nothing, a found health plan lands on the medical card and a found belongings policy becomes their
//! own policy, a plan already found is found at once for the next attendee, and a lookup that keeps
//! failing ends failed.

use super::*;
use crate::insurance::documents::*;
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
        t.db.staff_role().insert(StaffRole { id: 0, identity: id("worker"), role: "worker".into(), label: "worker".into(), granted_by: id("owner"), granted_at: t.clock.now() });
        t.db.band_owner().insert(BandOwner { band_id: 7, owner: id("alex"), claimed_at: t.clock.now() });
        World { t }
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    fn try_as<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> Result<T, String> {
        self.t.with_reducer_tx(auth(who), f)
    }

    fn lease(&self) -> Job {
        let job = self.t.db.job().iter().filter(|j| j.kind == KIND_PLAN_LOOKUP && j.status == JobStatus::Queued).max_by_key(|j| j.id).expect("a queued plan lookup");
        self.as_("worker", |ctx| claim_job(ctx, job.id));
        job
    }

    fn lookup(&self) -> PlanLookup {
        self.t.db.plan_lookup().iter().max_by_key(|l| l.id).expect("a plan lookup")
    }
}

fn found() -> PlanLookupResult {
    PlanLookupResult {
        status: FOUND.into(),
        source_url: "https://www.blueshieldca.com/sbc/silver-70-ppo-2026.pdf".into(),
        printed_insurer: "Blue Shield of California".into(),
        printed_plan: "Silver 70 PPO 2500/55".into(),
        plan_year: "2026".into(),
        file_hash: "C".repeat(64),
        size_bytes: 412_000,
        page_count: 8,
        note: String::new(),
        matched_chunk: Some(ChunkMatch {
            chunk_id: format!("{}-p1-k1", "c".repeat(64)),
            page: 1,
            text: "  Blue Shield of California: Silver 70 PPO 2500/55 Coverage Period: 01/01/2026 - 12/31/2026  ".into(),
            score: 0.81,
        }),
    }
}

#[test]
fn a_found_health_plan_lands_on_the_medical_card() {
    let w = World::new();
    let health = |who: &str| w.try_as(who, |ctx| look_up_plan(ctx, " Blue Shield  of California ".into(), "Silver 70 PPO".into(), "ca".into()));
    assert_eq!(health("sam").unwrap_err(), "claim your band first");
    health("alex").unwrap();
    let l = w.lookup();
    assert_eq!((l.insurer.as_str(), l.state.as_str(), l.limit_cents, l.status.as_str()), ("Blue Shield of California", "CA", 0, SEARCHING));
    assert_eq!(health("alex").unwrap_err(), "already looking up your plan");

    let job = w.lease();
    let payload: serde_json::Value = serde_json::from_str(&job.payload).unwrap();
    assert_eq!((payload["kind"].as_str(), payload["plan"].as_str()), (Some(HEALTH), Some("Silver 70 PPO")));
    assert!(w.try_as("alex", |ctx| finish_plan_lookup(ctx, job.id, found(), None)).is_err(), "only the worker finishes a lookup");
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, found(), None));

    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.file_hash.as_str(), l.page_count), (FOUND, "c".repeat(64).as_str(), 8));
    let cited = l.matched_chunk.expect("the found plan keeps the chunk its check cites");
    assert_eq!((cited.page, cited.text.as_str()), (1, "Blue Shield of California: Silver 70 PPO 2500/55 Coverage Period: 01/01/2026 - 12/31/2026"));
    let blob = w.t.db.blob_ref().hash().find("c".repeat(64)).unwrap();
    assert_eq!((blob.owner, blob.access.as_str(), blob.purpose.as_str()), (Some(id("alex")), "owner_only", PLAN_WORDING));
    let card = w.t.db.medical_card().attendee().find(id("alex")).unwrap();
    assert_eq!((card.insurer.as_str(), card.plan.as_str()), ("Blue Shield of California", "Silver 70 PPO 2500/55"));
    assert_eq!(w.t.db.job().id().find(job.id).unwrap().status, JobStatus::Done);
    let doc = w.t.db.policy_document().iter().next().expect("the found plan goes to the reading");
    assert_eq!((doc.kind.as_str(), doc.attendee, doc.source.as_str(), doc.page_count), (HEALTH_PLAN, Some(id("alex")), KIND_PLAN_LOOKUP, 8));
}

#[test]
fn a_plan_already_found_is_found_at_once() {
    let w = World::new();
    for (band, who) in [(8, "sam"), (9, "jo"), (10, "kim")] {
        w.t.db.band_owner().insert(BandOwner { band_id: band, owner: id(who), claimed_at: w.t.clock.now() });
    }
    let jobs = || w.t.db.job().iter().filter(|j| j.kind == KIND_PLAN_LOOKUP).count();
    let look = |who: &str, insurer: &str, plan: &str, state: &str| w.as_(who, |ctx| look_up_plan(ctx, insurer.into(), plan.into(), state.into()));
    look("alex", "Blue Shield of California", "Silver 70 PPO", "CA");
    let job = w.lease();
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, found(), None));
    let first = w.lookup();

    look("sam", "blue shield of california", "Silver 70 PPO", "ca");
    let l = w.lookup();
    assert_eq!((l.attendee, l.status.as_str(), l.job_id, l.reused_from), (id("sam"), FOUND, 0, first.id), "the same typed name");
    assert_eq!(l.matched_chunk, first.matched_chunk, "a reused lookup cites the same chunk");
    assert!(l.matched_chunk.is_some());
    assert_eq!((l.file_hash.as_str(), l.page_count, l.printed_plan.as_str()), (first.file_hash.as_str(), 8, "Silver 70 PPO 2500/55"));
    assert_eq!((l.insurer.as_str(), l.source_url.as_str()), ("blue shield of california", first.source_url.as_str()));
    assert_eq!(jobs(), 1, "no search, pick or fetch");
    let card = w.t.db.medical_card().attendee().find(id("sam")).unwrap();
    assert_eq!((card.insurer.as_str(), card.plan.as_str()), ("Blue Shield of California", "Silver 70 PPO 2500/55"));
    let doc = w.t.db.policy_document().iter().find(|d| d.attendee == Some(id("sam"))).expect("the same PDF goes to the reading for sam");
    assert_eq!((doc.file_hash.as_str(), doc.source.as_str(), doc.page_count), (first.file_hash.as_str(), KIND_PLAN_LOOKUP, 8));
    assert_eq!(w.t.db.blob_ref().hash().find(&first.file_hash).unwrap().owner, Some(id("alex")), "one blob, still alex's");

    look("jo", "Blue Shield of California", "Silver 70 PPO 2500/55", "CA");
    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.reused_from), (FOUND, first.id), "the printed name, linked to the lookup that fetched it");

    look("kim", "Blue Shield", "Silver 70", "CA");
    assert_eq!((w.lookup().status.as_str(), jobs()), (SEARCHING, 2), "a shorter name runs its own search");
    let job = w.lease();
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, PlanLookupResult { status: NOT_FOUND.into(), ..Default::default() }, None));
    look("kim", "Blue Shield of California", "Silver 70 PPO", "NV");
    assert_eq!((w.lookup().status.as_str(), jobs()), (SEARCHING, 3), "another state");
    let job = w.lease();
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, PlanLookupResult { status: NOT_FOUND.into(), ..Default::default() }, None));
    w.t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000 + 90 * 86_400_000_000));
    look("kim", "Blue Shield of California", "Silver 70 PPO", "CA");
    assert_eq!((w.lookup().status.as_str(), jobs()), (SEARCHING, 4), "another plan year");
}

#[test]
fn nothing_found_writes_nothing() {
    let w = World::new();
    w.as_("alex", |ctx| look_up_plan(ctx, "Acme Health".into(), "Gold Employer Plan".into(), "NY".into()));
    let job = w.lease();
    let none = PlanLookupResult { status: WRONG_PLAN.into(), note: "2 PDFs came back, none of them Gold Employer Plan".into(), ..Default::default() };
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, none, None));
    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.file_hash.as_str()), (WRONG_PLAN, ""));
    assert!(w.t.db.medical_card().attendee().find(id("alex")).is_none());
    w.as_("alex", |ctx| look_up_plan(ctx, "Acme Health".into(), "Gold".into(), "NY".into()));
}

#[test]
fn a_lookup_that_keeps_failing_ends_failed() {
    let w = World::new();
    w.as_("alex", |ctx| look_up_plan(ctx, "Kaiser Permanente".into(), "Bronze 60 HMO".into(), "CA".into()));
    for attempt in 1..=MAX_ATTEMPTS {
        let job = w.lease();
        w.as_("worker", |ctx| fail_job(ctx, job.id, format!("search failed {attempt}"), None));
        let ready = w.t.db.job().id().find(job.id).unwrap().not_before.unwrap_or(w.t.clock.now());
        w.t.clock.set(ready);
    }
    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.note.as_str()), (FAILED, "search failed 3"));
}

#[test]
fn a_cited_chunk_is_checked() {
    let chunk = |id: &str| ChunkMatch { chunk_id: id.into(), page: 2, text: "Coverage Period: 01/01/2026".into(), score: f32::NAN };
    assert_eq!(checked_match(Some(chunk("ab-p2-k1"))).unwrap().unwrap().score, 0.0, "a score that is not a number is 0");
    assert!(checked_match(Some(chunk("../x"))).is_err());
    assert!(checked_match(Some(ChunkMatch { page: 0, ..chunk("ab-p2-k1") })).is_err());
    let long = ChunkMatch { text: "x".repeat(5000), ..chunk("ab-p2-k1") };
    assert_eq!(checked_match(Some(long)).unwrap().unwrap().text.len(), 1000);
    assert_eq!(checked_match(None).unwrap(), None);
}
