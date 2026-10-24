#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct CommandSentArgs {
    pub id: u64,
    pub error: Option<String>,
}

impl From<CommandSentArgs> for super::Reducer {
    fn from(args: CommandSentArgs) -> Self {
        Self::CommandSent {
            id: args.id,
            error: args.error,
        }
    }
}

impl __sdk::InModule for CommandSentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait command_sent {
    fn command_sent(&self, id: u64, error: Option<String>) -> __sdk::Result<()> {
        self.command_sent_then(id, error, |_, _| {})
    }

    fn command_sent_then(
        &self,
        id: u64,
        error: Option<String>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl command_sent for super::RemoteReducers {
    fn command_sent_then(
        &self,
        id: u64,
        error: Option<String>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(CommandSentArgs { id, error }, callback)
    }
}
