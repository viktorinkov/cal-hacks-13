#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
#[derive(Copy, Eq, Hash)]
pub enum IncidentKind {
    Sos,

    Fall,

    Property,
}

impl __sdk::InModule for IncidentKind {
    type Module = super::RemoteModule;
}
