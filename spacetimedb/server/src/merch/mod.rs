//! Merch: templates in `assets/merch`, a tee and a mug for every sponsor booth plus plain ones, each with a
//! green photo area. When the event ends, the shopping agent (Claude, through a worker job) picks three
//! products for each attendee from their night: which template, which of their photos (the ones with the
//! people they met first) and a short line printed on it. Until it answers, or when it cannot, code ranks
//! the templates by the minutes spent at their booths. The attendee buys during and after the event from
//! their BandIt wallet, and a worker records the purchase on Nessie. The app draws the photo and the line into the photo area; the
//! server renders and stores no image, and an order keeps the template, the photo and the line.

use crate::insurance::*;
use crate::jobs::{self, *};
use crate::roles::*;
use crate::safety::STAFF_ROLES;
use crate::social::tables::*;
use crate::tables::*;
use crate::venue::*;
use crate::wallet;
use crate::web::event_state;
use crate::view_as::viewed;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};
use std::collections::{BTreeSet, HashMap};

pub const KIND_MERCH_PURCHASE: &str = "merch_purchase";
pub const KIND_MERCH_PICKS: &str = "merch_picks";
/// Longest line printed on a product, and longest reason shown with it.
pub const LINE_CHARS: usize = 40;
pub const REASON_CHARS: usize = 200;
pub const SHIPPING_ADDRESS_CHARS: usize = 1000;
pub const TEE_SIZES: &[&str] = &["S", "M", "L", "XL"];
const SUGGESTIONS: usize = 3;

pub const PAYING: &str = "paying";
pub const PAID: &str = "paid";
pub const FAILED: &str = "failed";

/// Prices go by kind, sponsor or not.
pub fn price_cents(kind: &str) -> Option<u64> {
    match kind {
        "tee" => Some(2500),
        "mug" => Some(1800),
        "poster" => Some(1500),
        _ => None,
    }
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = merch_template, public)]
pub struct MerchTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// The image's file name in `assets/merch`; the seed upserts by it.
    #[unique]
    pub name: String,
    pub title: String,
    /// `tee`, `mug` or `poster`.
    pub kind: String,
    /// Indexed so views can list every template.
    #[index(btree)]
    pub price_cents: u64,
    /// Where the app's static files serve the image.
    pub image_url: String,
    pub width: u32,
    pub height: u32,
    /// The green photo area, in the image's pixels.
    pub photo_x: u32,
    pub photo_y: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    /// Booths of the sponsors the template names; empty for a plain template.
    pub booth_ids: Vec<u64>,
    pub updated_at: Timestamp,
}

/// One template from `assets/merch/templates.json`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct MerchTemplateIn {
    pub name: String,
    pub title: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub photo_x: u32,
    pub photo_y: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    /// Organisation names, matched to the imported booths.
    pub sponsors: Vec<String>,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = merch_order)]
pub struct MerchOrder {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee: Identity,
    pub template_id: u64,
    pub photo_id: u64,
    /// S, M, L or XL for a tee; empty otherwise.
    pub size: String,
    pub amount_cents: u64,
    /// `paying`, `paid` or `failed`.
    pub status: String,
    pub failure: String,
    pub nessie_purchase_id: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    /// The line printed on the product with the photo.
    #[default("")]
    pub line: String,
}

/// The delivery destination fixed at checkout, separate from the existing order schema.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = merch_shipping)]
pub struct MerchShipping {
    #[primary_key]
    pub order_id: u64,
    pub shipping_address: String,
}

/// One product the shopping agent picked for an attendee: a template, one of their photos, the line
/// printed on it and why it suits them.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = merch_pick)]
pub struct MerchPick {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee: Identity,
    /// 1 is the best.
    pub rank: u32,
    pub template_id: u64,
    pub photo_id: u64,
    pub line: String,
    pub reason: String,
    pub model_call_id: u64,
    pub created_at: Timestamp,
}

/// One pick as the worker hands it in.
#[derive(SpacetimeType, Clone, Debug)]
pub struct MerchPickIn {
    pub template_id: u64,
    pub photo_id: u64,
    pub line: String,
    pub reason: String,
}

