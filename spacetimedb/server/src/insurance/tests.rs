//! The claim paths end to end inside an in-memory module: band flags, the
//! safety watch, the medic, the attendee filing in their own words, the
//! hospital report, the record reader, Elastic and Claude's investigation
//! (played here by the test, through the same reducers the workers call), and
//! the named approver.

use super::evidence::*;
use super::filing::*;
use super::flow::*;
use super::setup::*;
use super::*;
use crate::jobs::*;
use crate::live::decision;
use crate::roles::*;
use crate::safety::*;
use crate::social::tables::*;
use crate::tables::*;
use crate::venue::*;
use crate::vision::*;
use bandit_insurance::payloads::*;
use bandit_insurance::time::micros_at;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, ScheduleAt, Table, TimeDuration};

const PDT: i32 = -420;
const FIRST_AID: &str = include_str!("../../../../fixtures/medical-records/expected/first-aid-wrist.json");
const URGENT_CARE: &str = include_str!("../../../../fixtures/medical-records/expected/urgent-care-wrist.json");
const ANKLE_AT_HOME: &str = include_str!("../../../../fixtures/medical-records/expected/urgent-care-ankle-home.json");
const STATEMENT: &str = "I slipped on a spilled drink by the stage and landed on my right wrist.";

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
        t.clock.set(spacetimedb::Timestamp::from_micros_since_unix_epoch(micros_at(2026, 10, 24, 22, 14, 5, PDT)));
        t.db.owner().insert(Owner { identity: id("owner") });
        for (who, role, label) in [
            ("worker", "worker", "bandit-workers"),
            ("medic", "medic", "Ari Medic"),
            ("ops", "ops", "Ops desk"),
            ("vision", "vision", "bandit-vision"),
            ("tester", "tester", "bandit-claims"),
        ] {
            t.db.staff_role().insert(StaffRole {
                id: 0,
                identity: id(who),
                role: role.into(),
                label: label.into(),
                granted_by: id("owner"),
                granted_at: t.clock.now(),
            });
        }
        for (station, name) in [(101u8, "Main stage"), (102, "Sponsor hall")] {
            t.db.zone().insert(Zone {
                id: 0,
                source_key: format!("zone-{station}"),
                venue_id: 1,
                name: name.into(),
                kind: "floor".into(),
                station_id: station,
                plan_x_m: 0.0,
                plan_y_m: 0.0,
                area_sq_m: 40.0,
                capacity: 200,
                exit_colour: 1,
                description: String::new(),
                updated_at: t.clock.now(),
            });
        }
        for (band, name) in [(3u8, "Maya Chen"), (7, "Jordan Alvarez"), (8, "Sam Patel"), (6, "Lee Park")] {
            t.db.attendee().insert(Attendee {
                identity: id(name),
                node_id: 0,
                display_name: name.into(),
                photo_url: String::new(),
                findable: true,
                person_id: 0,
                organization_id: 0,
                crowd: false,
                created_at: t.clock.now(),
                updated_at: t.clock.now(),
            });
            t.db.band_owner().insert(BandOwner { band_id: band.into(), owner: id(name), claimed_at: t.clock.now() });
        }
        for b in 1..=9u8 {
            t.db.band().insert(band(b, 101));
        }
        let w = World { t };
        w.as_("ops", |ctx| {
            let start = spacetimedb::Timestamp::from_micros_since_unix_epoch(micros_at(2026, 10, 1, 0, 0, 0, PDT));
            upsert_insurance_policy(ctx, "GL-2026-04417".into(), "Northwind Mutual".into(), "claims@northwind.test".into(), start, start + TimeDuration::from_micros(365 * 86_400_000_000))?;
            upsert_coverage_rule(ctx, "GL-2026-04417".into(), "medical_payments".into(), vec!["sos".into(), "fall".into()], 500_000, 2_500_000, 0, 365, true)?;
            upsert_coverage_rule(ctx, "GL-2026-04417".into(), "property".into(), vec!["property".into()], 1_000_000, 5_000_000, 50_000, 0, true)
        });
        w
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&spacetimedb::ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    fn try_as<T>(&self, who: &str, f: impl FnOnce(&spacetimedb::ReducerContext) -> Result<T, String>) -> Result<T, String> {
        self.t.with_reducer_tx(auth(who), f)
    }

    fn advance(&self, secs: i64) {
        self.t.clock.advance(TimeDuration::from_micros(secs * 1_000_000));
    }

    fn set_band(&self, b: u8, f: impl FnOnce(&mut Band)) {
        let mut row = self.t.db.band().id().find(u32::from(b)).unwrap();
        f(&mut row);
        self.t.db.band().id().update(row);
    }

    fn watch(&self) {
        let timer = IncidentWatchTimer { scheduled_id: 0, scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(500_000)) };
        self.t.with_reducer_tx(TestAuth::internal(), |ctx| watch_bands(ctx, timer)).unwrap();
    }

    /// The subject band falls in `station`; `circle` bands light up blue in their own stations.
    fn fall(&self, subject: u8, station: u8, circle: &[(u8, u8)]) -> u64 {
        self.set_band(subject, |b| {
            b.fall = true;
            b.zone = station;
            b.state = 3;
        });
        self.watch();
        for (b, s) in circle {
            self.set_band(*b, |r| {
                r.state = S_NEAR_SOS;
                r.zone = *s;
            });
        }
        self.advance(1);
        self.watch();
        for (b, _) in circle {
            self.set_band(*b, |r| r.state = 0);
        }
        self.set_band(subject, |b| {
            b.fall = false;
            b.state = 0;
        });
        self.t.db.incident().subject_band().filter(u32::from(subject)).max_by_key(|i| i.id).unwrap().id
    }

    /// The medic treats and resolves the incident; no claim opens until the wearer files.
    fn treat_and_resolve(&self, incident_id: u64) -> u64 {
        self.as_("medic", |ctx| assign_medic(ctx, incident_id));
        self.advance(12 * 60);
        self.as_("medic", |ctx| add_incident_note(ctx, incident_id, "wrist wrapped, cold pack, first aid".into(), None));
        self.advance(5 * 60);
        self.as_("medic", |ctx| resolve_incident(ctx, incident_id, "treated on site".into()));
        assert!(self.t.db.claim().incident_id().find(incident_id).is_none(), "an injury claim opened on resolve");
        incident_id
    }

    /// Staff file the claim for the wearer, choosing the hospital report (`pdf` for none).
    fn file_for(&self, incident_id: u64, report: &str) -> Claim {
        self.as_("ops", |ctx| file_claim_for_wearer(ctx, incident_id, STATEMENT.into(), report.into()));
        self.t.db.claim().incident_id().find(incident_id).expect("claim filed")
    }

    /// Treated, resolved and filed by staff with no hospital report; the record PDF is filed by hand.
    fn injury_claim(&self, incident_id: u64) -> Claim {
        self.file_for(self.treat_and_resolve(incident_id), "pdf")
    }

    fn report_for(&self, claim_id: u64) -> ClinicReport {
        self.t.db.clinic_report().claim_id().filter(claim_id).next().expect("hospital report requested")
    }

    /// The worker writes the hospital report as `json` and hands it back.
    fn send_report(&self, claim_id: u64, json: &str) -> ClinicReport {
        let job = self.lease(KIND_CLINIC, claim_id);
        let hash = format!("{:064x}", claim_id * 104_729);
        self.as_("worker", |ctx| file_clinic_report(ctx, job.id, json.into(), hash.clone(), call("clinic_report")));
        self.report_for(claim_id)
    }

    fn view(&self, who: &str) -> spacetimedb::ViewContext {
        self.t.view_context(auth(who))
    }

    fn claim(&self, claim_id: u64) -> Claim {
        self.t.db.claim().id().find(claim_id).unwrap()
    }

    fn open_job(&self, kind: &str, claim_id: u64) -> Job {
        self.t
            .db
            .job()
            .iter()
            .filter(|j| j.kind == kind && j.subject_id == claim_id && j.status == JobStatus::Queued)
            .max_by_key(|j| j.id)
            .unwrap_or_else(|| panic!("no queued {kind} job for claim {claim_id}"))
    }

    fn lease(&self, kind: &str, claim_id: u64) -> Job {
        let job = self.open_job(kind, claim_id);
        self.as_("worker", |ctx| claim_job(ctx, job.id));
        job
    }

    fn file_record(&self, claim_id: u64, json: &str, pages: u32) {
        let hash = format!("{:064x}", claim_id * 7919 + json.len() as u64);
        self.file_record_hash(claim_id, json, pages, &hash);
    }

    fn file_record_hash(&self, claim_id: u64, json: &str, pages: u32, hash: &str) {
        self.as_("medic", |ctx| register_blob(ctx, hash.into(), None, "owner_only".into(), "medical".into(), "application/pdf".into(), 1000));
        self.as_("medic", |ctx| submit_medical_record(ctx, claim_id, hash.into(), pages));
        let job = self.lease(KIND_RECORD_EXTRACT, claim_id);
        self.as_("worker", |ctx| apply_medical_record(ctx, job.id, json.into(), call("claim_record_extract")));
    }

    fn verify(&self, claim_id: u64) {
        let job = self.lease(KIND_VERIFY, claim_id);
        let checks = vec![CheckIn { name: "elastic_validation".into(), result: "pass".into(), detail: "0 validation errors".into() }];
        let precedents = vec![PrecedentIn {
            reference: "history-03".into(),
            outcome: "approved".into(),
            payout_cents: 15_000,
            narrative: "Fall in zone Main stage left at 22:10; wrist sprain S63.5; first aid only.".into(),
            score: 0.81,
        }];
        self.as_("worker", |ctx| submit_claim_checks(ctx, job.id, checks, precedents));
    }

    /// Claude's investigation: one step reported while it runs, then the
    /// decision `decide` makes from the payload, after reading `read`.
    fn investigate(&self, claim_id: u64, read: &[&str], decide: impl FnOnce(&ReviewPayload) -> serde_json::Value) {
        let job = self.lease(KIND_REVIEW, claim_id);
        let p: ReviewPayload = serde_json::from_str(&job.payload).unwrap();
        self.as_("worker", |ctx| report_claim_step(ctx, job.id, "Claude".into(), "Read the light circle: 2 fact(s)".into(), "who was around".into()));
        let investigation = serde_json::json!({ "decision": decide(&p), "steps": [], "sources_read": read });
        self.as_("worker", |ctx| submit_claim_review(ctx, job.id, investigation.to_string(), call("claim_investigation")));
    }

    /// Claude reads the evidence a payment needs and decides to pay.
    fn claude_pays(&self, claim_id: u64) {
        self.investigate(claim_id, &["band", "light_circle", "hospital_report", "camera"], |p| decision(p, "pay"));
    }

    /// The decision history of a claim, oldest first: (actor, what).
    fn history(&self, claim_id: u64) -> Vec<(String, String)> {
        let mut rows: Vec<crate::live::Decision> = self.t.db.decision().claim_id().filter(claim_id).collect();
        rows.sort_by_key(|d| d.id);
        rows.into_iter().map(|d| (d.actor, d.what)).collect()
    }

    /// The worker's Nessie deposit for an injury payout.
    fn pay(&self, claim_id: u64) {
        assert_eq!(self.claim(claim_id).status, ClaimStatus::Paying);
        let job = self.lease(KIND_PAYOUT, claim_id);
        let p: PayoutPayload = serde_json::from_str(&job.payload).unwrap();
        assert_eq!(p.payout_cents, self.claim(claim_id).payout_cents);
        self.as_("worker", |ctx| record_claim_payout(ctx, job.id, "cust-1".into(), "acct-1".into(), format!("dep-{claim_id}")));
    }

    fn ledger(&self, claim_id: u64) -> Vec<(String, String, u64, u64)> {
        let mut rows: Vec<LedgerEntry> = self.t.db.ledger_entry().claim_id().filter(claim_id).collect();
        rows.sort_by_key(|e| e.id);
        rows.into_iter().map(|e| (e.journal, e.account, e.debit_cents, e.credit_cents)).collect()
    }
}

