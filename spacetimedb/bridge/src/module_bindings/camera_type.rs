#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Camera {
    pub id: u64,
    pub name: String,
    pub zone_id: u64,
    pub mount: String,
    pub live: bool,
    pub last_frame_at: Option<__sdk::Timestamp>,
}

impl __sdk::InModule for Camera {
    type Module = super::RemoteModule;
}

pub struct CameraCols {
    pub id: __sdk::__query_builder::Col<Camera, u64>,
    pub name: __sdk::__query_builder::Col<Camera, String>,
    pub zone_id: __sdk::__query_builder::Col<Camera, u64>,
    pub mount: __sdk::__query_builder::Col<Camera, String>,
    pub live: __sdk::__query_builder::Col<Camera, bool>,
    pub last_frame_at: __sdk::__query_builder::Col<Camera, Option<__sdk::Timestamp>>,
}

impl __sdk::__query_builder::HasCols for Camera {
    type Cols = CameraCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        CameraCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            name: __sdk::__query_builder::Col::new(table_name, "name"),
            zone_id: __sdk::__query_builder::Col::new(table_name, "zone_id"),
            mount: __sdk::__query_builder::Col::new(table_name, "mount"),
            live: __sdk::__query_builder::Col::new(table_name, "live"),
            last_frame_at: __sdk::__query_builder::Col::new(table_name, "last_frame_at"),
        }
    }
}

pub struct CameraIxCols {
    pub id: __sdk::__query_builder::IxCol<Camera, u64>,
    pub name: __sdk::__query_builder::IxCol<Camera, String>,
}

impl __sdk::__query_builder::HasIxCols for Camera {
    type IxCols = CameraIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        CameraIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            name: __sdk::__query_builder::IxCol::new(table_name, "name"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Camera {}
