#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct PersonIn {
    pub source_key: String,
    pub display_name: String,
    pub kind: String,
    pub role: String,
    pub title: String,
    pub organization_key: String,
    pub bio: String,
    pub headshot_url: String,
    pub links: Vec<String>,
    pub source_url: String,
    pub fetched_at: __sdk::Timestamp,
}

impl __sdk::InModule for PersonIn {
    type Module = super::RemoteModule;
}
