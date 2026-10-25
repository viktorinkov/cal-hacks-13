#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SettleMerchOrderArgs {
    pub job_id: u64,
    pub merchant_id: String,
    pub purchase_id: String,
}

impl From<SettleMerchOrderArgs> for super::Reducer {
    fn from(args: SettleMerchOrderArgs) -> Self {
        Self::SettleMerchOrder {
            job_id: args.job_id,
            merchant_id: args.merchant_id,
            purchase_id: args.purchase_id,
        }
    }
}

impl __sdk::InModule for SettleMerchOrderArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait settle_merch_order {
    fn settle_merch_order(
        &self,
        job_id: u64,
        merchant_id: String,
        purchase_id: String,
    ) -> __sdk::Result<()> {
        self.settle_merch_order_then(job_id, merchant_id, purchase_id, |_, _| {})
    }

    fn settle_merch_order_then(
        &self,
        job_id: u64,
        merchant_id: String,
        purchase_id: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl settle_merch_order for super::RemoteReducers {
    fn settle_merch_order_then(
        &self,
        job_id: u64,
        merchant_id: String,
        purchase_id: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SettleMerchOrderArgs {
                job_id,
                merchant_id,
                purchase_id,
            },
            callback,
        )
    }
}
