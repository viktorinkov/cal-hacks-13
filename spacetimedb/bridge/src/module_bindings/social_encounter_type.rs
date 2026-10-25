#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct SocialEncounter {
    pub id: u64,
    pub band_pair: u16,
    pub attendee_a: __sdk::Identity,
    pub attendee_b: __sdk::Identity,
    pub zone_id: u64,
    pub baseline_seconds: u32,
    pub seconds_together: u32,
    pub started_at: __sdk::Timestamp,
    pub last_seen_at: __sdk::Timestamp,
    pub met: bool,
    pub updated_at: __sdk::Timestamp,
}

impl __sdk::InModule for SocialEncounter {
    type Module = super::RemoteModule;
}

pub struct SocialEncounterCols {
    pub id: __sdk::__query_builder::Col<SocialEncounter, u64>,
    pub band_pair: __sdk::__query_builder::Col<SocialEncounter, u16>,
    pub attendee_a: __sdk::__query_builder::Col<SocialEncounter, __sdk::Identity>,
    pub attendee_b: __sdk::__query_builder::Col<SocialEncounter, __sdk::Identity>,
    pub zone_id: __sdk::__query_builder::Col<SocialEncounter, u64>,
    pub baseline_seconds: __sdk::__query_builder::Col<SocialEncounter, u32>,
    pub seconds_together: __sdk::__query_builder::Col<SocialEncounter, u32>,
    pub started_at: __sdk::__query_builder::Col<SocialEncounter, __sdk::Timestamp>,
    pub last_seen_at: __sdk::__query_builder::Col<SocialEncounter, __sdk::Timestamp>,
    pub met: __sdk::__query_builder::Col<SocialEncounter, bool>,
    pub updated_at: __sdk::__query_builder::Col<SocialEncounter, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for SocialEncounter {
    type Cols = SocialEncounterCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        SocialEncounterCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            band_pair: __sdk::__query_builder::Col::new(table_name, "band_pair"),
            attendee_a: __sdk::__query_builder::Col::new(table_name, "attendee_a"),
            attendee_b: __sdk::__query_builder::Col::new(table_name, "attendee_b"),
            zone_id: __sdk::__query_builder::Col::new(table_name, "zone_id"),
            baseline_seconds: __sdk::__query_builder::Col::new(table_name, "baseline_seconds"),
            seconds_together: __sdk::__query_builder::Col::new(table_name, "seconds_together"),
            started_at: __sdk::__query_builder::Col::new(table_name, "started_at"),
            last_seen_at: __sdk::__query_builder::Col::new(table_name, "last_seen_at"),
            met: __sdk::__query_builder::Col::new(table_name, "met"),
            updated_at: __sdk::__query_builder::Col::new(table_name, "updated_at"),
        }
    }
}

pub struct SocialEncounterIxCols {
    pub attendee_a: __sdk::__query_builder::IxCol<SocialEncounter, __sdk::Identity>,
    pub attendee_b: __sdk::__query_builder::IxCol<SocialEncounter, __sdk::Identity>,
    pub band_pair: __sdk::__query_builder::IxCol<SocialEncounter, u16>,
    pub id: __sdk::__query_builder::IxCol<SocialEncounter, u64>,
}

impl __sdk::__query_builder::HasIxCols for SocialEncounter {
    type IxCols = SocialEncounterIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        SocialEncounterIxCols {
            attendee_a: __sdk::__query_builder::IxCol::new(table_name, "attendee_a"),
            attendee_b: __sdk::__query_builder::IxCol::new(table_name, "attendee_b"),
            band_pair: __sdk::__query_builder::IxCol::new(table_name, "band_pair"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for SocialEncounter {}