/// A decision Claude could send, citing the payload's first fact: one finding
/// from the light circle that supports the claim. Tests change what they need.
fn decision(p: &ReviewPayload, choice: &str) -> serde_json::Value {
    let fact = p.facts[0].seq;
    serde_json::json!({
        "decision": choice, "causation": "supported",
        "summary": "The band, the light circle and the medic note agree.",
        "findings": [{ "source": "light_circle", "stance": "supports", "detail": "the witnesses were in the zone", "fact_ids": [fact] }],
        "trusted_source": "", "concerns": [], "innocent_explanations": [], "missing_evidence": [],
        "refusal_checks": [], "question": "", "cited_fact_ids": [fact]
    })
}

fn band(id: u8, station: u8) -> Band {
    Band {
        id: id.into(),
        state: 0,
        flags: 0,
        neigh: 4,
        zone: station,
        bat: 90,
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
        last_seen: spacetimedb::Timestamp::from_micros_since_unix_epoch(micros_at(2026, 10, 24, 22, 14, 5, PDT)),
        x_m: 0.0,
        y_m: 0.0,
        booth_id: 0,
    }
}

fn call(kind: &str) -> ModelCallIn {
    ModelCallIn { kind: kind.into(), model_requested: "claude-opus-5-5".into(), model_used: "claude-opus-5-5".into(), status: "ok".into(), ..Default::default() }
}

