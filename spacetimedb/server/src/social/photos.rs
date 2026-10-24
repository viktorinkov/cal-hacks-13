//! Event photos: a photo lands in a zone at a time, and the findable people whose bands were there are
//! tagged in it. Tagged photos go straight into each person's recap and merch.

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
    let mut findable: Vec<_> = bands_in_zone_at(ctx, zone_id, taken_at)
        .into_iter()
        .filter_map(|o| ctx.db.attendee().identity().find(o.owner).filter(|a| a.findable).map(|a| (a.simulated, o)))
        .collect();
    // Real attendees before the simulated crowd, so the cap never crowds out a person.
    findable.sort_by_key(|(simulated, _)| *simulated);
    let findable = findable.into_iter().map(|(_, o)| o).take(PHOTO_TAG_CAP);
    for o in findable {
        ctx.db.photo_tag().insert(PhotoTag {
            id: 0,
            photo_id: photo.id,
            attendee: o.owner,
            status: String::new(),
            updated_at: ctx.timestamp,
        });
    }
    Ok(())
}
