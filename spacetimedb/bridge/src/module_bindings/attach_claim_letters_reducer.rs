#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::model_call_in_type::ModelCallIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct AttachClaimLettersArgs {
    pub job_id: u64,
    pub fnol_hash: String,
    pub summary_hash: String,
    pub determination_hash: String,
    pub call: Option<ModelCallIn>,
}

impl From<AttachClaimLettersArgs> for super::Reducer {
    fn from(args: AttachClaimLettersArgs) -> Self {
        Self::AttachClaimLetters {
            job_id: args.job_id,
            fnol_hash: args.fnol_hash,
            summary_hash: args.summary_hash,
            determination_hash: args.determination_hash,
            call: args.call,
        }
    }
}

impl __sdk::InModule for AttachClaimLettersArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait attach_claim_letters {
    fn attach_claim_letters(
        &self,
        job_id: u64,
        fnol_hash: String,
        summary_hash: String,
        determination_hash: String,
        call: Option<ModelCallIn>,
    ) -> __sdk::Result<()> {
        self.attach_claim_letters_then(
            job_id,
            fnol_hash,
            summary_hash,
            determination_hash,
            call,
            |_, _| {},
        )
    }

    fn attach_claim_letters_then(
        &self,
        job_id: u64,
        fnol_hash: String,
        summary_hash: String,
        determination_hash: String,
        call: Option<ModelCallIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl attach_claim_letters for super::RemoteReducers {
    fn attach_claim_letters_then(
        &self,
        job_id: u64,
        fnol_hash: String,
        summary_hash: String,
        determination_hash: String,
        call: Option<ModelCallIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            AttachClaimLettersArgs {
                job_id,
                fnol_hash,
                summary_hash,
                determination_hash,
                call,
            },
            callback,
        )
    }
}
