//! Seeded crowd purchases use ordinary tagged photos, wallet holds and worker checkout.
//! Only selected generated attendees open wallets; real attendee wallets are never selected.

use super::{LivePhase, LiveRun, seconds};
use crate::departure::departure;
use crate::insurance::claimant_account;
use crate::merch::{self, MerchTemplate, merch_template};
use crate::social::{photos, tables::*};
use crate::tables::band;
use crate::venue::*;
use crate::wallet;
use crate::web::event_state;
use spacetimedb::rand::{Rng, SeedableRng, rngs::StdRng};
use spacetimedb::{Identity, ReducerContext, Table, TimeDuration, Timestamp};
use std::collections::HashSet;

const FIRST_SECS: i64 = 30;
const MAX_PENDING: usize = 10;

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = live_shopping)]
pub struct LiveShopping {
    #[primary_key]
    pub id: u8,
    pub next_at: Timestamp,
    pub gap_secs: i64,
    pub target: u16,
    pub selected: u16,
}

/// One selection per identity per run, including failed/skipped orders. Kept until Start event.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = live_shopper)]
pub struct LiveShopper {
    #[primary_key]
    pub identity: Identity,
    pub band_id: u32,
    pub template_id: u64,
    pub photo_id: u64,
    pub size: String,
    pub shipping_address: String,
    pub selected_at: Timestamp,
    pub pending: bool,
}

pub(super) fn start(ctx: &ReducerContext, crowd: u16, minutes: u16) {
    for shopper in ctx.db.live_shopper().iter().collect::<Vec<_>>() {
        ctx.db.live_shopper().identity().delete(shopper.identity);
    }
    ctx.db.live_shopping().id().delete(0);
    let target = (u32::from(crowd) * 30).div_ceil(100) as u16;
    // Whole seconds deliberately round down: the one-second clock must not turn 2.3s into 3s.
    let gap_secs = ((i64::from(minutes) * 60 - FIRST_SECS) / i64::from(target.max(1))).max(1);
    ctx.db.live_shopping().insert(LiveShopping {
        id: 0,
        next_at: ctx.timestamp + seconds(FIRST_SECS),
        gap_secs,
        target,
        selected: 0,
    });
}

pub(super) fn resume(ctx: &ReducerContext, gap: TimeDuration) {
    if let Some(s) = ctx.db.live_shopping().id().find(0) {
        ctx.db.live_shopping().id().update(LiveShopping {
            next_at: s.next_at + gap,
            ..s
        });
    }
}

pub(super) fn after_evacuation(ctx: &ReducerContext) {
    if let Some(s) = ctx.db.live_shopping().id().find(0) {
        ctx.db.live_shopping().id().update(LiveShopping {
            next_at: ctx.timestamp + seconds(FIRST_SECS),
            ..s
        });
    }
}

fn eligible(ctx: &ReducerContext, who: Identity, down: &HashSet<u32>) -> Option<CrowdMember> {
    let member = ctx.db.crowd_member().identity().find(who)?;
    if !ctx
        .db
        .attendee()
        .identity()
        .find(who)
        .is_some_and(|a| a.crowd)
        || ctx.db.departure().attendee().find(who).is_some()
        || down.contains(&member.band_id)
        || !ctx
            .db
            .band()
            .id()
            .find(member.band_id)
            .is_some_and(|b| b.online && !b.fall && !b.sos)
    {
        return None;
    }
    Some(member)
}

