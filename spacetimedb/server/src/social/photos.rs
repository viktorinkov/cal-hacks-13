//! Event photos: a photo lands in a zone at a time, and the findable people whose bands were there are
//! tagged in it. Tagged photos go straight into each person's recap and merch.

use super::logic::*;
use super::tables::*;
use super::tick::wearers_in_zone_at;
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
    let mut findable: Vec<_> = wearers_in_zone_at(ctx, zone_id, taken_at)
        .into_iter()
        .filter_map(|who| ctx.db.attendee().identity().find(who).filter(|a| a.findable).map(|a| (a.simulated, who)))
        .collect();
    // People who tapped their bands before the crowd, so the cap never leaves out a person.
    findable.sort_by_key(|(crowd, _)| *crowd);
    let findable = findable.into_iter().map(|(_, who)| who).take(PHOTO_TAG_CAP);
    for who in findable {
        ctx.db.photo_tag().insert(PhotoTag {
            id: 0,
            photo_id: photo.id,
            attendee: who,
            status: String::new(),
            updated_at: ctx.timestamp,
        });
    }
    Ok(())
}
