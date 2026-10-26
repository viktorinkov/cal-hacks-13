#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ClaimJobArgs {
    pub job_id: u64,
}

impl From<ClaimJobArgs> for super::Reducer {
    fn from(args: ClaimJobArgs) -> Self {
        Self::ClaimJob {
            job_id: args.job_id,
        }
    }
}

impl __sdk::InModule for ClaimJobArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait claim_job {
    fn claim_job(&self, job_id: u64) -> __sdk::Result<()> {
        self.claim_job_then(job_id, |_, _| {})
    }

    fn claim_job_then(
        &self,
        job_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl claim_job for super::RemoteReducers {
    fn claim_job_then(
        &self,
        job_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ClaimJobArgs { job_id }, callback)
    }
}
