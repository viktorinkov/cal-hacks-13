#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MerchShop {
    pub id: u8,
    pub nessie_merchant_id: String,
}

impl __sdk::InModule for MerchShop {
    type Module = super::RemoteModule;
}

pub struct MerchShopCols {
    pub id: __sdk::__query_builder::Col<MerchShop, u8>,
    pub nessie_merchant_id: __sdk::__query_builder::Col<MerchShop, String>,
}

impl __sdk::__query_builder::HasCols for MerchShop {
    type Cols = MerchShopCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        MerchShopCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            nessie_merchant_id: __sdk::__query_builder::Col::new(table_name, "nessie_merchant_id"),
        }
    }
}

pub struct MerchShopIxCols {
    pub id: __sdk::__query_builder::IxCol<MerchShop, u8>,
}

impl __sdk::__query_builder::HasIxCols for MerchShop {
    type IxCols = MerchShopIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        MerchShopIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for MerchShop {}