/// The Nessie merchant BandIt merch is sold as, created by the worker on the first purchase.
#[spacetimedb::table(accessor = merch_shop)]
pub struct MerchShop {
    #[primary_key]
    pub id: u8,
    pub nessie_merchant_id: String,
}

/// Loads the event's templates, upserting by image name. Run after the event import, so sponsor booths resolve.
#[spacetimedb::reducer]
pub fn load_merch_templates(ctx: &ReducerContext, templates: Vec<MerchTemplateIn>) -> Result<(), String> {
    require_role(ctx, &["ops", "ingest"])?;
    for t in templates {
        let price_cents = price_cents(&t.kind).ok_or_else(|| format!("{}: kind must be tee, mug or poster", t.name))?;
        let mut booth_ids = Vec::new();
        for sponsor in &t.sponsors {
            let orgs: Vec<u64> = ctx.db.organization().iter().filter(|o| o.name.eq_ignore_ascii_case(sponsor)).map(|o| o.id).collect();
            let booths: Vec<u64> = orgs.iter().flat_map(|o| ctx.db.booth().organization_id().filter(*o)).map(|b| b.id).collect();
            if booths.is_empty() {
                return Err(format!("{}: no booth for {sponsor}; import the event first", t.name));
            }
            booth_ids.extend(booths);
        }
        let row = MerchTemplate {
            id: 0,
            image_url: format!("/assets/merch/{}", t.name),
            name: t.name,
            title: t.title,
            kind: t.kind,
            price_cents,
            width: t.width,
            height: t.height,
            photo_x: t.photo_x,
            photo_y: t.photo_y,
            photo_w: t.photo_w,
            photo_h: t.photo_h,
            booth_ids,
            updated_at: ctx.timestamp,
        };
        match ctx.db.merch_template().name().find(&row.name) {
            Some(old) => {
                ctx.db.merch_template().id().update(MerchTemplate { id: old.id, ..row });
            }
            None => {
                ctx.db.merch_template().insert(row);
            }
        }
    }
    Ok(())
}

/// Buys one template with one of the caller's photos, paid from their wallet.
#[spacetimedb::reducer]
pub fn buy_merch(ctx: &ReducerContext, template_id: u64, photo_id: u64, size: String) -> Result<(), String> {
    place_order(ctx, ctx.sender(), template_id, photo_id, size, String::new())
}

/// Buys from the attendee's wallet with a delivery address saved on this order.
#[spacetimedb::reducer]
pub fn buy_merch_with_shipping(ctx: &ReducerContext, template_id: u64, photo_id: u64, size: String, shipping_address: String) -> Result<(), String> {
    place_with_shipping(ctx, ctx.sender(), template_id, photo_id, size, shipping_address)
}

/// The organizer buys for an attendee exactly as the attendee would from their tap page: the same
/// checks, paid from the attendee's wallet.
#[spacetimedb::reducer]
pub fn buy_merch_as(ctx: &ReducerContext, node_id: u64, template_id: u64, photo_id: u64, size: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let a = ctx.db.attendee().node_id().find(node_id).ok_or("no such attendee")?;
    place_order(ctx, a.identity, template_id, photo_id, size, String::new())
}

/// The organizer buys for an attendee with the delivery address provided at checkout.
#[spacetimedb::reducer]
pub fn buy_merch_as_with_shipping(ctx: &ReducerContext, node_id: u64, template_id: u64, photo_id: u64, size: String, shipping_address: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let a = ctx.db.attendee().node_id().find(node_id).ok_or("no such attendee")?;
    place_with_shipping(ctx, a.identity, template_id, photo_id, size, shipping_address)
}

/// Internal callers use the same address, photo ownership, wallet and balance checks as checkout.
pub(crate) fn place_with_shipping(ctx: &ReducerContext, me: Identity, template_id: u64, photo_id: u64, size: String, shipping_address: String) -> Result<(), String> {
    place_order(ctx, me, template_id, photo_id, size, checked_shipping_address(&shipping_address)?)
}

