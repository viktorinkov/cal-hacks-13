#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetExitArgs {
    pub target: u8,
    pub colour: u8,
}

impl From<SetExitArgs> for super::Reducer {
    fn from(args: SetExitArgs) -> Self {
        Self::SetExit {
            target: args.target,
            colour: args.colour,
        }
    }
}

impl __sdk::InModule for SetExitArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_exit {
    fn set_exit(&self, target: u8, colour: u8) -> __sdk::Result<()> {
        self.set_exit_then(target, colour, |_, _| {})
    }

    fn set_exit_then(
        &self,
        target: u8,
        colour: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_exit for super::RemoteReducers {
    fn set_exit_then(
        &self,
        target: u8,
        colour: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(SetExitArgs { target, colour }, callback)
    }
}
