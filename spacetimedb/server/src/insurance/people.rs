//! Who the claimant is: the attendee who wore the subject band (social's tables).

use crate::social::tables::{attendee, band_owner, crowd_member};
use crate::tables::radio_id;
use spacetimedb::{Identity, ReducerContext, Timestamp};

/// The wearer's identity and display name: the owner of a claimed radio or test band, or the crowd's
/// attendee wearing a crowd band.
pub fn wearer(ctx: &ReducerContext, band_id: u32) -> Option<(Identity, String)> {
    let who = match radio_id(band_id) {
        Some(radio) => ctx.db.band_owner().band_id().find(radio)?.owner,
        None => ctx.db.crowd_member().band_id().find(band_id)?.identity,
    };
    Some((who, display_name(ctx, who)))
}

/// Who wore the band at `at`: a radio or test band's owner who had claimed it by then, or the crowd's
/// attendee wearing a crowd band.
pub fn wore_band_at(ctx: &ReducerContext, band_id: u32, at: Timestamp) -> Option<Identity> {
    match radio_id(band_id) {
        Some(radio) => ctx.db.band_owner().band_id().find(radio).filter(|o| o.claimed_at <= at).map(|o| o.owner),
        None => ctx.db.crowd_member().band_id().find(band_id).map(|m| m.identity),
    }
}

/// The attendee's display name, empty when they never saved one.
pub fn display_name(ctx: &ReducerContext, identity: Identity) -> String {
    ctx.db.attendee().identity().find(identity).map(|a| a.display_name).unwrap_or_default()
}
