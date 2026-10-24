#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::model_call_in_type::ModelCallIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct AttachRecoveryLetterArgs {
    pub job_id: u64,
    pub recovery_hash: String,
    pub call: Option<ModelCallIn>,
}

impl From<AttachRecoveryLetterArgs> for super::Reducer {
    fn from(args: AttachRecoveryLetterArgs) -> Self {
        Self::AttachRecoveryLetter {
            job_id: args.job_id,
            recovery_hash: args.recovery_hash,
            call: args.call,
        }
    }
}

impl __sdk::InModule for AttachRecoveryLetterArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait attach_recovery_letter {
    fn attach_recovery_letter(
        &self,
        job_id: u64,
        recovery_hash: String,
        call: Option<ModelCallIn>,
    ) -> __sdk::Result<()> {
        self.attach_recovery_letter_then(job_id, recovery_hash, call, |_, _| {})
    }

    fn attach_recovery_letter_then(
        &self,
        job_id: u64,
        recovery_hash: String,
        call: Option<ModelCallIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl attach_recovery_letter for super::RemoteReducers {
    fn attach_recovery_letter_then(
        &self,
        job_id: u64,
        recovery_hash: String,
        call: Option<ModelCallIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            AttachRecoveryLetterArgs {
                job_id,
                recovery_hash,
                call,
            },
            callback,
        )
    }
}
