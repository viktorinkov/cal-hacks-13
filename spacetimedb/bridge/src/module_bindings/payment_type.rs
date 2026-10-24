#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::payment_status_type::PaymentStatus;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Payment {
    pub id: u64,
    pub band_id: u8,
    pub amount_cents: u32,
    pub merchant: String,
    pub status: PaymentStatus,
    pub created: __sdk::Timestamp,
    pub expires: __sdk::Timestamp,
    pub approved_at: Option<__sdk::Timestamp>,
    pub purchase_ref: Option<String>,
}

impl __sdk::InModule for Payment {
    type Module = super::RemoteModule;
}

pub struct PaymentCols {
    pub id: __sdk::__query_builder::Col<Payment, u64>,
    pub band_id: __sdk::__query_builder::Col<Payment, u8>,
    pub amount_cents: __sdk::__query_builder::Col<Payment, u32>,
    pub merchant: __sdk::__query_builder::Col<Payment, String>,
    pub status: __sdk::__query_builder::Col<Payment, PaymentStatus>,
    pub created: __sdk::__query_builder::Col<Payment, __sdk::Timestamp>,
    pub expires: __sdk::__query_builder::Col<Payment, __sdk::Timestamp>,
    pub approved_at: __sdk::__query_builder::Col<Payment, Option<__sdk::Timestamp>>,
    pub purchase_ref: __sdk::__query_builder::Col<Payment, Option<String>>,
}

impl __sdk::__query_builder::HasCols for Payment {
    type Cols = PaymentCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        PaymentCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            band_id: __sdk::__query_builder::Col::new(table_name, "band_id"),
            amount_cents: __sdk::__query_builder::Col::new(table_name, "amount_cents"),
            merchant: __sdk::__query_builder::Col::new(table_name, "merchant"),
            status: __sdk::__query_builder::Col::new(table_name, "status"),
            created: __sdk::__query_builder::Col::new(table_name, "created"),
            expires: __sdk::__query_builder::Col::new(table_name, "expires"),
            approved_at: __sdk::__query_builder::Col::new(table_name, "approved_at"),
            purchase_ref: __sdk::__query_builder::Col::new(table_name, "purchase_ref"),
        }
    }
}

pub struct PaymentIxCols {
    pub band_id: __sdk::__query_builder::IxCol<Payment, u8>,
    pub id: __sdk::__query_builder::IxCol<Payment, u64>,
}

impl __sdk::__query_builder::HasIxCols for Payment {
    type IxCols = PaymentIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        PaymentIxCols {
            band_id: __sdk::__query_builder::IxCol::new(table_name, "band_id"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Payment {}