/// Jordan's urgent-care visit: covered $895.00 after the fee schedule, with no
/// rule yet, so it goes to the organizer. The approval teaches the rule that
/// settles the next small fall on its own.
fn approve_larger_fall(w: &World) -> Claim {
    let incident = w.fall(7, 101, &[(2, 101), (4, 101), (9, 101)]);
    let claim = w.injury_claim(incident);
    assert_eq!(claim.status, ClaimStatus::AwaitingRecord);
    assert_eq!(claim.claimant_name, "Jordan Alvarez");
    w.file_record(claim.id, URGENT_CARE, 2);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Verifying);
    assert_eq!((c.cost_cents, c.payout_cents, c.recoverable_cents), (89_500, 89_500, 89_500));
    assert_eq!(c.corroboration, "corroborated");
    w.verify(claim.id);
    w.claude_pays(claim.id);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed, "{}", c.status_note);
    assert!(c.status_note.starts_with("Claude would pay $895.00"), "{}", c.status_note);
    assert_eq!((c.routed_to_role.as_str(), c.routed_to_name.as_str(), c.routed_to), ("ops", "Organizer", Identity::ZERO));

    let stale = w.try_as("ops", |ctx| approve_claim(ctx, c.id, c.payout_cents, "0".repeat(64), None, true));
    assert!(stale.unwrap_err().starts_with("stale"));
    assert!(w.try_as("medic", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true)).is_err());
    w.as_("ops", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true));
    w.pay(claim.id);
    w.claim(claim.id)
}

#[test]
fn larger_fall_goes_to_the_organizer() {
    let w = World::new();
    let c = approve_larger_fall(&w);
    assert_eq!(c.status, ClaimStatus::Settled);
    assert_eq!(c.decided_by, "approver");
    let rule = w.t.db.settlement_rule().iter().find(|r| r.status == "active").unwrap();
    assert_eq!((rule.incident_kind.as_str(), rule.ceiling_cents, rule.version, rule.approver_name.as_str()), ("fall", 89_500, 1, "Ops desk"));
    assert_eq!(
        w.ledger(c.id),
        [
            ("J1 reserve".into(), "claims_expense".into(), 89_500, 0),
            ("J1 reserve".into(), "claims_reserve".into(), 0, 89_500),
            ("J2 receivable".into(), "insurer_receivable".into(), 89_500, 0),
            ("J2 receivable".into(), "claims_expense".into(), 0, 89_500),
            ("J3 claimant payment".into(), "claims_reserve".into(), 89_500, 0),
            ("J3 claimant payment".into(), "cash".into(), 0, 89_500),
        ]
    );
    w.open_job(KIND_DRAFT, c.id);
    w.as_("ops", |ctx| record_insurer_payment(ctx, c.id, 89_500, "NWM-55120".into()));
    assert_eq!(w.claim(c.id).status, ClaimStatus::Reconciled);
}

#[test]
fn small_fall_settles_automatically_under_the_learned_rule() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let incident = w.fall(3, 101, &[(1, 101), (5, 101)]);
    let claim = w.injury_claim(incident);
    assert_eq!(claim.claimant_name, "Maya Chen");
    w.file_record(claim.id, FIRST_AID, 1);
    assert_eq!(w.claim(claim.id).payout_cents, 18_000);
    w.verify(claim.id);
    w.claude_pays(claim.id);
    w.pay(claim.id);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Settled, "{}", c.status_note);
    assert_eq!((c.decided_by.as_str(), c.settlement_rule_version), ("claude", 1));
    let history = w.history(c.id);
    assert!(history.contains(&("Claude".into(), "Read the light circle: 2 fact(s)".into())), "{history:?}");
    assert!(history.iter().any(|(a, w)| a == "Decision Engine" && w == "Paid on Claude's decision: $180.00 to Maya Chen"), "{history:?}");
    assert_eq!(c.payout_reference, format!("Nessie deposit dep-{}", c.id));
    let account = w.t.db.claimant_account().identity().find(id("Maya Chen")).unwrap();
    assert_eq!(account.account_id, "acct-1");
    assert_eq!(w.t.db.approval().claim_id().filter(c.id).count(), 0);
}

/// A gap in the policy is decided one by one: approving Jordan's claim over the
/// per-claim limit teaches no rule, and Maya's claim over the same limit shows
/// that decision to the organizer without applying it.
#[test]
fn a_claim_over_the_policy_limit_teaches_no_rule_and_shows_the_last_decision() {
    let w = World::new();
    w.as_("ops", |ctx| upsert_coverage_rule(ctx, "GL-2026-04417".into(), "medical_payments".into(), vec!["sos".into(), "fall".into()], 15_000, 2_500_000, 0, 365, true));
    let incident = w.fall(7, 101, &[(2, 101), (4, 101), (9, 101)]);
    let jordan = w.injury_claim(incident).id;
    w.file_record(jordan, URGENT_CARE, 2);
    w.verify(jordan);
    w.claude_pays(jordan);
    let c = w.claim(jordan);
    assert_eq!(c.status, ClaimStatus::Routed, "{}", c.status_note);
    assert_eq!(c.status_note, "Complication: the covered cost $895.00 is over the policy's limit, which pays at most $150.00. Claude would pay $150.00");
    w.as_("ops", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true));
    w.pay(jordan);
    assert_eq!(w.claim(jordan).status, ClaimStatus::Settled);
    assert_eq!(w.t.db.settlement_rule().iter().count(), 0, "a gap in the policy teaches no rule");
    assert!(w.history(jordan).contains(&("organizer".into(), "Precedent, over the policy's limit: approved $150.00 for Jordan Alvarez".into())));

    w.advance(3600);
    let incident = w.fall(3, 101, &[(1, 101), (5, 101)]);
    let maya = w.injury_claim(incident).id;
    w.file_record(maya, FIRST_AID, 1);
    w.verify(maya);
    w.claude_pays(maya);
    let c = w.claim(maya);
    assert_eq!(c.status, ClaimStatus::Routed, "the precedent is shown, never applied: {}", c.status_note);
    assert_eq!(
        c.status_note,
        format!(
            "Complication: the covered cost $180.00 is over the policy's limit, which pays at most $150.00. Claude would pay $150.00. \
             Precedent, not applied: Ops desk approved $150.00 for Jordan Alvarez (claim {jordan})"
        )
    );
}

