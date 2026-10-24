#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MyBand {
    pub band_id: u8,
    pub status: String,
    pub expires_at: Option<__sdk::Timestamp>,
}

impl __sdk::InModule for MyBand {
    type Module = super::RemoteModule;
}

pub struct MyBandCols {
    pub band_id: __sdk::__query_builder::Col<MyBand, u8>,
    pub status: __sdk::__query_builder::Col<MyBand, String>,
    pub expires_at: __sdk::__query_builder::Col<MyBand, Option<__sdk::Timestamp>>,
}

impl __sdk::__query_builder::HasCols for MyBand {
    type Cols = MyBandCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        MyBandCols {
            band_id: __sdk::__query_builder::Col::new(table_name, "band_id"),
            status: __sdk::__query_builder::Col::new(table_name, "status"),
            expires_at: __sdk::__query_builder::Col::new(table_name, "expires_at"),
        }
    }
}
