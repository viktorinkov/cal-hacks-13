#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct IncidentBand {
    pub id: u64,
    pub incident_id: u64,
    pub band_id: u8,
    pub role: String,
    pub zone_id: u64,
    pub rssi: i8,
    pub first_seen_at: __sdk::Timestamp,
    pub last_seen_at: __sdk::Timestamp,
}

impl __sdk::InModule for IncidentBand {
    type Module = super::RemoteModule;
}

pub struct IncidentBandCols {
    pub id: __sdk::__query_builder::Col<IncidentBand, u64>,
    pub incident_id: __sdk::__query_builder::Col<IncidentBand, u64>,
    pub band_id: __sdk::__query_builder::Col<IncidentBand, u8>,
    pub role: __sdk::__query_builder::Col<IncidentBand, String>,
    pub zone_id: __sdk::__query_builder::Col<IncidentBand, u64>,
    pub rssi: __sdk::__query_builder::Col<IncidentBand, i8>,
    pub first_seen_at: __sdk::__query_builder::Col<IncidentBand, __sdk::Timestamp>,
    pub last_seen_at: __sdk::__query_builder::Col<IncidentBand, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for IncidentBand {
    type Cols = IncidentBandCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        IncidentBandCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            incident_id: __sdk::__query_builder::Col::new(table_name, "incident_id"),
            band_id: __sdk::__query_builder::Col::new(table_name, "band_id"),
            role: __sdk::__query_builder::Col::new(table_name, "role"),
            zone_id: __sdk::__query_builder::Col::new(table_name, "zone_id"),
            rssi: __sdk::__query_builder::Col::new(table_name, "rssi"),
            first_seen_at: __sdk::__query_builder::Col::new(table_name, "first_seen_at"),
            last_seen_at: __sdk::__query_builder::Col::new(table_name, "last_seen_at"),
        }
    }
}

pub struct IncidentBandIxCols {
    pub id: __sdk::__query_builder::IxCol<IncidentBand, u64>,
    pub incident_id: __sdk::__query_builder::IxCol<IncidentBand, u64>,
}

impl __sdk::__query_builder::HasIxCols for IncidentBand {
    type IxCols = IncidentBandIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        IncidentBandIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            incident_id: __sdk::__query_builder::IxCol::new(table_name, "incident_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for IncidentBand {}