fn checked_shipping_address(address: &str) -> Result<String, String> {
    let address = address.trim();
    if address.is_empty() {
        return Err("enter the recipient and full shipping address".into());
    }
    if address.chars().count() > SHIPPING_ADDRESS_CHARS {
        return Err(format!("shipping address must be {SHIPPING_ADDRESS_CHARS} characters or fewer"));
    }
    Ok(address.to_string())
}

fn place_order(ctx: &ReducerContext, me: Identity, template_id: u64, photo_id: u64, size: String, shipping_address: String) -> Result<(), String> {
    let t = ctx.db.merch_template().id().find(template_id).ok_or("no such template")?;
    let size = match t.kind.as_str() {
        "tee" if TEE_SIZES.contains(&size.as_str()) => size,
        "tee" => return Err(format!("pick a size: {}", TEE_SIZES.join(", "))),
        _ => String::new(),
    };
    if !ctx.db.photo_tag().photo_id().filter(photo_id).any(|tag| tag.attendee == me) {
        return Err("you are not in this photo".into());
    }
    let account = ctx.db.claimant_account().identity().find(me).ok_or("your BandIt wallet is still opening")?;
    if wallet::spendable(ctx, me) < t.price_cents as i64 {
        return Err("not enough money in your BandIt wallet".into());
    }
    let line = ctx
        .db
        .merch_pick()
        .attendee()
        .filter(me)
        .find(|p| p.template_id == template_id && p.photo_id == photo_id)
        .map(|p| p.line)
        .unwrap_or_else(|| friends_line(&friends_in_photo(ctx, me, photo_id)));
    let order = ctx.db.merch_order().insert(MerchOrder {
        id: 0,
        attendee: me,
        template_id,
        photo_id,
        size: size.clone(),
        amount_cents: t.price_cents,
        status: PAYING.into(),
        failure: String::new(),
        nessie_purchase_id: String::new(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
        line,
    });
    if !shipping_address.is_empty() {
        ctx.db.merch_shipping().insert(MerchShipping { order_id: order.id, shipping_address });
    }
    let merchant_id = ctx.db.merch_shop().id().find(0).map(|s| s.nessie_merchant_id).unwrap_or_default();
    let what = if size.is_empty() { t.title.clone() } else { format!("{} ({size})", t.title) };
    let payload = serde_json::json!({
        "order_id": order.id,
        "account_id": account.account_id,
        "merchant_id": merchant_id,
        "amount_cents": t.price_cents,
        "memo": format!("BandIt merch order {}: {what}", order.id),
    });
    jobs::enqueue(ctx, KIND_MERCH_PURCHASE, payload.to_string(), "merch_order", order.id);
    Ok(())
}

/// The worker recorded the purchase on the attendee's Nessie account.
#[spacetimedb::reducer]
pub fn settle_merch_order(ctx: &ReducerContext, job_id: u64, merchant_id: String, purchase_id: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let order = ctx.db.merch_order().id().find(job.subject_id).ok_or("no such order")?;
    jobs::finish(ctx, job, purchase_id.clone());
    if ctx.db.merch_shop().id().find(0).is_none() {
        ctx.db.merch_shop().insert(MerchShop { id: 0, nessie_merchant_id: merchant_id });
    }
    if order.status != PAYING {
        return Ok(());
    }
    let title = ctx.db.merch_template().id().find(order.template_id).map(|t| t.title).unwrap_or_default();
    wallet::add_entry(ctx, order.attendee, "purchase", -(order.amount_cents as i64), format!("BandIt merch: {title}"), purchase_id.clone());
    ctx.db.merch_order().id().update(MerchOrder { status: PAID.into(), nessie_purchase_id: purchase_id, updated_at: ctx.timestamp, ..order });
    Ok(())
}

/// A purchase job gave up: the order fails and its money is free again.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_MERCH_PURCHASE {
        return;
    }
    if let Some(order) = ctx.db.merch_order().id().find(job.subject_id).filter(|o| o.status == PAYING) {
        ctx.db.merch_order().id().update(MerchOrder { status: FAILED.into(), failure: job.error.clone(), updated_at: ctx.timestamp, ..order });
    }
}

