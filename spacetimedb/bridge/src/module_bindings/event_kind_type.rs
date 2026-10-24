#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
#[derive(Copy, Eq, Hash)]
pub enum EventKind {
    Online,

    Offline,

    Sleep,

    SosRaised,

    SosCleared,

    Fall,

    Press,

    FindStarted,

    FindEnded,

    FoundMe,

    PaymentApproved,

    PaymentDeclined,

    PaymentCompleted,

    GatewayUp,

    CommandFailed,
}

impl __sdk::InModule for EventKind {
    type Module = super::RemoteModule;
}
