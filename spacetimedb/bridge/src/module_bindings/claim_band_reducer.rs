#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ClaimBandArgs {
    pub token: String,
}

impl From<ClaimBandArgs> for super::Reducer {
    fn from(args: ClaimBandArgs) -> Self {
        Self::ClaimBand { token: args.token }
    }
}

impl __sdk::InModule for ClaimBandArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait claim_band {
    fn claim_band(&self, token: String) -> __sdk::Result<()> {
        self.claim_band_then(token, |_, _| {})
    }

    fn claim_band_then(
        &self,
        token: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl claim_band for super::RemoteReducers {
    fn claim_band_then(
        &self,
        token: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ClaimBandArgs { token }, callback)
    }
}
