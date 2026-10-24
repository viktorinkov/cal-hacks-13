#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ResetBridgeArgs {}

impl From<ResetBridgeArgs> for super::Reducer {
    fn from(args: ResetBridgeArgs) -> Self {
        Self::ResetBridge
    }
}

impl __sdk::InModule for ResetBridgeArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait reset_bridge {
    fn reset_bridge(&self) -> __sdk::Result<()> {
        self.reset_bridge_then(|_, _| {})
    }

    fn reset_bridge_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl reset_bridge for super::RemoteReducers {
    fn reset_bridge_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ResetBridgeArgs {}, callback)
    }
}
