#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SleepBandsArgs {
    pub target: u8,
    pub minutes: u8,
}

impl From<SleepBandsArgs> for super::Reducer {
    fn from(args: SleepBandsArgs) -> Self {
        Self::SleepBands {
            target: args.target,
            minutes: args.minutes,
        }
    }
}

impl __sdk::InModule for SleepBandsArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait sleep_bands {
    fn sleep_bands(&self, target: u8, minutes: u8) -> __sdk::Result<()> {
        self.sleep_bands_then(target, minutes, |_, _| {})
    }

    fn sleep_bands_then(
        &self,
        target: u8,
        minutes: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl sleep_bands for super::RemoteReducers {
    fn sleep_bands_then(
        &self,
        target: u8,
        minutes: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(SleepBandsArgs { target, minutes }, callback)
    }
}
