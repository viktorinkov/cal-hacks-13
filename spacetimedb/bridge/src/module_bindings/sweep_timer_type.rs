#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct SweepTimer {
    pub scheduled_id: u64,
    pub scheduled_at: __sdk::ScheduleAt,
}

impl __sdk::InModule for SweepTimer {
    type Module = super::RemoteModule;
}

pub struct SweepTimerCols {
    pub scheduled_id: __sdk::__query_builder::Col<SweepTimer, u64>,
    pub scheduled_at: __sdk::__query_builder::Col<SweepTimer, __sdk::ScheduleAt>,
}

impl __sdk::__query_builder::HasCols for SweepTimer {
    type Cols = SweepTimerCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        SweepTimerCols {
            scheduled_id: __sdk::__query_builder::Col::new(table_name, "scheduled_id"),
            scheduled_at: __sdk::__query_builder::Col::new(table_name, "scheduled_at"),
        }
    }
}

pub struct SweepTimerIxCols {
    pub scheduled_id: __sdk::__query_builder::IxCol<SweepTimer, u64>,
}

impl __sdk::__query_builder::HasIxCols for SweepTimer {
    type IxCols = SweepTimerIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        SweepTimerIxCols {
            scheduled_id: __sdk::__query_builder::IxCol::new(table_name, "scheduled_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for SweepTimer {}
