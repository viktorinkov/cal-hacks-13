#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ReportSimBandArgs {
    pub band_id: u8,
    pub station_id: u8,
    pub state: u8,
    pub neigh: u8,
    pub sos: bool,
    pub fall: bool,
    pub press: bool,
}

impl From<ReportSimBandArgs> for super::Reducer {
    fn from(args: ReportSimBandArgs) -> Self {
        Self::ReportSimBand {
            band_id: args.band_id,
            station_id: args.station_id,
            state: args.state,
            neigh: args.neigh,
            sos: args.sos,
            fall: args.fall,
            press: args.press,
        }
    }
}

impl __sdk::InModule for ReportSimBandArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait report_sim_band {
    fn report_sim_band(
        &self,
        band_id: u8,
        station_id: u8,
        state: u8,
        neigh: u8,
        sos: bool,
        fall: bool,
        press: bool,
    ) -> __sdk::Result<()> {
        self.report_sim_band_then(
            band_id,
            station_id,
            state,
            neigh,
            sos,
            fall,
            press,
            |_, _| {},
        )
    }

    fn report_sim_band_then(
        &self,
        band_id: u8,
        station_id: u8,
        state: u8,
        neigh: u8,
        sos: bool,
        fall: bool,
        press: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl report_sim_band for super::RemoteReducers {
    fn report_sim_band_then(
        &self,
        band_id: u8,
        station_id: u8,
        state: u8,
        neigh: u8,
        sos: bool,
        fall: bool,
        press: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            ReportSimBandArgs {
                band_id,
                station_id,
                state,
                neigh,
                sos,
                fall,
                press,
            },
            callback,
        )
    }
}
