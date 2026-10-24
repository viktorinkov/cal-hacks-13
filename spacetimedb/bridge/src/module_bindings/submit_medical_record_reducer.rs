#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SubmitMedicalRecordArgs {
    pub claim_id: u64,
    pub file_hash: String,
    pub page_count: u32,
}

impl From<SubmitMedicalRecordArgs> for super::Reducer {
    fn from(args: SubmitMedicalRecordArgs) -> Self {
        Self::SubmitMedicalRecord {
            claim_id: args.claim_id,
            file_hash: args.file_hash,
            page_count: args.page_count,
        }
    }
}

impl __sdk::InModule for SubmitMedicalRecordArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait submit_medical_record {
    fn submit_medical_record(
        &self,
        claim_id: u64,
        file_hash: String,
        page_count: u32,
    ) -> __sdk::Result<()> {
        self.submit_medical_record_then(claim_id, file_hash, page_count, |_, _| {})
    }

    fn submit_medical_record_then(
        &self,
        claim_id: u64,
        file_hash: String,
        page_count: u32,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl submit_medical_record for super::RemoteReducers {
    fn submit_medical_record_then(
        &self,
        claim_id: u64,
        file_hash: String,
        page_count: u32,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SubmitMedicalRecordArgs {
                claim_id,
                file_hash,
                page_count,
            },
            callback,
        )
    }
}
