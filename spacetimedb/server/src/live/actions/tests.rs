use super::*;
use crate::departure::Departure;
use crate::insurance::{charge, claim, ClaimStatus};
use crate::insurance::filing::file_claim_for_wearer;
use crate::insurance::setup::{upsert_coverage_rule, upsert_insurance_policy};
use crate::roles::{staff_role, StaffRole};
use crate::safety::{add_incident_note, incident_snapshot, resolve_incident};
use crate::social::tables::{Attendee, CrowdMember};
use crate::venue::Zone;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::ConnectionId;

fn identity(name: &str) -> Identity { Identity::from_claims("bandit-actions", name) }
fn auth(name: &str) -> TestAuth {
    TestAuth::from_jwt_payload(format!(r#"{{"iss":"bandit-actions","sub":"{name}"}}"#), ConnectionId::from_u128(name.len() as u128 + 1)).unwrap()
}

struct World { t: TestContext }
impl World {
    fn new() -> Self {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000));
        let now = t.clock.now();
        t.db.owner().insert(Owner { identity: identity("owner") });
        for (who, role) in [("ops", "ops"), ("medic", "medic")] {
            t.db.staff_role().insert(StaffRole { id: 0, identity: identity(who), role: role.into(), label: who.into(), granted_by: identity("owner"), granted_at: now });
        }
        t.db.zone().insert(Zone {
            id: 1, source_key: "floor".into(), venue_id: 1, name: "Floor".into(), kind: "floor".into(), station_id: 101,
            plan_x_m: 0.0, plan_y_m: 0.0, area_sq_m: 500.0, capacity: 1000, exit_colour: 1, description: String::new(), updated_at: now,
        });
        t.db.live_run().insert(LiveRun {
            id: 0, phase: LivePhase::Running, crowd: 2, pace: 1, started_at: now, ends_at: now + seconds(600),
            closing_at: None, ended_at: None, next_incident_at: now + seconds(60), step: 4, seed: 42, started_by: identity("owner"),
        });
        let world = Self { t };
        world.person(1000, true);
        world.person(1001, true);
        world.person(90, false);
        world.call("ops", |ctx| {
            upsert_insurance_policy(ctx, "POLICY".into(), "Venue insurer".into(), String::new(), now - seconds(60), now + seconds(86400))?;
            upsert_coverage_rule(ctx, "POLICY".into(), "medical_payments".into(), vec!["fall".into()], 500_000, 2_500_000, 0, 365, true)?;
            upsert_coverage_rule(ctx, "POLICY".into(), "property".into(), vec!["theft".into()], 1_000_000, 5_000_000, 50_000, 0, true)
        }).unwrap();
        world
    }
    fn person(&self, band_id: u32, crowd: bool) {
        let now = self.t.clock.now();
        let who = identity(&format!("person-{band_id}"));
        self.t.db.attendee().insert(Attendee {
            identity: who, node_id: band_id as u64, display_name: format!("Person {band_id}"), photo_url: String::new(), findable: true,
            person_id: 0, organization_id: 0, crowd, created_at: now, updated_at: now,
        });
        if crowd {
            self.t.db.crowd_member().insert(CrowdMember { band_id, identity: who, joined_at: now, group_id: 1, dx_m: 0.0, dy_m: 0.0, interests: vec![], chat: 0 });
        }
        self.t.db.band().insert(Band {
            id: band_id, state: 0, flags: 0, neigh: 0, zone: 101, bat: 100, find: 0, rssi: -40, seq: 0, sos: false, fall: false,
            pressed: false, low_battery: false, has_mpu: true, has_motor: true, online: true, last_seen: now, x_m: band_id as f32 - 990.0, y_m: 12.0, booth_id: 0,
        });
    }
    fn call<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> Result<T, String> { self.t.with_reducer_tx(auth(who), f) }
    fn action(&self, who: &str, band: u32, action: &str) -> Result<(), String> { self.call(who, |ctx| stage_crowd_action(ctx, band, action.into())) }
}

#[test]
fn injury_targets_only_the_selected_bot_and_uses_the_regular_filing_path() {
    let w = World::new();
    let untouched = w.t.db.band().id().find(1001).unwrap();
    let run_before = w.t.db.live_run().id().find(0).unwrap();
    w.action("ops", 1000, "injury").unwrap();
    let band = w.t.db.band().id().find(1000).unwrap();
    assert!(band.fall && !band.sos);
    assert_eq!(band.state, S_SOS);
    let after = w.t.db.band().id().find(1001).unwrap();
    assert_eq!((after.state, after.fall, after.sos, after.x_m, after.y_m), (untouched.state, untouched.fall, untouched.sos, untouched.x_m, untouched.y_m));
    let incident = w.t.db.incident().iter().next().unwrap();
    assert_eq!(incident.subject_band, 1000);
    assert_eq!(incident.kind, IncidentKind::Fall);
    let marker = w.t.db.incident_marker().incident_id().find(incident.id).unwrap();
    assert_eq!((marker.x_m, marker.y_m), (10.0, 12.0));
    assert_eq!(marker.person, "Person 1000");
    let plan = w.t.db.live_plan().incident_id().find(incident.id).unwrap();
    assert_eq!(plan.record, "first-aid-wrist");
    assert_eq!(plan.culprit_band, 0);
    assert!(w.t.db.claim().iter().next().is_none());
    w.call("medic", |ctx| resolve_incident(ctx, incident.id, plan.resolution)).unwrap();
    assert!(w.t.db.claim().iter().next().is_none());
    w.call("medic", |ctx| file_claim_for_wearer(ctx, incident.id, "I slipped on a drink and hurt my wrist.".into(), "pdf".into())).unwrap();
    let claim = w.t.db.claim().incident_id().find(incident.id).unwrap();
    assert_eq!(claim.band_id, 1000);
    assert_eq!(claim.claimant_name, "Person 1000");
    assert_eq!(claim.status, ClaimStatus::AwaitingRecord);
    let run_after = w.t.db.live_run().id().find(0).unwrap();
    assert_eq!((run_after.step, run_after.seed, run_after.next_incident_at), (run_before.step, run_before.seed, run_before.next_incident_at));
}

