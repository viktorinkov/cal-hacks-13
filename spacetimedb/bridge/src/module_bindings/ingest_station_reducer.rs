#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct IngestStationArgs {
    pub id: u8,
    pub exit_colour: u8,
    pub rssi: i8,
}

impl From<IngestStationArgs> for super::Reducer {
    fn from(args: IngestStationArgs) -> Self {
        Self::IngestStation {
            id: args.id,
            exit_colour: args.exit_colour,
            rssi: args.rssi,
        }
    }
}

impl __sdk::InModule for IngestStationArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait ingest_station {
    fn ingest_station(&self, id: u8, exit_colour: u8, rssi: i8) -> __sdk::Result<()> {
        self.ingest_station_then(id, exit_colour, rssi, |_, _| {})
    }

    fn ingest_station_then(
        &self,
        id: u8,
        exit_colour: u8,
        rssi: i8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl ingest_station for super::RemoteReducers {
    fn ingest_station_then(
        &self,
        id: u8,
        exit_colour: u8,
        rssi: i8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            IngestStationArgs {
                id,
                exit_colour,
                rssi,
            },
            callback,
        )
    }
}
