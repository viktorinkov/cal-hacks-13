#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ForceStateArgs {
    pub target: u8,
    pub state: u8,
    pub tenths: u8,
}

impl From<ForceStateArgs> for super::Reducer {
    fn from(args: ForceStateArgs) -> Self {
        Self::ForceState {
            target: args.target,
            state: args.state,
            tenths: args.tenths,
        }
    }
}

impl __sdk::InModule for ForceStateArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait force_state {
    fn force_state(&self, target: u8, state: u8, tenths: u8) -> __sdk::Result<()> {
        self.force_state_then(target, state, tenths, |_, _| {})
    }

    fn force_state_then(
        &self,
        target: u8,
        state: u8,
        tenths: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl force_state for super::RemoteReducers {
    fn force_state_then(
        &self,
        target: u8,
        state: u8,
        tenths: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            ForceStateArgs {
                target,
                state,
                tenths,
            },
            callback,
        )
    }
}
