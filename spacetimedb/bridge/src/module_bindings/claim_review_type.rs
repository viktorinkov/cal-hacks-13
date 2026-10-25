#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub struct ClaimReview {
    pub id: u64,
    pub claim_id: u64,
    pub pack_version: u32,
    pub verdict: String,
    pub causation: String,
    pub summary: String,
    pub concerns: Vec<String>,
    pub innocent_explanations: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub cited_fact_ids: Vec<u32>,
    pub rejected: Vec<String>,
    pub model_call_id: u64,
    pub created_at: __sdk::Timestamp,
}

impl __sdk::InModule for ClaimReview {
    type Module = super::RemoteModule;
}

pub struct ClaimReviewCols {
    pub id: __sdk::__query_builder::Col<ClaimReview, u64>,
    pub claim_id: __sdk::__query_builder::Col<ClaimReview, u64>,
    pub pack_version: __sdk::__query_builder::Col<ClaimReview, u32>,
    pub verdict: __sdk::__query_builder::Col<ClaimReview, String>,
    pub causation: __sdk::__query_builder::Col<ClaimReview, String>,
    pub summary: __sdk::__query_builder::Col<ClaimReview, String>,
    pub concerns: __sdk::__query_builder::Col<ClaimReview, Vec<String>>,
    pub innocent_explanations: __sdk::__query_builder::Col<ClaimReview, Vec<String>>,
    pub missing_evidence: __sdk::__query_builder::Col<ClaimReview, Vec<String>>,
    pub cited_fact_ids: __sdk::__query_builder::Col<ClaimReview, Vec<u32>>,
    pub rejected: __sdk::__query_builder::Col<ClaimReview, Vec<String>>,
    pub model_call_id: __sdk::__query_builder::Col<ClaimReview, u64>,
    pub created_at: __sdk::__query_builder::Col<ClaimReview, __sdk::Timestamp>,
}

impl __sdk::__query_builder::HasCols for ClaimReview {
    type Cols = ClaimReviewCols;
    fn cols(table_name: &'static str) -> Self::Cols {
        ClaimReviewCols {
            id: __sdk::__query_builder::Col::new(table_name, "id"),
            claim_id: __sdk::__query_builder::Col::new(table_name, "claim_id"),
            pack_version: __sdk::__query_builder::Col::new(table_name, "pack_version"),
            verdict: __sdk::__query_builder::Col::new(table_name, "verdict"),
            causation: __sdk::__query_builder::Col::new(table_name, "causation"),
            summary: __sdk::__query_builder::Col::new(table_name, "summary"),
            concerns: __sdk::__query_builder::Col::new(table_name, "concerns"),
            innocent_explanations: __sdk::__query_builder::Col::new(
                table_name,
                "innocent_explanations",
            ),
            missing_evidence: __sdk::__query_builder::Col::new(table_name, "missing_evidence"),
            cited_fact_ids: __sdk::__query_builder::Col::new(table_name, "cited_fact_ids"),
            rejected: __sdk::__query_builder::Col::new(table_name, "rejected"),
            model_call_id: __sdk::__query_builder::Col::new(table_name, "model_call_id"),
            created_at: __sdk::__query_builder::Col::new(table_name, "created_at"),
        }
    }
}

pub struct ClaimReviewIxCols {
    pub claim_id: __sdk::__query_builder::IxCol<ClaimReview, u64>,
    pub id: __sdk::__query_builder::IxCol<ClaimReview, u64>,
}

impl __sdk::__query_builder::HasIxCols for ClaimReview {
    type IxCols = ClaimReviewIxCols;
    fn ix_cols(table_name: &'static str) -> Self::IxCols {
        ClaimReviewIxCols {
            claim_id: __sdk::__query_builder::IxCol::new(table_name, "claim_id"),
            id: __sdk::__query_builder::IxCol::new(table_name, "id"),
        }
    }
}

impl __sdk::__query_builder::CanBeLookupTable for ClaimReview {}
