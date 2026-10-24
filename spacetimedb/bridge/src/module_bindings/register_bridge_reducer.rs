#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RegisterBridgeArgs {}

impl From<RegisterBridgeArgs> for super::Reducer {
    fn from(args: RegisterBridgeArgs) -> Self {
        Self::RegisterBridge
    }
}

impl __sdk::InModule for RegisterBridgeArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait register_bridge {
    fn register_bridge(&self) -> __sdk::Result<()> {
        self.register_bridge_then(|_, _| {})
    }

    fn register_bridge_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl register_bridge for super::RemoteReducers {
    fn register_bridge_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(RegisterBridgeArgs {}, callback)
    }
}
