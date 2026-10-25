//! A plan lookup inside an in-memory module: the attendee names their plan, the worker finds its PDF
//! or nothing, a found health plan lands on the medical card and a found belongings policy becomes their
//! own policy, and a lookup that keeps failing ends failed.

use super::*;
use crate::insurance::documents::*;
use crate::insurance::own_policy::*;
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
    }
}

#[test]
fn a_found_health_plan_lands_on_the_medical_card() {
    let w = World::new();
    let health = |who: &str| w.try_as(who, |ctx| look_up_plan(ctx, HEALTH.into(), " Blue Shield  of California ".into(), "Silver 70 PPO".into(), "ca".into(), 999, 1));
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
    let blob = w.t.db.blob_ref().hash().find("c".repeat(64)).unwrap();
    assert_eq!((blob.owner, blob.access.as_str(), blob.purpose.as_str()), (Some(id("alex")), "owner_only", PLAN_WORDING));
    let card = w.t.db.medical_card().attendee().find(id("alex")).unwrap();
    assert_eq!((card.insurer.as_str(), card.plan.as_str()), ("Blue Shield of California", "Silver 70 PPO 2500/55"));
    assert_eq!(w.t.db.job().id().find(job.id).unwrap().status, JobStatus::Done);
    let doc = w.t.db.policy_document().iter().next().expect("the found plan goes to the reading");
    assert_eq!((doc.kind.as_str(), doc.attendee, doc.source.as_str(), doc.page_count), (HEALTH_PLAN, Some(id("alex")), KIND_PLAN_LOOKUP, 8));
}

#[test]
fn a_belongings_policy_needs_the_typed_limit_and_deductible() {
    let w = World::new();
    let ask = |limit: u64, deductible: u64| w.try_as("alex", |ctx| look_up_plan(ctx, BELONGINGS.into(), "Lemonade".into(), "Renters".into(), "CA".into(), limit, deductible));
    assert!(ask(0, 0).unwrap_err().contains("personal property limit"));
    assert_eq!(ask(25_000, 25_000).unwrap_err(), "the deductible must be below the limit");
    assert!(w.try_as("alex", |ctx| look_up_plan(ctx, BELONGINGS.into(), "Lemonade".into(), "Renters".into(), "California".into(), 1_000_000, 25_000)).is_err());
    ask(1_000_000, 25_000).unwrap();
    let l = w.lookup();
    assert_eq!((l.kind.as_str(), l.limit_cents, l.deductible_cents), (BELONGINGS, 1_000_000, 25_000));

    // The found form becomes their own policy with the numbers they typed, marked as found online.
    let job = w.lease();
    let form = PlanLookupResult { printed_insurer: "Lemonade Insurance Company".into(), printed_plan: "Renters Policy CA".into(), page_count: 40, ..found() };
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, form, None));
    let p = w.t.db.attendee_policy().holder().find(id("alex")).unwrap();
    assert_eq!((p.insurer_name.as_str(), p.policy_number.as_str(), p.source.as_str()), ("Lemonade Insurance Company", "Renters Policy CA", KIND_PLAN_LOOKUP));
    assert_eq!((p.per_claim_limit_cents, p.aggregate_limit_cents, p.deductible_cents, p.document_hash.as_str()), (1_000_000, 1_000_000, 25_000, "c".repeat(64).as_str()));
    let doc = w.t.db.policy_document().iter().next().unwrap();
    assert_eq!((doc.kind.as_str(), doc.page_count), (ATTENDEE_POLICY, 40));
}

#[test]
fn nothing_found_writes_nothing() {
    let w = World::new();
    w.as_("alex", |ctx| look_up_plan(ctx, HEALTH.into(), "Acme Health".into(), "Gold Employer Plan".into(), "NY".into(), 0, 0));
    let job = w.lease();
    let none = PlanLookupResult { status: WRONG_PLAN.into(), note: "2 PDFs came back, none of them Gold Employer Plan".into(), ..Default::default() };
    w.as_("worker", |ctx| finish_plan_lookup(ctx, job.id, none, None));
    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.file_hash.as_str()), (WRONG_PLAN, ""));
    assert!(w.t.db.medical_card().attendee().find(id("alex")).is_none());
    w.as_("alex", |ctx| look_up_plan(ctx, HEALTH.into(), "Acme Health".into(), "Gold".into(), "NY".into(), 0, 0));
}

#[test]
fn a_lookup_that_keeps_failing_ends_failed() {
    let w = World::new();
    w.as_("alex", |ctx| look_up_plan(ctx, HEALTH.into(), "Kaiser Permanente".into(), "Bronze 60 HMO".into(), "CA".into(), 0, 0));
    for attempt in 1..=MAX_ATTEMPTS {
        let job = w.lease();
        w.as_("worker", |ctx| fail_job(ctx, job.id, format!("search failed {attempt}"), None));
        let ready = w.t.db.job().id().find(job.id).unwrap().not_before.unwrap_or(w.t.clock.now());
        w.t.clock.set(ready);
    }
    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.note.as_str()), (FAILED, "search failed 3"));
}
