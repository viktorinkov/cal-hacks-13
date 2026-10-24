#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::model_call_in_type::ModelCallIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SubmitClaimReviewArgs {
    pub job_id: u64,
    pub review_json: String,
    pub call: ModelCallIn,
}

impl From<SubmitClaimReviewArgs> for super::Reducer {
    fn from(args: SubmitClaimReviewArgs) -> Self {
        Self::SubmitClaimReview {
            job_id: args.job_id,
            review_json: args.review_json,
            call: args.call,
        }
    }
}

impl __sdk::InModule for SubmitClaimReviewArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait submit_claim_review {
    fn submit_claim_review(
        &self,
        job_id: u64,
        review_json: String,
        call: ModelCallIn,
    ) -> __sdk::Result<()> {
        self.submit_claim_review_then(job_id, review_json, call, |_, _| {})
    }

    fn submit_claim_review_then(
        &self,
        job_id: u64,
        review_json: String,
        call: ModelCallIn,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl submit_claim_review for super::RemoteReducers {
    fn submit_claim_review_then(
        &self,
        job_id: u64,
        review_json: String,
        call: ModelCallIn,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SubmitClaimReviewArgs {
                job_id,
                review_json,
                call,
            },
            callback,
        )
    }
}
