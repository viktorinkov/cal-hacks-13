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

/// Claude proposes a payment rule from approved precedents of one shape, for the organizer.
pub const KIND_RULE_PROPOSAL: &str = "rule_proposal";

pub const INSURANCE_KINDS: &[&str] = &[KIND_RECORD_EXTRACT, KIND_VERIFY, KIND_REVIEW, KIND_DRAFT, KIND_RECOVERY, KIND_PAYOUT, KIND_CLINIC];

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
    /// SHA-256 of the confirmed venue policy PDF whose clauses are indexed; empty for the seeded policy.
    #[serde(default)]
    pub venue_policy_hash: String,
}

/// A similar past claim Elastic found, as the module stored it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Precedent {
    pub reference: String,
    pub outcome: String,
    pub payout_cents: Cents,
    pub narrative: String,
    pub score: f32,
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
    pub precedents: Vec<Precedent>,
    /// What the cover pays for and what it excludes, in a few lines.
    pub policy_summary: String,
    /// What the attendee wrote when they filed the claim, in their own words.
    #[serde(default)]
    pub claimant_statement: String,
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

/// One approved claim offered to Claude as a precedent for a rule.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApprovedPrecedent {
    pub claim_id: u64,
    pub claimant: String,
    pub zone: String,
    pub payout_cents: Cents,
    pub billed_cents: Cents,
    pub covered_cents: Cents,
    pub diagnoses: Vec<String>,
    pub service_codes: Vec<String>,
    pub corroboration: String,
    pub approver: String,
    /// Local `YYYY-MM-DD HH:MM`.
    pub decided_at: String,
}

/// A refused claim of the same shape, for context; a proposal never cites it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RefusedPrecedent {
    pub claim_id: u64,
    pub claimant: String,
    pub zone: String,
    pub payout_cents: Cents,
    pub reason: String,
}

/// The shape's rule in force when the proposal opened.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuleInForce {
    pub version: u32,
    pub ceiling_cents: Cents,
}

/// Input of `rule_proposal`: one shape's precedents and the policy terms a rule must stay inside.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuleProposalPayload {
    pub proposal_id: u64,
    pub venue_name: String,
    pub incident_kind: String,
    pub cover_kind: String,
    pub policy_number: String,
    /// The cover's per-claim limit: no rule pays above it.
    pub limit_cents: Cents,
    pub minimum_payout_cents: Cents,
    pub rule_in_force: Option<RuleInForce>,
    pub approved: Vec<ApprovedPrecedent>,
    pub refused: Vec<RefusedPrecedent>,
}
