#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ExtendJobLeaseArgs {
    pub job_id: u64,
}

impl From<ExtendJobLeaseArgs> for super::Reducer {
    fn from(args: ExtendJobLeaseArgs) -> Self {
        Self::ExtendJobLease {
            job_id: args.job_id,
        }
    }
}

impl __sdk::InModule for ExtendJobLeaseArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait extend_job_lease {
    fn extend_job_lease(&self, job_id: u64) -> __sdk::Result<()> {
        self.extend_job_lease_then(job_id, |_, _| {})
    }

    fn extend_job_lease_then(
        &self,
        job_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl extend_job_lease for super::RemoteReducers {
    fn extend_job_lease_then(
        &self,
        job_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ExtendJobLeaseArgs { job_id }, callback)
    }
}
