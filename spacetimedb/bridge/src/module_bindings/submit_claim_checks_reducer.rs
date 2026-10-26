#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::check_in_type::CheckIn;
use super::precedent_in_type::PrecedentIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SubmitClaimChecksArgs {
    pub job_id: u64,
    pub checks: Vec<CheckIn>,
    pub precedents: Vec<PrecedentIn>,
}

impl From<SubmitClaimChecksArgs> for super::Reducer {
    fn from(args: SubmitClaimChecksArgs) -> Self {
        Self::SubmitClaimChecks {
            job_id: args.job_id,
            checks: args.checks,
            precedents: args.precedents,
        }
    }
}

impl __sdk::InModule for SubmitClaimChecksArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait submit_claim_checks {
    fn submit_claim_checks(
        &self,
        job_id: u64,
        checks: Vec<CheckIn>,
        precedents: Vec<PrecedentIn>,
    ) -> __sdk::Result<()> {
        self.submit_claim_checks_then(job_id, checks, precedents, |_, _| {})
    }

    fn submit_claim_checks_then(
        &self,
        job_id: u64,
        checks: Vec<CheckIn>,
        precedents: Vec<PrecedentIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl submit_claim_checks for super::RemoteReducers {
    fn submit_claim_checks_then(
        &self,
        job_id: u64,
        checks: Vec<CheckIn>,
        precedents: Vec<PrecedentIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SubmitClaimChecksArgs {
                job_id,
                checks,
                precedents,
            },
            callback,
        )
    }
}