#[test]
fn claude_flags_an_injury_that_happened_at_home_for_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let incident = w.fall(8, 101, &[(1, 101), (5, 101)]);
    let claim = w.injury_claim(incident);
    w.file_record(claim.id, ANKLE_AT_HOME, 2);
    w.verify(claim.id);
    let version = w.claim(claim.id).pack_version;
    let checks = w.as_("ops", |ctx| Ok(pack_checks(ctx, claim.id, version)));
    assert!(checks.iter().all(|c| c.result != bandit_insurance::CheckResult::Fail), "{checks:?}");
    w.investigate(claim.id, &["band", "light_circle", "hospital_report"], |p| {
        let mut d = decision(p, "refuse");
        let at_home = "the record says the ankle was hurt playing basketball at home the day before";
        d["causation"] = "unsupported".into();
        d["findings"] = serde_json::json!([{ "source": "hospital_report", "stance": "contradicts", "detail": at_home, "fact_ids": [p.facts[0].seq] }]);
        d["concerns"] = serde_json::json!([{ "kind": "causation", "detail": at_home, "fact_ids": [p.facts[0].seq] }]);
        d
    });
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed, "every check passed, so a refusal on Claude's judgment goes to a person");
    assert!(c.status_note.starts_with("Claude recommends refusing: causation: the record says"), "{}", c.status_note);
    assert!(c.status_note.ends_with("Every check passed, so a person decides"), "{}", c.status_note);
    assert_eq!(c.routed_to_name, "Organizer");
}

#[test]
fn a_circle_in_another_zone_disputes_the_fall() {
    let w = World::new();
    let incident = w.fall(6, 101, &[(1, 102), (2, 102), (4, 102)]);
    let claim = w.injury_claim(incident);
    assert_eq!(claim.status, ClaimStatus::Verifying, "disputed evidence goes to Claude without waiting for a record");
    w.verify(claim.id);
    w.investigate(claim.id, &["band", "light_circle"], |p| {
        let mut d = decision(p, "refuse");
        d["causation"] = "unsupported".into();
        d["findings"][0]["stance"] = "contradicts".into();
        d["findings"][0]["detail"] = "every witness band lit up in Sponsor row, not Main stage".into();
        d["refusal_checks"] = serde_json::json!(["witness_zone"]);
        d
    });
    let c = w.claim(claim.id);
    assert_eq!((c.status, c.decided_by.as_str()), (ClaimStatus::Refused, "claude"), "{}", c.status_note);
    assert!(c.refusal_reason.starts_with("Claude refused: failed witness_zone"), "{}", c.refusal_reason);
    assert!(w.ledger(claim.id).is_empty());
}

#[test]
fn claude_cannot_pay_a_disputed_fall() {
    let w = World::new();
    let claim = w.injury_claim(w.fall(6, 101, &[(1, 102), (2, 102), (4, 102)]));
    w.verify(claim.id);
    w.investigate(claim.id, &["band", "light_circle"], |p| {
        let mut d = decision(p, "pay");
        d["trusted_source"] = "the medic saw the fall".into();
        d
    });
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert!(c.status_note.starts_with("Claude would pay $0.00, but checks failed: witness_zone"), "{}", c.status_note);
}

#[test]
fn a_decision_that_breaks_the_rules_is_set_aside() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let claim = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record(claim.id, FIRST_AID, 1);
    w.verify(claim.id);
    w.investigate(claim.id, &["band"], |p| decision(p, "pay"));
    let c = w.claim(claim.id);
    assert_eq!((c.status, c.review_verdict.as_str()), (ClaimStatus::Routed, "invalid"), "{}", c.status_note);
    let review = w.t.db.claim_review().claim_id().filter(c.id).last().unwrap();
    assert!(review.rejected.iter().any(|r| r.starts_with("pay without reading the light circle")), "{:?}", review.rejected);
    assert!(w.history(c.id).iter().any(|(a, w)| a == "Decision Engine" && w == "Set Claude's decision aside"));
}

#[test]
fn only_claude_and_the_evidence_engine_report_investigation_steps() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let claim = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record(claim.id, FIRST_AID, 1);
    w.verify(claim.id);
    let job = w.lease(KIND_REVIEW, claim.id);
    let spoof = w.try_as("worker", |ctx| report_claim_step(ctx, job.id, "organizer".into(), "Approved".into(), String::new()));
    assert!(spoof.unwrap_err().contains("does not investigate claims"));
    w.as_("worker", |ctx| report_claim_step(ctx, job.id, "Evidence Engine".into(), "Past fall claims: 12 approved".into(), "base rates".into()));
    assert!(w.history(claim.id).contains(&("Evidence Engine".into(), "Past fall claims: 12 approved".into())));
}

#[test]
fn the_same_record_filed_twice_goes_to_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    let hash = "ab".repeat(32);
    let first = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(first.id, FIRST_AID, 1, &hash);
    w.advance(3600);
    let second = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(second.id, FIRST_AID, 1, &hash);
    w.verify(second.id);
    w.claude_pays(second.id);
    let c = w.claim(second.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert!(c.status_note.contains("record_duplicate"), "{}", c.status_note);
}

