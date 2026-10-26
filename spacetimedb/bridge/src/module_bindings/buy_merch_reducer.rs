#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct BuyMerchArgs {
    pub template_id: u64,
    pub photo_id: u64,
    pub size: String,
}

impl From<BuyMerchArgs> for super::Reducer {
    fn from(args: BuyMerchArgs) -> Self {
        Self::BuyMerch {
            template_id: args.template_id,
            photo_id: args.photo_id,
            size: args.size,
        }
    }
}

impl __sdk::InModule for BuyMerchArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait buy_merch {
    fn buy_merch(&self, template_id: u64, photo_id: u64, size: String) -> __sdk::Result<()> {
        self.buy_merch_then(template_id, photo_id, size, |_, _| {})
    }

    fn buy_merch_then(
        &self,
        template_id: u64,
        photo_id: u64,
        size: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl buy_merch for super::RemoteReducers {
    fn buy_merch_then(
        &self,
        template_id: u64,
        photo_id: u64,
        size: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            BuyMerchArgs {
                template_id,
                photo_id,
                size,
            },
            callback,
        )
    }
}
