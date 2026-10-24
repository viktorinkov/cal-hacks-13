//! Sign-up to paid merch inside an in-memory module: the wallet opens with $200, the recap suggests
//! the attendee's photos on the templates of the booths they stayed at, and a purchase settles or
//! fails through the same reducers the worker calls.

use super::*;
use crate::roles::*;
use crate::social::onboarding::update_profile;
use crate::tables::*;
use crate::wallet::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, Table, TimeDuration, Timestamp};

fn id(name: &str) -> Identity {
    Identity::from_claims("bandit-test", name)
}

fn auth(name: &str) -> TestAuth {
    let payload = format!(r#"{{"iss":"bandit-test","sub":"{name}"}}"#);
    TestAuth::from_jwt_payload(payload, ConnectionId::from_u128(name.len() as u128 + 1)).unwrap()
}

struct World {
    t: TestContext,
    sponsor_row: u64,
    food: u64,
}

impl World {
    fn new() -> Self {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000));
        t.db.owner().insert(Owner { identity: id("owner") });
        for (who, role) in [("worker", "worker"), ("ops", "ops")] {
            t.db.staff_role().insert(StaffRole { id: 0, identity: id(who), role: role.into(), label: who.into(), granted_by: id("owner"), granted_at: t.clock.now() });
        }
        let zone = |key: &str, name: &str, station: u8| {
            t.db.zone()
                .insert(Zone {
                    id: 0,
                    source_key: key.into(),
                    venue_id: 1,
                    name: name.into(),
                    kind: "floor".into(),
                    station_id: station,
                    plan_x_m: 0.0,
                    plan_y_m: 0.0,
                    area_sq_m: 100.0,
                    capacity: 100,
                    exit_colour: 0,
                    description: String::new(),
                    updated_at: t.clock.now(),
                })
                .id
        };
        let sponsor_row = zone("zone:sponsor-row", "Sponsor row", 103);
        let food = zone("zone:food", "Food and drinks", 105);
        for sponsor in ["SpacetimeDB", "Elastic", "Bright Data", "Capital One", "Hyphenate", "Anthropic"] {
            let org = t.db.organization().insert(Organization {
                id: 0,
                source_key: format!("org:{sponsor}"),
                venue_id: 1,
                name: sponsor.into(),
                kind: "sponsor".into(),
                sponsor_tier: String::new(),
                website: String::new(),
                domain: String::new(),
                logo_url: String::new(),
                description: String::new(),
                category: String::new(),
                tags: Vec::new(),
                industry: String::new(),
                headquarters: String::new(),
                size_range: String::new(),
                founded_year: 0,
                linkedin_url: String::new(),
                prizes: Vec::new(),
                source_url: String::new(),
                fetched_at: t.clock.now(),
                updated_at: t.clock.now(),
                crunchbase_url: String::new(),
                funding_summary: String::new(),
            });
            t.db.booth().insert(Booth {
                id: 0,
                source_key: format!("booth:{sponsor}"),
                venue_id: 1,
                zone_id: sponsor_row,
                organization_id: org.id,
                booth_number: String::new(),
                name: format!("{sponsor} booth"),
                kind: "sponsor".into(),
                description: String::new(),
                tags: Vec::new(),
                plan_x_m: 0.0,
                plan_y_m: 0.0,
                placement: String::new(),
                source_url: String::new(),
                fetched_at: t.clock.now(),
                updated_at: t.clock.now(),
            });
        }
        for name in ["Maya Chen", "Jordan Alvarez"] {
            t.db.attendee().insert(Attendee {
                identity: id(name),
                node_id: 0,
                display_name: String::new(),
                photo_url: String::new(),
                findable: true,
                person_id: 0,
                organization_id: 0,
                simulated: false,
                created_at: t.clock.now(),
                updated_at: t.clock.now(),
            });
        }
        let w = World { t, sponsor_row, food };
        w.as_("ops", |ctx| load_merch_templates(ctx, templates()));
        w
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    fn try_as<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> Result<T, String> {
        self.t.with_reducer_tx(auth(who), f)
    }

    fn view(&self, who: &str) -> spacetimedb::ViewContext {
        self.t.view_context(auth(who))
    }

    fn queued(&self, kind: &str) -> Job {
        self.t.db.job().iter().filter(|j| j.kind == kind && j.status == JobStatus::Queued).max_by_key(|j| j.id).unwrap_or_else(|| panic!("no queued {kind} job"))
    }

    /// The worker leases the queued job of `kind`.
    fn lease(&self, kind: &str) -> Job {
        let job = self.queued(kind);
        self.as_("worker", |ctx| claim_job(ctx, job.id));
        job
    }

    /// Signs up and opens the wallet the way the worker does.
    fn sign_up(&self, name: &str) {
        self.as_(name, |ctx| update_profile(ctx, name.into(), true));
        self.as_(name, crate::wallet::connect_wallet);
        let job = self.lease(crate::wallet::KIND_WALLET_OPEN);
        self.as_("worker", |ctx| record_wallet(ctx, job.id, format!("cust-{name}"), format!("acct-{name}")));
    }

    fn visit(&self, name: &str, zone_id: u64, minutes: f32) {
        let n = self.t.db.visit().iter().count() as u64 + 1;
        self.t.db.visit().insert(Visit {
            zone_visit_id: n,
            attendee: id(name),
            zone_id,
            band_id: 3,
            started_at: self.t.clock.now(),
            ended_at: None,
            minutes,
            updated_at: self.t.clock.now(),
        });
    }

    /// A photo taken now in `zone_id`, with `name` tagged as `status`.
    fn photo(&self, name: &str, zone_id: u64, status: &str) -> u64 {
        let photo = self.t.db.photo().insert(Photo {
            id: 0,
            url: format!("/photos/{zone_id}-{}.jpg", self.t.db.photo().iter().count()),
            taken_at: self.t.clock.now(),
            zone_id,
            caption: String::new(),
            added_by: id("photographer"),
            created_at: self.t.clock.now(),
        });
        self.t.db.photo_tag().insert(PhotoTag { id: 0, photo_id: photo.id, attendee: id(name), status: status.into(), updated_at: self.t.clock.now() });
        self.t.clock.advance(TimeDuration::from_micros(60_000_000));
        photo.id
    }

    /// The host's "Event ended" button; merch is sold only after it.
    fn end_event(&self) {
        self.as_("ops", crate::web::end_event);
    }

    fn balance(&self, name: &str) -> i64 {
        my_wallet(&self.view(name)).expect("wallet is open").balance_cents
    }

    fn template(&self, name: &str) -> MerchTemplate {
        self.t.db.merch_template().name().find(name.to_string()).unwrap()
    }

    fn order(&self, order_id: u64) -> MerchOrder {
        self.t.db.merch_order().id().find(order_id).unwrap()
    }

    fn last_order(&self) -> MerchOrder {
        self.t.db.merch_order().iter().max_by_key(|o| o.id).unwrap()
    }
}

