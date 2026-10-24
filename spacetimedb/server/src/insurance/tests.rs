//! The demo paths end to end inside an in-memory module: band flags, the
//! safety watch, the medic, the record reader, Elastic and the claims agent
//! (played here by the test, through the same reducers the workers call),
//! and the named approver.

use super::evidence::*;
use super::flow::*;
use super::setup::*;
use super::*;
use crate::jobs::*;
use crate::roles::*;
use crate::safety::*;
use crate::social::tables::*;
use crate::tables::*;
use crate::venue::*;
use crate::vision::*;
use hyphenate_core::payloads::*;
use hyphenate_core::time::micros_at;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, ScheduleAt, Table, TimeDuration};

const PDT: i32 = -420;
const FIRST_AID: &str = include_str!("../../../../fixtures/medical-records/expected/first-aid-wrist.json");
const URGENT_CARE: &str = include_str!("../../../../fixtures/medical-records/expected/urgent-care-wrist.json");
const ANKLE_AT_HOME: &str = include_str!("../../../../fixtures/medical-records/expected/urgent-care-ankle-home.json");

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
            ("sam", "floor_manager", "Sam Okafor"),
            ("dana", "risk_manager", "Dana Ruiz"),
            ("priya", "adjuster", "Priya Nair"),
            ("vision", "vision", "bandit-vision"),
            ("sim", "simulator", "bandit-claims"),
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
                simulated: false,
                created_at: t.clock.now(),
                updated_at: t.clock.now(),
            });
            t.db.band_owner().insert(BandOwner { band_id: band, owner: id(name), claimed_at: t.clock.now() });
        }
        for b in 1..=9u8 {
            t.db.band().insert(band(b, 101));
        }
        let w = World { t };
        w.as_("dana", |ctx| {
            let start = spacetimedb::Timestamp::from_micros_since_unix_epoch(micros_at(2026, 10, 1, 0, 0, 0, PDT));
            upsert_insurance_policy(ctx, "GL-2026-04417".into(), "Northwind Mutual".into(), "claims@northwind.test".into(), start, start + TimeDuration::from_micros(365 * 86_400_000_000))?;
            upsert_coverage_rule(ctx, "GL-2026-04417".into(), "medical_payments".into(), vec!["sos".into(), "fall".into()], 500_000, 2_500_000, 0, 365, true)?;
            upsert_coverage_rule(ctx, "GL-2026-04417".into(), "property".into(), vec!["property".into()], 1_000_000, 5_000_000, 50_000, 0, true)?;
            set_authority_limit(ctx, "floor_manager".into(), 1, Some(50_000), Some(id("sam")), "Sam Okafor".into())?;
            set_authority_limit(ctx, "risk_manager".into(), 2, Some(500_000), Some(id("dana")), "Dana Ruiz".into())?;
            set_authority_limit(ctx, "adjuster".into(), 3, None, Some(id("priya")), "Priya Nair".into())
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
        let mut row = self.t.db.band().id().find(b).unwrap();
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
        self.t.db.incident().subject_band().filter(subject).max_by_key(|i| i.id).unwrap().id
    }

    fn treat_and_resolve(&self, incident_id: u64) -> Claim {
        self.as_("medic", |ctx| assign_medic(ctx, incident_id));
        self.advance(12 * 60);
        self.as_("medic", |ctx| add_incident_note(ctx, incident_id, "wrist wrapped, cold pack, first aid".into(), None));
        self.advance(5 * 60);
        self.as_("medic", |ctx| resolve_incident(ctx, incident_id, "treated on site".into()));
        self.t.db.claim().incident_id().find(incident_id).expect("claim opened on resolve")
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

    fn review(&self, claim_id: u64, verdict: &str, causation: &str, concern: Option<&str>) {
        let job = self.lease(KIND_REVIEW, claim_id);
        let p: ReviewPayload = serde_json::from_str(&job.payload).unwrap();
        let concerns = match concern {
            Some(c) => format!(r#"[{{"kind":"causation","detail":"{c}","fact_ids":[{}]}}]"#, p.facts[0].seq),
            None => "[]".into(),
        };
        let review = format!(
            r#"{{"verdict":"{verdict}","causation":"{causation}","summary":"The band, the light circle and the medic note agree.","concerns":{concerns},"innocent_explanations":[],"missing_evidence":[],"cited_fact_ids":[1,2]}}"#
        );
        self.as_("worker", |ctx| submit_claim_review(ctx, job.id, review, call("claim_review")));
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

fn band(id: u8, station: u8) -> Band {
    Band {
        id,
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
    }
}

fn call(kind: &str) -> ModelCallIn {
    ModelCallIn { kind: kind.into(), model_requested: "claude-opus-5-5".into(), model_used: "claude-opus-5-5".into(), status: "ok".into(), ..Default::default() }
}

/// Jordan's urgent-care visit: covered $895.00 after the fee schedule, above
/// the floor manager's $500 ceiling, so it goes to Dana Ruiz. Her approval
/// teaches the rule that settles the next small fall on its own.
fn approve_larger_fall(w: &World) -> Claim {
    let incident = w.fall(7, 101, &[(2, 101), (4, 101), (9, 101)]);
    let claim = w.treat_and_resolve(incident);
    assert_eq!(claim.status, ClaimStatus::AwaitingRecord);
    assert_eq!(claim.claimant_name, "Jordan Alvarez");
    w.file_record(claim.id, URGENT_CARE, 2);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Verifying);
    assert_eq!((c.cost_cents, c.payout_cents, c.recoverable_cents), (89_500, 89_500, 89_500));
    assert_eq!(c.corroboration, "corroborated");
    w.verify(claim.id);
    w.review(claim.id, "consistent", "supported", None);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed, "{}", c.status_note);
    assert_eq!((c.routed_to_role.as_str(), c.routed_to_name.as_str(), c.routed_to), ("risk_manager", "Dana Ruiz", id("dana")));

    let stale = w.try_as("dana", |ctx| approve_claim(ctx, c.id, c.payout_cents, "0".repeat(64), None, true));
    assert!(stale.unwrap_err().starts_with("stale"));
    assert!(w.try_as("sam", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true)).is_err());
    w.as_("dana", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true));
    w.pay(claim.id);
    w.claim(claim.id)
}

