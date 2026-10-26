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
                crowd: false,
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
            booth_id: 0,
            open: true,
        });
    }

    /// A photo taken now in `zone_id`, with `name` tagged in it.
    fn photo(&self, name: &str, zone_id: u64) -> u64 {
        let photo = self.t.db.photo().insert(Photo {
            id: 0,
            url: format!("/photos/{zone_id}-{}.jpg", self.t.db.photo().iter().count()),
            taken_at: self.t.clock.now(),
            zone_id,
            caption: String::new(),
            added_by: id("photographer"),
            created_at: self.t.clock.now(),
            people_count: 0,
            features_call_id: 0,
        });
        self.t.db.photo_tag().insert(PhotoTag { id: 0, photo_id: photo.id, attendee: id(name), status: String::new(), updated_at: self.t.clock.now() });
        self.t.clock.advance(TimeDuration::from_micros(60_000_000));
        photo.id
    }

    /// The host's "Event ended" button, which also queues the final shopping picks.
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

    /// Also tags `name` in the photo.
    fn tag(&self, photo_id: u64, name: &str) {
        self.t.db.photo_tag().insert(PhotoTag { id: 0, photo_id, attendee: id(name), status: String::new(), updated_at: self.t.clock.now() });
    }

    /// The two spent 20 minutes close together: they met.
    fn met(&self, a: &str, b: &str) {
        let (a, b) = if id(a) < id(b) { (id(a), id(b)) } else { (id(b), id(a)) };
        self.t.db.social_encounter().insert(SocialEncounter {
            id: 0,
            band_pair: self.t.db.social_encounter().iter().count() as u64 + 1,
            attendee_a: a,
            attendee_b: b,
            zone_id: self.sponsor_row,
            baseline_seconds: 0,
            seconds_together: 1200,
            started_at: self.t.clock.now(),
            last_seen_at: self.t.clock.now(),
            met: true,
            updated_at: self.t.clock.now(),
        });
    }
}

fn pick(template_id: u64, photo_id: u64, line: &str) -> MerchPickIn {
    MerchPickIn { template_id, photo_id, line: line.into(), reason: "You spent most of your night at the sponsor row.".into() }
}

fn call() -> ModelCallIn {
    ModelCallIn { kind: KIND_MERCH_PICKS.into(), model_used: "claude-opus-5-5".into(), status: "ok".into(), ..Default::default() }
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
    assert!(my_merch_suggestions(&w.view("Maya Chen")).is_empty(), "no photo, nothing to suggest");

    w.visit("Maya Chen", w.sponsor_row, 25.0);
    w.visit("Maya Chen", w.sponsor_row, 15.0);
    w.visit("Maya Chen", w.food, 50.0);
    let at_booths = w.photo("Maya Chen", w.sponsor_row);
    let newest = w.photo("Maya Chen", w.food);

    let s = my_merch_suggestions(&w.view("Maya Chen"));
    let names: Vec<&str> = s.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(names, ["SpacetimeDB tee", "Elastic mug", "Booth crawl poster"]);
    assert!(s.iter().all(|s| s.photo_id == at_booths));
    assert_eq!(s.iter().map(|s| s.rank).collect::<Vec<_>>(), [1, 2, 3]);
    assert_eq!((s[0].photo_x, s[0].photo_w, s[0].price_cents), (100, 400, 2500));

    // Someone who never went to the sponsor row gets the plain templates with their newest photo.
    w.visit("Jordan Alvarez", w.food, 30.0);
    w.photo("Jordan Alvarez", w.food);
    let jordan = w.photo("Jordan Alvarez", w.food);
    let s = my_merch_suggestions(&w.view("Jordan Alvarez"));
    let names: Vec<&str> = s.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(names, ["Cal Hacks 13.0 tee", "Cal Hacks 13.0 mug", "Cal Hacks 13.0 poster"]);
    assert!(s.iter().all(|s| s.photo_id == jordan));
    assert_ne!(newest, jordan);
}

