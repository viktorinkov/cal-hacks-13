#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct EventLink {
    pub id: u64,
    pub kind: String,
    pub from_kind: String,
    pub from_id: u64,
    pub to_kind: String,
    pub to_id: u64,
    pub weight: f32,
}

impl __sdk::InModule for EventLink {
    type Module = super::RemoteModule;
}

pub struct EventLinkCols {
    pub id: __sdk::__query_builder::Col<EventLink, u64>,
    pub kind: __sdk::__query_builder::Col<EventLink, String>,
    pub from_kind: __sdk::__query_builder::Col<EventLink, String>,
    pub from_id: __sdk::__query_builder::Col<EventLink, u64>,
    pub to_kind: __sdk::__query_builder::Col<EventLink, String>,
    pub to_id: __sdk::__query_builder::Col<EventLink, u64>,
    pub weight: __sdk::__query_builder::Col<EventLink, f32>,
}

impl __sdk::__query_builder::HasCols for EventLink {
    type Cols = EventLinkCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        EventLinkCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            kind: __sdk::__query_builder::Col::new(table_name, "kind"),
            from_kind: __sdk::__query_builder::Col::new(table_name, "from_kind"),
            from_id: __sdk::__query_builder::Col::new(table_name, "from_id"),
            to_kind: __sdk::__query_builder::Col::new(table_name, "to_kind"),
            to_id: __sdk::__query_builder::Col::new(table_name, "to_id"),
            weight: __sdk::__query_builder::Col::new(table_name, "weight"),
        }
    }
}
