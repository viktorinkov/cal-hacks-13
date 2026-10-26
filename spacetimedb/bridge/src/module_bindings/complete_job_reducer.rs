#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct CompleteJobArgs {
    pub job_id: u64,
    pub result: String,
}

impl From<CompleteJobArgs> for super::Reducer {
    fn from(args: CompleteJobArgs) -> Self {
        Self::CompleteJob {
            job_id: args.job_id,
            result: args.result,
        }
    }
}

impl __sdk::InModule for CompleteJobArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait complete_job {
    fn complete_job(&self, job_id: u64, result: String) -> __sdk::Result<()> {
        self.complete_job_then(job_id, result, |_, _| {})
    }

    fn complete_job_then(
        &self,
        job_id: u64,
        result: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl complete_job for super::RemoteReducers {
    fn complete_job_then(
        &self,
        job_id: u64,
        result: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(CompleteJobArgs { job_id, result }, callback)
    }
}
