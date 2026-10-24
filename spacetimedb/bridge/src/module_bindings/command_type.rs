#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct Command {
    pub id: u64,
    pub pending: bool,
    pub target: u8,
    pub name: String,
    pub arg: u8,
    pub arg_2: u8,
    pub requested_by: __sdk::Identity,
    pub created: __sdk::Timestamp,
    pub sent_at: Option<__sdk::Timestamp>,
    pub error: Option<String>,
}

impl __sdk::InModule for Command {
    type Module = super::RemoteModule;
}

pub struct CommandCols {
    pub id: __sdk::__query_builder::Col<Command, u64>,
    pub pending: __sdk::__query_builder::Col<Command, bool>,
    pub target: __sdk::__query_builder::Col<Command, u8>,
    pub name: __sdk::__query_builder::Col<Command, String>,
    pub arg: __sdk::__query_builder::Col<Command, u8>,
    pub arg_2: __sdk::__query_builder::Col<Command, u8>,
    pub requested_by: __sdk::__query_builder::Col<Command, __sdk::Identity>,
    pub created: __sdk::__query_builder::Col<Command, __sdk::Timestamp>,
    pub sent_at: __sdk::__query_builder::Col<Command, Option<__sdk::Timestamp>>,
    pub error: __sdk::__query_builder::Col<Command, Option<String>>,
}

impl __sdk::__query_builder::HasCols for Command {
    type Cols = CommandCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        CommandCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            pending: __sdk::__query_builder::Col::new(table_name, "pending"),
            target: __sdk::__query_builder::Col::new(table_name, "target"),
            name: __sdk::__query_builder::Col::new(table_name, "name"),
            arg: __sdk::__query_builder::Col::new(table_name, "arg"),
            arg_2: __sdk::__query_builder::Col::new(table_name, "arg_2"),
            requested_by: __sdk::__query_builder::Col::new(table_name, "requested_by"),
            created: __sdk::__query_builder::Col::new(table_name, "created"),
            sent_at: __sdk::__query_builder::Col::new(table_name, "sent_at"),
            error: __sdk::__query_builder::Col::new(table_name, "error"),
        }
    }
}

pub struct CommandIxCols {
    pub id: __sdk::__query_builder::IxCol<Command, u64>,
    pub pending: __sdk::__query_builder::IxCol<Command, bool>,
}

impl __sdk::__query_builder::HasIxCols for Command {
    type IxCols = CommandIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        CommandIxCols {
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
            pending: __sdk::__query_builder::IxCol::new(table_name, "pending"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for Command {}
