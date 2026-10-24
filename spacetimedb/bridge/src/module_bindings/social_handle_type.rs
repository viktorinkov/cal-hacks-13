#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct SocialHandle {
    pub id: u64,
    pub owner: __sdk::Identity,
    pub platform: String,
    pub handle: String,
    pub updated_at: __sdk::Timestamp,
}

impl __sdk::InModule for SocialHandle {
    type Module = super::RemoteModule;
}

pub struct SocialHandleCols {
    pub id: __sdk::__query_builder::Col<SocialHandle, u64>,
    pub owner: __sdk::__query_builder::Col<SocialHandle, __sdk::Identity>,
    pub platform: __sdk::__query_builder::Col<SocialHandle, String>,
    pub handle: __sdk::__query_builder::Col<SocialHandle, String>,
    pub updated_at: __sdk::__query_builder::Col<SocialHandle, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for SocialHandle {
    type Cols = SocialHandleCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        SocialHandleCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            owner: __sdk::__query_builder::Col::new(table_name, "owner"),
            platform: __sdk::__query_builder::Col::new(table_name, "platform"),
            handle: __sdk::__query_builder::Col::new(table_name, "handle"),
            updated_at: __sdk::__query_builder::Col::new(table_name, "updated_at"),
        }
    }
}

pub struct SocialHandleIxCols {
    pub id: __sdk::__query_builder::IxCol<SocialHandle, u64>,
    pub owner: __sdk::__query_builder::IxCol<SocialHandle, __sdk::Identity>,
}

impl __sdk::__query_builder::HasIxCols for SocialHandle {
    type IxCols = SocialHandleIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        SocialHandleIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            owner: __sdk::__query_builder::IxCol::new(table_name, "owner"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for SocialHandle {}
