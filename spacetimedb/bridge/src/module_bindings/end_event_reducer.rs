#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct EndEventArgs {}

impl From<EndEventArgs> for super::Reducer {
    fn from(args: EndEventArgs) -> Self {
        Self::EndEvent
    }
}

impl __sdk::InModule for EndEventArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait end_event {
    fn end_event(&self) -> __sdk::Result<()> {
        self.end_event_then(|_, _| {})
    }

    fn end_event_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl end_event for super::RemoteReducers {
    fn end_event_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(EndEventArgs {}, callback)
    }
}
