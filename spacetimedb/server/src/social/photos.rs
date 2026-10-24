//! Event photos: a photo lands in a zone at a time, and the findable people whose bands were there are
//! suggested as tags. Each person confirms or removes their own tag; confirmed photos go into their summary.

use super::logic::*;
use super::tables::*;
use super::tick::bands_in_zone_at;
use crate::roles::require_role;
use spacetimedb::{ReducerContext, Table, Timestamp};

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
    });
    let findable = bands_in_zone_at(ctx, zone_id, taken_at)
        .into_iter()
        .filter(|o| ctx.db.attendee().identity().find(o.owner).is_some_and(|a| a.findable))
        .take(PHOTO_TAG_CAP);
    for o in findable {
        ctx.db.photo_tag().insert(PhotoTag {
            id: 0,
            photo_id: photo.id,
            attendee: o.owner,
            status: TAG_SUGGESTED.into(),
            updated_at: ctx.timestamp,
        });
    }
    Ok(())
}

/// The tagged person keeps or removes their own tag.
#[spacetimedb::reducer]
pub fn respond_photo_tag(ctx: &ReducerContext, tag_id: u64, confirm: bool) -> Result<(), String> {
    let tag = ctx.db.photo_tag().id().find(tag_id).filter(|t| t.attendee == ctx.sender()).ok_or("no such tag")?;
    let status = if confirm { TAG_CONFIRMED } else { TAG_REMOVED };
    ctx.db.photo_tag().id().update(PhotoTag { status: status.into(), updated_at: ctx.timestamp, ..tag });
    Ok(())
}
