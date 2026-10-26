#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct EvidenceFact {
    pub id: u64,
    pub claim_id: u64,
    pub pack_version: u32,
    pub seq: u32,
    pub source: String,
    pub key: String,
    pub value: String,
    pub observed_at: __sdk::Timestamp,
    pub read_at: __sdk::Timestamp,
    pub reader: String,
    pub reference: String,
}

impl __sdk::InModule for EvidenceFact {
    type Module = super::RemoteModule;
}

pub struct EvidenceFactCols {
    pub id: __sdk::__query_builder::Col<EvidenceFact, u64>,
    pub claim_id: __sdk::__query_builder::Col<EvidenceFact, u64>,
    pub pack_version: __sdk::__query_builder::Col<EvidenceFact, u32>,
    pub seq: __sdk::__query_builder::Col<EvidenceFact, u32>,
    pub source: __sdk::__query_builder::Col<EvidenceFact, String>,
    pub key: __sdk::__query_builder::Col<EvidenceFact, String>,
    pub value: __sdk::__query_builder::Col<EvidenceFact, String>,
    pub observed_at: __sdk::__query_builder::Col<EvidenceFact, __sdk::Timestamp>,
    pub read_at: __sdk::__query_builder::Col<EvidenceFact, __sdk::Timestamp>,
    pub reader: __sdk::__query_builder::Col<EvidenceFact, String>,
    pub reference: __sdk::__query_builder::Col<EvidenceFact, String>,
}

impl __sdk::__query_builder::HasCols for EvidenceFact {
    type Cols = EvidenceFactCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        EvidenceFactCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            claim_id: __sdk::__query_builder::Col::new(table_name, "claim_id"),
            pack_version: __sdk::__query_builder::Col::new(table_name, "pack_version"),
            seq: __sdk::__query_builder::Col::new(table_name, "seq"),
            source: __sdk::__query_builder::Col::new(table_name, "source"),
            key: __sdk::__query_builder::Col::new(table_name, "key"),
            value: __sdk::__query_builder::Col::new(table_name, "value"),
            observed_at: __sdk::__query_builder::Col::new(table_name, "observed_at"),
            read_at: __sdk::__query_builder::Col::new(table_name, "read_at"),
            reader: __sdk::__query_builder::Col::new(table_name, "reader"),
            reference: __sdk::__query_builder::Col::new(table_name, "reference"),
        }
    }
}

pub struct EvidenceFactIxCols {
    pub claim_id: __sdk::__query_builder::IxCol<EvidenceFact, u64>,
    pub id: __sdk::__query_builder::IxCol<EvidenceFact, u64>,
}

impl __sdk::__query_builder::HasIxCols for EvidenceFact {
    type IxCols = EvidenceFactIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        EvidenceFactIxCols {
            claim_id: __sdk::__query_builder::IxCol::new(table_name, "claim_id"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for EvidenceFact {}
