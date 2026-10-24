#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct GraphLink {
    pub id: u64,
    pub kind: String,
    pub from_kind: String,
    pub from_id: u64,
    pub from_label: String,
    pub to_kind: String,
    pub to_id: u64,
    pub to_label: String,
    pub weight: f32,
}

impl __sdk::InModule for GraphLink {
    type Module = super::RemoteModule;
}

pub struct GraphLinkCols {
    pub id: __sdk::__query_builder::Col<GraphLink, u64>,
    pub kind: __sdk::__query_builder::Col<GraphLink, String>,
    pub from_kind: __sdk::__query_builder::Col<GraphLink, String>,
    pub from_id: __sdk::__query_builder::Col<GraphLink, u64>,
    pub from_label: __sdk::__query_builder::Col<GraphLink, String>,
    pub to_kind: __sdk::__query_builder::Col<GraphLink, String>,
    pub to_id: __sdk::__query_builder::Col<GraphLink, u64>,
    pub to_label: __sdk::__query_builder::Col<GraphLink, String>,
    pub weight: __sdk::__query_builder::Col<GraphLink, f32>,
}

impl __sdk::__query_builder::HasCols for GraphLink {
    type Cols = GraphLinkCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        GraphLinkCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            kind: __sdk::__query_builder::Col::new(table_name, "kind"),
            from_kind: __sdk::__query_builder::Col::new(table_name, "from_kind"),
            from_id: __sdk::__query_builder::Col::new(table_name, "from_id"),
            from_label: __sdk::__query_builder::Col::new(table_name, "from_label"),
            to_kind: __sdk::__query_builder::Col::new(table_name, "to_kind"),
            to_id: __sdk::__query_builder::Col::new(table_name, "to_id"),
            to_label: __sdk::__query_builder::Col::new(table_name, "to_label"),
            weight: __sdk::__query_builder::Col::new(table_name, "weight"),
        }
    }
}
