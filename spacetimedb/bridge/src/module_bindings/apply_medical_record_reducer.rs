#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::model_call_in_type::ModelCallIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ApplyMedicalRecordArgs {
    pub job_id: u64,
    pub record_json: String,
    pub call: ModelCallIn,
}

impl From<ApplyMedicalRecordArgs> for super::Reducer {
    fn from(args: ApplyMedicalRecordArgs) -> Self {
        Self::ApplyMedicalRecord {
            job_id: args.job_id,
            record_json: args.record_json,
            call: args.call,
        }
    }
}

impl __sdk::InModule for ApplyMedicalRecordArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait apply_medical_record {
    fn apply_medical_record(
        &self,
        job_id: u64,
        record_json: String,
        call: ModelCallIn,
    ) -> __sdk::Result<()> {
        self.apply_medical_record_then(job_id, record_json, call, |_, _| {})
    }

    fn apply_medical_record_then(
        &self,
        job_id: u64,
        record_json: String,
        call: ModelCallIn,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl apply_medical_record for super::RemoteReducers {
    fn apply_medical_record_then(
        &self,
        job_id: u64,
        record_json: String,
        call: ModelCallIn,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            ApplyMedicalRecordArgs {
                job_id,
                record_json,
                call,
            },
            callback,
        )
    }
}
