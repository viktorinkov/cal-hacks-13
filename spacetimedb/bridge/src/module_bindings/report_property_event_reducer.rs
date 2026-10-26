#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ReportPropertyEventArgs {
    pub incident_id: u64,
    pub camera_id: u64,
    pub kind: String,
    pub description: String,
    pub confidence: f32,
    pub frame_hashes: Vec<String>,
}

impl From<ReportPropertyEventArgs> for super::Reducer {
    fn from(args: ReportPropertyEventArgs) -> Self {
        Self::ReportPropertyEvent {
            incident_id: args.incident_id,
            camera_id: args.camera_id,
            kind: args.kind,
            description: args.description,
            confidence: args.confidence,
            frame_hashes: args.frame_hashes,
        }
    }
}

impl __sdk::InModule for ReportPropertyEventArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait report_property_event {
    fn report_property_event(
        &self,
        incident_id: u64,
        camera_id: u64,
        kind: String,
        description: String,
        confidence: f32,
        frame_hashes: Vec<String>,
    ) -> __sdk::Result<()> {
        self.report_property_event_then(
            incident_id,
            camera_id,
            kind,
            description,
            confidence,
            frame_hashes,
            |_, _| {},
        )
    }

    fn report_property_event_then(
        &self,
        incident_id: u64,
        camera_id: u64,
        kind: String,
        description: String,
        confidence: f32,
        frame_hashes: Vec<String>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl report_property_event for super::RemoteReducers {
    fn report_property_event_then(
        &self,
        incident_id: u64,
        camera_id: u64,
        kind: String,
        description: String,
        confidence: f32,
        frame_hashes: Vec<String>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            ReportPropertyEventArgs {
                incident_id,
                camera_id,
                kind,
                description,
                confidence,
                frame_hashes,
            },
            callback,
        )
    }
}
