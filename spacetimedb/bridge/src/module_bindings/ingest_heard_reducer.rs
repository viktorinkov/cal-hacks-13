#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::heard_entry_type::HeardEntry;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct IngestHeardArgs {
    pub id: u8,
    pub heard: Vec<HeardEntry>,
}

impl From<IngestHeardArgs> for super::Reducer {
    fn from(args: IngestHeardArgs) -> Self {
        Self::IngestHeard {
            id: args.id,
            heard: args.heard,
        }
    }
}

impl __sdk::InModule for IngestHeardArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait ingest_heard {
    fn ingest_heard(&self, id: u8, heard: Vec<HeardEntry>) -> __sdk::Result<()> {
        self.ingest_heard_then(id, heard, |_, _| {})
    }

    fn ingest_heard_then(
        &self,
        id: u8,
        heard: Vec<HeardEntry>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl ingest_heard for super::RemoteReducers {
    fn ingest_heard_then(
        &self,
        id: u8,
        heard: Vec<HeardEntry>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(IngestHeardArgs { id, heard }, callback)
    }
}