/// Money set aside for orders still being paid.
pub fn held_cents(ctx: &ReducerContext, who: Identity) -> i64 {
    ctx.db.merch_order().attendee().filter(who).filter(|o| o.status == PAYING).map(|o| o.amount_cents as i64).sum()
}

pub fn my_held_cents(ctx: &ViewContext, who: Identity) -> i64 {
    ctx.db.merch_order().attendee().filter(who).filter(|o| o.status == PAYING).map(|o| o.amount_cents as i64).sum()
}

#[spacetimedb::view(accessor = my_merch_orders, public)]
pub fn my_merch_orders(ctx: &ViewContext) -> Vec<MerchOrder> {
    ctx.db.merch_order().attendee().filter(viewed(ctx)).collect()
}

#[spacetimedb::view(accessor = my_merch_shipping, public)]
pub fn my_merch_shipping(ctx: &ViewContext) -> Vec<MerchShipping> {
    ctx.db.merch_order().attendee().filter(viewed(ctx)).filter_map(|o| ctx.db.merch_shipping().order_id().find(o.id)).collect()
}

/// Delivery destinations for the organizer's order list.
#[spacetimedb::view(accessor = board_merch_shipping, public)]
pub fn board_merch_shipping(ctx: &ViewContext) -> Vec<MerchShipping> {
    let ops = ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| r.role == "ops");
    if !ops {
        return Vec::new();
    }
    ctx.db.merch_order().attendee().filter(Identity::ZERO..).filter_map(|o| ctx.db.merch_shipping().order_id().find(o.id)).collect()
}

/// One order with who placed it, for the organizer portal's Merch tab.
#[derive(SpacetimeType, Clone, Debug)]
pub struct BoardMerchOrder {
    pub id: u64,
    pub attendee_name: String,
    pub template_id: u64,
    pub title: String,
    pub size: String,
    pub amount_cents: u64,
    pub status: String,
    pub failure: String,
    pub nessie_purchase_id: String,
    pub created_at: Timestamp,
    pub line: String,
    pub photo_url: String,
    /// The attendee's graph node id, as `board_attendees` has it.
    pub node_id: u64,
}

/// Every attendee's merch orders, for the organizer (ops) only.
#[spacetimedb::view(accessor = board_merch_orders, public)]
pub fn board_merch_orders(ctx: &ViewContext) -> Vec<BoardMerchOrder> {
    let ops = ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| r.role == "ops");
    if !ops {
        return Vec::new();
    }
    ctx.db
        .merch_order()
        .attendee()
        .filter(Identity::ZERO..)
        .map(|o| BoardMerchOrder {
            id: o.id,
            attendee_name: ctx.db.attendee().identity().find(o.attendee).map(|a| a.display_name).unwrap_or_default(),
            template_id: o.template_id,
            title: ctx.db.merch_template().id().find(o.template_id).map(|t| t.title).unwrap_or_default(),
            size: o.size,
            amount_cents: o.amount_cents,
            status: o.status,
            failure: o.failure,
            nessie_purchase_id: o.nessie_purchase_id,
            created_at: o.created_at,
            line: o.line,
            photo_url: ctx.db.photo().id().find(o.photo_id).map(|p| p.url).unwrap_or_default(),
            node_id: ctx.db.attendee().identity().find(o.attendee).map(|a| a.node_id).unwrap_or_default(),
        })
        .collect()
}

/// "with Maya", "with Maya & Noor", "with Maya, Noor & Sam", or "" for nobody.
pub fn friends_line(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [a] => format!("with {a}"),
        [rest @ .., last] if rest.len() <= 2 => format!("with {} & {last}", rest.join(", ")),
        [a, b, more @ ..] => format!("with {a}, {b} & {} more", more.len()),
    }
}

/// The people `me` met, by identity.
fn met_set(ctx: &ReducerContext, me: Identity) -> BTreeSet<Identity> {
    let a = ctx.db.social_encounter().attendee_a().filter(me).filter(|e| e.met).map(|e| e.attendee_b);
    a.chain(ctx.db.social_encounter().attendee_b().filter(me).filter(|e| e.met).map(|e| e.attendee_a)).collect()
}