#[test]
fn larger_fall_goes_to_the_named_risk_manager() {
    let w = World::new();
    let c = approve_larger_fall(&w);
    assert_eq!(c.status, ClaimStatus::Settled);
    assert_eq!(c.decided_by, "approver");
    let rule = w.t.db.settlement_rule().iter().find(|r| r.status == "active").unwrap();
    assert_eq!((rule.incident_kind.as_str(), rule.ceiling_cents, rule.version, rule.approver_name.as_str()), ("fall", 89_500, 1, "Dana Ruiz"));
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
    w.as_("priya", |ctx| record_insurer_payment(ctx, c.id, 89_500, "NWM-55120".into()));
    assert_eq!(w.claim(c.id).status, ClaimStatus::Reconciled);
}

#[test]
fn small_fall_settles_automatically_under_the_learned_rule() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let incident = w.fall(3, 101, &[(1, 101), (5, 101)]);
    let claim = w.treat_and_resolve(incident);
    assert_eq!(claim.claimant_name, "Maya Chen");
    w.file_record(claim.id, FIRST_AID, 1);
    assert_eq!(w.claim(claim.id).payout_cents, 18_000);
    w.verify(claim.id);
    w.review(claim.id, "consistent", "supported", None);
    w.pay(claim.id);
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Settled, "{}", c.status_note);
    assert_eq!((c.decided_by.as_str(), c.settlement_rule_version), ("rule", 1));
    assert_eq!(c.payout_reference, format!("Nessie deposit dep-{}", c.id));
    let account = w.t.db.claimant_account().identity().find(id("Maya Chen")).unwrap();
    assert_eq!(account.account_id, "acct-1");
    assert_eq!(w.t.db.approval().claim_id().filter(c.id).count(), 0);
}

