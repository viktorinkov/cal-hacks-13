//! Who the claimant is: the attendee who wore the subject band (social's tables).

use crate::social::tables::{attendee, band_owner};
use spacetimedb::{Identity, ReducerContext, Timestamp};

/// The band's owner, when they claimed it at or before `at`.
pub fn wore_band_at(ctx: &ReducerContext, band_id: u8, at: Timestamp) -> Option<Identity> {
    ctx.db.band_owner().band_id().find(band_id).filter(|o| o.claimed_at <= at).map(|o| o.owner)
}

/// The attendee's display name, empty when they never saved one.
pub fn display_name(ctx: &ReducerContext, identity: Identity) -> String {
    ctx.db.attendee().identity().find(identity).map(|a| a.display_name).unwrap_or_default()
}
