//! Merch: a few hand-made templates in `assets/merch`, each with a green photo area. After the event
//! the recap suggests the attendee's own confirmed photos on the templates, ranked by the minutes they
//! spent at the booths a template names, and the attendee buys one from their BandIt wallet. A worker
//! records the purchase on Nessie. The app draws the photo into the photo area; the server renders
//! and stores no image, and an order keeps the template and the photo.

use crate::insurance::*;
use crate::jobs::{self, *};
use crate::roles::require_role;
use crate::social::logic::TAG_CONFIRMED;
use crate::social::tables::*;
use crate::venue::*;
use crate::wallet;
use crate::web::event_state;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};
use std::collections::{BTreeSet, HashMap};

pub const KIND_MERCH_PURCHASE: &str = "merch_purchase";
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

/// Buys one template with one of the caller's confirmed photos, paid from their wallet.
#[spacetimedb::reducer]
pub fn buy_merch(ctx: &ReducerContext, template_id: u64, photo_id: u64, size: String) -> Result<(), String> {
    if !ctx.db.event_state().id().find(0).is_some_and(|e| e.ended) {
        return Err("merch opens in your recap once the event ends".into());
    }
    let me = ctx.sender();
    let t = ctx.db.merch_template().id().find(template_id).ok_or("no such template")?;
    let size = match t.kind.as_str() {
        "tee" if TEE_SIZES.contains(&size.as_str()) => size,
        "tee" => return Err(format!("pick a size: {}", TEE_SIZES.join(", "))),
        _ => String::new(),
    };
    if !ctx.db.photo_tag().photo_id().filter(photo_id).any(|tag| tag.attendee == me && tag.status == TAG_CONFIRMED) {
        return Err("confirm that you are in this photo first".into());
    }
    let account = ctx.db.claimant_account().identity().find(me).ok_or("your BandIt wallet is still opening")?;
    if wallet::spendable(ctx, me) < t.price_cents as i64 {
        return Err("not enough money in your BandIt wallet".into());
    }
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
    });
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
    ctx.db.merch_order().attendee().filter(ctx.sender()).collect()
}

/// One template with the caller's best photo for it, ready to draw.
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
    /// Minutes the caller spent at the template's booths.
    pub minutes: f32,
}

/// The caller's top three template and photo pairs. Each template is paired with the caller's best
/// confirmed photo for it (taken at its booths, else the newest) and ranked by the minutes the caller
/// spent at its booths, then by a photo from those booths, then plain templates before sponsor ones.
#[spacetimedb::view(accessor = my_merch_suggestions, public)]
pub fn my_merch_suggestions(ctx: &ViewContext) -> Vec<MerchSuggestion> {
    let me = ctx.sender();
    let photos: Vec<Photo> = ctx
        .db
        .photo_tag()
        .attendee()
        .filter(me)
        .filter(|t| t.status == TAG_CONFIRMED)
        .filter_map(|t| ctx.db.photo().id().find(t.photo_id))
        .collect();
    if photos.is_empty() {
        return Vec::new();
    }
    let mut zone_minutes: HashMap<u64, f32> = HashMap::new();
    for v in ctx.db.visit().attendee().filter(me) {
        *zone_minutes.entry(v.zone_id).or_default() += v.minutes;
    }
    let mut picks: Vec<(MerchTemplate, &Photo, f32, bool)> = ctx
        .db
        .merch_template()
        .price_cents()
        .filter(0u64..)
        .map(|t| {
            let zones: BTreeSet<u64> = t.booth_ids.iter().filter_map(|b| ctx.db.booth().id().find(*b)).map(|b| b.zone_id).collect();
            let minutes = zones.iter().fold(0.0f32, |sum, z| sum + zone_minutes.get(z).copied().unwrap_or_default());
            let photo = photos.iter().max_by_key(|p| (zones.contains(&p.zone_id), p.taken_at, p.id)).expect("photos is not empty");
            let at_booth = zones.contains(&photo.zone_id);
            (t, photo, minutes, at_booth)
        })
        .collect();
    picks.sort_by(|a, b| {
        b.2.total_cmp(&a.2)
            .then(b.3.cmp(&a.3))
            .then(a.0.booth_ids.is_empty().cmp(&b.0.booth_ids.is_empty()).reverse())
            .then(b.1.taken_at.cmp(&a.1.taken_at))
            .then(a.0.id.cmp(&b.0.id))
    });
    picks
        .into_iter()
        .take(SUGGESTIONS)
        .enumerate()
        .map(|(i, (t, p, minutes, _))| MerchSuggestion {
            rank: i as u32 + 1,
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
            minutes,
        })
        .collect()
}

#[cfg(test)]
mod tests;
