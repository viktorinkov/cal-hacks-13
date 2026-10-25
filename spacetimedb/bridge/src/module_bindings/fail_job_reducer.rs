#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::model_call_in_type::ModelCallIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct FailJobArgs {
    pub job_id: u64,
    pub error: String,
    pub call: Option<ModelCallIn>,
}

impl From<FailJobArgs> for super::Reducer {
    fn from(args: FailJobArgs) -> Self {
        Self::FailJob {
            job_id: args.job_id,
            error: args.error,
            call: args.call,
        }
    }
}

impl __sdk::InModule for FailJobArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait fail_job {
    fn fail_job(&self, job_id: u64, error: String, call: Option<ModelCallIn>) -> __sdk::Result<()> {
        self.fail_job_then(job_id, error, call, |_, _| {})
    }

    fn fail_job_then(
        &self,
        job_id: u64,
        error: String,
        call: Option<ModelCallIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl fail_job for super::RemoteReducers {
    fn fail_job_then(
        &self,
        job_id: u64,
        error: String,
        call: Option<ModelCallIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            FailJobArgs {
                job_id,
                error,
                call,
            },
            callback,
        )
    }
}
