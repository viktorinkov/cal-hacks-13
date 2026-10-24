#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ModelCall {
    pub id: u64,
    pub job_id: u64,
    pub kind: String,
    pub model_requested: String,
    pub model_used: String,
    pub effort: String,
    pub request_hash: String,
    pub status: String,
    pub stop_reason: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub latency_ms: u32,
    pub response: String,
    pub error: String,
    pub recorded_by: __sdk::Identity,
    pub created_at: __sdk::Timestamp,
}

impl __sdk::InModule for ModelCall {
    type Module = super::RemoteModule;
}

pub struct ModelCallCols {
    pub id: __sdk::__query_builder::Col<ModelCall, u64>,
    pub job_id: __sdk::__query_builder::Col<ModelCall, u64>,
    pub kind: __sdk::__query_builder::Col<ModelCall, String>,
    pub model_requested: __sdk::__query_builder::Col<ModelCall, String>,
    pub model_used: __sdk::__query_builder::Col<ModelCall, String>,
    pub effort: __sdk::__query_builder::Col<ModelCall, String>,
    pub request_hash: __sdk::__query_builder::Col<ModelCall, String>,
    pub status: __sdk::__query_builder::Col<ModelCall, String>,
    pub stop_reason: __sdk::__query_builder::Col<ModelCall, String>,
    pub input_tokens: __sdk::__query_builder::Col<ModelCall, u32>,
    pub output_tokens: __sdk::__query_builder::Col<ModelCall, u32>,
    pub latency_ms: __sdk::__query_builder::Col<ModelCall, u32>,
    pub response: __sdk::__query_builder::Col<ModelCall, String>,
    pub error: __sdk::__query_builder::Col<ModelCall, String>,
    pub recorded_by: __sdk::__query_builder::Col<ModelCall, __sdk::Identity>,
    pub created_at: __sdk::__query_builder::Col<ModelCall, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for ModelCall {
    type Cols = ModelCallCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        ModelCallCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            job_id: __sdk::__query_builder::Col::new(table_name, "job_id"),
            kind: __sdk::__query_builder::Col::new(table_name, "kind"),
            model_requested: __sdk::__query_builder::Col::new(table_name, "model_requested"),
            model_used: __sdk::__query_builder::Col::new(table_name, "model_used"),
            effort: __sdk::__query_builder::Col::new(table_name, "effort"),
            request_hash: __sdk::__query_builder::Col::new(table_name, "request_hash"),
            status: __sdk::__query_builder::Col::new(table_name, "status"),
            stop_reason: __sdk::__query_builder::Col::new(table_name, "stop_reason"),
            input_tokens: __sdk::__query_builder::Col::new(table_name, "input_tokens"),
            output_tokens: __sdk::__query_builder::Col::new(table_name, "output_tokens"),
            latency_ms: __sdk::__query_builder::Col::new(table_name, "latency_ms"),
            response: __sdk::__query_builder::Col::new(table_name, "response"),
            error: __sdk::__query_builder::Col::new(table_name, "error"),
            recorded_by: __sdk::__query_builder::Col::new(table_name, "recorded_by"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
        }
    }
}

pub struct ModelCallIxCols {
    pub id: __sdk::__query_builder::IxCol<ModelCall, u64>,
    pub job_id: __sdk::__query_builder::IxCol<ModelCall, u64>,
}

impl __sdk::__query_builder::HasIxCols for ModelCall {
    type IxCols = ModelCallIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        ModelCallIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            job_id: __sdk::__query_builder::IxCol::new(table_name, "job_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for ModelCall {}
