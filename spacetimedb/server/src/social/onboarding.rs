//! Onboarding: tap the band's NFC sticker, press its button to make it yours, then name yourself,
//! optionally claim your pre-populated profile, and type your socials.

use super::graph::relink;
use super::logic::*;
use super::tables::*;
use super::tick::ensure_tick;
use crate::commands::enqueue;
use crate::safety::SIM_BANDS;
use crate::venue::person;
use spacetimedb::{Identity, ReducerContext, Table};

fn attendee_or_new(ctx: &ReducerContext, who: Identity) -> Attendee {
    ctx.db.attendee().identity().find(who).unwrap_or_else(|| {
        ctx.db.attendee().insert(Attendee {
            identity: who,
            node_id: 0,
            display_name: String::new(),
            photo_url: String::new(),
            findable: false,
            person_id: 0,
            organization_id: 0,
            simulated: false,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        })
    })
}

fn my_attendee(ctx: &ReducerContext) -> Result<Attendee, String> {
    ctx.db
        .attendee()
        .identity()
        .find(ctx.sender())
        .ok_or_else(|| "tap your band first".to_string())
}

/// Step 1, from the NFC tap: the band blinks white and waits a few seconds for its button.
/// The press itself is read from band1t's event log by the social tick.
#[spacetimedb::reducer]
pub fn claim_band(ctx: &ReducerContext, token: String) -> Result<(), String> {
    ensure_tick(ctx);
    let band_id = band_from_token(&token)?;
    let me = ctx.sender();
    if let Some(owner) = ctx.db.band_owner().band_id().find(band_id) {
        return if owner.owner == me { Ok(()) } else { Err("this band already belongs to someone".into()) };
    }
    if ctx.db.band_owner().owner().find(me).is_some() {
        return Err("you already wear another band".into());
    }
    if let Some(c) = ctx.db.band_claim().band_id().find(band_id) {
        if c.claimant != me && micros(c.expires_at) > micros(ctx.timestamp) {
            return Err("someone just tapped this band, wait a few seconds and tap again".into());
        }
        ctx.db.band_claim().band_id().delete(band_id);
    }
    attendee_or_new(ctx, me);
    ctx.db.band_claim().insert(BandClaim {
        band_id,
        claimant: me,
        started_at: ctx.timestamp,
        expires_at: ctx.timestamp + seconds(CLAIM_WINDOW_SECONDS),
    });
    // Simulated bands have no radio, so only a real band gets the white blink.
    if !SIM_BANDS.contains(&band_id) {
        enqueue(ctx, band_id, "state", STATE_IDENT, IDENT_TENTHS);
    }
    Ok(())
}

/// Called by the tick when the claimed band's button was pressed inside the window.
pub fn complete_claim(ctx: &ReducerContext, claim: BandClaim) {
    ctx.db.band_claim().band_id().delete(claim.band_id);
    if ctx.db.band_owner().owner().find(claim.claimant).is_some() {
        return;
    }
    ctx.db.band_owner().insert(BandOwner { band_id: claim.band_id, owner: claim.claimant, claimed_at: ctx.timestamp });
    if !SIM_BANDS.contains(&claim.band_id) {
        enqueue(ctx, claim.band_id, "state", STATE_IDLE, 1);
    }
}

/// Step 2: the name others see and the one consent switch.
#[spacetimedb::reducer]
pub fn update_profile(ctx: &ReducerContext, display_name: String, findable: bool) -> Result<(), String> {
    let display_name = clean_name(&display_name)?;
    let old = my_attendee(ctx)?;
    let a = ctx.db.attendee().identity().update(Attendee { display_name, findable, updated_at: ctx.timestamp, ..old.clone() });
    if a.findable != old.findable {
        relink(ctx, &a);
    }
    Ok(())
}

/// Optional step: "this is me" on a speaker, sponsor or exhibitor profile scraped from the event pages.
/// Holding a claimed band is the proof; the first claim wins.
#[spacetimedb::reducer]
pub fn claim_person(ctx: &ReducerContext, person_id: u64) -> Result<(), String> {
    let me = ctx.sender();
    if ctx.db.band_owner().owner().find(me).is_none() {
        return Err("claim your band first".into());
    }
    let p = ctx.db.person().id().find(person_id).ok_or("no such profile")?;
    if let Some(c) = ctx.db.person_claim().person_id().filter(person_id).next() {
        return if c.attendee == me { Ok(()) } else { Err("this profile is already claimed".into()) };
    }
    if ctx.db.person_claim().attendee().find(me).is_some() {
        return Err("you already claimed a profile".into());
    }
    ctx.db.person_claim().insert(PersonClaim { attendee: me, person_id, claimed_at: ctx.timestamp });
    let a = my_attendee(ctx)?;
    let display_name = if a.display_name.is_empty() { p.display_name } else { a.display_name.clone() };
    let a = ctx.db.attendee().identity().update(Attendee {
        display_name,
        photo_url: p.headshot_url,
        person_id,
        organization_id: p.organization_id,
        updated_at: ctx.timestamp,
        ..a
    });
    relink(ctx, &a);
    Ok(())
}

/// Step 3: socials, one per platform.
#[spacetimedb::reducer]
pub fn set_social_handle(ctx: &ReducerContext, platform: String, handle: String) -> Result<(), String> {
    let (platform, handle) = clean_handle(&platform, &handle)?;
    let me = my_attendee(ctx)?.identity;
    match ctx.db.social_handle().owner().filter(me).find(|h| h.platform == platform) {
        Some(h) => {
            ctx.db.social_handle().id().update(SocialHandle { handle, updated_at: ctx.timestamp, ..h });
        }
        None => {
            ctx.db.social_handle().insert(SocialHandle { id: 0, owner: me, platform, handle, updated_at: ctx.timestamp });
        }
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_social_handle(ctx: &ReducerContext, platform: String) -> Result<(), String> {
    let platform = platform.trim().to_ascii_lowercase();
    for h in ctx.db.social_handle().owner().filter(ctx.sender()).filter(|h| h.platform == platform).collect::<Vec<_>>() {
        ctx.db.social_handle().id().delete(h.id);
    }
    Ok(())
}

/// The app registers the hash of a random token; bandit-api later finds the caller by hashing the token it receives.
#[spacetimedb::reducer]
pub fn open_api_session(ctx: &ReducerContext, token_hash: String) -> Result<(), String> {
    check_token_hash(&token_hash)?;
    if ctx.db.api_session().token_hash().find(&token_hash).is_some() {
        return Err("token already registered".into());
    }
    ctx.db.api_session().insert(ApiSession {
        token_hash,
        identity: ctx.sender(),
        created_at: ctx.timestamp,
        expires_at: ctx.timestamp + seconds(API_SESSION_HOURS * 3600),
    });
    Ok(())
}
