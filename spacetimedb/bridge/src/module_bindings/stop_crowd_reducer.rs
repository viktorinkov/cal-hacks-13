#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct StopCrowdArgs {}

impl From<StopCrowdArgs> for super::Reducer {
    fn from(args: StopCrowdArgs) -> Self {
        Self::StopCrowd
    }
}

impl __sdk::InModule for StopCrowdArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait stop_crowd {
    fn stop_crowd(&self) -> __sdk::Result<()> {
        self.stop_crowd_then(|_, _| {})
    }

    fn stop_crowd_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl stop_crowd for super::RemoteReducers {
    fn stop_crowd_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(StopCrowdArgs {}, callback)
    }
}
