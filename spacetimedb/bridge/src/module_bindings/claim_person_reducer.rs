#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ClaimPersonArgs {
    pub person_id: u64,
}

impl From<ClaimPersonArgs> for super::Reducer {
    fn from(args: ClaimPersonArgs) -> Self {
        Self::ClaimPerson {
            person_id: args.person_id,
        }
    }
}

impl __sdk::InModule for ClaimPersonArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait claim_person {
    fn claim_person(&self, person_id: u64) -> __sdk::Result<()> {
        self.claim_person_then(person_id, |_, _| {})
    }

    fn claim_person_then(
        &self,
        person_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl claim_person for super::RemoteReducers {
    fn claim_person_then(
        &self,
        person_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ClaimPersonArgs { person_id }, callback)
    }
}
