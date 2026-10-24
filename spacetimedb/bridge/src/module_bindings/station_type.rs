#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Station {
    pub id: u8,
    pub exit_colour: u8,
    pub rssi: i8,
    pub online: bool,
    pub last_seen: __sdk::Timestamp,
}

impl __sdk::InModule for Station {
    type Module = super::RemoteModule;
}

pub struct StationCols {
    pub id: __sdk::__query_builder::Col<Station, u8>,
    pub exit_colour: __sdk::__query_builder::Col<Station, u8>,
    pub rssi: __sdk::__query_builder::Col<Station, i8>,
    pub online: __sdk::__query_builder::Col<Station, bool>,
    pub last_seen: __sdk::__query_builder::Col<Station, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for Station {
    type Cols = StationCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        StationCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            exit_colour: __sdk::__query_builder::Col::new(table_name, "exit_colour"),
            rssi: __sdk::__query_builder::Col::new(table_name, "rssi"),
            online: __sdk::__query_builder::Col::new(table_name, "online"),
            last_seen: __sdk::__query_builder::Col::new(table_name, "last_seen"),
        }
    }
}

pub struct StationIxCols {
    pub id: __sdk::__query_builder::IxCol<Station, u8>,
}

impl __sdk::__query_builder::HasIxCols for Station {
    type IxCols = StationIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        StationIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Station {}