#[test]
fn theft_keeps_venue_as_claimant_and_selected_bot_as_responsible_band() {
    let w = World::new();
    w.action("owner", 1001, "theft").unwrap();
    let incident = w.t.db.incident().iter().next().unwrap();
    assert_eq!(incident.kind, IncidentKind::Theft);
    assert_eq!(incident.subject_band, 0);
    let marker = w.t.db.incident_marker().incident_id().find(incident.id).unwrap();
    assert_eq!((marker.x_m, marker.y_m), (11.0, 12.0));
    let plan = w.t.db.live_plan().incident_id().find(incident.id).unwrap();
    assert_eq!(plan.culprit_band, 1001);
    assert!(plan.cost_cents > 0 && plan.camera);
    let snapshot = w.t.db.incident_snapshot().incident_id().find(incident.id).unwrap();
    assert!(snapshot.bands_present.contains(&1001));
    w.call("ops", |ctx| {
        add_incident_note(ctx, incident.id, plan.note.clone(), Some(plan.cost_cents))?;
        crate::insurance::name_responsible_band(ctx, incident.id, 1001, plan.naming.clone())?;
        resolve_incident(ctx, incident.id, plan.resolution.clone())
    }).unwrap();
    let claim = w.t.db.claim().incident_id().find(incident.id).unwrap();
    assert_eq!(claim.cover_kind, "property");
    assert_eq!(claim.band_id, 0);
    assert!(claim.claimant.is_none());
    let charge = w.t.db.charge().incident_id().find(incident.id).unwrap();
    assert_eq!(charge.band_id, 1001);
    assert_eq!(charge.status, "proposed");
    assert_eq!(charge.claim_id, claim.id);
}

#[test]
fn permissions_and_authoritative_crowd_membership_are_required() {
    let w = World::new();
    for who in ["person-1000", "medic", "stranger"] { assert!(w.action(who, 1000, "injury").is_err()); }
    assert!(w.action("ops", 90, "injury").is_err());
    assert!(w.action("ops", 9999, "injury").is_err());
    let person = w.t.db.attendee().identity().find(identity("person-1000")).unwrap();
    w.t.db.attendee().identity().update(Attendee { crowd: false, ..person });
    assert!(w.action("ops", 1000, "injury").is_err());
    assert_eq!(w.t.db.incident().iter().count(), 0);
}

#[test]
fn invalid_actions_and_repeated_actions_do_not_create_extra_incidents() {
    let w = World::new();
    assert!(w.action("ops", 1000, "unknown").is_err());
    w.action("ops", 1000, "injury").unwrap();
    assert!(w.action("ops", 1000, "theft").is_err());
    w.action("ops", 1001, "theft").unwrap();
    assert!(w.action("ops", 1001, "injury").is_err());
    assert_eq!(w.t.db.incident().iter().count(), 2);
}

#[test]
fn offline_departed_and_unplaced_bots_are_rejected() {
    let w = World::new();
    let band = w.t.db.band().id().find(1000).unwrap();
    w.t.db.band().id().update(Band { online: false, ..band });
    assert!(w.action("ops", 1000, "injury").is_err());
    let band = w.t.db.band().id().find(1000).unwrap();
    w.t.db.band().id().update(Band { online: true, zone: 0, ..band });
    assert!(w.action("ops", 1000, "injury").is_err());
    let band = w.t.db.band().id().find(1000).unwrap();
    w.t.db.band().id().update(Band { zone: 101, ..band });
    w.t.db.departure().insert(Departure {
        attendee: identity("person-1000"), node_id: 1000, name: "Person 1000".into(), band_id: 1000, door: String::new(),
        station_id: 101, x_m: 10.0, y_m: 12.0, asked_at: w.t.clock.now(), left_at: None, by: "ops".into(),
    });
    assert!(w.action("ops", 1000, "injury").is_err());
    assert_eq!(w.t.db.incident().iter().count(), 0);
}

#[test]
fn paused_evacuating_and_ended_runs_are_rejected() {
    let w = World::new();
    w.t.db.live_pause().insert(LivePause { id: 0, paused_at: w.t.clock.now(), paused_by: identity("ops") });
    assert!(w.action("ops", 1000, "injury").is_err());
    w.t.db.live_pause().id().delete(0);
    w.t.db.live_evacuation().insert(LiveEvacuation { id: 0, started_at: w.t.clock.now(), started_by: identity("ops") });
    assert!(w.action("ops", 1000, "injury").is_err());
    w.t.db.live_evacuation().id().delete(0);
    let run = w.t.db.live_run().id().find(0).unwrap();
    w.t.db.live_run().id().update(LiveRun { phase: LivePhase::Ended, ..run });
    assert!(w.action("ops", 1000, "injury").is_err());
    assert_eq!(w.t.db.incident().iter().count(), 0);
}
