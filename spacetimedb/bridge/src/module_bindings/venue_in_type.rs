#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::fact_type::Fact;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct VenueIn {
    pub source_key: String,
    pub name: String,
    pub venue_name: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub website: String,
    pub timezone: String,
    pub starts_at: Option<__sdk::Timestamp>,
    pub ends_at: Option<__sdk::Timestamp>,
    pub description: String,
    pub facts: Vec<Fact>,
    pub source_url: String,
    pub fetched_at: __sdk::Timestamp,
}

impl __sdk::InModule for VenueIn {
    type Module = super::RemoteModule;
}
