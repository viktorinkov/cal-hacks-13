//! Who the claimant is: the attendee who owns the subject band (social's tables).

use crate::social::tables::{attendee, band_owner};
use spacetimedb::{Identity, ReducerContext};

/// The band owner's identity and display name, when the band is claimed.
pub fn claimant_for_band(ctx: &ReducerContext, band_id: u8) -> Option<(Identity, String)> {
    let owner = ctx.db.band_owner().band_id().find(band_id)?.owner;
    let name = ctx.db.attendee().identity().find(owner).map(|a| a.display_name).unwrap_or_default();
    Some((owner, name))
}
