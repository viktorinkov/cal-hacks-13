#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RetryClaimPayoutArgs {
    pub claim_id: u64,
}

impl From<RetryClaimPayoutArgs> for super::Reducer {
    fn from(args: RetryClaimPayoutArgs) -> Self {
        Self::RetryClaimPayout {
            claim_id: args.claim_id,
        }
    }
}

impl __sdk::InModule for RetryClaimPayoutArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait retry_claim_payout {
    fn retry_claim_payout(&self, claim_id: u64) -> __sdk::Result<()> {
        self.retry_claim_payout_then(claim_id, |_, _| {})
    }

    fn retry_claim_payout_then(
        &self,
        claim_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl retry_claim_payout for super::RemoteReducers {
    fn retry_claim_payout_then(
        &self,
        claim_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(RetryClaimPayoutArgs { claim_id }, callback)
    }
}
