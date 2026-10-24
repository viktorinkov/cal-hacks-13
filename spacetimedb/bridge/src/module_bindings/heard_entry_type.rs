#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct HeardEntry {
    pub id: u8,
    pub rssi: i8,
}

impl __sdk::InModule for HeardEntry {
    type Module = super::RemoteModule;
}
