#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::fact_type::Fact;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Venue {
    pub id: u64,
    pub source_key: String,
    pub name: String,
    pub venue_name: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub website: String,
    pub timezone: String,
    pub starts_at: Option<__sdk::Timestamp>,
    pub ends_at: Option<__sdk::Timestamp>,
    pub description: String,
    pub facts: Vec<Fact>,
    pub source_url: String,
    pub fetched_at: __sdk::Timestamp,
    pub updated_at: __sdk::Timestamp,
}

impl __sdk::InModule for Venue {
    type Module = super::RemoteModule;
}

pub struct VenueCols {
    pub id: __sdk::__query_builder::Col<Venue, u64>,
    pub source_key: __sdk::__query_builder::Col<Venue, String>,
    pub name: __sdk::__query_builder::Col<Venue, String>,
    pub venue_name: __sdk::__query_builder::Col<Venue, String>,
    pub address: __sdk::__query_builder::Col<Venue, String>,
    pub latitude: __sdk::__query_builder::Col<Venue, f64>,
    pub longitude: __sdk::__query_builder::Col<Venue, f64>,
    pub website: __sdk::__query_builder::Col<Venue, String>,
    pub timezone: __sdk::__query_builder::Col<Venue, String>,
    pub starts_at: __sdk::__query_builder::Col<Venue, Option<__sdk::Timestamp>>,
    pub ends_at: __sdk::__query_builder::Col<Venue, Option<__sdk::Timestamp>>,
    pub description: __sdk::__query_builder::Col<Venue, String>,
    pub facts: __sdk::__query_builder::Col<Venue, Vec<Fact>>,
    pub source_url: __sdk::__query_builder::Col<Venue, String>,
    pub fetched_at: __sdk::__query_builder::Col<Venue, __sdk::Timestamp>,
    pub updated_at: __sdk::__query_builder::Col<Venue, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for Venue {
    type Cols = VenueCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        VenueCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            source_key: __sdk::__query_builder::Col::new(table_name, "source_key"),
            name: __sdk::__query_builder::Col::new(table_name, "name"),
            venue_name: __sdk::__query_builder::Col::new(table_name, "venue_name"),
            address: __sdk::__query_builder::Col::new(table_name, "address"),
            latitude: __sdk::__query_builder::Col::new(table_name, "latitude"),
            longitude: __sdk::__query_builder::Col::new(table_name, "longitude"),
            website: __sdk::__query_builder::Col::new(table_name, "website"),
            timezone: __sdk::__query_builder::Col::new(table_name, "timezone"),
            starts_at: __sdk::__query_builder::Col::new(table_name, "starts_at"),
            ends_at: __sdk::__query_builder::Col::new(table_name, "ends_at"),
            description: __sdk::__query_builder::Col::new(table_name, "description"),
            facts: __sdk::__query_builder::Col::new(table_name, "facts"),
            source_url: __sdk::__query_builder::Col::new(table_name, "source_url"),
            fetched_at: __sdk::__query_builder::Col::new(table_name, "fetched_at"),
            updated_at: __sdk::__query_builder::Col::new(table_name, "updated_at"),
        }
    }
}

pub struct VenueIxCols {
    pub id: __sdk::__query_builder::IxCol<Venue, u64>,
    pub source_key: __sdk::__query_builder::IxCol<Venue, String>,
}

impl __sdk::__query_builder::HasIxCols for Venue {
    type IxCols = VenueIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        VenueIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            source_key: __sdk::__query_builder::IxCol::new(table_name, "source_key"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Venue {}
