#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::band_beacon_type::BandBeacon;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct IngestBandArgs {
    pub beacon: BandBeacon,
}

impl From<IngestBandArgs> for super::Reducer {
    fn from(args: IngestBandArgs) -> Self {
        Self::IngestBand {
            beacon: args.beacon,
        }
    }
}

impl __sdk::InModule for IngestBandArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait ingest_band {
    fn ingest_band(&self, beacon: BandBeacon) -> __sdk::Result<()> {
        self.ingest_band_then(beacon, |_, _| {})
    }

    fn ingest_band_then(
        &self,
        beacon: BandBeacon,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl ingest_band for super::RemoteReducers {
    fn ingest_band_then(
        &self,
        beacon: BandBeacon,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(IngestBandArgs { beacon }, callback)
    }
}
