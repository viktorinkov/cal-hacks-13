#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct BoothIn {
    pub source_key: String,
    pub zone_key: String,
    pub organization_key: String,
    pub booth_number: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub tags: Vec<String>,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub placement: String,
    pub source_url: String,
    pub fetched_at: __sdk::Timestamp,
}

impl __sdk::InModule for BoothIn {
    type Module = super::RemoteModule;
}