#[test]
fn broken_speaker_with_camera_evidence_and_a_recovery_query() {
    let w = World::new();
    let zone = w.t.db.zone().station_id().filter(101u8).next().unwrap().id;
    w.as_("vision", |ctx| upsert_camera(ctx, "overhead pit".into(), zone, "overhead".into()));
    w.as_("ops", |ctx| open_incident(ctx, "property".into(), zone, 0, "speaker knocked off its stand at Main stage".into()));
    let incident = w.t.db.incident().iter().find(|i| i.kind == IncidentKind::Property).unwrap();
    let cam = w.t.db.camera().iter().next().unwrap().id;
    let frame_at = w.t.clock.now();
    w.as_("vision", |ctx| report_property_event(ctx, incident.id, cam, "fallen_object".into(), "a speaker lies on the floor".into(), 0.9, vec!["cd".repeat(32)]));
    w.as_("vision", |ctx| {
        submit_vision_assessment(
            ctx,
            incident.id,
            "staff_button".into(),
            true,
            0.9,
            "speaker on its side".into(),
            "rope off the area".into(),
            "a speaker fell".into(),
            cam,
            vec!["cd".repeat(32)],
            vec![frame_at],
            0,
        )
    });
    w.advance(600);
    w.as_("ops", |ctx| add_incident_note(ctx, incident.id, "repair estimate from the AV vendor".into(), Some(240_000)));
    w.as_("ops", |ctx| resolve_incident(ctx, incident.id, "area cleared".into()));
    let claim = w.t.db.claim().incident_id().find(incident.id).unwrap();
    assert_eq!(claim.status, ClaimStatus::Verifying);
    assert_eq!((claim.payout_cents, claim.recoverable_cents, claim.venue_cost_cents), (240_000, 190_000, 50_000));
    assert_eq!(claim.corroboration, "corroborated");
    w.verify(claim.id);
    w.claude_pays(claim.id);
    let c = w.claim(claim.id);
    assert_eq!((c.status, c.routed_to_name.as_str()), (ClaimStatus::Routed, "Organizer"));
    w.as_("ops", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true));
    w.as_("ops", |ctx| request_recovery_letter(ctx, c.id, "Stagecraft AV".into(), "ops@stagecraft.test".into()));
    let job = w.open_job(KIND_RECOVERY, c.id);
    let p: RecoveryPayload = serde_json::from_str(&job.payload).unwrap();
    assert_eq!(p.letter.amounts.venue_cost_cents, 50_000);
}

#[test]
fn a_dead_review_job_sends_the_claim_to_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    let claim = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record(claim.id, FIRST_AID, 1);
    w.verify(claim.id);
    for _ in 0..MAX_ATTEMPTS {
        let job = w.lease(KIND_REVIEW, claim.id);
        w.as_("worker", |ctx| fail_job(ctx, job.id, "Claude unavailable".into(), None));
        w.advance(60);
    }
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert_eq!(c.status_note, "claims agent review unavailable");
}

#[test]
fn injured_staff_are_excluded_from_medical_payments() {
    let w = World::new();
    w.t.db.staff_role().insert(StaffRole { id: 0, identity: id("Lee Park"), role: "medic".into(), label: "Lee Park".into(), granted_by: id("owner"), granted_at: w.t.clock.now() });
    let claim = w.injury_claim(w.fall(6, 101, &[(1, 101), (2, 101)]));
    assert_eq!(claim.status, ClaimStatus::Refused);
    assert!(claim.refusal_reason.starts_with("medical payments cover excludes staff: Lee Park holds the staff role medic"), "{}", claim.refusal_reason);
}

#[test]
fn three_people_hurt_at_once_go_to_the_organizer_on_one_notice() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let a = w.fall(3, 101, &[(1, 101), (5, 101)]);
    w.advance(30);
    let b = w.fall(8, 101, &[(1, 101), (5, 101)]);
    w.advance(30);
    let c = w.fall(6, 101, &[(1, 101), (5, 101)]);
    let first = w.injury_claim(a);
    w.injury_claim(b);
    w.injury_claim(c);
    w.file_record(first.id, FIRST_AID, 1);
    w.verify(first.id);
    w.claude_pays(first.id);
    let claim = w.claim(first.id);
    assert_eq!((claim.status, claim.routed_to_name.as_str()), (ClaimStatus::Routed, "Organizer"));
    assert!(claim.status_note.starts_with("3 people hurt in Main stage"), "{}", claim.status_note);
    w.as_("ops", |ctx| approve_claim(ctx, claim.id, claim.payout_cents, claim.pack_hash.clone(), None, false));
    w.pay(claim.id);
    let p: DraftPayload = serde_json::from_str(&w.open_job(KIND_DRAFT, claim.id).payload).unwrap();
    assert_eq!(p.letter.related_claims.len(), 2, "{:?}", p.letter.related_claims);
    assert!(bandit_insurance::letters::fnol_template(&p.letter).contains("Sam Patel"));
}

#[test]
fn the_same_invoice_on_another_claim_goes_to_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let first = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(first.id, FIRST_AID, 1, &"ab".repeat(32));
    w.advance(3600);
    let second = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(second.id, FIRST_AID, 1, &"cd".repeat(32));
    let version = w.claim(second.id).pack_version;
    let checks = w.as_("ops", |ctx| Ok(pack_checks(ctx, second.id, version)));
    let dup = checks.iter().find(|c| c.name == "record_duplicate").unwrap();
    assert_eq!(dup.result, bandit_insurance::CheckResult::Fail);
    assert!(dup.detail.starts_with("invoice FA-1024-0007"), "{}", dup.detail);
}

#[test]
fn test_bands_raise_incidents_without_the_bridge() {
    let w = World::new();
    assert!(w.try_as("tester", |ctx| report_test_band(ctx, 7, 101, 3, 4, false, true, false)).is_err());
    w.as_("tester", |ctx| report_test_band(ctx, 95, 101, 3, 4, false, true, false));
    for b in [96u8, 97] {
        w.as_("tester", |ctx| report_test_band(ctx, b, 101, S_NEAR_SOS, 5, false, false, false));
    }
    w.watch();
    w.advance(1);
    w.watch();
    let incident = w.t.db.incident().subject_band().filter(95u32).next().expect("incident from a test band fall");
    assert_eq!(incident.kind, IncidentKind::Fall);
    assert_eq!(w.t.db.incident_band().incident_id().filter(incident.id).filter(|r| r.role == "witness").count(), 2);
    assert!(w.t.db.event().iter().any(|e| e.band_id == 95 && e.kind == EventKind::Fall));
}

#[test]
fn a_medic_tap_opens_the_card_without_an_incident() {
    use crate::medical::*;
    let w = World::new();
    assert!(w.try_as("ops", |ctx| request_medical_card(ctx, 3)).is_err());
    w.as_("medic", |ctx| request_medical_card(ctx, 3));
    let read = w.t.db.medical_access_log().reader().filter(id("medic")).next().unwrap();
    assert_eq!((read.attendee, read.incident_id, read.granted), (id("Maya Chen"), 0, true));
}

