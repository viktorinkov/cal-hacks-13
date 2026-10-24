#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct AddIncidentNoteArgs {
    pub incident_id: u64,
    pub text: String,
    pub cost_cents: Option<u64>,
}

impl From<AddIncidentNoteArgs> for super::Reducer {
    fn from(args: AddIncidentNoteArgs) -> Self {
        Self::AddIncidentNote {
            incident_id: args.incident_id,
            text: args.text,
            cost_cents: args.cost_cents,
        }
    }
}

impl __sdk::InModule for AddIncidentNoteArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait add_incident_note {
    fn add_incident_note(
        &self,
        incident_id: u64,
        text: String,
        cost_cents: Option<u64>,
    ) -> __sdk::Result<()> {
        self.add_incident_note_then(incident_id, text, cost_cents, |_, _| {})
    }

    fn add_incident_note_then(
        &self,
        incident_id: u64,
        text: String,
        cost_cents: Option<u64>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl add_incident_note for super::RemoteReducers {
    fn add_incident_note_then(
        &self,
        incident_id: u64,
        text: String,
        cost_cents: Option<u64>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            AddIncidentNoteArgs {
                incident_id,
                text,
                cost_cents,
            },
            callback,
        )
    }
}
