#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ClearArgs {
    pub target: u8,
}

impl From<ClearArgs> for super::Reducer {
    fn from(args: ClearArgs) -> Self {
        Self::Clear {
            target: args.target,
        }
    }
}

impl __sdk::InModule for ClearArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait clear {
    fn clear(&self, target: u8) -> __sdk::Result<()> {
        self.clear_then(target, |_, _| {})
    }

    fn clear_then(
        &self,
        target: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl clear for super::RemoteReducers {
    fn clear_then(
        &self,
        target: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ClearArgs { target }, callback)
    }
}
