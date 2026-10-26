#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct StartCrowdArgs {
    pub size: u8,
}

impl From<StartCrowdArgs> for super::Reducer {
    fn from(args: StartCrowdArgs) -> Self {
        Self::StartCrowd { size: args.size }
    }
}

impl __sdk::InModule for StartCrowdArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait start_crowd {
    fn start_crowd(&self, size: u8) -> __sdk::Result<()> {
        self.start_crowd_then(size, |_, _| {})
    }

    fn start_crowd_then(
        &self,
        size: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl start_crowd for super::RemoteReducers {
    fn start_crowd_then(
        &self,
        size: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(StartCrowdArgs { size }, callback)
    }
}
