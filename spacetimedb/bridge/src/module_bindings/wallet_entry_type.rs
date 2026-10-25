#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct WalletEntry {
    pub id: u64,
    pub identity: __sdk::Identity,
    pub kind: String,
    pub amount_cents: i64,
    pub memo: String,
    pub nessie_id: String,
    pub created_at: __sdk::Timestamp,
}

impl __sdk::InModule for WalletEntry {
    type Module = super::RemoteModule;
}

pub struct WalletEntryCols {
    pub id: __sdk::__query_builder::Col<WalletEntry, u64>,
    pub identity: __sdk::__query_builder::Col<WalletEntry, __sdk::Identity>,
    pub kind: __sdk::__query_builder::Col<WalletEntry, String>,
    pub amount_cents: __sdk::__query_builder::Col<WalletEntry, i64>,
    pub memo: __sdk::__query_builder::Col<WalletEntry, String>,
    pub nessie_id: __sdk::__query_builder::Col<WalletEntry, String>,
    pub created_at: __sdk::__query_builder::Col<WalletEntry, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for WalletEntry {
    type Cols = WalletEntryCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        WalletEntryCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            identity: __sdk::__query_builder::Col::new(table_name, "identity"),
            kind: __sdk::__query_builder::Col::new(table_name, "kind"),
            amount_cents: __sdk::__query_builder::Col::new(table_name, "amount_cents"),
            memo: __sdk::__query_builder::Col::new(table_name, "memo"),
            nessie_id: __sdk::__query_builder::Col::new(table_name, "nessie_id"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
        }
    }
}

pub struct WalletEntryIxCols {
    pub id: __sdk::__query_builder::IxCol<WalletEntry, u64>,
    pub identity: __sdk::__query_builder::IxCol<WalletEntry, __sdk::Identity>,
}

impl __sdk::__query_builder::HasIxCols for WalletEntry {
    type IxCols = WalletEntryIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        WalletEntryIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            identity: __sdk::__query_builder::IxCol::new(table_name, "identity"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for WalletEntry {}
