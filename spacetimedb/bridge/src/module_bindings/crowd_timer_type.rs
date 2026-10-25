#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct CrowdTimer {
    pub scheduled_id: u64,
    pub scheduled_at: __sdk::ScheduleAt,
}

impl __sdk::InModule for CrowdTimer {
    type Module = super::RemoteModule;
}

pub struct CrowdTimerCols {
    pub scheduled_id: __sdk::__query_builder::Col<CrowdTimer, u64>,
    pub scheduled_at: __sdk::__query_builder::Col<CrowdTimer, __sdk::ScheduleAt>,
}

impl __sdk::__query_builder::HasCols for CrowdTimer {
    type Cols = CrowdTimerCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        CrowdTimerCols {
            scheduled_id: __sdk::__query_builder::Col::new(table_name, "scheduled_id"),
            scheduled_at: __sdk::__query_builder::Col::new(table_name, "scheduled_at"),
        }
    }
}

pub struct CrowdTimerIxCols {
    pub scheduled_id: __sdk::__query_builder::IxCol<CrowdTimer, u64>,
}

impl __sdk::__query_builder::HasIxCols for CrowdTimer {
    type IxCols = CrowdTimerIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        CrowdTimerIxCols {
            scheduled_id: __sdk::__query_builder::IxCol::new(table_name, "scheduled_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for CrowdTimer {}