/// The names of the people `me` met who are in the photo.
fn friends_in_photo(ctx: &ReducerContext, me: Identity, photo_id: u64) -> Vec<String> {
    let met = met_set(ctx, me);
    ctx.db
        .photo_tag()
        .photo_id()
        .filter(photo_id)
        .filter(|t| met.contains(&t.attendee))
        .filter_map(|t| ctx.db.attendee().identity().find(t.attendee).filter(|a| a.findable).map(|a| a.display_name))
        .collect()
}

/// When the event ends, every attendee who tapped a band and is in a photo gets a shopping agent run, except
/// the ones who left early and had theirs then.
pub fn on_event_ended(ctx: &ReducerContext) {
    shop_for_everyone(ctx, false);
}

/// An attendee who left early gets their shopping agent run as they walk out, when they tapped a band and are
/// in a photo.
pub fn on_attendee_left(ctx: &ReducerContext, who: Identity) {
    let shopper = ctx.db.attendee().identity().find(who).is_some_and(|a| !a.crowd) && ctx.db.photo_tag().attendee().filter(who).next().is_some();
    if ctx.db.merch_template().count() > 0 && shopper {
        shop_for(ctx, who);
    }
}

fn shop_for_everyone(ctx: &ReducerContext, with_left: bool) {
    if ctx.db.merch_template().count() == 0 {
        return;
    }
    let shoppers: BTreeSet<Identity> = ctx
        .db
        .photo_tag()
        .photo_id()
        .filter(0u64..)
        .map(|t| t.attendee)
        .filter(|who| ctx.db.attendee().identity().find(*who).is_some_and(|a| !a.crowd))
        .filter(|who| with_left || !crate::departure::left(ctx, *who))
        .collect();
    for who in shoppers {
        shop_for(ctx, who);
    }
}

fn shop_for(ctx: &ReducerContext, who: Identity) {
    let payload = picks_payload(ctx, who);
    jobs::enqueue(ctx, KIND_MERCH_PICKS, payload.to_string(), "attendee", ctx.db.attendee().identity().find(who).map(|a| a.node_id).unwrap_or_default());
}

/// Runs the shopping agent again for everyone, for example after more photos came in.
#[spacetimedb::reducer]
pub fn rerun_shopping_agent(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if !ctx.db.event_state().id().find(0).is_some_and(|e| e.ended) {
        return Err("the shopping agent runs once the event ends".into());
    }
    shop_for_everyone(ctx, true);
    Ok(())
}

