#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct OpenClaimArgs {
    pub incident_id: u64,
}

impl From<OpenClaimArgs> for super::Reducer {
    fn from(args: OpenClaimArgs) -> Self {
        Self::OpenClaim {
            incident_id: args.incident_id,
        }
    }
}

impl __sdk::InModule for OpenClaimArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait open_claim {
    fn open_claim(&self, incident_id: u64) -> __sdk::Result<()> {
        self.open_claim_then(incident_id, |_, _| {})
    }

    fn open_claim_then(
        &self,
        incident_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl open_claim for super::RemoteReducers {
    fn open_claim_then(
        &self,
        incident_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(OpenClaimArgs { incident_id }, callback)
    }
}
