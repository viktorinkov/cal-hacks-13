#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Owner {
    pub identity: __sdk::Identity,
}

impl __sdk::InModule for Owner {
    type Module = super::RemoteModule;
}

pub struct OwnerCols {
    pub identity: __sdk::__query_builder::Col<Owner, __sdk::Identity>,
}

impl __sdk::__query_builder::HasCols for Owner {
    type Cols = OwnerCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        OwnerCols {
            identity: __sdk::__query_builder::Col::new(table_name, "identity"),
        }
    }
}

pub struct OwnerIxCols {
    pub identity: __sdk::__query_builder::IxCol<Owner, __sdk::Identity>,
}

impl __sdk::__query_builder::HasIxCols for Owner {
    type IxCols = OwnerIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        OwnerIxCols {
            identity: __sdk::__query_builder::IxCol::new(table_name, "identity"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Owner {}