#[test]
fn purchases_during_and_after_the_event_hold_money_and_settle_into_the_wallet() {
    let w = World::new();
    w.as_("ops", crate::web::reopen_event);
    w.sign_up("Maya Chen");
    let photo = w.photo("Maya Chen", w.sponsor_row);
    let tee = w.template("tee_spacetimedb.png");

    assert!(!w.t.db.event_state().id().find(0).unwrap().ended);
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
    assert!(my_merch_shipping(&w.view("Maya Chen")).is_empty(), "earlier clients still buy without changing their order schema");
    let entries = my_wallet_entries(&w.view("Maya Chen"));
    assert_eq!(entries.last().map(|e| (e.kind.as_str(), e.amount_cents)), Some(("purchase", -2500)));

    // Buying still works after the event; the next purchase reuses the merchant.
    w.end_event();
    let mug = w.template("mug_elastic.png");
    w.as_("Maya Chen", |ctx| buy_merch(ctx, mug.id, photo, "XL".into()));
    assert_eq!(w.last_order().size, "");
    let payload: serde_json::Value = serde_json::from_str(&w.queued(KIND_MERCH_PURCHASE).payload).unwrap();
    assert_eq!(payload["merchant_id"], "merchant-1");
}

#[test]
fn a_failed_purchase_frees_the_money_and_the_wallet_cannot_overspend() {
    let w = World::new();
    let photo = w.photo("Maya Chen", w.sponsor_row);
    let tee = w.template("tee.png");
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

#[test]
fn the_organizer_buys_as_an_attendee_from_their_wallet() {
    let w = World::new();
    w.sign_up("Maya Chen");
    let photo = w.photo("Maya Chen", w.sponsor_row);
    let tee = w.template("tee_spacetimedb.png");
    let maya = w.t.db.attendee().identity().find(id("Maya Chen")).unwrap().node_id;
    assert!(w.try_as("Jordan Alvarez", |ctx| buy_merch_as(ctx, maya, tee.id, photo, "M".into())).unwrap_err().contains("roles"));
    assert!(w.try_as("ops", |ctx| buy_merch_as(ctx, maya + 99, tee.id, photo, "M".into())).unwrap_err().contains("no such attendee"));
    w.as_("ops", |ctx| buy_merch_as(ctx, maya, tee.id, photo, "L".into()));
    let order = w.last_order();
    assert_eq!((order.attendee, order.size.as_str(), order.status.as_str()), (id("Maya Chen"), "L", PAYING));
    assert_eq!(w.balance("Maya Chen"), 17_500);

    let wallets = crate::wallet::board_wallets(&w.view("ops"));
    assert_eq!(wallets.iter().map(|x| (x.node_id, x.balance_cents)).collect::<Vec<_>>(), [(maya, 17_500)]);
    assert!(crate::wallet::board_wallets(&w.view("Maya Chen")).is_empty());
}

#[test]
fn shipping_checkout_rejects_missing_and_overlong_addresses_without_holding_money() {
    let w = World::new();
    w.sign_up("Maya Chen");
    let photo = w.photo("Maya Chen", w.sponsor_row);
    let mug = w.template("mug_elastic.png");

    for address in [" \n\t ".to_string(), "a".repeat(SHIPPING_ADDRESS_CHARS + 1)] {
        let err = w.try_as("Maya Chen", |ctx| buy_merch_with_shipping(ctx, mug.id, photo, String::new(), address)).unwrap_err();
        assert!(err.contains("shipping address"), "{err}");
    }
    assert_eq!(w.t.db.merch_order().count(), 0);
    assert_eq!(w.t.db.merch_shipping().count(), 0);
    assert_eq!(w.t.db.job().kind().filter(KIND_MERCH_PURCHASE).count(), 0);
    assert_eq!(w.balance("Maya Chen"), 20_000);
}

#[test]
fn shipping_is_trimmed_fixed_per_order_and_visible_only_with_the_orders() {
    let w = World::new();
    w.as_("ops", crate::web::reopen_event);
    w.sign_up("Maya Chen");
    let photo = w.photo("Maya Chen", w.sponsor_row);
    let mug = w.template("mug_elastic.png");
    let address = "Maya Chen\nEvent delivery desk\nFort Mason Center\nSan Francisco, CA 94123\nUnited States";
    w.as_("Maya Chen", |ctx| buy_merch_with_shipping(ctx, mug.id, photo, String::new(), format!("  {address}\n ")));
    let first = w.last_order();
    assert_eq!(w.t.db.merch_shipping().order_id().find(first.id).unwrap().shipping_address, address);
    assert_eq!(w.balance("Maya Chen"), 18_200);
    assert_eq!(my_merch_shipping(&w.view("Maya Chen"))[0].shipping_address, address);
    assert!(my_merch_shipping(&w.view("Jordan Alvarez")).is_empty());
    assert!(board_merch_shipping(&w.view("Jordan Alvarez")).is_empty());
    assert_eq!(board_merch_shipping(&w.view("ops"))[0].order_id, first.id);
    assert_eq!(board_merch_shipping(&w.view("owner"))[0].shipping_address, address);

    let job = w.lease(KIND_MERCH_PURCHASE);
    w.as_("worker", |ctx| settle_merch_order(ctx, job.id, "merchant-1".into(), "purchase-1".into()));
    assert_eq!(w.order(first.id).status, PAID);
    w.end_event();
    let next_address = "Maya Chen\nEvent collection desk B\nFort Mason Center\nSan Francisco, CA 94123\nUnited States";
    w.as_("Maya Chen", |ctx| buy_merch_with_shipping(ctx, mug.id, photo, String::new(), next_address.into()));
    assert_eq!(w.t.db.merch_shipping().order_id().find(first.id).unwrap().shipping_address, address);
    assert_eq!(w.t.db.merch_shipping().order_id().find(w.last_order().id).unwrap().shipping_address, next_address);
    assert_eq!(my_merch_shipping(&w.view("Maya Chen")).len(), 2);
}

#[test]
fn organizer_shipping_checkout_keeps_role_and_photo_checks() {
    let w = World::new();
    w.sign_up("Maya Chen");
    w.sign_up("Jordan Alvarez");
    let photo = w.photo("Maya Chen", w.sponsor_row);
    let tee = w.template("tee.png");
    let maya = w.t.db.attendee().identity().find(id("Maya Chen")).unwrap().node_id;
    let jordan = w.t.db.attendee().identity().find(id("Jordan Alvarez")).unwrap().node_id;
    let address = "Maya Chen\nEvent delivery desk\nFort Mason Center\nSan Francisco, CA 94123\nUnited States";
    assert!(w.try_as("Jordan Alvarez", |ctx| buy_merch_as_with_shipping(ctx, maya, tee.id, photo, "M".into(), address.into())).unwrap_err().contains("roles"));
    assert!(w.try_as("ops", |ctx| buy_merch_as_with_shipping(ctx, maya, tee.id, photo, "M".into(), " ".into())).unwrap_err().contains("shipping address"));
    assert!(w.try_as("ops", |ctx| buy_merch_as_with_shipping(ctx, jordan, tee.id, photo, "M".into(), address.into())).unwrap_err().contains("photo"));
    assert_eq!(w.t.db.merch_order().count(), 0);
    w.as_("ops", |ctx| buy_merch_as_with_shipping(ctx, maya, tee.id, photo, "M".into(), address.into()));
    let order = w.last_order();
    assert_eq!(order.attendee, id("Maya Chen"));
    assert_eq!(board_merch_shipping(&w.view("ops"))[0].shipping_address, address);
    assert_eq!(w.balance("Maya Chen"), 17_500);
    assert_eq!(w.balance("Jordan Alvarez"), 20_000);
}

#[test]
fn suggestions_prefer_photos_with_the_people_you_met_and_tick_the_booths_you_visited() {
    let w = World::new();
    for name in ["Maya Chen", "Jordan Alvarez"] {
        w.as_(name, |ctx| update_profile(ctx, name.into(), true));
    }
    w.visit("Maya Chen", w.sponsor_row, 30.0);
    let together = w.photo("Maya Chen", w.sponsor_row);
    w.tag(together, "Jordan Alvarez");
    w.photo("Maya Chen", w.sponsor_row);
    w.met("Maya Chen", "Jordan Alvarez");

    let s = my_merch_suggestions(&w.view("Maya Chen"));
    assert!(s.iter().all(|s| s.photo_id == together), "the photo with the person she met wins over the newer one");
    assert_eq!(s[0].friends, ["Jordan Alvarez"]);
    assert_eq!(s[0].line, "with Jordan Alvarez");
    assert_eq!(s[0].reason, "");
    let crawl = s.iter().find(|s| s.title == "Booth crawl poster").unwrap();
    assert_eq!(crawl.ticks.len(), 6, "every sponsor booth in the zone she visited");
    assert_eq!(friends_line(&["A".into(), "B".into(), "C".into(), "D".into()]), "with A, B & 2 more");
    assert_eq!(friends_line(&["A".into(), "B".into(), "C".into()]), "with A, B & C");
}

#[test]
fn the_shopping_agent_picks_replace_the_ranking_and_go_onto_the_order() {
    let w = World::new();
    w.sign_up("Maya Chen");
    w.as_("Jordan Alvarez", |ctx| update_profile(ctx, "Jordan Alvarez".into(), true));
    w.visit("Maya Chen", w.sponsor_row, 30.0);
    let together = w.photo("Maya Chen", w.sponsor_row);
    w.tag(together, "Jordan Alvarez");
    let jordans = w.photo("Jordan Alvarez", w.food);
    w.met("Maya Chen", "Jordan Alvarez");

    w.end_event();
    let jobs: Vec<Job> = w.t.db.job().kind().filter(KIND_MERCH_PICKS).collect();
    assert_eq!(jobs.len(), 2, "one run for each attendee in a photo");
    let maya_node = w.t.db.attendee().identity().find(id("Maya Chen")).unwrap().node_id;
    let job = jobs.iter().find(|j| j.subject_id == maya_node).unwrap().clone();
    let payload: serde_json::Value = serde_json::from_str(&job.payload).unwrap();
    assert_eq!(payload["attendee"], "Maya Chen");
    assert_eq!(payload["photos"][0]["people_you_met_in_it"], serde_json::json!(["Jordan Alvarez"]));
    assert_eq!(payload["products"].as_array().unwrap().len(), 6);
    assert_eq!(payload["places"][0]["zone"], "Sponsor row");

    w.as_("worker", |ctx| claim_job(ctx, job.id));
    let mug = w.template("mug_elastic.png");
    let picks = vec![
        pick(mug.id, together, "Elastic booth crew with Jordan, and a line that runs far too long"),
        pick(9_999, together, "no such template"),
        pick(mug.id, together, "the same template twice"),
        pick(w.template("tee.png").id, jordans, "not her photo"),
        pick(w.template("poster_booth_crawl.png").id, together, "Booth crawl"),
    ];
    assert!(w.try_as("Maya Chen", |ctx| submit_merch_picks(ctx, job.id, picks.clone(), call())).is_err());
    w.as_("worker", |ctx| submit_merch_picks(ctx, job.id, picks, call()));

    let s = my_merch_suggestions(&w.view("Maya Chen"));
    let titles: Vec<&str> = s.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(titles, ["Elastic mug", "Booth crawl poster"]);
    assert_eq!(s[0].line.chars().count(), LINE_CHARS);
    assert!(s[0].reason.starts_with("You spent"));
    assert_eq!(board_merch_picks(&w.view("ops")).len(), 2);
    assert!(board_merch_picks(&w.view("Maya Chen")).is_empty());

    w.as_("Maya Chen", |ctx| buy_merch(ctx, mug.id, together, String::new()));
    assert_eq!(w.last_order().line, s[0].line);
}

#[test]
fn leaving_early_queues_final_picks_and_shopping_stays_open_for_everyone() {
    let w = World::new();
    w.sign_up("Maya Chen");
    w.sign_up("Jordan Alvarez");
    let hers = w.photo("Maya Chen", w.sponsor_row);
    let his = w.photo("Jordan Alvarez", w.food);
    let mug = w.template("mug_elastic.png");
    let maya_node = w.t.db.attendee().identity().find(id("Maya Chen")).unwrap().node_id;

    w.as_("Maya Chen", crate::departure::leave_event);
    let gone = crate::departure::my_departure(&w.view("Maya Chen")).expect("she left");
    assert!(gone.left_at.is_some(), "without a crowd band she is out at once");
    assert!(crate::departure::my_departure(&w.view("Jordan Alvarez")).is_none());
    let jobs: Vec<Job> = w.t.db.job().kind().filter(KIND_MERCH_PICKS).collect();
    assert_eq!(jobs.iter().map(|j| j.subject_id).collect::<Vec<_>>(), [maya_node], "her shopping agent runs as she walks out");

    w.as_("Maya Chen", |ctx| buy_merch(ctx, mug.id, hers, String::new()));
    w.as_("Jordan Alvarez", |ctx| buy_merch(ctx, mug.id, his, String::new()));
    assert_eq!(w.balance("Maya Chen"), 18_200);
    assert_eq!(w.balance("Jordan Alvarez"), 18_200);
    assert!(w.try_as("Maya Chen", crate::departure::leave_event).unwrap_err().contains("already left"));

    w.end_event();
    assert_eq!(w.t.db.job().kind().filter(KIND_MERCH_PICKS).count(), 2, "the end of the event runs it only for Jordan");
    assert!(w.try_as("ops", |ctx| crate::departure::leave_early(ctx, maya_node)).unwrap_err().contains("already ended"));

    w.as_("ops", crate::web::reopen_event);
    assert!(crate::departure::my_departure(&w.view("Maya Chen")).is_none(), "everyone is back for the next run");
}