/// The six Cal Hacks 13.0 templates, as scripts/merch-setup sends them.
fn templates() -> Vec<MerchTemplateIn> {
    let t = |name: &str, title: &str, kind: &str, sponsors: &[&str]| MerchTemplateIn {
        name: name.into(),
        title: title.into(),
        kind: kind.into(),
        width: 1254,
        height: 1254,
        photo_x: 100,
        photo_y: 100,
        photo_w: 400,
        photo_h: 300,
        sponsors: sponsors.iter().map(|s| s.to_string()).collect(),
    };
    vec![
        t("tee.png", "Cal Hacks 13.0 tee", "tee", &[]),
        t("mug.png", "Cal Hacks 13.0 mug", "mug", &[]),
        t("poster.png", "Cal Hacks 13.0 poster", "poster", &[]),
        t("tee_spacetimedb.png", "SpacetimeDB tee", "tee", &["SpacetimeDB"]),
        t("mug_elastic.png", "Elastic mug", "mug", &["Elastic"]),
        t("poster_booth_crawl.png", "Booth crawl poster", "poster", &["SpacetimeDB", "Elastic", "Bright Data", "Capital One", "Hyphenate", "Anthropic"]),
    ]
}

#[test]
fn templates_load_with_prices_and_sponsor_booths_and_reload_in_place() {
    let w = World::new();
    assert_eq!(w.t.db.merch_template().count(), 6);
    let tee = w.template("tee_spacetimedb.png");
    assert_eq!((tee.kind.as_str(), tee.price_cents, tee.booth_ids.len()), ("tee", 2500, 1));
    assert_eq!(tee.image_url, "/assets/merch/tee_spacetimedb.png");
    assert_eq!(w.template("mug.png").price_cents, 1800);
    assert!(w.template("poster.png").booth_ids.is_empty());
    assert_eq!(w.template("poster_booth_crawl.png").booth_ids.len(), 6);

    w.as_("ops", |ctx| load_merch_templates(ctx, templates()));
    assert_eq!(w.t.db.merch_template().count(), 6);
    assert_eq!(w.template("tee_spacetimedb.png").id, tee.id);
    assert!(w.try_as("Maya Chen", |ctx| load_merch_templates(ctx, templates())).is_err());
}

