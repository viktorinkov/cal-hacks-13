#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct StartJobReaperArgs {}

impl From<StartJobReaperArgs> for super::Reducer {
    fn from(args: StartJobReaperArgs) -> Self {
        Self::StartJobReaper
    }
}

impl __sdk::InModule for StartJobReaperArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait start_job_reaper {
    fn start_job_reaper(&self) -> __sdk::Result<()> {
        self.start_job_reaper_then(|_, _| {})
    }

    fn start_job_reaper_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl start_job_reaper for super::RemoteReducers {
    fn start_job_reaper_then(
        &self,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(StartJobReaperArgs {}, callback)
    }
}
