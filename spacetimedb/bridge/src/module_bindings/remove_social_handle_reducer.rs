#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RemoveSocialHandleArgs {
    pub platform: String,
}

impl From<RemoveSocialHandleArgs> for super::Reducer {
    fn from(args: RemoveSocialHandleArgs) -> Self {
        Self::RemoveSocialHandle {
            platform: args.platform,
        }
    }
}

impl __sdk::InModule for RemoveSocialHandleArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait remove_social_handle {
    fn remove_social_handle(&self, platform: String) -> __sdk::Result<()> {
        self.remove_social_handle_then(platform, |_, _| {})
    }

    fn remove_social_handle_then(
        &self,
        platform: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl remove_social_handle for super::RemoteReducers {
    fn remove_social_handle_then(
        &self,
        platform: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(RemoveSocialHandleArgs { platform }, callback)
    }
}
