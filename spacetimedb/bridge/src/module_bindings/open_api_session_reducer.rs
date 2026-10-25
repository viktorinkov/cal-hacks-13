#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct OpenApiSessionArgs {
    pub token_hash: String,
}

impl From<OpenApiSessionArgs> for super::Reducer {
    fn from(args: OpenApiSessionArgs) -> Self {
        Self::OpenApiSession {
            token_hash: args.token_hash,
        }
    }
}

impl __sdk::InModule for OpenApiSessionArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait open_api_session {
    fn open_api_session(&self, token_hash: String) -> __sdk::Result<()> {
        self.open_api_session_then(token_hash, |_, _| {})
    }

    fn open_api_session_then(
        &self,
        token_hash: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl open_api_session for super::RemoteReducers {
    fn open_api_session_then(
        &self,
        token_hash: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(OpenApiSessionArgs { token_hash }, callback)
    }
}
