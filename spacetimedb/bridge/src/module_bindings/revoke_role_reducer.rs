#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RevokeRoleArgs {
    pub identity: __sdk::Identity,
    pub role: String,
}

impl From<RevokeRoleArgs> for super::Reducer {
    fn from(args: RevokeRoleArgs) -> Self {
        Self::RevokeRole {
            identity: args.identity,
            role: args.role,
        }
    }
}

impl __sdk::InModule for RevokeRoleArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait revoke_role {
    fn revoke_role(&self, identity: __sdk::Identity, role: String) -> __sdk::Result<()> {
        self.revoke_role_then(identity, role, |_, _| {})
    }

    fn revoke_role_then(
        &self,
        identity: __sdk::Identity,
        role: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl revoke_role for super::RemoteReducers {
    fn revoke_role_then(
        &self,
        identity: __sdk::Identity,
        role: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(RevokeRoleArgs { identity, role }, callback)
    }
}
