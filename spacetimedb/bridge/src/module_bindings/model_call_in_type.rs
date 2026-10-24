#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ModelCallIn {
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
}

impl __sdk::InModule for ModelCallIn {
    type Module = super::RemoteModule;
}
