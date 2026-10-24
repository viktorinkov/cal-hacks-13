#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct StopFindArgs {
    pub seeker: u8,
}

impl From<StopFindArgs> for super::Reducer {
    fn from(args: StopFindArgs) -> Self {
        Self::StopFind {
            seeker: args.seeker,
        }
    }
}

impl __sdk::InModule for StopFindArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait stop_find {
    fn stop_find(&self, seeker: u8) -> __sdk::Result<()> {
        self.stop_find_then(seeker, |_, _| {})
    }

    fn stop_find_then(
        &self,
        seeker: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl stop_find for super::RemoteReducers {
    fn stop_find_then(
        &self,
        seeker: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(StopFindArgs { seeker }, callback)
    }
}
