#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct BandClaim {
    pub band_id: u8,
    pub claimant: __sdk::Identity,
    pub started_at: __sdk::Timestamp,
    pub expires_at: __sdk::Timestamp,
}

impl __sdk::InModule for BandClaim {
    type Module = super::RemoteModule;
}

pub struct BandClaimCols {
    pub band_id: __sdk::__query_builder::Col<BandClaim, u8>,
    pub claimant: __sdk::__query_builder::Col<BandClaim, __sdk::Identity>,
    pub started_at: __sdk::__query_builder::Col<BandClaim, __sdk::Timestamp>,
    pub expires_at: __sdk::__query_builder::Col<BandClaim, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for BandClaim {
    type Cols = BandClaimCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        BandClaimCols {
            band_id: __sdk::__query_builder::Col::new(table_name, "band_id"),
            claimant: __sdk::__query_builder::Col::new(table_name, "claimant"),
            started_at: __sdk::__query_builder::Col::new(table_name, "started_at"),
            expires_at: __sdk::__query_builder::Col::new(table_name, "expires_at"),
        }
    }
}

pub struct BandClaimIxCols {
    pub band_id: __sdk::__query_builder::IxCol<BandClaim, u8>,
    pub claimant: __sdk::__query_builder::IxCol<BandClaim, __sdk::Identity>,
}

impl __sdk::__query_builder::HasIxCols for BandClaim {
    type IxCols = BandClaimIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        BandClaimIxCols {
            band_id: __sdk::__query_builder::IxCol::new(table_name, "band_id"),
            claimant: __sdk::__query_builder::IxCol::new(table_name, "claimant"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for BandClaim {}
