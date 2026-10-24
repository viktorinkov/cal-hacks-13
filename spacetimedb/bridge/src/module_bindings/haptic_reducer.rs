#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct HapticArgs {
    pub target: u8,
    pub pattern: u8,
}

impl From<HapticArgs> for super::Reducer {
    fn from(args: HapticArgs) -> Self {
        Self::Haptic {
            target: args.target,
            pattern: args.pattern,
        }
    }
}

impl __sdk::InModule for HapticArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait haptic {
    fn haptic(&self, target: u8, pattern: u8) -> __sdk::Result<()> {
        self.haptic_then(target, pattern, |_, _| {})
    }

    fn haptic_then(
        &self,
        target: u8,
        pattern: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl haptic for super::RemoteReducers {
    fn haptic_then(
        &self,
        target: u8,
        pattern: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(HapticArgs { target, pattern }, callback)
    }
}
