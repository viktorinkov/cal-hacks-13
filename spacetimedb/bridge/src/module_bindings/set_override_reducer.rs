#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetOverrideArgs {
    pub on: bool,
}

impl From<SetOverrideArgs> for super::Reducer {
    fn from(args: SetOverrideArgs) -> Self {
        Self::SetOverride { on: args.on }
    }
}

impl __sdk::InModule for SetOverrideArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_override {
    fn set_override(&self, on: bool) -> __sdk::Result<()> {
        self.set_override_then(on, |_, _| {})
    }

    fn set_override_then(
        &self,
        on: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_override for super::RemoteReducers {
    fn set_override_then(
        &self,
        on: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(SetOverrideArgs { on }, callback)
    }
}
