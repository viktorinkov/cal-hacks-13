#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetLowVisArgs {
    pub on: bool,
}

impl From<SetLowVisArgs> for super::Reducer {
    fn from(args: SetLowVisArgs) -> Self {
        Self::SetLowVis { on: args.on }
    }
}

impl __sdk::InModule for SetLowVisArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_low_vis {
    fn set_low_vis(&self, on: bool) -> __sdk::Result<()> {
        self.set_low_vis_then(on, |_, _| {})
    }

    fn set_low_vis_then(
        &self,
        on: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_low_vis for super::RemoteReducers {
    fn set_low_vis_then(
        &self,
        on: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(SetLowVisArgs { on }, callback)
    }
}
