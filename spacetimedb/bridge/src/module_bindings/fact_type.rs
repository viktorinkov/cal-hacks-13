#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Fact {
    pub label: String,
    pub value: String,
}

impl __sdk::InModule for Fact {
    type Module = super::RemoteModule;
}