#[test]
fn the_claims_agent_stops_an_injury_that_happened_at_home() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let incident = w.fall(8, 101, &[(1, 101), (5, 101)]);
    let claim = w.treat_and_resolve(incident);
    w.file_record(claim.id, ANKLE_AT_HOME, 2);
    w.verify(claim.id);
    let version = w.claim(claim.id).pack_version;
    let checks = w.as_("ops", |ctx| Ok(pack_checks(ctx, claim.id, version)));
    assert!(checks.iter().all(|c| c.result != hyphenate_core::CheckResult::Fail), "{checks:?}");
    w.review(claim.id, "needs_human", "unsupported", Some("the record says the ankle was hurt playing basketball at home the day before"));
    let c = w.claim(claim.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert!(c.status_note.starts_with("claims agent: needs_human: causation"), "{}", c.status_note);
    assert_eq!(c.routed_to_name, "Dana Ruiz");
}

#[test]
fn a_circle_in_another_zone_disputes_the_fall() {
    let w = World::new();
    let incident = w.fall(6, 101, &[(1, 102), (2, 102), (4, 102)]);
    let claim = w.treat_and_resolve(incident);
    assert_eq!(claim.status, ClaimStatus::Refused);
    assert!(claim.refusal_reason.contains("witness_zone"), "{}", claim.refusal_reason);
    assert!(w.ledger(claim.id).is_empty());
}

#[test]
fn the_same_record_filed_twice_goes_to_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    let hash = "ab".repeat(32);
    let first = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(first.id, FIRST_AID, 1, &hash);
    w.advance(3600);
    let second = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(second.id, FIRST_AID, 1, &hash);
    w.verify(second.id);
    w.review(second.id, "consistent", "supported", None);
    let c = w.claim(second.id);
    assert_eq!(c.status, ClaimStatus::Routed);
    assert!(c.status_note.contains("record_duplicate"), "{}", c.status_note);
}

#[test]
fn broken_speaker_with_camera_evidence_and_a_recovery_query() {
    let w = World::new();
    let zone = w.t.db.zone().station_id().filter(101u8).next().unwrap().id;
    w.as_("vision", |ctx| upsert_camera(ctx, "overhead pit".into(), zone, "overhead".into()));
    w.as_("sam", |ctx| open_incident(ctx, "property".into(), zone, 0, "speaker knocked off its stand at Main stage".into()));
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
    w.as_("sam", |ctx| add_incident_note(ctx, incident.id, "repair estimate from the AV vendor".into(), Some(240_000)));
    w.as_("sam", |ctx| resolve_incident(ctx, incident.id, "area cleared".into()));
    let claim = w.t.db.claim().incident_id().find(incident.id).unwrap();
    assert_eq!(claim.status, ClaimStatus::Verifying);
    assert_eq!((claim.payout_cents, claim.recoverable_cents, claim.venue_cost_cents), (240_000, 190_000, 50_000));
    assert_eq!(claim.corroboration, "corroborated");
    w.verify(claim.id);
    w.review(claim.id, "consistent", "supported", None);
    let c = w.claim(claim.id);
    assert_eq!((c.status, c.routed_to_name.as_str()), (ClaimStatus::Routed, "Dana Ruiz"));
    w.as_("dana", |ctx| approve_claim(ctx, c.id, c.payout_cents, c.pack_hash.clone(), None, true));
    w.as_("dana", |ctx| request_recovery_letter(ctx, c.id, "Stagecraft AV".into(), "ops@stagecraft.test".into()));
    let job = w.open_job(KIND_RECOVERY, c.id);
    let p: RecoveryPayload = serde_json::from_str(&job.payload).unwrap();
    assert_eq!(p.letter.amounts.venue_cost_cents, 50_000);
}

