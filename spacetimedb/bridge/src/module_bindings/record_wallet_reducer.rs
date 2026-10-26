#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RecordWalletArgs {
    pub job_id: u64,
    pub customer_id: String,
    pub account_id: String,
}

impl From<RecordWalletArgs> for super::Reducer {
    fn from(args: RecordWalletArgs) -> Self {
        Self::RecordWallet {
            job_id: args.job_id,
            customer_id: args.customer_id,
            account_id: args.account_id,
        }
    }
}

impl __sdk::InModule for RecordWalletArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait record_wallet {
    fn record_wallet(
        &self,
        job_id: u64,
        customer_id: String,
        account_id: String,
    ) -> __sdk::Result<()> {
        self.record_wallet_then(job_id, customer_id, account_id, |_, _| {})
    }

    fn record_wallet_then(
        &self,
        job_id: u64,
        customer_id: String,
        account_id: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl record_wallet for super::RemoteReducers {
    fn record_wallet_then(
        &self,
        job_id: u64,
        customer_id: String,
        account_id: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RecordWalletArgs {
                job_id,
                customer_id,
                account_id,
            },
            callback,
        )
    }
}
