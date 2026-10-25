#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RegisterBlobArgs {
    pub hash: String,
    pub owner: Option<__sdk::Identity>,
    pub access: String,
    pub purpose: String,
    pub content_type: String,
    pub size_bytes: u64,
}

impl From<RegisterBlobArgs> for super::Reducer {
    fn from(args: RegisterBlobArgs) -> Self {
        Self::RegisterBlob {
            hash: args.hash,
            owner: args.owner,
            access: args.access,
            purpose: args.purpose,
            content_type: args.content_type,
            size_bytes: args.size_bytes,
        }
    }
}

impl __sdk::InModule for RegisterBlobArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait register_blob {
    fn register_blob(
        &self,
        hash: String,
        owner: Option<__sdk::Identity>,
        access: String,
        purpose: String,
        content_type: String,
        size_bytes: u64,
    ) -> __sdk::Result<()> {
        self.register_blob_then(
            hash,
            owner,
            access,
            purpose,
            content_type,
            size_bytes,
            |_, _| {},
        )
    }

    fn register_blob_then(
        &self,
        hash: String,
        owner: Option<__sdk::Identity>,
        access: String,
        purpose: String,
        content_type: String,
        size_bytes: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl register_blob for super::RemoteReducers {
    fn register_blob_then(
        &self,
        hash: String,
        owner: Option<__sdk::Identity>,
        access: String,
        purpose: String,
        content_type: String,
        size_bytes: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RegisterBlobArgs {
                hash,
                owner,
                access,
                purpose,
                content_type,
                size_bytes,
            },
            callback,
        )
    }
}
