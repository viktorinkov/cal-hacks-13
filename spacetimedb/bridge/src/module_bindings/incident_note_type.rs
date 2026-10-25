#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct IncidentNote {
    pub id: u64,
    pub incident_id: u64,
    pub author: __sdk::Identity,
    pub author_role: String,
    pub text: String,
    pub cost_cents: Option<u64>,
    pub created_at: __sdk::Timestamp,
}

impl __sdk::InModule for IncidentNote {
    type Module = super::RemoteModule;
}

pub struct IncidentNoteCols {
    pub id: __sdk::__query_builder::Col<IncidentNote, u64>,
    pub incident_id: __sdk::__query_builder::Col<IncidentNote, u64>,
    pub author: __sdk::__query_builder::Col<IncidentNote, __sdk::Identity>,
    pub author_role: __sdk::__query_builder::Col<IncidentNote, String>,
    pub text: __sdk::__query_builder::Col<IncidentNote, String>,
    pub cost_cents: __sdk::__query_builder::Col<IncidentNote, Option<u64>>,
    pub created_at: __sdk::__query_builder::Col<IncidentNote, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for IncidentNote {
    type Cols = IncidentNoteCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        IncidentNoteCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            incident_id: __sdk::__query_builder::Col::new(table_name, "incident_id"),
            author: __sdk::__query_builder::Col::new(table_name, "author"),
            author_role: __sdk::__query_builder::Col::new(table_name, "author_role"),
            text: __sdk::__query_builder::Col::new(table_name, "text"),
            cost_cents: __sdk::__query_builder::Col::new(table_name, "cost_cents"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
        }
    }
}

pub struct IncidentNoteIxCols {
    pub id: __sdk::__query_builder::IxCol<IncidentNote, u64>,
    pub incident_id: __sdk::__query_builder::IxCol<IncidentNote, u64>,
}

impl __sdk::__query_builder::HasIxCols for IncidentNote {
    type IxCols = IncidentNoteIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        IncidentNoteIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            incident_id: __sdk::__query_builder::IxCol::new(table_name, "incident_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for IncidentNote {}
