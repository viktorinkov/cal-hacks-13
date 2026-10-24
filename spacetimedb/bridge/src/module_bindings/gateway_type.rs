#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Gateway {
    pub id: u8,
    pub mac: String,
    pub fw: String,
    pub online: bool,
    pub last_line: __sdk::Timestamp,
}

impl __sdk::InModule for Gateway {
    type Module = super::RemoteModule;
}

pub struct GatewayCols {
    pub id: __sdk::__query_builder::Col<Gateway, u8>,
    pub mac: __sdk::__query_builder::Col<Gateway, String>,
    pub fw: __sdk::__query_builder::Col<Gateway, String>,
    pub online: __sdk::__query_builder::Col<Gateway, bool>,
    pub last_line: __sdk::__query_builder::Col<Gateway, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for Gateway {
    type Cols = GatewayCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        GatewayCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            mac: __sdk::__query_builder::Col::new(table_name, "mac"),
            fw: __sdk::__query_builder::Col::new(table_name, "fw"),
            online: __sdk::__query_builder::Col::new(table_name, "online"),
            last_line: __sdk::__query_builder::Col::new(table_name, "last_line"),
        }
    }
}

pub struct GatewayIxCols {
    pub id: __sdk::__query_builder::IxCol<Gateway, u8>,
}

impl __sdk::__query_builder::HasIxCols for Gateway {
    type IxCols = GatewayIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        GatewayIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Gateway {}
