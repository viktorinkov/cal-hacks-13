#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetZoneStationArgs {
    pub zone_id: u64,
    pub station_id: u8,
}

impl From<SetZoneStationArgs> for super::Reducer {
    fn from(args: SetZoneStationArgs) -> Self {
        Self::SetZoneStation {
            zone_id: args.zone_id,
            station_id: args.station_id,
        }
    }
}

impl __sdk::InModule for SetZoneStationArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_zone_station {
    fn set_zone_station(&self, zone_id: u64, station_id: u8) -> __sdk::Result<()> {
        self.set_zone_station_then(zone_id, station_id, |_, _| {})
    }

    fn set_zone_station_then(
        &self,
        zone_id: u64,
        station_id: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_zone_station for super::RemoteReducers {
    fn set_zone_station_then(
        &self,
        zone_id: u64,
        station_id: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SetZoneStationArgs {
                zone_id,
                station_id,
            },
            callback,
        )
    }
}
