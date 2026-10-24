#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RecordClaimPayoutArgs {
    pub job_id: u64,
    pub customer_id: String,
    pub account_id: String,
    pub deposit_id: String,
}

impl From<RecordClaimPayoutArgs> for super::Reducer {
    fn from(args: RecordClaimPayoutArgs) -> Self {
        Self::RecordClaimPayout {
            job_id: args.job_id,
            customer_id: args.customer_id,
            account_id: args.account_id,
            deposit_id: args.deposit_id,
        }
    }
}

impl __sdk::InModule for RecordClaimPayoutArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait record_claim_payout {
    fn record_claim_payout(
        &self,
        job_id: u64,
        customer_id: String,
        account_id: String,
        deposit_id: String,
    ) -> __sdk::Result<()> {
        self.record_claim_payout_then(job_id, customer_id, account_id, deposit_id, |_, _| {})
    }

    fn record_claim_payout_then(
        &self,
        job_id: u64,
        customer_id: String,
        account_id: String,
        deposit_id: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl record_claim_payout for super::RemoteReducers {
    fn record_claim_payout_then(
        &self,
        job_id: u64,
        customer_id: String,
        account_id: String,
        deposit_id: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RecordClaimPayoutArgs {
                job_id,
                customer_id,
                account_id,
                deposit_id,
            },
            callback,
        )
    }
}
