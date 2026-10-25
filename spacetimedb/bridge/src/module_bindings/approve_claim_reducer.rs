#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ApproveClaimArgs {
    pub claim_id: u64,
    pub amount_seen_cents: u64,
    pub pack_hash_seen: String,
    pub requested_ceiling_cents: Option<u64>,
    pub learn: bool,
}

impl From<ApproveClaimArgs> for super::Reducer {
    fn from(args: ApproveClaimArgs) -> Self {
        Self::ApproveClaim {
            claim_id: args.claim_id,
            amount_seen_cents: args.amount_seen_cents,
            pack_hash_seen: args.pack_hash_seen,
            requested_ceiling_cents: args.requested_ceiling_cents,
            learn: args.learn,
        }
    }
}

impl __sdk::InModule for ApproveClaimArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait approve_claim {
    fn approve_claim(
        &self,
        claim_id: u64,
        amount_seen_cents: u64,
        pack_hash_seen: String,
        requested_ceiling_cents: Option<u64>,
        learn: bool,
    ) -> __sdk::Result<()> {
        self.approve_claim_then(
            claim_id,
            amount_seen_cents,
            pack_hash_seen,
            requested_ceiling_cents,
            learn,
            |_, _| {},
        )
    }

    fn approve_claim_then(
        &self,
        claim_id: u64,
        amount_seen_cents: u64,
        pack_hash_seen: String,
        requested_ceiling_cents: Option<u64>,
        learn: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl approve_claim for super::RemoteReducers {
    fn approve_claim_then(
        &self,
        claim_id: u64,
        amount_seen_cents: u64,
        pack_hash_seen: String,
        requested_ceiling_cents: Option<u64>,
        learn: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            ApproveClaimArgs {
                claim_id,
                amount_seen_cents,
                pack_hash_seen,
                requested_ceiling_cents,
                learn,
            },
            callback,
        )
    }
}
