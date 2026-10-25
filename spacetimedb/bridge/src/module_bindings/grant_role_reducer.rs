#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct GrantRoleArgs {
    pub identity: __sdk::Identity,
    pub role: String,
    pub label: String,
}

impl From<GrantRoleArgs> for super::Reducer {
    fn from(args: GrantRoleArgs) -> Self {
        Self::GrantRole {
            identity: args.identity,
            role: args.role,
            label: args.label,
        }
    }
}

impl __sdk::InModule for GrantRoleArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait grant_role {
    fn grant_role(
        &self,
        identity: __sdk::Identity,
        role: String,
        label: String,
    ) -> __sdk::Result<()> {
        self.grant_role_then(identity, role, label, |_, _| {})
    }

    fn grant_role_then(
        &self,
        identity: __sdk::Identity,
        role: String,
        label: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl grant_role for super::RemoteReducers {
    fn grant_role_then(
        &self,
        identity: __sdk::Identity,
        role: String,
        label: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            GrantRoleArgs {
                identity,
                role,
                label,
            },
            callback,
        )
    }
}
