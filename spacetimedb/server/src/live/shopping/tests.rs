use super::*;
use crate::insurance::{ClaimantAccount, claimant_account};
use crate::jobs::*;
use crate::live::*;
use crate::merch::*;
use crate::roles::*;
use crate::tables::*;
use crate::wallet::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, ScheduleAt};

fn id(name: &str) -> Identity {
    Identity::from_claims("bandit-test", name)
}
fn crowd_id(band: u32) -> Identity {
    Identity::from_claims("bandit-crowd", &format!("band-{band}"))
}
fn auth(name: &str) -> TestAuth {
    TestAuth::from_jwt_payload(
        format!(r#"{{"iss":"bandit-test","sub":"{name}"}}"#),
        ConnectionId::from_u128(name.len() as u128 + 1),
    )
    .unwrap()
}

struct World {
    t: TestContext,
}
impl World {
    fn new(count: u16) -> Self {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(
            1_792_900_000_000_000,
        ));
        let now = t.clock.now();
        t.db.owner().insert(Owner {
            identity: id("ops"),
        });
        t.db.staff_role().insert(StaffRole {
            id: 0,
            identity: id("worker"),
            role: "worker".into(),
            label: "worker".into(),
            granted_by: id("ops"),
            granted_at: now,
        });
        let venue = t.db.venue().insert(Venue {
            id: 0,
            source_key: "venue".into(),
            name: "Event".into(),
            venue_name: "Hall".into(),
            address: "Event Hall, 1 Market St, San Francisco, CA 94105, USA".into(),
            latitude: 0.0,
            longitude: 0.0,
            website: String::new(),
            timezone: "America/Los_Angeles".into(),
            starts_at: None,
            ends_at: None,
            description: String::new(),
            facts: vec![],
            source_url: String::new(),
            fetched_at: now,
            updated_at: now,
        });
        let zone =
            t.db.zone()
                .insert(Zone {
                    id: 0,
                    source_key: "sponsor".into(),
                    venue_id: venue.id,
                    name: "Sponsor row".into(),
                    kind: "sponsor".into(),
                    station_id: 103,
                    plan_x_m: 0.0,
                    plan_y_m: 0.0,
                    area_sq_m: 500.0,
                    capacity: 2000,
                    exit_colour: 0,
                    description: String::new(),
                    updated_at: now,
                })
                .id;
        t.db.booth().insert(Booth {
            id: 1,
            source_key: "booth".into(),
            venue_id: venue.id,
            zone_id: zone,
            organization_id: 0,
            booth_number: String::new(),
            name: "Sponsor".into(),
            kind: "sponsor".into(),
            description: String::new(),
            tags: vec![],
            plan_x_m: 0.0,
            plan_y_m: 0.0,
            placement: String::new(),
            source_url: String::new(),
            fetched_at: now,
            updated_at: now,
        });
        for (name, booths) in [("plain", vec![]), ("sponsor", vec![1])] {
            t.db.merch_template().insert(MerchTemplate {
                id: 0,
                name: name.into(),
                title: name.into(),
                kind: "mug".into(),
                price_cents: 1800,
                image_url: String::new(),
                width: 100,
                height: 100,
                photo_x: 0,
                photo_y: 0,
                photo_w: 100,
                photo_h: 100,
                booth_ids: booths,
                updated_at: now,
            });
        }
        t.db.live_run().insert(LiveRun {
            id: 0,
            phase: LivePhase::Running,
            crowd: count,
            pace: 1,
            started_at: now,
            ends_at: now + seconds(720),
            closing_at: None,
            ended_at: None,
            next_incident_at: now + seconds(720),
            step: 0,
            seed: 42,
            started_by: id("ops"),
        });
        let w = Self { t };
        for band in 100..100 + u32::from(count) {
            w.person(band, crowd_id(band), true);
        }
        // An actual attendee in the same zone has a wallet and is always the first photo candidate.
        w.person(90, id("real"), false);
        w.t.db.band_owner().insert(BandOwner {
            owner: id("real"),
            band_id: 90,
            claimed_at: now,
        });
        w.t.db.claimant_account().insert(ClaimantAccount {
            identity: id("real"),
            customer_id: "real-customer".into(),
            account_id: "real-account".into(),
            created_at: now,
        });
        w.internal(|ctx| {
            add_entry(
                ctx,
                id("real"),
                "opening",
                20000,
                String::new(),
                String::new(),
            );
            start(ctx, count, 12);
        });
        w
    }
    fn person(&self, band_id: u32, identity: Identity, crowd: bool) {
        let now = self.t.clock.now();
        self.t.db.attendee().insert(Attendee {
            identity,
            node_id: 0,
            display_name: format!("Person {band_id}"),
            photo_url: String::new(),
            findable: true,
            person_id: 0,
            organization_id: 0,
            crowd,
            created_at: now,
            updated_at: now,
        });
        if crowd {
            self.t.db.crowd_member().insert(CrowdMember {
                band_id,
                identity,
                joined_at: now,
                group_id: (band_id / 4) as u16,
                dx_m: 0.0,
                dy_m: 0.0,
                interests: vec![],
                chat: 0,
            });
        }
        self.t.db.band().insert(Band {
            id: band_id,
            state: 0,
            flags: 0,
            neigh: 0,
            zone: 103,
            bat: 100,
            find: 0,
            rssi: 0,
            seq: 0,
            sos: false,
            fall: false,
            pressed: false,
            low_battery: false,
            has_mpu: false,
            has_motor: false,
            online: true,
            last_seen: now,
            x_m: 0.0,
            y_m: 0.0,
            booth_id: 1,
        });
        self.t.db.zone_visit().insert(ZoneVisit {
            id: 0,
            band_id,
            zone: 103,
            entered: now,
            left: None,
            booth_id: 1,
            open: true,
        });
    }
    fn internal(&self, f: impl FnOnce(&ReducerContext)) {
        self.t
            .with_reducer_tx(TestAuth::internal(), |ctx| {
                f(ctx);
                Ok::<(), String>(())
            })
            .unwrap();
    }
    fn as_(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<(), String>) {
        self.t.with_reducer_tx(auth(who), f).unwrap();
    }
    fn tick(&self, secs: i64) {
        self.t.clock.advance(seconds(secs));
        self.internal(|ctx| tick(ctx, &run(ctx).unwrap()));
    }
    fn workers(&self) {
        let jobs: Vec<_> = self
            .t
            .db
            .job()
            .iter()
            .filter(|j| j.status == JobStatus::Queued)
            .collect();
        for j in jobs {
            self.as_("worker", |ctx| claim_job(ctx, j.id));
            self.as_("worker", |ctx| match j.kind.as_str() {
                KIND_WALLET_OPEN => record_wallet(
                    ctx,
                    j.id,
                    format!("customer-{}", j.id),
                    format!("account-{}", j.id),
                ),
                KIND_MERCH_PURCHASE => {
                    settle_merch_order(ctx, j.id, "merchant".into(), format!("purchase-{}", j.id))
                }
                _ => panic!("unexpected job {}", j.kind),
            });
        }
    }
}

