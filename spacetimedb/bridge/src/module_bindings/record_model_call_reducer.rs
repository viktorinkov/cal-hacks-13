#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::model_call_in_type::ModelCallIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RecordModelCallArgs {
    pub call: ModelCallIn,
}

impl From<RecordModelCallArgs> for super::Reducer {
    fn from(args: RecordModelCallArgs) -> Self {
        Self::RecordModelCall { call: args.call }
    }
}

impl __sdk::InModule for RecordModelCallArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait record_model_call {
    fn record_model_call(&self, call: ModelCallIn) -> __sdk::Result<()> {
        self.record_model_call_then(call, |_, _| {})
    }

    fn record_model_call_then(
        &self,
        call: ModelCallIn,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl record_model_call for super::RemoteReducers {
    fn record_model_call_then(
        &self,
        call: ModelCallIn,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(RecordModelCallArgs { call }, callback)
    }
}
