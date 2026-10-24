#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ReopenEventArgs {}

impl From<ReopenEventArgs> for super::Reducer {
    fn from(args: ReopenEventArgs) -> Self {
        Self::ReopenEvent
    }
}

impl __sdk::InModule for ReopenEventArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait reopen_event {
    fn reopen_event(&self) -> __sdk::Result<()> {
        self.reopen_event_then(|_, _| {})
    }

    fn reopen_event_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl reopen_event for super::RemoteReducers {
    fn reopen_event_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ReopenEventArgs {}, callback)
    }
}
