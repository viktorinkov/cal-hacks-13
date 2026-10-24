#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ClaimCheck {
    pub id: u64,
    pub claim_id: u64,
    pub pack_version: u32,
    pub name: String,
    pub result: String,
    pub detail: String,
    pub reader: String,
    pub created_at: __sdk::Timestamp,
}

impl __sdk::InModule for ClaimCheck {
    type Module = super::RemoteModule;
}

pub struct ClaimCheckCols {
    pub id: __sdk::__query_builder::Col<ClaimCheck, u64>,
    pub claim_id: __sdk::__query_builder::Col<ClaimCheck, u64>,
    pub pack_version: __sdk::__query_builder::Col<ClaimCheck, u32>,
    pub name: __sdk::__query_builder::Col<ClaimCheck, String>,
    pub result: __sdk::__query_builder::Col<ClaimCheck, String>,
    pub detail: __sdk::__query_builder::Col<ClaimCheck, String>,
    pub reader: __sdk::__query_builder::Col<ClaimCheck, String>,
    pub created_at: __sdk::__query_builder::Col<ClaimCheck, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for ClaimCheck {
    type Cols = ClaimCheckCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        ClaimCheckCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            claim_id: __sdk::__query_builder::Col::new(table_name, "claim_id"),
            pack_version: __sdk::__query_builder::Col::new(table_name, "pack_version"),
            name: __sdk::__query_builder::Col::new(table_name, "name"),
            result: __sdk::__query_builder::Col::new(table_name, "result"),
            detail: __sdk::__query_builder::Col::new(table_name, "detail"),
            reader: __sdk::__query_builder::Col::new(table_name, "reader"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
        }
    }
}

pub struct ClaimCheckIxCols {
    pub claim_id: __sdk::__query_builder::IxCol<ClaimCheck, u64>,
    pub id: __sdk::__query_builder::IxCol<ClaimCheck, u64>,
}

impl __sdk::__query_builder::HasIxCols for ClaimCheck {
    type IxCols = ClaimCheckIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        ClaimCheckIxCols {
            claim_id: __sdk::__query_builder::IxCol::new(table_name, "claim_id"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for ClaimCheck {}
