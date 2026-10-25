//! Job payloads the SpacetimeDB module enqueues and `bandit-workers` reads.
//! Each payload is self-contained, so a worker never needs to read claim tables.

use crate::coverage::Amounts;
use crate::fee_schedule::LineDecision;
use crate::letters::LetterData;
use crate::{Cents, Check, Fact};
use serde::{Deserialize, Serialize};

/// Claude reads the medical record PDF into a structured record.
pub const KIND_RECORD_EXTRACT: &str = "claim_record_extract";
/// Elastic validates the evidence document and finds similar past claims.
pub const KIND_VERIFY: &str = "claim_verify";
/// The claims agent reviews the whole pack and gives its verdict.
pub const KIND_REVIEW: &str = "claim_review";
/// Claude drafts the first notice of loss, the approver summary and the claimant letter.
pub const KIND_DRAFT: &str = "claim_draft";
/// Claude drafts a recovery letter, worded as a question, for a property claim.
pub const KIND_RECOVERY: &str = "recovery_letter";
/// Deposits an injury claim's payout into the claimant's Nessie account.
pub const KIND_PAYOUT: &str = "claim_payout";
/// The hospital sends its report for an injury claim, written for the case the module drew.
pub const KIND_CLINIC: &str = "clinic_report";
/// The attendee pays a charge from their wallet: a Nessie purchase at the venue.
pub const KIND_CHARGE_PAYMENT: &str = "charge_payment";

pub const INSURANCE_KINDS: &[&str] =
    &[KIND_RECORD_EXTRACT, KIND_VERIFY, KIND_REVIEW, KIND_DRAFT, KIND_RECOVERY, KIND_PAYOUT, KIND_CLINIC, KIND_CHARGE_PAYMENT];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecordExtractPayload {
    pub claim_id: u64,
    pub record_id: u64,
    /// SHA-256 of the PDF in the blob store.
    pub file_hash: String,
    pub page_count: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VerifyPayload {
    pub claim_id: u64,
    pub pack_version: u32,
    pub venue_name: String,
    pub incident_kind: String,
    pub cover_kind: String,
    pub zone_id: u64,
    pub zone_name: String,
    pub incident_at_micros: i64,
    /// Local `HH:MM` of the incident.
    pub local_time: String,
    pub corroboration: String,
    /// Light-circle witnesses in the incident zone.
    pub witness_count: u32,
    /// Minutes from incident open to the first staff note.
    pub minutes_to_first_note: Option<i64>,
    /// `(code, description)` per diagnosis.
    pub diagnoses: Vec<(String, String)>,
    pub service_codes: Vec<String>,
    pub record_hash: String,
    pub billed_cents: Cents,
    pub covered_cents: Cents,
    pub payout_cents: Cents,
    /// For property claims: what the staff note says was damaged.
    pub property_description: String,
    /// The loss staff logged: the repair cost or the item's value, for every kind but an injury.
    #[serde(default)]
    pub cost_cents: Cents,
    /// True when staff named the attendee who broke or took it.
    #[serde(default)]
    pub responsible_named: bool,
    /// The attendee's own policy document (`attendee_policy.document_hash`), empty when none is on file.
    #[serde(default)]
    pub attendee_policy_hash: String,
    /// SHA-256 of the confirmed venue policy PDF whose clauses are indexed; empty for the seeded policy.
    #[serde(default)]
    pub venue_policy_hash: String,
}

/// A policy clause the Evidence Engine found for a claim, as the module stored it (`claim_clause`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ClauseRef {
    pub clause_id: String,
    /// `venue` or `attendee`.
    pub policy: String,
    pub section: String,
    pub page: u32,
    pub text: String,
    pub score: f32,
}

/// The charge staff proposed on the claim's incident, for Claude's recommendation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChargeBrief {
    pub charge_id: u64,
    pub band_id: u32,
    pub attendee_name: String,
    /// What code would charge: the claim's whole loss.
    pub amount_cents: Cents,
    pub named_by_role: String,
    pub note: String,
    /// Code's checks of the named band: in the zone, at the spot, the cameras.
    pub checks: Vec<Check>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewPayload {
    pub claim_id: u64,
    pub pack_version: u32,
    pub pack_hash: String,
    pub incident_kind: String,
    pub cover_kind: String,
    pub zone_name: String,
    /// Local `YYYY-MM-DD HH:MM:SS`.
    pub incident_time: String,
    pub claimant_name: String,
    pub corroboration: String,
    pub facts: Vec<Fact>,
    /// Code and Elastic checks of this pack version.
    pub checks: Vec<Check>,
    pub amounts: Amounts,
    pub lines: Vec<LineDecision>,
    /// The record's history of present illness and reason for visit, as extracted.
    pub record_history: String,
    pub record_reason: String,
    /// The policy clauses the Evidence Engine found for this pack version, closest first.
    #[serde(default)]
    pub clauses: Vec<ClauseRef>,
    /// What the cover pays for and what it excludes, in a few lines.
    pub policy_summary: String,
    /// What the attendee wrote when they filed the claim, in their own words.
    #[serde(default)]
    pub claimant_statement: String,
    /// The charge staff proposed on this incident, when they named someone.
    #[serde(default)]
    pub charge: Option<ChargeBrief>,
    /// The attendee's own policy document, empty when none is on file: Claude's policy search covers it too.
    #[serde(default)]
    pub attendee_policy_hash: String,
    /// SHA-256 of the confirmed venue policy PDF whose clauses are indexed; empty for the seeded policy.
    #[serde(default)]
    pub venue_policy_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DraftPayload {
    pub claim_id: u64,
    pub pack_version: u32,
    /// `auto_settled` or `approved`; also written to the Elastic copy.
    pub outcome: String,
    pub letter: LetterData,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoveryPayload {
    pub claim_id: u64,
    pub letter: LetterData,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PayoutPayload {
    pub claim_id: u64,
    /// The claimant's SpacetimeDB identity, hex.
    pub claimant: String,
    pub claimant_name: String,
    /// The claimant's Nessie customer and account from an earlier payout; empty the first time.
    pub customer_id: String,
    pub account_id: String,
    pub payout_cents: Cents,
    pub memo: String,
}

/// Input of `charge_payment`: the attendee pays a charge from their wallet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChargePaymentPayload {
    pub charge_id: u64,
    /// The paying attendee's SpacetimeDB identity, hex.
    pub payer: String,
    pub payer_name: String,
    /// The attendee's Nessie customer and account; empty when they have no wallet yet.
    pub customer_id: String,
    pub account_id: String,
    pub amount_cents: Cents,
    /// The merchant the purchase is made at: the venue.
    pub merchant_name: String,
    pub memo: String,
}

/// Input of `clinic_report`: everything the hospital's report is written from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClinicPayload {
    pub claim_id: u64,
    pub report_id: u64,
    /// `clinic::Scenario::as_str`, drawn by the module.
    pub scenario: String,
    /// `YYYY-MM-DD`, set by the module for the scenario.
    pub visit_date: String,
    /// The incident's local `YYYY-MM-DD` and `HH:MM`.
    pub incident_date: String,
    pub incident_time: String,
    pub incident_kind: String,
    pub venue_name: String,
    pub zone_name: String,
    pub claimant_name: String,
    /// The attendee's own words from filing the claim.
    pub statement: String,
    /// The staff notes on the incident, oldest first.
    pub medic_notes: Vec<String>,
}
