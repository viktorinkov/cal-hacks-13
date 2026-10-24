#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SendCommandArgs {
    pub target: u8,
    pub name: String,
    pub arg: u8,
    pub arg_2: u8,
}

impl From<SendCommandArgs> for super::Reducer {
    fn from(args: SendCommandArgs) -> Self {
        Self::SendCommand {
            target: args.target,
            name: args.name,
            arg: args.arg,
            arg_2: args.arg_2,
        }
    }
}

impl __sdk::InModule for SendCommandArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait send_command {
    fn send_command(&self, target: u8, name: String, arg: u8, arg_2: u8) -> __sdk::Result<()> {
        self.send_command_then(target, name, arg, arg_2, |_, _| {})
    }

    fn send_command_then(
        &self,
        target: u8,
        name: String,
        arg: u8,
        arg_2: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl send_command for super::RemoteReducers {
    fn send_command_then(
        &self,
        target: u8,
        name: String,
        arg: u8,
        arg_2: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SendCommandArgs {
                target,
                name,
                arg,
                arg_2,
            },
            callback,
        )
    }
}
