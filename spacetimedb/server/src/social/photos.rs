//! Event photos: a photo lands in a zone at a time, and the findable people whose bands were there are
//! tagged in it. Claude then reads the photo for how many people it shows and a caption, and the tags are
//! set to that many: the people the bands put closest together at that moment. Tagged photos go straight
//! into each person's recap and merch.

use super::logic::*;
use super::tables::*;
use super::tick::wearer;
use crate::jobs::{self, ModelCallIn, blob_ref};
use crate::roles::require_role;
use crate::tables::{Encounter, band, encounter, zone_visit};
use crate::venue::*;
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};
use std::collections::{HashMap, HashSet};

pub const KIND_PHOTO_FEATURES: &str = "photo_features";
/// Two bands count as standing together at the moment of a photo when they heard each other this recently.
const TOGETHER_SECONDS: i64 = 30;
const CAPTION_CHARS: usize = 140;

/// The findable people whose bands were in the zone when the photo was taken, best first: people who tapped
/// their bands before the crowd, then whoever stood close to the most other candidates at that moment (a group
/// posing together), then who had been there longest.
pub fn photo_candidates(ctx: &ReducerContext, zone_id: u64, at: Timestamp) -> Vec<Identity> {
    let Some(station) = ctx.db.zone().id().find(zone_id).map(|z| z.station_id) else {
        return Vec::new();
    };
    let t = micros(at);
    // (band, entered, crowd, who) for every worn, findable band with a stay in the zone covering `at`.
    let present: Vec<(u32, i64, bool, Identity)> = ctx
        .db
        .band()
        .iter()
        .filter_map(|b| {
            let stay = ctx.db.zone_visit().band_id().filter(b.id).find(|v| {
                v.zone == station && micros(v.entered) <= t && v.left.is_none_or(|l| micros(l) >= t)
            })?;
            let (who, _) = wearer(ctx, b.id)?;
            let a = ctx.db.attendee().identity().find(who).filter(|a| a.findable)?;
            Some((b.id, micros(stay.entered), a.crowd, who))
        })
        .collect();
    let bands: HashSet<u32> = present.iter().map(|p| p.0).collect();
    let close_at = |e: &Encounter| micros(e.first_seen) <= t && micros(e.last_seen) >= t - TOGETHER_SECONDS * 1_000_000;
    let together: HashMap<u32, usize> = present
        .iter()
        .map(|&(band, ..)| {
            let n = ctx
                .db
                .encounter()
                .band_a()
                .filter(band)
                .map(|e| (e.band_b, close_at(&e)))
                .chain(ctx.db.encounter().band_b().filter(band).map(|e| (e.band_a, close_at(&e))))
                .filter(|(other, close)| *close && bands.contains(other))
                .count();
            (band, n)
        })
        .collect();
    let mut ranked = present;
    ranked.sort_by_key(|&(band, entered, crowd, _)| (crowd, std::cmp::Reverse(together[&band]), entered, band));
    ranked.into_iter().map(|(.., who)| who).collect()
}

/// Replaces the photo's tags with the first `cap` candidates.
fn tag(ctx: &ReducerContext, photo: &Photo, cap: usize) {
    for old in ctx.db.photo_tag().photo_id().filter(photo.id).collect::<Vec<_>>() {
        ctx.db.photo_tag().id().delete(old.id);
    }
    for who in photo_candidates(ctx, photo.zone_id, photo.taken_at).into_iter().take(cap) {
        ctx.db.photo_tag().insert(PhotoTag {
            id: 0,
            photo_id: photo.id,
            attendee: who,
            status: String::new(),
            updated_at: ctx.timestamp,
        });
    }
}

#[spacetimedb::reducer]
pub fn register_photo(ctx: &ReducerContext, url: String, taken_at: Timestamp, zone_id: u64, caption: String) -> Result<(), String> {
    require_role(ctx, &["photographer", "ingest", "ops"])?;
    if url.trim().is_empty() {
        return Err("photo url is empty".into());
    }
    let photo = ctx.db.photo().insert(Photo {
        id: 0,
        url,
        taken_at,
        zone_id,
        caption,
        added_by: ctx.sender(),
        created_at: ctx.timestamp,
        people_count: 0,
        features_call_id: 0,
    });
    tag(ctx, &photo, PHOTO_TAG_CAP);
    // A photo in the blob store goes to Claude, which counts the people and writes a caption.
    let hash = photo.url.strip_prefix("/blobs/").unwrap_or_default();
    if let Some(blob) = ctx.db.blob_ref().hash().find(hash.to_string()) {
        let zone = ctx.db.zone().id().find(zone_id);
        let payload = serde_json::json!({
            "photo_id": photo.id,
            "blob_hash": blob.hash,
            "content_type": blob.content_type,
            "zone": zone.as_ref().map(|z| z.name.clone()).unwrap_or_default(),
            "zone_description": zone.map(|z| z.description).unwrap_or_default(),
            "booths": ctx.db.booth().zone_id().filter(zone_id).map(|b| b.name).take(60).collect::<Vec<_>>(),
            "caption": photo.caption,
        });
        jobs::enqueue(ctx, KIND_PHOTO_FEATURES, payload.to_string(), "photo", photo.id);
    }
    Ok(())
}

/// The worker's reading of a photo: how many people it shows and a one-line caption. The tags become the
/// first `people_count` candidates, and the caption fills in when the photographer gave none.
#[spacetimedb::reducer]
pub fn submit_photo_features(ctx: &ReducerContext, job_id: u64, people_count: u32, caption: String, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker", "vision"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let photo = ctx.db.photo().id().find(job.subject_id).ok_or("no such photo")?;
    let call_id = jobs::record_call(ctx, job_id, &call);
    let caption: String = caption.trim().chars().take(CAPTION_CHARS).collect();
    let photo = ctx.db.photo().id().update(Photo {
        caption: if photo.caption.trim().is_empty() { caption.clone() } else { photo.caption.clone() },
        people_count,
        features_call_id: call_id,
        ..photo
    });
    tag(ctx, &photo, people_count as usize);
    jobs::finish(ctx, job, format!("{people_count} people: {caption}"));
    Ok(())
}
