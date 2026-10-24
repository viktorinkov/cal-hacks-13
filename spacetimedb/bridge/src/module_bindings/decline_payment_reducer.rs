#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct DeclinePaymentArgs {
    pub payment_id: u64,
}

impl From<DeclinePaymentArgs> for super::Reducer {
    fn from(args: DeclinePaymentArgs) -> Self {
        Self::DeclinePayment {
            payment_id: args.payment_id,
        }
    }
}

impl __sdk::InModule for DeclinePaymentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait decline_payment {
    fn decline_payment(&self, payment_id: u64) -> __sdk::Result<()> {
        self.decline_payment_then(payment_id, |_, _| {})
    }

    fn decline_payment_then(
        &self,
        payment_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl decline_payment for super::RemoteReducers {
    fn decline_payment_then(
        &self,
        payment_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(DeclinePaymentArgs { payment_id }, callback)
    }
}
