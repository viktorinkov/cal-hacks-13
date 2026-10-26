#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RespondPhotoTagArgs {
    pub tag_id: u64,
    pub confirm: bool,
}

impl From<RespondPhotoTagArgs> for super::Reducer {
    fn from(args: RespondPhotoTagArgs) -> Self {
        Self::RespondPhotoTag {
            tag_id: args.tag_id,
            confirm: args.confirm,
        }
    }
}

impl __sdk::InModule for RespondPhotoTagArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait respond_photo_tag {
    fn respond_photo_tag(&self, tag_id: u64, confirm: bool) -> __sdk::Result<()> {
        self.respond_photo_tag_then(tag_id, confirm, |_, _| {})
    }

    fn respond_photo_tag_then(
        &self,
        tag_id: u64,
        confirm: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl respond_photo_tag for super::RemoteReducers {
    fn respond_photo_tag_then(
        &self,
        tag_id: u64,
        confirm: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(RespondPhotoTagArgs { tag_id, confirm }, callback)
    }
}
