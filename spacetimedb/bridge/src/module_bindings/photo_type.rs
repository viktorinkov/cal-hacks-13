#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Photo {
    pub id: u64,
    pub url: String,
    pub taken_at: __sdk::Timestamp,
    pub zone_id: u64,
    pub caption: String,
    pub added_by: __sdk::Identity,
    pub created_at: __sdk::Timestamp,
}

impl __sdk::InModule for Photo {
    type Module = super::RemoteModule;
}

pub struct PhotoCols {
    pub id: __sdk::__query_builder::Col<Photo, u64>,
    pub url: __sdk::__query_builder::Col<Photo, String>,
    pub taken_at: __sdk::__query_builder::Col<Photo, __sdk::Timestamp>,
    pub zone_id: __sdk::__query_builder::Col<Photo, u64>,
    pub caption: __sdk::__query_builder::Col<Photo, String>,
    pub added_by: __sdk::__query_builder::Col<Photo, __sdk::Identity>,
    pub created_at: __sdk::__query_builder::Col<Photo, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for Photo {
    type Cols = PhotoCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        PhotoCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            url: __sdk::__query_builder::Col::new(table_name, "url"),
            taken_at: __sdk::__query_builder::Col::new(table_name, "taken_at"),
            zone_id: __sdk::__query_builder::Col::new(table_name, "zone_id"),
            caption: __sdk::__query_builder::Col::new(table_name, "caption"),
            added_by: __sdk::__query_builder::Col::new(table_name, "added_by"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
        }
    }
}

pub struct PhotoIxCols {
    pub id: __sdk::__query_builder::IxCol<Photo, u64>,
    pub zone_id: __sdk::__query_builder::IxCol<Photo, u64>,
}

impl __sdk::__query_builder::HasIxCols for Photo {
    type IxCols = PhotoIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        PhotoIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            zone_id: __sdk::__query_builder::IxCol::new(table_name, "zone_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Photo {}
