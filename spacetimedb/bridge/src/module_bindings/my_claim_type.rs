#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::claim_status_type::ClaimStatus;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct MyClaim {
    pub id: u64,
    pub incident_kind: String,
    pub zone_name: String,
    pub status: ClaimStatus,
    pub status_note: String,
    pub payout_cents: u64,
    pub payout_reference: String,
    pub opened_at: __sdk::Timestamp,
    pub settled_at: Option<__sdk::Timestamp>,
}

impl __sdk::InModule for MyClaim {
    type Module = super::RemoteModule;
}

pub struct MyClaimCols {
    pub id: __sdk::__query_builder::Col<MyClaim, u64>,
    pub incident_kind: __sdk::__query_builder::Col<MyClaim, String>,
    pub zone_name: __sdk::__query_builder::Col<MyClaim, String>,
    pub status: __sdk::__query_builder::Col<MyClaim, ClaimStatus>,
    pub status_note: __sdk::__query_builder::Col<MyClaim, String>,
    pub payout_cents: __sdk::__query_builder::Col<MyClaim, u64>,
    pub payout_reference: __sdk::__query_builder::Col<MyClaim, String>,
    pub opened_at: __sdk::__query_builder::Col<MyClaim, __sdk::Timestamp>,
    pub settled_at: __sdk::__query_builder::Col<MyClaim, Option<__sdk::Timestamp>>,
}

impl __sdk::__query_builder::HasCols for MyClaim {
    type Cols = MyClaimCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        MyClaimCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            incident_kind: __sdk::__query_builder::Col::new(table_name, "incident_kind"),
            zone_name: __sdk::__query_builder::Col::new(table_name, "zone_name"),
            status: __sdk::__query_builder::Col::new(table_name, "status"),
            status_note: __sdk::__query_builder::Col::new(table_name, "status_note"),
            payout_cents: __sdk::__query_builder::Col::new(table_name, "payout_cents"),
            payout_reference: __sdk::__query_builder::Col::new(table_name, "payout_reference"),
            opened_at: __sdk::__query_builder::Col::new(table_name, "opened_at"),
            settled_at: __sdk::__query_builder::Col::new(table_name, "settled_at"),
        }
    }
}
