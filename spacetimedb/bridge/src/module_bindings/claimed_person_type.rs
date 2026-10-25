#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ClaimedPerson {
    pub person_id: u64,
}

impl __sdk::InModule for ClaimedPerson {
    type Module = super::RemoteModule;
}

pub struct ClaimedPersonCols {
    pub person_id: __sdk::__query_builder::Col<ClaimedPerson, u64>,
}

impl __sdk::__query_builder::HasCols for ClaimedPerson {
    type Cols = ClaimedPersonCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        ClaimedPersonCols {
            person_id: __sdk::__query_builder::Col::new(table_name, "person_id"),
        }
    }
}