#[test]
fn connecting_the_wallet_opens_it_once() {
    let w = World::new();
    w.as_("Maya Chen", |ctx| update_profile(ctx, "Maya Chen".into(), true));
    w.as_("Maya Chen", crate::wallet::connect_wallet);
    w.as_("Maya Chen", crate::wallet::connect_wallet);
    let opening: Vec<Job> = w.t.db.job().kind().filter(crate::wallet::KIND_WALLET_OPEN).collect();
    assert_eq!(opening.len(), 1, "a second connect while the wallet opens queues nothing");
    assert!(my_wallet(&w.view("Maya Chen")).is_none());

    let job = w.lease(crate::wallet::KIND_WALLET_OPEN);
    assert!(w.try_as("Maya Chen", |ctx| record_wallet(ctx, job.id, "c".into(), "a".into())).is_err());
    w.as_("worker", |ctx| record_wallet(ctx, job.id, "cust-1".into(), "acct-1".into()));
    let wallet = my_wallet(&w.view("Maya Chen")).unwrap();
    assert_eq!((wallet.account_id.as_str(), wallet.balance_cents), ("acct-1", 20_000));
    assert_eq!(my_wallet_entries(&w.view("Maya Chen")).len(), 1);
    assert!(my_wallet(&w.view("Jordan Alvarez")).is_none());

    w.as_("Maya Chen", |ctx| update_profile(ctx, "Maya Chen".into(), true));
    assert_eq!(w.t.db.job().kind().filter(crate::wallet::KIND_WALLET_OPEN).count(), 1, "an open wallet is never opened again");
}

#[test]
fn suggestions_rank_sponsor_templates_by_minutes_at_their_booths() {
    let w = World::new();
    assert!(my_merch_suggestions(&w.view("Maya Chen")).is_empty(), "no confirmed photo, nothing to suggest");

    w.visit("Maya Chen", w.sponsor_row, 25.0);
    w.visit("Maya Chen", w.sponsor_row, 15.0);
    w.visit("Maya Chen", w.food, 50.0);
    let at_booths = w.photo("Maya Chen", w.sponsor_row, "confirmed");
    let newest = w.photo("Maya Chen", w.food, "confirmed");
    w.photo("Maya Chen", w.food, "suggested");

    let s = my_merch_suggestions(&w.view("Maya Chen"));
    let names: Vec<&str> = s.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(names, ["SpacetimeDB tee", "Elastic mug", "Booth crawl poster"]);
    assert!(s.iter().all(|s| s.photo_id == at_booths && s.minutes == 40.0));
    assert_eq!(s.iter().map(|s| s.rank).collect::<Vec<_>>(), [1, 2, 3]);
    assert_eq!((s[0].photo_x, s[0].photo_w, s[0].price_cents), (100, 400, 2500));

    // Someone who never went to the sponsor row gets the plain templates with their newest photo.
    w.visit("Jordan Alvarez", w.food, 30.0);
    w.photo("Jordan Alvarez", w.food, "confirmed");
    let jordan = w.photo("Jordan Alvarez", w.food, "confirmed");
    let s = my_merch_suggestions(&w.view("Jordan Alvarez"));
    let names: Vec<&str> = s.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(names, ["Cal Hacks 13.0 tee", "Cal Hacks 13.0 mug", "Cal Hacks 13.0 poster"]);
    assert!(s.iter().all(|s| s.photo_id == jordan && s.minutes == 0.0));
    assert_ne!(newest, jordan);
}