#[test]
fn a_thousand_people_reach_three_hundred_distinct_paid_buyers() {
    let w = World::new(1000);
    for _ in 0..719 {
        w.tick(1);
        w.workers();
    }
    let orders: Vec<_> = w.t.db.merch_order().iter().collect();
    assert_eq!(orders.len(), 300);
    assert_eq!(
        orders
            .iter()
            .map(|o| o.attendee)
            .collect::<HashSet<_>>()
            .len(),
        300
    );
    assert!(
        orders
            .iter()
            .all(|o| o.status == PAID && o.attendee != id("real"))
    );
    assert_eq!(w.t.db.claimant_account().iter().count(), 301);
    assert_eq!(
        w.t.db.wallet_entry().identity().filter(id("real")).count(),
        1
    );
    for order in orders {
        assert!(
            w.t.db
                .photo_tag()
                .photo_id()
                .filter(order.photo_id)
                .any(|tag| tag.attendee == order.attendee)
        );
        assert!(w.t.db.photo_tag().photo_id().filter(order.photo_id).count() <= 3);
        assert_eq!(
            w.t.db
                .merch_template()
                .id()
                .find(order.template_id)
                .unwrap()
                .booth_ids,
            vec![1]
        );
        assert!(
            w.t.db
                .merch_shipping()
                .order_id()
                .find(order.id)
                .unwrap()
                .shipping_address
                .starts_with("Test order, do not ship\n")
        );
    }
    w.internal(|ctx| assert_eq!(spendable(ctx, id("real")), 20000));
}

