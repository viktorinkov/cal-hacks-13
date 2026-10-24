#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct UpsertCameraArgs {
    pub name: String,
    pub zone_id: u64,
    pub mount: String,
}

impl From<UpsertCameraArgs> for super::Reducer {
    fn from(args: UpsertCameraArgs) -> Self {
        Self::UpsertCamera {
            name: args.name,
            zone_id: args.zone_id,
            mount: args.mount,
        }
    }
}

impl __sdk::InModule for UpsertCameraArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait upsert_camera {
    fn upsert_camera(&self, name: String, zone_id: u64, mount: String) -> __sdk::Result<()> {
        self.upsert_camera_then(name, zone_id, mount, |_, _| {})
    }

    fn upsert_camera_then(
        &self,
        name: String,
        zone_id: u64,
        mount: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl upsert_camera for super::RemoteReducers {
    fn upsert_camera_then(
        &self,
        name: String,
        zone_id: u64,
        mount: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            UpsertCameraArgs {
                name,
                zone_id,
                mount,
            },
            callback,
        )
    }
}
