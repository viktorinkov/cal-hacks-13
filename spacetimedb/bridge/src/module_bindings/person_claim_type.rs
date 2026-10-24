#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct PersonClaim {
    pub attendee: __sdk::Identity,
    pub person_id: u64,
    pub claimed_at: __sdk::Timestamp,
}

impl __sdk::InModule for PersonClaim {
    type Module = super::RemoteModule;
}

pub struct PersonClaimCols {
    pub attendee: __sdk::__query_builder::Col<PersonClaim, __sdk::Identity>,
    pub person_id: __sdk::__query_builder::Col<PersonClaim, u64>,
    pub claimed_at: __sdk::__query_builder::Col<PersonClaim, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for PersonClaim {
    type Cols = PersonClaimCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        PersonClaimCols {
            attendee: __sdk::__query_builder::Col::new(table_name, "attendee"),
            person_id: __sdk::__query_builder::Col::new(table_name, "person_id"),
            claimed_at: __sdk::__query_builder::Col::new(table_name, "claimed_at"),
        }
    }
}

pub struct PersonClaimIxCols {
    pub attendee: __sdk::__query_builder::IxCol<PersonClaim, __sdk::Identity>,
    pub person_id: __sdk::__query_builder::IxCol<PersonClaim, u64>,
}

impl __sdk::__query_builder::HasIxCols for PersonClaim {
    type IxCols = PersonClaimIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        PersonClaimIxCols {
            attendee: __sdk::__query_builder::IxCol::new(table_name, "attendee"),
            person_id: __sdk::__query_builder::IxCol::new(table_name, "person_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for PersonClaim {}
