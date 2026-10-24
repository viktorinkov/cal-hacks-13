#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetRssiArgs {
    pub neigh_rssi: i8,
    pub circle_rssi: i8,
}

impl From<SetRssiArgs> for super::Reducer {
    fn from(args: SetRssiArgs) -> Self {
        Self::SetRssi {
            neigh_rssi: args.neigh_rssi,
            circle_rssi: args.circle_rssi,
        }
    }
}

impl __sdk::InModule for SetRssiArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_rssi {
    fn set_rssi(&self, neigh_rssi: i8, circle_rssi: i8) -> __sdk::Result<()> {
        self.set_rssi_then(neigh_rssi, circle_rssi, |_, _| {})
    }

    fn set_rssi_then(
        &self,
        neigh_rssi: i8,
        circle_rssi: i8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_rssi for super::RemoteReducers {
    fn set_rssi_then(
        &self,
        neigh_rssi: i8,
        circle_rssi: i8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SetRssiArgs {
                neigh_rssi,
                circle_rssi,
            },
            callback,
        )
    }
}
