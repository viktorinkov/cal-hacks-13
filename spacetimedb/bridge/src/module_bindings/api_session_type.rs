#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ApiSession {
    pub token_hash: String,
    pub identity: __sdk::Identity,
    pub created_at: __sdk::Timestamp,
    pub expires_at: __sdk::Timestamp,
}

impl __sdk::InModule for ApiSession {
    type Module = super::RemoteModule;
}

pub struct ApiSessionCols {
    pub token_hash: __sdk::__query_builder::Col<ApiSession, String>,
    pub identity: __sdk::__query_builder::Col<ApiSession, __sdk::Identity>,
    pub created_at: __sdk::__query_builder::Col<ApiSession, __sdk::Timestamp>,
    pub expires_at: __sdk::__query_builder::Col<ApiSession, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for ApiSession {
    type Cols = ApiSessionCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        ApiSessionCols {
            token_hash: __sdk::__query_builder::Col::new(table_name, "token_hash"),
            identity: __sdk::__query_builder::Col::new(table_name, "identity"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
            expires_at: __sdk::__query_builder::Col::new(table_name, "expires_at"),
        }
    }
}

pub struct ApiSessionIxCols {
    pub identity: __sdk::__query_builder::IxCol<ApiSession, __sdk::Identity>,
    pub token_hash: __sdk::__query_builder::IxCol<ApiSession, String>,
}

impl __sdk::__query_builder::HasIxCols for ApiSession {
    type IxCols = ApiSessionIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        ApiSessionIxCols {
            identity: __sdk::__query_builder::IxCol::new(table_name, "identity"),
            token_hash: __sdk::__query_builder::IxCol::new(table_name, "token_hash"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for ApiSession {}
