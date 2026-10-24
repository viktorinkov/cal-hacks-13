#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct GatewayUpArgs {
    pub mac: String,
    pub fw: String,
}

impl From<GatewayUpArgs> for super::Reducer {
    fn from(args: GatewayUpArgs) -> Self {
        Self::GatewayUp {
            mac: args.mac,
            fw: args.fw,
        }
    }
}

impl __sdk::InModule for GatewayUpArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait gateway_up {
    fn gateway_up(&self, mac: String, fw: String) -> __sdk::Result<()> {
        self.gateway_up_then(mac, fw, |_, _| {})
    }

    fn gateway_up_then(
        &self,
        mac: String,
        fw: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl gateway_up for super::RemoteReducers {
    fn gateway_up_then(
        &self,
        mac: String,
        fw: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(GatewayUpArgs { mac, fw }, callback)
    }
}