#[test]
fn a_dead_review_job_sends_the_claim_to_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    let claim = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
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
    let claim = w.treat_and_resolve(w.fall(6, 101, &[(1, 101), (2, 101)]));
    assert_eq!(claim.status, ClaimStatus::Refused);
    assert!(claim.refusal_reason.starts_with("medical payments cover excludes staff: Lee Park holds the staff role medic"), "{}", claim.refusal_reason);
}

#[test]
fn three_people_hurt_at_once_go_to_the_adjuster_on_one_notice() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let a = w.fall(3, 101, &[(1, 101), (5, 101)]);
    w.advance(30);
    let b = w.fall(8, 101, &[(1, 101), (5, 101)]);
    w.advance(30);
    let c = w.fall(6, 101, &[(1, 101), (5, 101)]);
    let first = w.treat_and_resolve(a);
    w.treat_and_resolve(b);
    w.treat_and_resolve(c);
    w.file_record(first.id, FIRST_AID, 1);
    w.verify(first.id);
    w.review(first.id, "consistent", "supported", None);
    let claim = w.claim(first.id);
    assert_eq!((claim.status, claim.routed_to_name.as_str()), (ClaimStatus::Routed, "Priya Nair"));
    assert!(claim.status_note.starts_with("3 people hurt in Main stage"), "{}", claim.status_note);
    w.as_("priya", |ctx| approve_claim(ctx, claim.id, claim.payout_cents, claim.pack_hash.clone(), None, false));
    w.pay(claim.id);
    let p: DraftPayload = serde_json::from_str(&w.open_job(KIND_DRAFT, claim.id).payload).unwrap();
    assert_eq!(p.letter.related_claims.len(), 2, "{:?}", p.letter.related_claims);
    assert!(hyphenate_core::letters::fnol_template(&p.letter).contains("Sam Patel"));
}

#[test]
fn the_same_invoice_on_another_claim_goes_to_a_person() {
    let w = World::new();
    approve_larger_fall(&w);
    w.advance(3600);
    let first = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(first.id, FIRST_AID, 1, &"ab".repeat(32));
    w.advance(3600);
    let second = w.treat_and_resolve(w.fall(3, 101, &[(1, 101), (5, 101)]));
    w.file_record_hash(second.id, FIRST_AID, 1, &"cd".repeat(32));
    let version = w.claim(second.id).pack_version;
    let checks = w.as_("ops", |ctx| Ok(pack_checks(ctx, second.id, version)));
    let dup = checks.iter().find(|c| c.name == "record_duplicate").unwrap();
    assert_eq!(dup.result, hyphenate_core::CheckResult::Fail);
    assert!(dup.detail.starts_with("invoice FA-1024-0007"), "{}", dup.detail);
}

#[test]
fn simulated_bands_raise_incidents_without_the_bridge() {
    let w = World::new();
    assert!(w.try_as("sim", |ctx| report_sim_band(ctx, 7, 101, 3, 4, false, true, false)).is_err());
    w.as_("sim", |ctx| report_sim_band(ctx, 95, 101, 3, 4, false, true, false));
    for b in [96u8, 97] {
        w.as_("sim", |ctx| report_sim_band(ctx, b, 101, S_NEAR_SOS, 5, false, false, false));
    }
    w.watch();
    w.advance(1);
    w.watch();
    let incident = w.t.db.incident().subject_band().filter(95u8).next().expect("incident from a simulated fall");
    assert_eq!(incident.kind, IncidentKind::Fall);
    assert_eq!(w.t.db.incident_band().incident_id().filter(incident.id).filter(|r| r.role == "witness").count(), 2);
    assert!(w.t.db.event().iter().any(|e| e.band_id == 95 && e.kind == EventKind::Fall));
}
