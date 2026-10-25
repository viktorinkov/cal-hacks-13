#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MerchOrder {
    pub id: u64,
    pub attendee: __sdk::Identity,
    pub template_id: u64,
    pub photo_id: u64,
    pub size: String,
    pub amount_cents: u64,
    pub status: String,
    pub failure: String,
    pub nessie_purchase_id: String,
    pub created_at: __sdk::Timestamp,
    pub updated_at: __sdk::Timestamp,
}

impl __sdk::InModule for MerchOrder {
    type Module = super::RemoteModule;
}

pub struct MerchOrderCols {
    pub id: __sdk::__query_builder::Col<MerchOrder, u64>,
    pub attendee: __sdk::__query_builder::Col<MerchOrder, __sdk::Identity>,
    pub template_id: __sdk::__query_builder::Col<MerchOrder, u64>,
    pub photo_id: __sdk::__query_builder::Col<MerchOrder, u64>,
    pub size: __sdk::__query_builder::Col<MerchOrder, String>,
    pub amount_cents: __sdk::__query_builder::Col<MerchOrder, u64>,
    pub status: __sdk::__query_builder::Col<MerchOrder, String>,
    pub failure: __sdk::__query_builder::Col<MerchOrder, String>,
    pub nessie_purchase_id: __sdk::__query_builder::Col<MerchOrder, String>,
    pub created_at: __sdk::__query_builder::Col<MerchOrder, __sdk::Timestamp>,
    pub updated_at: __sdk::__query_builder::Col<MerchOrder, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for MerchOrder {
    type Cols = MerchOrderCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        MerchOrderCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            attendee: __sdk::__query_builder::Col::new(table_name, "attendee"),
            template_id: __sdk::__query_builder::Col::new(table_name, "template_id"),
            photo_id: __sdk::__query_builder::Col::new(table_name, "photo_id"),
            size: __sdk::__query_builder::Col::new(table_name, "size"),
            amount_cents: __sdk::__query_builder::Col::new(table_name, "amount_cents"),
            status: __sdk::__query_builder::Col::new(table_name, "status"),
            failure: __sdk::__query_builder::Col::new(table_name, "failure"),
            nessie_purchase_id: __sdk::__query_builder::Col::new(table_name, "nessie_purchase_id"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
            updated_at: __sdk::__query_builder::Col::new(table_name, "updated_at"),
        }
    }
}

pub struct MerchOrderIxCols {
    pub attendee: __sdk::__query_builder::IxCol<MerchOrder, __sdk::Identity>,
    pub id: __sdk::__query_builder::IxCol<MerchOrder, u64>,
}

impl __sdk::__query_builder::HasIxCols for MerchOrder {
    type IxCols = MerchOrderIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        MerchOrderIxCols {
            attendee: __sdk::__query_builder::IxCol::new(table_name, "attendee"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for MerchOrder {}