/// What the shopping agent knows about one attendee's night: where they spent time, who they met, their
/// photos with the people in them, and every product.
pub fn picks_payload(ctx: &ReducerContext, who: Identity) -> serde_json::Value {
    let me = ctx.db.attendee().identity().find(who);
    let met = met_set(ctx, who);
    let mut zone_minutes: HashMap<u64, f32> = HashMap::new();
    let mut booth_minutes: HashMap<u64, f32> = HashMap::new();
    for v in ctx.db.visit().attendee().filter(who) {
        *zone_minutes.entry(v.zone_id).or_default() += v.minutes;
        if v.booth_id != 0 {
            *booth_minutes.entry(v.booth_id).or_default() += v.minutes;
        }
    }
    let mut places: Vec<(u64, f32)> = zone_minutes.into_iter().collect();
    places.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let places: Vec<_> = places
        .into_iter()
        .map(|(zone_id, minutes)| {
            let zone = ctx.db.zone().id().find(zone_id).map(|z| z.name).unwrap_or_default();
            let mut at: Vec<(String, f32)> = ctx
                .db
                .booth()
                .zone_id()
                .filter(zone_id)
                .filter_map(|b| booth_minutes.get(&b.id).map(|m| (b.name, *m)))
                .collect();
            at.sort_by(|a, b| b.1.total_cmp(&a.1));
            let booths: Vec<String> = ctx.db.booth().zone_id().filter(zone_id).map(|b| b.name).collect();
            serde_json::json!({
                "zone": zone,
                "minutes": minutes.round(),
                "booths_in_zone": booths,
                "minutes_at_booths": at.into_iter().map(|(b, m)| serde_json::json!({"booth": b, "minutes": m.round()})).collect::<Vec<_>>(),
            })
        })
        .collect();
    let mut people: Vec<(String, f32)> = ctx
        .db
        .social_encounter()
        .attendee_a()
        .filter(who)
        .filter(|e| e.met)
        .map(|e| (e.attendee_b, e.seconds_together))
        .chain(ctx.db.social_encounter().attendee_b().filter(who).filter(|e| e.met).map(|e| (e.attendee_a, e.seconds_together)))
        .filter_map(|(other, secs)| ctx.db.attendee().identity().find(other).filter(|a| a.findable).map(|a| (a.display_name, secs as f32 / 60.0)))
        .collect();
    people.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut photos: Vec<Photo> = ctx.db.photo_tag().attendee().filter(who).filter_map(|t| ctx.db.photo().id().find(t.photo_id)).collect();
    photos.sort_by_key(|p| (p.taken_at, p.id));
    let photos: Vec<_> = photos
        .into_iter()
        .map(|p| {
            let tagged: Vec<Identity> = ctx.db.photo_tag().photo_id().filter(p.id).map(|t| t.attendee).filter(|a| *a != who).collect();
            let friends: Vec<String> = tagged
                .iter()
                .filter(|a| met.contains(a))
                .filter_map(|a| ctx.db.attendee().identity().find(*a).filter(|a| a.findable).map(|a| a.display_name))
                .collect();
            serde_json::json!({
                "photo_id": p.id,
                "zone": ctx.db.zone().id().find(p.zone_id).map(|z| z.name).unwrap_or_default(),
                "caption": p.caption,
                "people_in_photo": p.people_count,
                "people_you_met_in_it": friends,
                "others_tagged": tagged.len() - friends.len(),
            })
        })
        .collect();
    let products: Vec<_> = ctx
        .db
        .merch_template()
        .price_cents()
        .filter(0u64..)
        .map(|t| {
            let mut sponsors: Vec<String> = t
                .booth_ids
                .iter()
                .filter_map(|b| ctx.db.booth().id().find(*b))
                .filter_map(|b| ctx.db.organization().id().find(b.organization_id).map(|o| o.name))
                .collect();
            sponsors.dedup();
            serde_json::json!({"template_id": t.id, "title": t.title, "kind": t.kind, "price_cents": t.price_cents, "sponsors": sponsors})
        })
        .collect();
    serde_json::json!({
        "attendee": me.map(|a| a.display_name).unwrap_or_default(),
        "event": ctx.db.venue().iter().next().map(|v| v.name).unwrap_or_default(),
        "places": places,
        "people_met": people.into_iter().map(|(n, m)| serde_json::json!({"name": n, "minutes": m.round()})).collect::<Vec<_>>(),
        "photos": photos,
        "products": products,
    })
}

/// The shopping agent's picks for one attendee replace their earlier ones. Picks of an unknown template, a
/// photo they are not in, or a template already picked are dropped; lines and reasons are cut to length.
#[spacetimedb::reducer]
pub fn submit_merch_picks(ctx: &ReducerContext, job_id: u64, picks: Vec<MerchPickIn>, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let who = ctx.db.attendee().node_id().find(job.subject_id).ok_or("no such attendee")?.identity;
    let call_id = jobs::record_call(ctx, job_id, &call);
    let mut seen = BTreeSet::new();
    let picks: Vec<MerchPickIn> = picks
        .into_iter()
        .filter(|p| ctx.db.merch_template().id().find(p.template_id).is_some() && seen.insert(p.template_id))
        .filter(|p| ctx.db.photo_tag().photo_id().filter(p.photo_id).any(|t| t.attendee == who))
        .take(SUGGESTIONS)
        .collect();
    if picks.is_empty() {
        return Err("none of the picks is a product with one of the attendee's photos".into());
    }
    for old in ctx.db.merch_pick().attendee().filter(who).collect::<Vec<_>>() {
        ctx.db.merch_pick().id().delete(old.id);
    }
    let n = picks.len();
    for (i, p) in picks.into_iter().enumerate() {
        ctx.db.merch_pick().insert(MerchPick {
            id: 0,
            attendee: who,
            rank: i as u32 + 1,
            template_id: p.template_id,
            photo_id: p.photo_id,
            line: p.line.trim().chars().take(LINE_CHARS).collect(),
            reason: p.reason.trim().chars().take(REASON_CHARS).collect(),
            model_call_id: call_id,
            created_at: ctx.timestamp,
        });
    }
    jobs::finish(ctx, job, format!("{n} picks"));
    Ok(())
}

