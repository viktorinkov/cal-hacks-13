#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct UpdateProfileArgs {
    pub display_name: String,
    pub findable: bool,
}

impl From<UpdateProfileArgs> for super::Reducer {
    fn from(args: UpdateProfileArgs) -> Self {
        Self::UpdateProfile {
            display_name: args.display_name,
            findable: args.findable,
        }
    }
}

impl __sdk::InModule for UpdateProfileArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait update_profile {
    fn update_profile(&self, display_name: String, findable: bool) -> __sdk::Result<()> {
        self.update_profile_then(display_name, findable, |_, _| {})
    }

    fn update_profile_then(
        &self,
        display_name: String,
        findable: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl update_profile for super::RemoteReducers {
    fn update_profile_then(
        &self,
        display_name: String,
        findable: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            UpdateProfileArgs {
                display_name,
                findable,
            },
            callback,
        )
    }
}