pub(super) fn tick(ctx: &ReducerContext, run: &LiveRun) {
    if run.phase != LivePhase::Running
        || ctx.timestamp >= run.ends_at
        || super::paused(ctx)
        || super::evacuating(ctx)
        || ctx.db.event_state().id().find(0).is_some_and(|e| e.ended)
    {
        return;
    }
    let Some(schedule) = ctx.db.live_shopping().id().find(0) else {
        return;
    };
    let down: HashSet<u32> = super::down_bands(ctx)
        .into_iter()
        .map(|d| d.band_id)
        .collect();
    // At most one checkout per tick, even when workers finish several wallets during a pause.
    let mut pending: Vec<LiveShopper> =
        ctx.db.live_shopper().iter().filter(|s| s.pending).collect();
    pending.sort_by_key(|s| (s.selected_at, s.band_id));
    if let Some(shopper) = pending.iter().find(|s| {
        eligible(ctx, s.identity, &down).is_none()
            || ctx
                .db
                .claimant_account()
                .identity()
                .find(s.identity)
                .is_some()
            || !wallet::live_wallet_pending(ctx, s.identity)
    }) {
        if eligible(ctx, shopper.identity, &down).is_some()
            && ctx
                .db
                .claimant_account()
                .identity()
                .find(shopper.identity)
                .is_some()
        {
            // All checkout errors occur before its first write. An unavailable photo, balance or
            // template skips this selection without creating a hold or a purchase job.
            let _ = merch::place_with_shipping(
                ctx,
                shopper.identity,
                shopper.template_id,
                shopper.photo_id,
                shopper.size.clone(),
                shopper.shipping_address.clone(),
            );
        }
        ctx.db.live_shopper().identity().update(LiveShopper {
            pending: false,
            ..(*shopper).clone()
        });
    }
    if ctx.timestamp < schedule.next_at || schedule.selected >= schedule.target {
        return;
    }
    // Advance from now, never replay missed deadlines after a pause, evacuation or delayed tick.
    ctx.db.live_shopping().id().update(LiveShopping {
        next_at: ctx.timestamp + seconds(schedule.gap_secs),
        ..schedule.clone()
    });
    if ctx.db.live_shopper().iter().filter(|s| s.pending).count() >= MAX_PENDING {
        return;
    }
    let opening_full = wallet::live_wallet_open_count(ctx) >= MAX_PENDING;
    let mut templates: Vec<MerchTemplate> = ctx
        .db
        .merch_template()
        .iter()
        .filter(|t| {
            matches!(t.kind.as_str(), "tee" | "mug" | "poster")
                && t.price_cents <= wallet::OPENING_CENTS
        })
        .collect();
    templates.sort_by_key(|t| t.id);
    if templates.is_empty() {
        return;
    }
    let mut zones: Vec<Zone> = ctx
        .db
        .zone()
        .iter()
        .filter(|z| z.kind == "sponsor")
        .collect();
    zones.sort_by_key(|z| z.id);
    let mut rng = StdRng::seed_from_u64(
        run.seed
            ^ 0x5A0F_51A0_9E37
            ^ (u64::from(schedule.selected) + 1).wrapping_mul(0x9E37_79B9_7F4A_7C15),
    );
    // Seeded zone rotation, then a seeded person/template draw. Neither uses the incident RNG.
    if zones.is_empty() {
        return;
    }
    let offset = rng.gen_range(0..zones.len());
    zones.rotate_left(offset);
    for zone in zones {
        let Some(venue) = ctx
            .db
            .venue()
            .id()
            .find(zone.venue_id)
            .filter(|v| !v.address.trim().is_empty())
        else {
            continue;
        };
        let booth_ids: HashSet<u64> = ctx
            .db
            .booth()
            .zone_id()
            .filter(zone.id)
            .map(|b| b.id)
            .collect();
        let matching: Vec<&MerchTemplate> = templates
            .iter()
            .filter(|t| t.booth_ids.iter().any(|id| booth_ids.contains(id)))
            .collect();
        let choices: Vec<&MerchTemplate> = if matching.is_empty() {
            templates
                .iter()
                .filter(|t| t.booth_ids.is_empty())
                .collect()
        } else {
            matching
        };
        if choices.is_empty() {
            continue;
        }
        let mut candidates: Vec<CrowdMember> =
            photos::photo_candidates(ctx, zone.id, ctx.timestamp)
                .into_iter()
                .filter(|who| ctx.db.live_shopper().identity().find(*who).is_none())
                .filter(|who| {
                    !opening_full
                        || ctx.db.claimant_account().identity().find(*who).is_some()
                        || wallet::live_wallet_pending(ctx, *who)
                })
                .filter_map(|who| eligible(ctx, who, &down))
                .collect();
        candidates.sort_by_key(|m| m.band_id);
        if candidates.is_empty() {
            continue;
        }
        let member = candidates[rng.gen_range(0..candidates.len())].clone();
        let a = ctx.db.attendee().identity().find(member.identity).unwrap();
        let shipping = format!(
            "Test order, do not ship\n{}\nEvent delivery desk\n{}",
            a.display_name,
            venue.address.trim()
        );
        if shipping.chars().count() > merch::SHIPPING_ADDRESS_CHARS {
            continue;
        }
        let template = choices[rng.gen_range(0..choices.len())];
        let mut group = vec![member.identity];
        group.extend(
            candidates
                .iter()
                .filter(|m| m.group_id == member.group_id && m.identity != member.identity)
                .take(2)
                .map(|m| m.identity),
        );
        let Some(photo) = photos::register_crowd_photo(ctx, zone.id, &group) else {
            continue;
        };
        if !wallet::open_for_live_shopper(ctx, &a) {
            return;
        }
        let size = if template.kind == "tee" {
            merch::TEE_SIZES[rng.gen_range(0..merch::TEE_SIZES.len())].into()
        } else {
            String::new()
        };
        ctx.db.live_shopper().insert(LiveShopper {
            identity: member.identity,
            band_id: member.band_id,
            template_id: template.id,
            photo_id: photo.id,
            size,
            shipping_address: shipping,
            selected_at: ctx.timestamp,
            pending: true,
        });
        ctx.db.live_shopping().id().update(LiveShopping {
            selected: schedule.selected + 1,
            next_at: ctx.timestamp + seconds(schedule.gap_secs),
            ..schedule
        });
        return;
    }
}

#[cfg(test)]
mod tests;