#[test]
fn resolving_an_injury_waits_for_the_wearer_to_file() {
    let w = World::new();
    let incident = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    let err = w.try_as("Jordan Alvarez", |ctx| file_claim(ctx, incident, STATEMENT.into())).unwrap_err();
    assert!(err.starts_with("only the person who wore band 3"), "{err}");
    assert!(w.try_as("ops", |ctx| file_claim(ctx, incident, STATEMENT.into())).is_err());
    assert!(w.try_as("Maya Chen", |ctx| file_claim(ctx, incident, "   ".into())).is_err());
    assert!(w.try_as("Maya Chen", |ctx| file_claim(ctx, incident, "x".repeat(2001))).is_err());
    w.as_("Maya Chen", |ctx| file_claim(ctx, incident, format!("  {STATEMENT}\n")));
    let claim = w.t.db.claim().incident_id().find(incident).unwrap();
    assert_eq!((claim.status, claim.status_note.as_str()), (ClaimStatus::AwaitingRecord, "waiting for the hospital report"));
    assert_eq!((claim.claimant, claim.claimant_name.as_str(), claim.statement.as_str()), (Some(id("Maya Chen")), "Maya Chen", STATEMENT));

    let report = w.report_for(claim.id);
    assert_eq!((report.choice.as_str(), report.status.as_str(), report.requested_by), ("random", "requested", id("Maya Chen")));
    let job = w.open_job(KIND_CLINIC, claim.id);
    assert_eq!(report.job_id, job.id);
    let p: ClinicPayload = serde_json::from_str(&job.payload).unwrap();
    assert_eq!((p.claim_id, p.report_id, p.scenario.as_str(), p.visit_date.as_str()), (claim.id, report.id, report.scenario.as_str(), report.visit_date.as_str()));
    assert_eq!((p.statement.as_str(), p.claimant_name.as_str(), p.incident_kind.as_str(), p.zone_name.as_str()), (STATEMENT, "Maya Chen", "fall", "Main stage"));
    assert_eq!((p.incident_date.as_str(), p.incident_time.as_str(), p.venue_name.as_str()), ("2026-10-24", "22:14", "Cal Hacks 13.0"));
    assert_eq!(p.medic_notes, ["wrist wrapped, cold pack, first aid"]);
    let facts = w.as_("ops", |ctx| Ok(pack_facts(ctx, claim.id, claim.pack_version)));
    assert!(facts.iter().any(|f| f.key == "claimant_statement" && f.value == STATEMENT), "{facts:?}");

    let err = w.try_as("Maya Chen", |ctx| file_claim(ctx, incident, STATEMENT.into())).unwrap_err();
    assert!(err.contains("already has a claim"), "{err}");
}

#[test]
fn staff_choose_the_hospital_report() {
    let w = World::new();
    let first = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    assert!(w.try_as("Maya Chen", |ctx| file_claim_for_wearer(ctx, first, STATEMENT.into(), "matches".into())).is_err());
    assert!(w.try_as("ops", |ctx| file_claim_for_wearer(ctx, first, STATEMENT.into(), "fake".into())).is_err());
    let matched = w.report_for(w.file_for(first, "matches").id);
    assert_eq!((matched.scenario.as_str(), matched.choice.as_str(), matched.visit_date.as_str()), ("matches", "matches", "2026-10-24"));

    w.advance(3600);
    let second = w.treat_and_resolve(w.fall(7, 101, &[(1, 101), (5, 101)]));
    w.as_("medic", |ctx| file_claim_for_wearer(ctx, second, STATEMENT.into(), "mismatch".into()));
    let claim = w.t.db.claim().incident_id().find(second).unwrap();
    let mismatch = w.report_for(claim.id);
    let scenario = bandit_insurance::clinic::Scenario::parse(&mismatch.scenario).unwrap();
    assert!(!scenario.matches(), "{}", mismatch.scenario);
    assert_eq!(claim.claimant_name, "Jordan Alvarez");

    w.advance(3600);
    let third = w.treat_and_resolve(w.fall(8, 101, &[(1, 101), (5, 101)]));
    let claim = w.file_for(third, "pdf");
    assert_eq!((claim.status, claim.status_note.as_str()), (ClaimStatus::AwaitingRecord, "waiting for the medical record"));
    assert!(w.t.db.clinic_report().claim_id().filter(claim.id).next().is_none());
    assert!(w.t.db.job().iter().all(|j| !(j.kind == KIND_CLINIC && j.subject_id == claim.id)));

    let zone = w.t.db.zone().station_id().filter(101u8).next().unwrap().id;
    w.as_("ops", |ctx| open_incident(ctx, "property".into(), zone, 0, "a chair broke".into()));
    let property = w.t.db.incident().iter().find(|i| i.kind == IncidentKind::Property).unwrap().id;
    w.as_("ops", |ctx| resolve_incident(ctx, property, "chair removed".into()));
    let err = w.try_as("ops", |ctx| file_claim_for_wearer(ctx, property, STATEMENT.into(), "random".into())).unwrap_err();
    assert!(err.contains("not an injury"), "{err}");
}

#[test]
fn a_matching_hospital_report_moves_the_claim_on() {
    let w = World::new();
    let claim = w.file_for(w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)])), "matches");
    let report = w.send_report(claim.id, FIRST_AID);
    assert_eq!((report.status.as_str(), report.provider_name.as_str()), ("received", "Event Medical Station - Cal Hacks 13.0"));
    assert!(report.problems.is_empty() && report.received_at.is_some() && report.model_call_id != 0);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Verifying, "{}", c.status_note);
    assert_eq!(c.payout_cents, 18_000);
    let record = w.t.db.medical_record().claim_id().filter(claim.id).next().unwrap();
    assert_eq!((record.status.as_str(), record.page_count, record.file_hash.as_str()), ("extracted", 2, report.file_hash.as_str()));
    assert_eq!(record.job_id, report.job_id);
    w.verify(claim.id);
    let p: ReviewPayload = serde_json::from_str(&w.open_job(KIND_REVIEW, claim.id).payload).unwrap();
    assert_eq!(p.claimant_statement, STATEMENT);
}

