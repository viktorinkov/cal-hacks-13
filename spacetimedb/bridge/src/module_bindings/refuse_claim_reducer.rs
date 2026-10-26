#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RefuseClaimArgs {
    pub claim_id: u64,
    pub pack_hash_seen: String,
    pub reason: String,
}

impl From<RefuseClaimArgs> for super::Reducer {
    fn from(args: RefuseClaimArgs) -> Self {
        Self::RefuseClaim {
            claim_id: args.claim_id,
            pack_hash_seen: args.pack_hash_seen,
            reason: args.reason,
        }
    }
}

impl __sdk::InModule for RefuseClaimArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait refuse_claim {
    fn refuse_claim(
        &self,
        claim_id: u64,
        pack_hash_seen: String,
        reason: String,
    ) -> __sdk::Result<()> {
        self.refuse_claim_then(claim_id, pack_hash_seen, reason, |_, _| {})
    }

    fn refuse_claim_then(
        &self,
        claim_id: u64,
        pack_hash_seen: String,
        reason: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl refuse_claim for super::RemoteReducers {
    fn refuse_claim_then(
        &self,
        claim_id: u64,
        pack_hash_seen: String,
        reason: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RefuseClaimArgs {
                claim_id,
                pack_hash_seen,
                reason,
            },
            callback,
        )
    }
}
