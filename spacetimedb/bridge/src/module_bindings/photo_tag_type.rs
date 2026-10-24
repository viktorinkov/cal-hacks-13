#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct PhotoTag {
    pub id: u64,
    pub photo_id: u64,
    pub attendee: __sdk::Identity,
    pub status: String,
    pub updated_at: __sdk::Timestamp,
}

impl __sdk::InModule for PhotoTag {
    type Module = super::RemoteModule;
}

pub struct PhotoTagCols {
    pub id: __sdk::__query_builder::Col<PhotoTag, u64>,
    pub photo_id: __sdk::__query_builder::Col<PhotoTag, u64>,
    pub attendee: __sdk::__query_builder::Col<PhotoTag, __sdk::Identity>,
    pub status: __sdk::__query_builder::Col<PhotoTag, String>,
    pub updated_at: __sdk::__query_builder::Col<PhotoTag, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for PhotoTag {
    type Cols = PhotoTagCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        PhotoTagCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            photo_id: __sdk::__query_builder::Col::new(table_name, "photo_id"),
            attendee: __sdk::__query_builder::Col::new(table_name, "attendee"),
            status: __sdk::__query_builder::Col::new(table_name, "status"),
            updated_at: __sdk::__query_builder::Col::new(table_name, "updated_at"),
        }
    }
}

pub struct PhotoTagIxCols {
    pub attendee: __sdk::__query_builder::IxCol<PhotoTag, __sdk::Identity>,
    pub id: __sdk::__query_builder::IxCol<PhotoTag, u64>,
    pub photo_id: __sdk::__query_builder::IxCol<PhotoTag, u64>,
}

impl __sdk::__query_builder::HasIxCols for PhotoTag {
    type IxCols = PhotoTagIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        PhotoTagIxCols {
            attendee: __sdk::__query_builder::IxCol::new(table_name, "attendee"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            photo_id: __sdk::__query_builder::IxCol::new(table_name, "photo_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for PhotoTag {}
