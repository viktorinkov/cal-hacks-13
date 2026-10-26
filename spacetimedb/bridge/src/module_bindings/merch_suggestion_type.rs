#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MerchSuggestion {
    pub rank: u32,
    pub template_id: u64,
    pub title: String,
    pub kind: String,
    pub price_cents: u64,
    pub image_url: String,
    pub width: u32,
    pub height: u32,
    pub photo_x: u32,
    pub photo_y: u32,
    pub photo_w: u32,
    pub photo_h: u32,
    pub photo_id: u64,
    pub photo_url: String,
    pub minutes: f32,
}

impl __sdk::InModule for MerchSuggestion {
    type Module = super::RemoteModule;
}

pub struct MerchSuggestionCols {
    pub rank: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub template_id: __sdk::__query_builder::Col<MerchSuggestion, u64>,
    pub title: __sdk::__query_builder::Col<MerchSuggestion, String>,
    pub kind: __sdk::__query_builder::Col<MerchSuggestion, String>,
    pub price_cents: __sdk::__query_builder::Col<MerchSuggestion, u64>,
    pub image_url: __sdk::__query_builder::Col<MerchSuggestion, String>,
    pub width: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub height: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub photo_x: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub photo_y: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub photo_w: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub photo_h: __sdk::__query_builder::Col<MerchSuggestion, u32>,
    pub photo_id: __sdk::__query_builder::Col<MerchSuggestion, u64>,
    pub photo_url: __sdk::__query_builder::Col<MerchSuggestion, String>,
    pub minutes: __sdk::__query_builder::Col<MerchSuggestion, f32>,
}

impl __sdk::__query_builder::HasCols for MerchSuggestion {
    type Cols = MerchSuggestionCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        MerchSuggestionCols {
            rank: __sdk::__query_builder::Col::new(table_name, "rank"),
            template_id: __sdk::__query_builder::Col::new(table_name, "template_id"),
            title: __sdk::__query_builder::Col::new(table_name, "title"),
            kind: __sdk::__query_builder::Col::new(table_name, "kind"),
            price_cents: __sdk::__query_builder::Col::new(table_name, "price_cents"),
            image_url: __sdk::__query_builder::Col::new(table_name, "image_url"),
            width: __sdk::__query_builder::Col::new(table_name, "width"),
            height: __sdk::__query_builder::Col::new(table_name, "height"),
            photo_x: __sdk::__query_builder::Col::new(table_name, "photo_x"),
            photo_y: __sdk::__query_builder::Col::new(table_name, "photo_y"),
            photo_w: __sdk::__query_builder::Col::new(table_name, "photo_w"),
            photo_h: __sdk::__query_builder::Col::new(table_name, "photo_h"),
            photo_id: __sdk::__query_builder::Col::new(table_name, "photo_id"),
            photo_url: __sdk::__query_builder::Col::new(table_name, "photo_url"),
            minutes: __sdk::__query_builder::Col::new(table_name, "minutes"),
        }
    }
}