/// One template with one of the caller's photos, ready to draw.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct MerchSuggestion {
    /// 1 is the best.
    pub rank: u32,
    pub template_id: u64,
    pub title: String,
    pub kind: String,
    pub price_cents: u64,
    pub image_url: String,
    pub width: u32,
    pub height: u32,
    pub photo_x: u32,
    pub photo_y: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    pub photo_id: u64,
    pub photo_url: String,
    /// Printed on the product under the photo.
    pub line: String,
    /// Why the shopping agent picked it; empty when code ranked it.
    pub reason: String,
    /// The people the caller met who are in the photo.
    pub friends: Vec<String>,
    /// The template's sponsors whose booths the caller visited, for the booth crawl's check boxes.
    pub ticks: Vec<String>,
}

/// The caller's three products: the shopping agent's picks once it has answered, otherwise each template
/// with the caller's best photo for it (taken at its booths, then with the most people they met, then the
/// newest), ranked by the minutes spent at its booths, then a photo from those booths, then plain
/// templates before sponsor ones.
#[spacetimedb::view(accessor = my_merch_suggestions, public)]
pub fn my_merch_suggestions(ctx: &ViewContext) -> Vec<MerchSuggestion> {
    let me = viewed(ctx);
    let photos: Vec<Photo> = ctx
        .db
        .photo_tag()
        .attendee()
        .filter(me)
        .filter_map(|t| ctx.db.photo().id().find(t.photo_id))
        .collect();
    if photos.is_empty() {
        return Vec::new();
    }
    let met: BTreeSet<Identity> = ctx
        .db
        .social_encounter()
        .attendee_a()
        .filter(me)
        .filter(|e| e.met)
        .map(|e| e.attendee_b)
        .chain(ctx.db.social_encounter().attendee_b().filter(me).filter(|e| e.met).map(|e| e.attendee_a))
        .collect();
    let friends: HashMap<u64, Vec<String>> = photos
        .iter()
        .map(|p| {
            let names = ctx
                .db
                .photo_tag()
                .photo_id()
                .filter(p.id)
                .filter(|t| met.contains(&t.attendee))
                .filter_map(|t| ctx.db.attendee().identity().find(t.attendee).filter(|a| a.findable).map(|a| a.display_name))
                .collect();
            (p.id, names)
        })
        .collect();
    let mut zone_minutes: HashMap<u64, f32> = HashMap::new();
    let mut visited_booths: BTreeSet<u64> = BTreeSet::new();
    for v in ctx.db.visit().attendee().filter(me) {
        *zone_minutes.entry(v.zone_id).or_default() += v.minutes;
        if v.booth_id != 0 {
            visited_booths.insert(v.booth_id);
        } else {
            visited_booths.extend(ctx.db.booth().zone_id().filter(v.zone_id).map(|b| b.id));
        }
    }
    let ticks = |t: &MerchTemplate| -> Vec<String> {
        let mut names: Vec<String> = t
            .booth_ids
            .iter()
            .filter(|b| visited_booths.contains(b))
            .filter_map(|b| ctx.db.booth().id().find(*b))
            .filter_map(|b| ctx.db.organization().id().find(b.organization_id).map(|o| o.name))
            .collect();
        names.dedup();
        names
    };
    let suggestion = |rank: u32, t: MerchTemplate, p: &Photo, line: String, reason: String| MerchSuggestion {
        rank,
        ticks: ticks(&t),
        template_id: t.id,
        title: t.title,
        kind: t.kind,
        price_cents: t.price_cents,
        image_url: t.image_url,
        width: t.width,
        height: t.height,
        photo_x: t.photo_x,
        photo_y: t.photo_y,
        photo_w: t.photo_w,
        photo_h: t.photo_h,
        photo_id: p.id,
        photo_url: p.url.clone(),
        line,
        reason,
        friends: friends.get(&p.id).cloned().unwrap_or_default(),
    };

    let mut picks: Vec<MerchPick> = ctx.db.merch_pick().attendee().filter(me).collect();
    picks.sort_by_key(|p| p.rank);
    let picked: Vec<MerchSuggestion> = picks
        .into_iter()
        .filter_map(|pick| {
            let t = ctx.db.merch_template().id().find(pick.template_id)?;
            let p = photos.iter().find(|p| p.id == pick.photo_id)?;
            Some(suggestion(pick.rank, t, p, pick.line, pick.reason))
        })
        .collect();
    if !picked.is_empty() {
        return picked;
    }

    let mut ranked: Vec<(MerchTemplate, &Photo, f32, bool)> = ctx
        .db
        .merch_template()
        .price_cents()
        .filter(0u64..)
        .map(|t| {
            let zones: BTreeSet<u64> = t.booth_ids.iter().filter_map(|b| ctx.db.booth().id().find(*b)).map(|b| b.zone_id).collect();
            let minutes = zones.iter().fold(0.0f32, |sum, z| sum + zone_minutes.get(z).copied().unwrap_or_default());
            let with = |p: &Photo| friends.get(&p.id).map_or(0, |f| f.len());
            let photo = photos.iter().max_by_key(|p| (zones.contains(&p.zone_id), with(p), p.taken_at, p.id)).expect("photos is not empty");
            let at_booth = zones.contains(&photo.zone_id);
            (t, photo, minutes, at_booth)
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.2.total_cmp(&a.2)
            .then(b.3.cmp(&a.3))
            .then(a.0.booth_ids.is_empty().cmp(&b.0.booth_ids.is_empty()).reverse())
            .then(b.1.taken_at.cmp(&a.1.taken_at))
            .then(a.0.id.cmp(&b.0.id))
    });
    ranked
        .into_iter()
        .take(SUGGESTIONS)
        .enumerate()
        .map(|(i, (t, p, _, _))| {
            let line = friends_line(friends.get(&p.id).map(Vec::as_slice).unwrap_or_default());
            suggestion(i as u32 + 1, t, p, line, String::new())
        })
        .collect()
}