#[test]
fn a_purchase_holds_the_money_and_settles_into_the_wallet() {
    let w = World::new();
    w.sign_up("Maya Chen");
    let photo = w.photo("Maya Chen", w.sponsor_row, "confirmed");
    let tee = w.template("tee_spacetimedb.png");

    let err = w.try_as("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, "M".into())).unwrap_err();
    assert!(err.contains("once the event ends"), "{err}");
    w.end_event();
    assert!(w.try_as("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, String::new())).unwrap_err().contains("size"));
    assert!(w.try_as("Jordan Alvarez", |ctx| buy_merch(ctx, tee.id, photo, "M".into())).unwrap_err().contains("photo"));
    w.as_("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, "M".into()));
    let order = w.last_order();
    assert_eq!((order.status.as_str(), order.size.as_str(), order.amount_cents), (PAYING, "M", 2500));
    assert_eq!(w.balance("Maya Chen"), 17_500, "the paying order is held");

    let job = w.lease(KIND_MERCH_PURCHASE);
    let payload: serde_json::Value = serde_json::from_str(&job.payload).unwrap();
    assert_eq!(payload["account_id"], "acct-Maya Chen");
    assert_eq!(payload["amount_cents"], 2500);
    assert_eq!(payload["merchant_id"], "");
    assert_eq!(payload["memo"], format!("BandIt merch order {}: SpacetimeDB tee (M)", order.id));
    w.as_("worker", |ctx| settle_merch_order(ctx, job.id, "merchant-1".into(), "purchase-1".into()));

    let order = w.order(order.id);
    assert_eq!((order.status.as_str(), order.nessie_purchase_id.as_str()), (PAID, "purchase-1"));
    assert_eq!(w.balance("Maya Chen"), 17_500);
    assert_eq!(my_merch_orders(&w.view("Maya Chen")).len(), 1);
    assert!(my_merch_orders(&w.view("Jordan Alvarez")).is_empty());
    let entries = my_wallet_entries(&w.view("Maya Chen"));
    assert_eq!(entries.last().map(|e| (e.kind.as_str(), e.amount_cents)), Some(("purchase", -2500)));

    // The next purchase carries the merchant the first one created; a mug needs no size.
    let mug = w.template("mug_elastic.png");
    w.as_("Maya Chen", |ctx| buy_merch(ctx, mug.id, photo, "XL".into()));
    assert_eq!(w.last_order().size, "");
    let payload: serde_json::Value = serde_json::from_str(&w.queued(KIND_MERCH_PURCHASE).payload).unwrap();
    assert_eq!(payload["merchant_id"], "merchant-1");
}

#[test]
fn a_failed_purchase_frees_the_money_and_the_wallet_cannot_overspend() {
    let w = World::new();
    let photo = w.photo("Maya Chen", w.sponsor_row, "confirmed");
    let tee = w.template("tee.png");
    w.end_event();
    w.as_("Maya Chen", |ctx| update_profile(ctx, "Maya Chen".into(), true));
    w.as_("Maya Chen", crate::wallet::connect_wallet);
    assert!(w.try_as("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, "S".into())).unwrap_err().contains("opening"));
    let job = w.lease(crate::wallet::KIND_WALLET_OPEN);
    w.as_("worker", |ctx| record_wallet(ctx, job.id, "c".into(), "a".into()));

    w.as_("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, "S".into()));
    let order = w.last_order();
    for attempt in 1..=MAX_ATTEMPTS {
        let job = w.lease(KIND_MERCH_PURCHASE);
        w.as_("worker", |ctx| fail_job(ctx, job.id, format!("Nessie unreachable ({attempt})"), None));
        w.t.clock.advance(TimeDuration::from_micros(60_000_000));
    }
    let order = w.order(order.id);
    assert_eq!((order.status.as_str(), order.failure.as_str()), (FAILED, "Nessie unreachable (3)"));
    assert_eq!(w.balance("Maya Chen"), 20_000);

    for _ in 0..8 {
        w.as_("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, "S".into()));
    }
    assert_eq!(w.balance("Maya Chen"), 0);
    let err = w.try_as("Maya Chen", |ctx| buy_merch(ctx, tee.id, photo, "S".into())).unwrap_err();
    assert!(err.contains("not enough money"), "{err}");
}

#[test]
fn a_claim_payout_lands_in_the_wallet() {
    let w = World::new();
    w.sign_up("Maya Chen");
    w.as_("worker", |ctx| {
        crate::wallet::on_payout(ctx, id("Maya Chen"), 7, 18_000, "deposit-1".into());
        Ok(())
    });
    assert_eq!(w.balance("Maya Chen"), 38_000);
    let entry = my_wallet_entries(&w.view("Maya Chen")).pop().unwrap();
    assert_eq!((entry.kind.as_str(), entry.memo.as_str(), entry.nessie_id.as_str()), ("payout", "BandIt claim 7 payout", "deposit-1"));
}
