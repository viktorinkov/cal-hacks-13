#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ResolveIncidentArgs {
    pub incident_id: u64,
    pub resolution: String,
}

impl From<ResolveIncidentArgs> for super::Reducer {
    fn from(args: ResolveIncidentArgs) -> Self {
        Self::ResolveIncident {
            incident_id: args.incident_id,
            resolution: args.resolution,
        }
    }
}

impl __sdk::InModule for ResolveIncidentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait resolve_incident {
    fn resolve_incident(&self, incident_id: u64, resolution: String) -> __sdk::Result<()> {
        self.resolve_incident_then(incident_id, resolution, |_, _| {})
    }

    fn resolve_incident_then(
        &self,
        incident_id: u64,
        resolution: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl resolve_incident for super::RemoteReducers {
    fn resolve_incident_then(
        &self,
        incident_id: u64,
        resolution: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            ResolveIncidentArgs {
                incident_id,
                resolution,
            },
            callback,
        )
    }
}
