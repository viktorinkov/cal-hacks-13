#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MyWallet {
    pub account_id: String,
    pub balance_cents: i64,
    pub opened_at: __sdk::Timestamp,
}

impl __sdk::InModule for MyWallet {
    type Module = super::RemoteModule;
}

pub struct MyWalletCols {
    pub account_id: __sdk::__query_builder::Col<MyWallet, String>,
    pub balance_cents: __sdk::__query_builder::Col<MyWallet, i64>,
    pub opened_at: __sdk::__query_builder::Col<MyWallet, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for MyWallet {
    type Cols = MyWalletCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        MyWalletCols {
            account_id: __sdk::__query_builder::Col::new(table_name, "account_id"),
            balance_cents: __sdk::__query_builder::Col::new(table_name, "balance_cents"),
            opened_at: __sdk::__query_builder::Col::new(table_name, "opened_at"),
        }
    }
}