/// One attendee's pick, for the organizer portal's Merch tab.
#[derive(SpacetimeType, Clone, Debug)]
pub struct BoardMerchPick {
    pub id: u64,
    /// The attendee's graph node id, as `board_attendees` has it.
    pub node_id: u64,
    pub attendee_name: String,
    pub rank: u32,
    pub template_id: u64,
    pub photo_id: u64,
    pub photo_url: String,
    pub line: String,
    pub reason: String,
    pub created_at: Timestamp,
}

/// Every attendee's picks from the shopping agent, for staff.
#[spacetimedb::view(accessor = board_merch_picks, public)]
pub fn board_merch_picks(ctx: &ViewContext) -> Vec<BoardMerchPick> {
    let staff = ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| STAFF_ROLES.contains(&r.role.as_str()));
    if !staff {
        return Vec::new();
    }
    ctx.db
        .merch_pick()
        .attendee()
        .filter(Identity::ZERO..)
        .map(|p| BoardMerchPick {
            id: p.id,
            node_id: ctx.db.attendee().identity().find(p.attendee).map(|a| a.node_id).unwrap_or_default(),
            attendee_name: ctx.db.attendee().identity().find(p.attendee).map(|a| a.display_name).unwrap_or_default(),
            rank: p.rank,
            template_id: p.template_id,
            photo_id: p.photo_id,
            photo_url: ctx.db.photo().id().find(p.photo_id).map(|x| x.url).unwrap_or_default(),
            line: p.line,
            reason: p.reason,
            created_at: p.created_at,
        })
        .collect()
}

#[cfg(test)]
mod tests;
