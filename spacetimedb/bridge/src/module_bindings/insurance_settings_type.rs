#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct InsuranceSettings {
    pub id: u8,
    pub venue_name: String,
    pub photo_window_secs: i64,
    pub note_window_secs: i64,
    pub min_witnesses: u32,
    pub tz_offset_minutes: i32,
    pub review_required: bool,
    pub next_journal_id: u64,
}

impl __sdk::InModule for InsuranceSettings {
    type Module = super::RemoteModule;
}

pub struct InsuranceSettingsCols {
    pub id: __sdk::__query_builder::Col<InsuranceSettings, u8>,
    pub venue_name: __sdk::__query_builder::Col<InsuranceSettings, String>,
    pub photo_window_secs: __sdk::__query_builder::Col<InsuranceSettings, i64>,
    pub note_window_secs: __sdk::__query_builder::Col<InsuranceSettings, i64>,
    pub min_witnesses: __sdk::__query_builder::Col<InsuranceSettings, u32>,
    pub tz_offset_minutes: __sdk::__query_builder::Col<InsuranceSettings, i32>,
    pub review_required: __sdk::__query_builder::Col<InsuranceSettings, bool>,
    pub next_journal_id: __sdk::__query_builder::Col<InsuranceSettings, u64>,
}

impl __sdk::__query_builder::HasCols for InsuranceSettings {
    type Cols = InsuranceSettingsCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        InsuranceSettingsCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            venue_name: __sdk::__query_builder::Col::new(table_name, "venue_name"),
            photo_window_secs: __sdk::__query_builder::Col::new(table_name, "photo_window_secs"),
            note_window_secs: __sdk::__query_builder::Col::new(table_name, "note_window_secs"),
            min_witnesses: __sdk::__query_builder::Col::new(table_name, "min_witnesses"),
            tz_offset_minutes: __sdk::__query_builder::Col::new(table_name, "tz_offset_minutes"),
            review_required: __sdk::__query_builder::Col::new(table_name, "review_required"),
            next_journal_id: __sdk::__query_builder::Col::new(table_name, "next_journal_id"),
        }
    }
}

pub struct InsuranceSettingsIxCols {
    pub id: __sdk::__query_builder::IxCol<InsuranceSettings, u8>,
}

impl __sdk::__query_builder::HasIxCols for InsuranceSettings {
    type IxCols = InsuranceSettingsIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        InsuranceSettingsIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for InsuranceSettings {}