#[test]
fn seeded_choices_repeat_and_wallet_holds_use_the_normal_checkout() {
    let a = World::new(100);
    let b = World::new(100);
    a.tick(30);
    b.tick(30);
    let first = a.t.db.live_shopper().iter().next().unwrap();
    let repeat = b.t.db.live_shopper().iter().next().unwrap();
    assert_eq!(
        (first.identity, first.template_id, first.size),
        (repeat.identity, repeat.template_id, repeat.size)
    );
    assert_eq!(a.t.db.merch_order().iter().count(), 0);
    a.workers();
    a.tick(1);
    let order = a.t.db.merch_order().iter().next().unwrap();
    assert_eq!(order.status, PAYING);
    a.internal(|ctx| {
        assert_eq!(held_cents(ctx, order.attendee), 1800);
        assert_eq!(spendable(ctx, order.attendee), 18200);
    });
    a.workers();
    a.internal(|ctx| {
        assert_eq!(held_cents(ctx, order.attendee), 0);
        assert_eq!(spendable(ctx, order.attendee), 18200);
    });
}

#[test]
fn worker_backpressure_and_restart_keep_wallet_openings_bounded() {
    let w = World::new(1000);
    for _ in 0..120 {
        w.tick(1);
    }
    assert_eq!(
        w.t.db.job().kind().filter(KIND_WALLET_OPEN).count(),
        MAX_PENDING
    );
    assert_eq!(w.t.db.merch_order().iter().count(), 0);
    let old: Vec<_> = w.t.db.live_shopper().iter().collect();
    // Recreated attendee node IDs are deliberately different, as on Start event.
    for shopper in &old {
        let a = w.t.db.attendee().identity().find(shopper.identity).unwrap();
        w.t.db.attendee().identity().delete(a.identity);
        w.t.db.attendee().insert(Attendee { node_id: 0, ..a });
    }
    w.internal(|ctx| start(ctx, 1000, 12));
    w.tick(30);
    assert_eq!(
        w.t.db.job().kind().filter(KIND_WALLET_OPEN).count(),
        MAX_PENDING
    );
    w.workers();
    assert_eq!(w.t.db.claimant_account().iter().count(), MAX_PENDING + 1);
    for shopper in old {
        assert!(
            w.t.db
                .claimant_account()
                .identity()
                .find(shopper.identity)
                .is_some()
        );
    }
}

#[test]
fn pause_evacuation_end_and_clock_jumps_never_catch_up_in_a_burst() {
    let w = World::new(1000);
    w.tick(30);
    w.workers();
    w.as_("ops", pause_live_run);
    w.tick(100);
    assert_eq!(w.t.db.merch_order().iter().count(), 0);
    w.as_("ops", resume_live_run);
    w.tick(0);
    assert_eq!(w.t.db.merch_order().iter().count(), 1);
    assert_eq!(w.t.db.live_shopper().iter().count(), 1);
    w.as_("ops", |ctx| evacuate_live_run(ctx, true));
    w.tick(100);
    assert_eq!(w.t.db.live_shopper().iter().count(), 1);
    w.as_("ops", |ctx| evacuate_live_run(ctx, false));
    w.tick(0);
    assert_eq!(w.t.db.live_shopper().iter().count(), 1);
    w.tick(100);
    assert!(w.t.db.live_shopper().iter().count() <= 2);
    w.as_("ops", crate::web::end_event);
    let before = w.t.db.live_shopper().iter().count();
    w.tick(100);
    assert_eq!(w.t.db.live_shopper().iter().count(), before);
    w.as_("ops", end_live_run);
    w.tick(1);
    assert_eq!(w.t.db.live_shopper().iter().count(), before);
}

