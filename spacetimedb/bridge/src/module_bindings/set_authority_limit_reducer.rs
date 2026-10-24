#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetAuthorityLimitArgs {
    pub role: String,
    pub rank: u8,
    pub ceiling_cents: Option<u64>,
    pub assignee: Option<__sdk::Identity>,
    pub assignee_name: String,
}

impl From<SetAuthorityLimitArgs> for super::Reducer {
    fn from(args: SetAuthorityLimitArgs) -> Self {
        Self::SetAuthorityLimit {
            role: args.role,
            rank: args.rank,
            ceiling_cents: args.ceiling_cents,
            assignee: args.assignee,
            assignee_name: args.assignee_name,
        }
    }
}

impl __sdk::InModule for SetAuthorityLimitArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_authority_limit {
    fn set_authority_limit(
        &self,
        role: String,
        rank: u8,
        ceiling_cents: Option<u64>,
        assignee: Option<__sdk::Identity>,
        assignee_name: String,
    ) -> __sdk::Result<()> {
        self.set_authority_limit_then(
            role,
            rank,
            ceiling_cents,
            assignee,
            assignee_name,
            |_, _| {},
        )
    }

    fn set_authority_limit_then(
        &self,
        role: String,
        rank: u8,
        ceiling_cents: Option<u64>,
        assignee: Option<__sdk::Identity>,
        assignee_name: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_authority_limit for super::RemoteReducers {
    fn set_authority_limit_then(
        &self,
        role: String,
        rank: u8,
        ceiling_cents: Option<u64>,
        assignee: Option<__sdk::Identity>,
        assignee_name: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SetAuthorityLimitArgs {
                role,
                rank,
                ceiling_cents,
                assignee,
                assignee_name,
            },
            callback,
        )
    }
}
