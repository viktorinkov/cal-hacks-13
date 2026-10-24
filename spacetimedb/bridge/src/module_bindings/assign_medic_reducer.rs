#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct AssignMedicArgs {
    pub incident_id: u64,
}

impl From<AssignMedicArgs> for super::Reducer {
    fn from(args: AssignMedicArgs) -> Self {
        Self::AssignMedic {
            incident_id: args.incident_id,
        }
    }
}

impl __sdk::InModule for AssignMedicArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait assign_medic {
    fn assign_medic(&self, incident_id: u64) -> __sdk::Result<()> {
        self.assign_medic_then(incident_id, |_, _| {})
    }

    fn assign_medic_then(
        &self,
        incident_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl assign_medic for super::RemoteReducers {
    fn assign_medic_then(
        &self,
        incident_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(AssignMedicArgs { incident_id }, callback)
    }
}
