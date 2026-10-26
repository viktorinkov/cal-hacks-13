#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::section_count_type::SectionCount;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ImportRun {
    pub id: u64,
    pub run_id: String,
    pub venue_id: u64,
    pub organizer: String,
    pub bundle_hash: String,
    pub imported_by: __sdk::Identity,
    pub imported_at: __sdk::Timestamp,
    pub counts: Vec<SectionCount>,
}

impl __sdk::InModule for ImportRun {
    type Module = super::RemoteModule;
}

pub struct ImportRunCols {
    pub id: __sdk::__query_builder::Col<ImportRun, u64>,
    pub run_id: __sdk::__query_builder::Col<ImportRun, String>,
    pub venue_id: __sdk::__query_builder::Col<ImportRun, u64>,
    pub organizer: __sdk::__query_builder::Col<ImportRun, String>,
    pub bundle_hash: __sdk::__query_builder::Col<ImportRun, String>,
    pub imported_by: __sdk::__query_builder::Col<ImportRun, __sdk::Identity>,
    pub imported_at: __sdk::__query_builder::Col<ImportRun, __sdk::Timestamp>,
    pub counts: __sdk::__query_builder::Col<ImportRun, Vec<SectionCount>>,
}

impl __sdk::__query_builder::HasCols for ImportRun {
    type Cols = ImportRunCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        ImportRunCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            run_id: __sdk::__query_builder::Col::new(table_name, "run_id"),
            venue_id: __sdk::__query_builder::Col::new(table_name, "venue_id"),
            organizer: __sdk::__query_builder::Col::new(table_name, "organizer"),
            bundle_hash: __sdk::__query_builder::Col::new(table_name, "bundle_hash"),
            imported_by: __sdk::__query_builder::Col::new(table_name, "imported_by"),
            imported_at: __sdk::__query_builder::Col::new(table_name, "imported_at"),
            counts: __sdk::__query_builder::Col::new(table_name, "counts"),
        }
    }
}

pub struct ImportRunIxCols {
    pub id: __sdk::__query_builder::IxCol<ImportRun, u64>,
    pub run_id: __sdk::__query_builder::IxCol<ImportRun, String>,
}

impl __sdk::__query_builder::HasIxCols for ImportRun {
    type IxCols = ImportRunIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        ImportRunIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            run_id: __sdk::__query_builder::IxCol::new(table_name, "run_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for ImportRun {}
