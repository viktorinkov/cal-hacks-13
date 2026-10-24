//! Who the claimant is: the owner of the subject band.

use spacetimedb::{Identity, ReducerContext};

/// The band owner's identity and display name, when the band is claimed.
pub fn claimant_for_band(_ctx: &ReducerContext, _band_id: u8) -> Option<(Identity, String)> {
    None
}
