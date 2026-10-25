#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RecordInsurerPaymentArgs {
    pub claim_id: u64,
    pub amount_cents: u64,
    pub reference: String,
}

impl From<RecordInsurerPaymentArgs> for super::Reducer {
    fn from(args: RecordInsurerPaymentArgs) -> Self {
        Self::RecordInsurerPayment {
            claim_id: args.claim_id,
            amount_cents: args.amount_cents,
            reference: args.reference,
        }
    }
}

impl __sdk::InModule for RecordInsurerPaymentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait record_insurer_payment {
    fn record_insurer_payment(
        &self,
        claim_id: u64,
        amount_cents: u64,
        reference: String,
    ) -> __sdk::Result<()> {
        self.record_insurer_payment_then(claim_id, amount_cents, reference, |_, _| {})
    }

    fn record_insurer_payment_then(
        &self,
        claim_id: u64,
        amount_cents: u64,
        reference: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl record_insurer_payment for super::RemoteReducers {
    fn record_insurer_payment_then(
        &self,
        claim_id: u64,
        amount_cents: u64,
        reference: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RecordInsurerPaymentArgs {
                claim_id,
                amount_cents,
                reference,
            },
            callback,
        )
    }
}
