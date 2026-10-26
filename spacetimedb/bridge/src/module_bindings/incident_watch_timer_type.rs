#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct IncidentWatchTimer {
    pub scheduled_id: u64,
    pub scheduled_at: __sdk::ScheduleAt,
}

impl __sdk::InModule for IncidentWatchTimer {
    type Module = super::RemoteModule;
}

pub struct IncidentWatchTimerCols {
    pub scheduled_id: __sdk::__query_builder::Col<IncidentWatchTimer, u64>,
    pub scheduled_at: __sdk::__query_builder::Col<IncidentWatchTimer, __sdk::ScheduleAt>,
}

impl __sdk::__query_builder::HasCols for IncidentWatchTimer {
    type Cols = IncidentWatchTimerCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        IncidentWatchTimerCols {
            scheduled_id: __sdk::__query_builder::Col::new(table_name, "scheduled_id"),
            scheduled_at: __sdk::__query_builder::Col::new(table_name, "scheduled_at"),
        }
    }
}

pub struct IncidentWatchTimerIxCols {
    pub scheduled_id: __sdk::__query_builder::IxCol<IncidentWatchTimer, u64>,
}

impl __sdk::__query_builder::HasIxCols for IncidentWatchTimer {
    type IxCols = IncidentWatchTimerIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        IncidentWatchTimerIxCols {
            scheduled_id: __sdk::__query_builder::IxCol::new(table_name, "scheduled_id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for IncidentWatchTimer {}
