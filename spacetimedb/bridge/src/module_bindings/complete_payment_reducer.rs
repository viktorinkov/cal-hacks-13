#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct CompletePaymentArgs {
    pub payment_id: u64,
    pub purchase_ref: String,
}

impl From<CompletePaymentArgs> for super::Reducer {
    fn from(args: CompletePaymentArgs) -> Self {
        Self::CompletePayment {
            payment_id: args.payment_id,
            purchase_ref: args.purchase_ref,
        }
    }
}

impl __sdk::InModule for CompletePaymentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait complete_payment {
    fn complete_payment(&self, payment_id: u64, purchase_ref: String) -> __sdk::Result<()> {
        self.complete_payment_then(payment_id, purchase_ref, |_, _| {})
    }

    fn complete_payment_then(
        &self,
        payment_id: u64,
        purchase_ref: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl complete_payment for super::RemoteReducers {
    fn complete_payment_then(
        &self,
        payment_id: u64,
        purchase_ref: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            CompletePaymentArgs {
                payment_id,
                purchase_ref,
            },
            callback,
        )
    }
}