#[test]
fn missing_inputs_or_photo_ownership_never_create_holds() {
    let w = World::new(100);
    let venue = w.t.db.venue().iter().next().unwrap();
    w.t.db.venue().id().update(Venue {
        address: String::new(),
        ..venue.clone()
    });
    w.tick(30);
    assert_eq!(w.t.db.job().iter().count(), 0);
    w.t.db.venue().id().update(venue);
    w.tick(30);
    w.workers();
    let selected = w.t.db.live_shopper().iter().next().unwrap();
    for tag in
        w.t.db
            .photo_tag()
            .photo_id()
            .filter(selected.photo_id)
            .collect::<Vec<_>>()
    {
        w.t.db.photo_tag().id().delete(tag.id);
    }
    w.tick(1);
    assert_eq!(w.t.db.merch_order().iter().count(), 0);
    w.internal(|ctx| assert_eq!(held_cents(ctx, selected.identity), 0));
    for template in w.t.db.merch_template().iter().collect::<Vec<_>>() {
        w.t.db.merch_template().id().delete(template.id);
    }
    let count = w.t.db.job().iter().count();
    w.tick(30);
    assert_eq!(w.t.db.job().iter().count(), count);
}

#[test]
fn down_offline_departed_and_real_attendees_are_never_selected() {
    let w = World::new(3);
    let b = w.t.db.band().id().find(100).unwrap();
    w.t.db.band().id().update(Band { fall: true, ..b });
    let b = w.t.db.band().id().find(101).unwrap();
    w.t.db.band().id().update(Band { online: false, ..b });
    let a = w.t.db.attendee().identity().find(crowd_id(102)).unwrap();
    w.t.db.departure().insert(crate::departure::Departure {
        attendee: a.identity,
        node_id: a.node_id,
        name: a.display_name,
        band_id: 102,
        door: String::new(),
        station_id: 103,
        x_m: 0.0,
        y_m: 0.0,
        asked_at: w.t.clock.now(),
        left_at: None,
        by: "ops".into(),
    });
    w.tick(30);
    assert_eq!(w.t.db.live_shopper().iter().count(), 0);
    assert_eq!(w.t.db.job().iter().count(), 0);
}

#[test]
fn start_event_resets_the_selection_schedule_without_erasing_money() {
    let w = World::new(10);
    w.tick(30);
    w.workers();
    w.tick(1);
    w.workers();
    w.as_("ops", |ctx| start_live_run(ctx, 10, 12, 1, true, 42));
    assert_eq!(w.t.db.live_shopper().iter().count(), 0);
    assert_eq!(w.t.db.live_shopping().id().find(0).unwrap().target, 3);
    assert_eq!(w.t.db.merch_order().iter().count(), 1);
    assert_eq!(
        w.t.db
            .wallet_entry()
            .iter()
            .filter(|e| e.kind == "purchase")
            .count(),
        1
    );
    // The actual scheduler path has the same initial delay.
    w.t.with_reducer_tx(TestAuth::internal(), |ctx| {
        live_tick(
            ctx,
            LiveRunTimer {
                scheduled_id: 0,
                scheduled_at: ScheduleAt::Time(ctx.timestamp),
            },
        )
    })
    .unwrap();
    assert_eq!(w.t.db.live_shopper().iter().count(), 0);
}
