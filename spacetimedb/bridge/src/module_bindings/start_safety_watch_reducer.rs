#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct StartSafetyWatchArgs {}

impl From<StartSafetyWatchArgs> for super::Reducer {
    fn from(args: StartSafetyWatchArgs) -> Self {
        Self::StartSafetyWatch
    }
}

impl __sdk::InModule for StartSafetyWatchArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait start_safety_watch {
    fn start_safety_watch(&self) -> __sdk::Result<()> {
        self.start_safety_watch_then(|_, _| {})
    }

    fn start_safety_watch_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl start_safety_watch for super::RemoteReducers {
    fn start_safety_watch_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(StartSafetyWatchArgs {}, callback)
    }
}
