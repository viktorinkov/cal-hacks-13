#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct CrowdMember {
    pub band_id: u8,
    pub group_id: u8,
    pub station: u8,
    pub next_move_at: __sdk::Timestamp,
}

impl __sdk::InModule for CrowdMember {
    type Module = super::RemoteModule;
}

pub struct CrowdMemberCols {
    pub band_id: __sdk::__query_builder::Col<CrowdMember, u8>,
    pub group_id: __sdk::__query_builder::Col<CrowdMember, u8>,
    pub station: __sdk::__query_builder::Col<CrowdMember, u8>,
    pub next_move_at: __sdk::__query_builder::Col<CrowdMember, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for CrowdMember {
    type Cols = CrowdMemberCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        CrowdMemberCols {
            band_id: __sdk::__query_builder::Col::new(table_name, "band_id"),
            group_id: __sdk::__query_builder::Col::new(table_name, "group_id"),
            station: __sdk::__query_builder::Col::new(table_name, "station"),
            next_move_at: __sdk::__query_builder::Col::new(table_name, "next_move_at"),
        }
    }
}

pub struct CrowdMemberIxCols {
    pub band_id: __sdk::__query_builder::IxCol<CrowdMember, u8>,
    pub group_id: __sdk::__query_builder::IxCol<CrowdMember, u8>,
}

impl __sdk::__query_builder::HasIxCols for CrowdMember {
    type IxCols = CrowdMemberIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        CrowdMemberIxCols {
            band_id: __sdk::__query_builder::IxCol::new(table_name, "band_id"),
            group_id: __sdk::__query_builder::IxCol::new(table_name, "group_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for CrowdMember {}
