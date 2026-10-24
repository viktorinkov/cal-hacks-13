#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct SocialTickTimer {
    pub scheduled_id: u64,
    pub scheduled_at: __sdk::ScheduleAt,
}

impl __sdk::InModule for SocialTickTimer {
    type Module = super::RemoteModule;
}

pub struct SocialTickTimerCols {
    pub scheduled_id: __sdk::__query_builder::Col<SocialTickTimer, u64>,
    pub scheduled_at: __sdk::__query_builder::Col<SocialTickTimer, __sdk::ScheduleAt>,
}

impl __sdk::__query_builder::HasCols for SocialTickTimer {
    type Cols = SocialTickTimerCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        SocialTickTimerCols {
            scheduled_id: __sdk::__query_builder::Col::new(table_name, "scheduled_id"),
            scheduled_at: __sdk::__query_builder::Col::new(table_name, "scheduled_at"),
        }
    }
}

pub struct SocialTickTimerIxCols {
    pub scheduled_id: __sdk::__query_builder::IxCol<SocialTickTimer, u64>,
}

impl __sdk::__query_builder::HasIxCols for SocialTickTimer {
    type IxCols = SocialTickTimerIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        SocialTickTimerIxCols {
            scheduled_id: __sdk::__query_builder::IxCol::new(table_name, "scheduled_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for SocialTickTimer {}
