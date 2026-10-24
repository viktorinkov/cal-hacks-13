#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RequestPaymentArgs {
    pub band_id: u8,
    pub amount_cents: u32,
    pub merchant: String,
}

impl From<RequestPaymentArgs> for super::Reducer {
    fn from(args: RequestPaymentArgs) -> Self {
        Self::RequestPayment {
            band_id: args.band_id,
            amount_cents: args.amount_cents,
            merchant: args.merchant,
        }
    }
}

impl __sdk::InModule for RequestPaymentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait request_payment {
    fn request_payment(
        &self,
        band_id: u8,
        amount_cents: u32,
        merchant: String,
    ) -> __sdk::Result<()> {
        self.request_payment_then(band_id, amount_cents, merchant, |_, _| {})
    }

    fn request_payment_then(
        &self,
        band_id: u8,
        amount_cents: u32,
        merchant: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl request_payment for super::RemoteReducers {
    fn request_payment_then(
        &self,
        band_id: u8,
        amount_cents: u32,
        merchant: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RequestPaymentArgs {
                band_id,
                amount_cents,
                merchant,
            },
            callback,
        )
    }
}
