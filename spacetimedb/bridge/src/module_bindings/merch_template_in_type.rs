#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MerchTemplateIn {
    pub name: String,
    pub title: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub photo_x: u32,
    pub photo_y: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    pub sponsors: Vec<String>,
}

impl __sdk::InModule for MerchTemplateIn {
    type Module = super::RemoteModule;
}
