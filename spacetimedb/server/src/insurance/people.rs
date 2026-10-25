//! Who the claimant is: the attendee who wears the subject band (social's tables).

use crate::social::tables::{attendee, band_owner, crowd_member};
use crate::tables::radio_id;
use spacetimedb::{Identity, ReducerContext};

/// The wearer's identity and display name: the owner of a claimed radio or test band, or the crowd's
/// attendee wearing a crowd band.
pub fn wearer(ctx: &ReducerContext, band_id: u32) -> Option<(Identity, String)> {
    let who = match radio_id(band_id) {
        Some(radio) => ctx.db.band_owner().band_id().find(radio)?.owner,
        None => ctx.db.crowd_member().band_id().find(band_id)?.identity,
    };
    let name = ctx.db.attendee().identity().find(who).map(|a| a.display_name).unwrap_or_default();
    Some((who, name))
}

/// The claimant of an incident on this band: whoever wears it.
pub fn claimant_for_band(ctx: &ReducerContext, band_id: u32) -> Option<(Identity, String)> {
    wearer(ctx, band_id)
}
