#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::event_bundle_type::EventBundle;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct ImportEventArgs {
    pub bundle: EventBundle,
}

impl From<ImportEventArgs> for super::Reducer {
    fn from(args: ImportEventArgs) -> Self {
        Self::ImportEvent {
            bundle: args.bundle,
        }
    }
}

impl __sdk::InModule for ImportEventArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait import_event {
    fn import_event(&self, bundle: EventBundle) -> __sdk::Result<()> {
        self.import_event_then(bundle, |_, _| {})
    }

    fn import_event_then(
        &self,
        bundle: EventBundle,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl import_event for super::RemoteReducers {
    fn import_event_then(
        &self,
        bundle: EventBundle,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(ImportEventArgs { bundle }, callback)
    }
}