#[test]
fn a_hospital_report_off_its_case_goes_to_a_person() {
    let w = World::new();
    let claim = w.file_for(w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)])), "matches");
    let report = w.send_report(claim.id, &FIRST_AID.replace("2026-10-24", "2026-10-23"));
    assert_eq!(report.status, "failed");
    assert!(report.problems.iter().any(|p| p.contains("visit date must be 2026-10-24")), "{:?}", report.problems);
    let c = w.claim(claim.id);
    assert_eq!((c.status, c.routed_to_name.as_str()), (ClaimStatus::Routed, "Organizer"));
    assert!(c.status_note.starts_with("the hospital report could not be read: "), "{}", c.status_note);
    assert_eq!(w.t.db.medical_record().claim_id().filter(claim.id).count(), 0);
    assert_eq!(w.t.db.job().id().find(report.job_id).unwrap().status, JobStatus::Done);
}

#[test]
fn a_hospital_report_that_never_arrives_goes_to_a_person() {
    let w = World::new();
    let claim = w.file_for(w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)])), "random");
    for _ in 0..MAX_ATTEMPTS {
        let job = w.lease(KIND_CLINIC, claim.id);
        w.as_("worker", |ctx| fail_job(ctx, job.id, "the writer is unavailable".into(), None));
        w.advance(60);
    }
    assert_eq!(w.report_for(claim.id).status, "failed");
    let c = w.claim(claim.id);
    assert_eq!((c.status, c.status_note.as_str()), (ClaimStatus::Routed, "the hospital report did not arrive; a person must file the record"));
}

#[test]
fn a_hospital_report_after_a_filed_record_only_finishes_its_job() {
    let w = World::new();
    let claim = w.file_for(w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)])), "matches");
    w.file_record(claim.id, FIRST_AID, 1);
    assert_eq!(w.claim(claim.id).status, ClaimStatus::Verifying);
    let report = w.send_report(claim.id, FIRST_AID);
    assert_eq!(report.status, "requested");
    assert_eq!(w.t.db.job().id().find(report.job_id).unwrap().status, JobStatus::Done);
    assert_eq!(w.claim(claim.id).status, ClaimStatus::Verifying);
    assert_eq!(w.t.db.medical_record().claim_id().filter(claim.id).count(), 1);
}

#[test]
fn about_half_the_hospital_reports_match() {
    let w = World::new();
    let zone = w.t.db.zone().station_id().filter(101u8).next().unwrap().id;
    let n = 120;
    let mut matched = 0;
    for _ in 0..n {
        w.as_("medic", |ctx| open_incident(ctx, "sos".into(), zone, 3, "felt faint by the stage".into()));
        let incident = w.t.db.incident().subject_band().filter(3u32).max_by_key(|i| i.id).unwrap().id;
        w.as_("medic", |ctx| resolve_incident(ctx, incident, "rested and recovered".into()));
        w.as_("Maya Chen", |ctx| file_claim(ctx, incident, STATEMENT.into()));
        let claim = w.t.db.claim().incident_id().find(incident).unwrap();
        matched += (w.report_for(claim.id).scenario == "matches") as u32;
        w.advance(60);
    }
    assert!((40..=80).contains(&matched), "{matched} of {n} matched");
}

#[test]
fn the_wearer_sees_their_incidents_and_staff_see_the_unclaimed_ones() {
    use crate::web::{board_clinic_reports, my_claims, my_incidents, unclaimed_injuries};
    let w = World::new();
    let incident = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    let mine = my_incidents(&w.view("Maya Chen"));
    assert_eq!(mine.len(), 1);
    assert_eq!((mine[0].incident_id, mine[0].kind.as_str(), mine[0].zone_name.as_str(), mine[0].resolved, mine[0].claim_id), (incident, "fall", "Main stage", true, 0));
    assert!(my_incidents(&w.view("Jordan Alvarez")).is_empty());
    let open = unclaimed_injuries(&w.view("ops"));
    assert_eq!(open.len(), 1);
    assert_eq!((open[0].incident_id, open[0].band_id, open[0].wearer_name.as_str(), open[0].kind.as_str()), (incident, 3, "Maya Chen", "fall"));
    assert_eq!(open[0].notes, ["wrist wrapped, cold pack, first aid"]);
    assert!(unclaimed_injuries(&w.view("Maya Chen")).is_empty());

    w.as_("Maya Chen", |ctx| file_claim(ctx, incident, STATEMENT.into()));
    let claim = w.t.db.claim().incident_id().find(incident).unwrap();
    assert_eq!(my_incidents(&w.view("Maya Chen"))[0].claim_id, claim.id);
    assert!(unclaimed_injuries(&w.view("ops")).is_empty());
    let claims = my_claims(&w.view("Maya Chen"));
    assert_eq!((claims[0].incident_id, claims[0].statement.as_str()), (incident, STATEMENT));
    assert_eq!(board_clinic_reports(&w.view("ops")).len(), 1);
    assert!(board_clinic_reports(&w.view("Maya Chen")).is_empty());
}

/// The text layer of the venue's policy, one string per page.
fn policy_pages() -> Vec<String> {
    vec![
        "Insurer: Northwind Mutual Insurance Company. Policy number: NWM-GL-2026-0413. Policy period: 2026-10-01 to 2027-09-30. \
         Coverage C medical payments: $5,000 each person. We will not pay a medical payments claim of less than $250.00. \
         Expenses must be incurred within 365 days of the accident."
            .into(),
        "Exclusions. This insurance does not apply to bodily injury to any employee or volunteer of the insured.".into(),
    ]
}

/// What the Evidence Engine read from those pages.
fn policy_read() -> String {
    let term = |name: &str, cover: &str, value: &str, quote: &str, page: u32| serde_json::json!({"name": name, "cover": cover, "value": value, "quote": quote, "page": page});
    serde_json::json!({
        "terms": [
            term("insurer_name", "", "Northwind Mutual Insurance Company", "Insurer: Northwind Mutual Insurance Company", 1),
            term("policy_number", "", "NWM-GL-2026-0413", "Policy number: NWM-GL-2026-0413", 1),
            term("period_start", "", "2026-10-01", "Policy period: 2026-10-01 to 2027-09-30", 1),
            term("period_end", "", "2027-09-30", "Policy period: 2026-10-01 to 2027-09-30", 1),
            term("per_claim_limit", "medical_payments", "$5,000", "Coverage C medical payments: $5,000 each person", 1),
            term("minimum_payout", "medical_payments", "$250.00", "We will not pay a medical payments claim of less than $250.00.", 1),
            term("service_window_days", "medical_payments", "365 days", "within 365 days of the accident", 1),
            term("deductible", "property", "$900", "a $900 deductible", 1)
        ],
        "fee_schedule": [],
        "exclusions": [{"kind": "staff", "quote": "This insurance does not apply to bodily injury to any employee or volunteer of the insured.", "page": 2}],
        "clauses": [{"section": "exclusions", "page": 2, "text": "This insurance does not apply to bodily injury to any employee or volunteer of the insured."}]
    })
    .to_string()
}

