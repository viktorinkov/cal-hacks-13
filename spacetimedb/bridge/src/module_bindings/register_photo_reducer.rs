#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RegisterPhotoArgs {
    pub url: String,
    pub taken_at: __sdk::Timestamp,
    pub zone_id: u64,
    pub caption: String,
}

impl From<RegisterPhotoArgs> for super::Reducer {
    fn from(args: RegisterPhotoArgs) -> Self {
        Self::RegisterPhoto {
            url: args.url,
            taken_at: args.taken_at,
            zone_id: args.zone_id,
            caption: args.caption,
        }
    }
}

impl __sdk::InModule for RegisterPhotoArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait register_photo {
    fn register_photo(
        &self,
        url: String,
        taken_at: __sdk::Timestamp,
        zone_id: u64,
        caption: String,
    ) -> __sdk::Result<()> {
        self.register_photo_then(url, taken_at, zone_id, caption, |_, _| {})
    }

    fn register_photo_then(
        &self,
        url: String,
        taken_at: __sdk::Timestamp,
        zone_id: u64,
        caption: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl register_photo for super::RemoteReducers {
    fn register_photo_then(
        &self,
        url: String,
        taken_at: __sdk::Timestamp,
        zone_id: u64,
        caption: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RegisterPhotoArgs {
                url,
                taken_at,
                zone_id,
                caption,
            },
            callback,
        )
    }
}
