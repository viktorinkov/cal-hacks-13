#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Person {
    pub id: u64,
    pub source_key: String,
    pub venue_id: u64,
    pub display_name: String,
    pub kind: String,
    pub role: String,
    pub title: String,
    pub organization_id: u64,
    pub bio: String,
    pub headshot_url: String,
    pub links: Vec<String>,
    pub source_url: String,
    pub fetched_at: __sdk::Timestamp,
    pub updated_at: __sdk::Timestamp,
}

impl __sdk::InModule for Person {
    type Module = super::RemoteModule;
}

pub struct PersonCols {
    pub id: __sdk::__query_builder::Col<Person, u64>,
    pub source_key: __sdk::__query_builder::Col<Person, String>,
    pub venue_id: __sdk::__query_builder::Col<Person, u64>,
    pub display_name: __sdk::__query_builder::Col<Person, String>,
    pub kind: __sdk::__query_builder::Col<Person, String>,
    pub role: __sdk::__query_builder::Col<Person, String>,
    pub title: __sdk::__query_builder::Col<Person, String>,
    pub organization_id: __sdk::__query_builder::Col<Person, u64>,
    pub bio: __sdk::__query_builder::Col<Person, String>,
    pub headshot_url: __sdk::__query_builder::Col<Person, String>,
    pub links: __sdk::__query_builder::Col<Person, Vec<String>>,
    pub source_url: __sdk::__query_builder::Col<Person, String>,
    pub fetched_at: __sdk::__query_builder::Col<Person, __sdk::Timestamp>,
    pub updated_at: __sdk::__query_builder::Col<Person, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for Person {
    type Cols = PersonCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        PersonCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            source_key: __sdk::__query_builder::Col::new(table_name, "source_key"),
            venue_id: __sdk::__query_builder::Col::new(table_name, "venue_id"),
            display_name: __sdk::__query_builder::Col::new(table_name, "display_name"),
            kind: __sdk::__query_builder::Col::new(table_name, "kind"),
            role: __sdk::__query_builder::Col::new(table_name, "role"),
            title: __sdk::__query_builder::Col::new(table_name, "title"),
            organization_id: __sdk::__query_builder::Col::new(table_name, "organization_id"),
            bio: __sdk::__query_builder::Col::new(table_name, "bio"),
            headshot_url: __sdk::__query_builder::Col::new(table_name, "headshot_url"),
            links: __sdk::__query_builder::Col::new(table_name, "links"),
            source_url: __sdk::__query_builder::Col::new(table_name, "source_url"),
            fetched_at: __sdk::__query_builder::Col::new(table_name, "fetched_at"),
            updated_at: __sdk::__query_builder::Col::new(table_name, "updated_at"),
        }
    }
}

pub struct PersonIxCols {
    pub id: __sdk::__query_builder::IxCol<Person, u64>,
    pub organization_id: __sdk::__query_builder::IxCol<Person, u64>,
    pub source_key: __sdk::__query_builder::IxCol<Person, String>,
    pub venue_id: __sdk::__query_builder::IxCol<Person, u64>,
}

impl __sdk::__query_builder::HasIxCols for Person {
    type IxCols = PersonIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        PersonIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            organization_id: __sdk::__query_builder::IxCol::new(table_name, "organization_id"),
            source_key: __sdk::__query_builder::IxCol::new(table_name, "source_key"),
            venue_id: __sdk::__query_builder::IxCol::new(table_name, "venue_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Person {}