/// The organizer uploads the policy and the worker hands back what was read.
fn upload_policy(w: &World) -> PolicyDocument {
    let hash = "ab".repeat(32);
    w.as_("ops", |ctx| register_blob(ctx, hash.clone(), None, "staff".into(), "policy".into(), "application/pdf".into(), 4000));
    w.as_("ops", |ctx| documents::submit_policy_document(ctx, hash.clone(), 2));
    let doc = w.t.db.policy_document().iter().max_by_key(|d| d.id).unwrap();
    assert_eq!((doc.status.as_str(), doc.kind.as_str()), ("reading", "venue_policy"));
    let job = w.lease(bandit_insurance::policy::KIND_DOCUMENT_READ, doc.id);
    w.as_("worker", |ctx| documents::apply_document_terms(ctx, job.id, policy_read(), policy_pages()));
    w.t.db.policy_document().id().find(doc.id).unwrap()
}

#[test]
fn an_uploaded_policy_sets_the_terms_once_the_organizer_confirms() {
    let w = World::new();
    let doc = upload_policy(&w);
    assert_eq!((doc.status.as_str(), doc.clause_count), ("read", 1));
    let terms: Vec<PolicyTerm> = w.t.db.policy_term().document_id().filter(doc.id).collect();
    let term = |cover: &str, name: &str| terms.iter().find(|t| t.cover_kind == cover && t.name == name).unwrap().clone();
    let min = term("medical_payments", "minimum_payout");
    assert_eq!((min.value.as_str(), min.status.as_str(), min.page), ("25000", "read", 1));
    let ded = term("property", "deductible");
    assert_eq!((ded.status.as_str(), ded.value.as_str(), ded.problem.as_str()), ("flagged", "50000", "the quote is not on page 1"));
    let staff = terms.iter().find(|t| t.name == "exclusion" && t.code == "staff").unwrap();
    assert_eq!(staff.clause_id, format!("{}-c1", "ab".repeat(32)));
    assert_eq!(terms.iter().filter(|t| t.name == "fee_cap").count(), 21, "no schedule stated: the default one");

    let before = w.as_("ops", |ctx| Ok(documents::current_policy(ctx).map(|p| p.policy_number)));
    assert_eq!(before.as_deref(), Some("GL-2026-04417"));
    assert!(w.try_as("medic", |ctx| documents::confirm_policy_terms(ctx, doc.id)).is_err());
    w.as_("ops", |ctx| documents::confirm_policy_terms(ctx, doc.id));

    let policy = w.t.db.insurance_policy().policy_number().find("NWM-GL-2026-0413".to_string()).unwrap();
    assert!(policy.period_checked && policy.staff_excluded);
    assert_eq!(policy.insurer_name, "Northwind Mutual Insurance Company");
    let medical = w.t.db.coverage_rule().policy_id().filter(policy.id).find(|r| r.cover_kind == "medical_payments").unwrap();
    assert_eq!((medical.per_claim_limit_cents, medical.minimum_payout_cents, medical.service_window_days), (500_000, 25_000, 365));
    assert_eq!(w.t.db.fee_schedule_line().policy_id().filter(policy.id).count(), 21);
    let doc = w.t.db.policy_document().id().find(doc.id).unwrap();
    assert_eq!((doc.status.as_str(), doc.policy_id), ("confirmed", policy.id));

    let claim = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    assert_eq!(claim.policy_id, policy.id, "new claims take the confirmed policy");
}

#[test]
fn a_payout_below_the_confirmed_minimum_goes_to_the_organizer() {
    let w = World::new();
    approve_larger_fall(&w);
    let doc = upload_policy(&w);
    w.as_("ops", |ctx| documents::confirm_policy_terms(ctx, doc.id));
    w.advance(3600);
    let claim = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record(claim.id, FIRST_AID, 1);
    assert_eq!(w.claim(claim.id).payout_cents, 18_000);
    w.verify(claim.id);
    let job = w.open_job(KIND_REVIEW, claim.id);
    let p: ReviewPayload = serde_json::from_str(&job.payload).unwrap();
    assert_eq!(p.venue_policy_hash, "ab".repeat(32));
    w.claude_pays(claim.id);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert_eq!(c.status_note, "Claude would pay $180.00, below the policy's minimum payout of $250.00");
}

#[test]
fn an_incident_outside_the_policy_period_has_no_cover() {
    let w = World::new();
    let doc = upload_policy(&w);
    w.as_("ops", |ctx| documents::confirm_policy_terms(ctx, doc.id));
    w.t.clock.set(spacetimedb::Timestamp::from_micros_since_unix_epoch(micros_at(2027, 10, 2, 22, 0, 0, PDT)));
    let claim = w.injury_claim(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record(claim.id, FIRST_AID, 1);
    w.verify(claim.id);
    w.claude_pays(claim.id);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert!(c.status_note.contains("no cover in the venue's policy pays for this kind of incident"), "{}", c.status_note);
}

#[test]
fn a_policy_that_cannot_be_read_is_marked_failed() {
    let w = World::new();
    let hash = "cd".repeat(32);
    w.as_("ops", |ctx| register_blob(ctx, hash.clone(), None, "staff".into(), "policy".into(), "application/pdf".into(), 4000));
    w.as_("ops", |ctx| documents::submit_policy_document(ctx, hash.clone(), 3));
    let doc = w.t.db.policy_document().iter().max_by_key(|d| d.id).unwrap();
    for _ in 0..MAX_ATTEMPTS {
        let job = w.lease(bandit_insurance::policy::KIND_DOCUMENT_READ, doc.id);
        w.as_("worker", |ctx| fail_job(ctx, job.id, "the reader timed out".into(), None));
        w.advance(60);
    }
    let doc = w.t.db.policy_document().id().find(doc.id).unwrap();
    assert_eq!((doc.status.as_str(), doc.error.as_str()), ("failed", "the reader timed out"));
    assert!(w.try_as("ops", |ctx| documents::confirm_policy_terms(ctx, doc.id)).is_err());
    assert!(w.try_as("ops", |ctx| documents::submit_policy_document(ctx, "ef".repeat(32), 2)).is_err(), "the file must be stored first");
}
