#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetSocialHandleArgs {
    pub platform: String,
    pub handle: String,
}

impl From<SetSocialHandleArgs> for super::Reducer {
    fn from(args: SetSocialHandleArgs) -> Self {
        Self::SetSocialHandle {
            platform: args.platform,
            handle: args.handle,
        }
    }
}

impl __sdk::InModule for SetSocialHandleArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_social_handle {
    fn set_social_handle(&self, platform: String, handle: String) -> __sdk::Result<()> {
        self.set_social_handle_then(platform, handle, |_, _| {})
    }

    fn set_social_handle_then(
        &self,
        platform: String,
        handle: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_social_handle for super::RemoteReducers {
    fn set_social_handle_then(
        &self,
        platform: String,
        handle: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(SetSocialHandleArgs { platform, handle }, callback)
    }
}
