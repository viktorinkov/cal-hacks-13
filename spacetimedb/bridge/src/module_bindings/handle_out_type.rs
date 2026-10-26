#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct HandleOut {
    pub platform: String,
    pub handle: String,
}

impl __sdk::InModule for HandleOut {
    type Module = super::RemoteModule;
}
