#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct OpenIncidentArgs {
    pub kind: String,
    pub zone_id: u64,
    pub band_id: u8,
    pub note: String,
}

impl From<OpenIncidentArgs> for super::Reducer {
    fn from(args: OpenIncidentArgs) -> Self {
        Self::OpenIncident {
            kind: args.kind,
            zone_id: args.zone_id,
            band_id: args.band_id,
            note: args.note,
        }
    }
}

impl __sdk::InModule for OpenIncidentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait open_incident {
    fn open_incident(
        &self,
        kind: String,
        zone_id: u64,
        band_id: u8,
        note: String,
    ) -> __sdk::Result<()> {
        self.open_incident_then(kind, zone_id, band_id, note, |_, _| {})
    }

    fn open_incident_then(
        &self,
        kind: String,
        zone_id: u64,
        band_id: u8,
        note: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl open_incident for super::RemoteReducers {
    fn open_incident_then(
        &self,
        kind: String,
        zone_id: u64,
        band_id: u8,
        note: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            OpenIncidentArgs {
                kind,
                zone_id,
                band_id,
                note,
            },
            callback,
        )
    }
}
