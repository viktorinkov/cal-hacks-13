#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetThresholdsArgs {
    pub yellow: u8,
    pub red: u8,
}

impl From<SetThresholdsArgs> for super::Reducer {
    fn from(args: SetThresholdsArgs) -> Self {
        Self::SetThresholds {
            yellow: args.yellow,
            red: args.red,
        }
    }
}

impl __sdk::InModule for SetThresholdsArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_thresholds {
    fn set_thresholds(&self, yellow: u8, red: u8) -> __sdk::Result<()> {
        self.set_thresholds_then(yellow, red, |_, _| {})
    }

    fn set_thresholds_then(
        &self,
        yellow: u8,
        red: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_thresholds for super::RemoteReducers {
    fn set_thresholds_then(
        &self,
        yellow: u8,
        red: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(SetThresholdsArgs { yellow, red }, callback)
    }
}
