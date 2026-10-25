use spacetimedb::{Identity, SpacetimeType, Timestamp};

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimStatus {
    /// Injury claim opened; the medical record has not been filed yet.
    AwaitingRecord,
    /// Claude is reading the medical record.
    ReadingRecord,
    /// Elastic is validating the evidence and finding similar claims.
    Verifying,
    /// The claims agent is reviewing the pack.
    Reviewing,
    /// Waiting for the named person in `routed_to_name`.
    Routed,
    /// Approved; the payout is being deposited into the claimant's Nessie account.
    Paying,
    /// Paid to the claimant; the insurer's payment is outstanding.
    Settled,
    Refused,
    /// The insurer paid; the receivable is closed.
    Reconciled,
}

/// The venue's general liability policy for the event.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = insurance_policy)]
pub struct InsurancePolicy {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub policy_number: String,
    pub insurer_name: String,
    /// Where first notices of loss go.
    pub fnol_contact: String,
    pub period_start: Timestamp,
    pub period_end: Timestamp,
    /// Paid so far under each cover, against the aggregate limits.
    pub medical_used_cents: u64,
    pub property_used_cents: u64,
    pub updated_at: Timestamp,
}

/// One cover under the policy: `medical_payments` or `property`.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = coverage_rule)]
pub struct CoverageRuleRow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub policy_id: u64,
    pub cover_kind: String,
    pub incident_kinds: Vec<String>,
    pub per_claim_limit_cents: u64,
    pub aggregate_limit_cents: u64,
    pub deductible_cents: u64,
    pub service_window_days: u32,
    pub active: bool,
    pub updated_at: Timestamp,
}

/// One rung of the former authority matrix. Nothing writes or reads it since every claim goes to the
/// organizer; it stays so the live database keeps its schema.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = authority_limit)]
pub struct AuthorityLimitRow {
    #[primary_key]
    pub role: String,
    pub rank: u8,
    /// Empty means no ceiling.
    pub ceiling_cents: Option<u64>,
    pub assignee: Option<Identity>,
    pub assignee_name: String,
    pub updated_by: Identity,
    pub updated_at: Timestamp,
}

/// Verification starting values, one row.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = insurance_settings)]
pub struct InsuranceSettings {
    #[primary_key]
    pub id: u8,
    pub venue_name: String,
    pub photo_window_secs: i64,
    pub note_window_secs: i64,
    pub min_witnesses: u32,
    pub tz_offset_minutes: i32,
    pub review_required: bool,
    pub next_journal_id: u64,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = claim)]
pub struct Claim {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub incident_id: u64,
    pub incident_kind: String,
    pub cover_kind: String,
    pub claimant: Option<Identity>,
    pub claimant_name: String,
    pub band_id: u32,
    pub zone_id: u64,
    pub zone_name: String,
    pub policy_id: u64,
    pub status: ClaimStatus,
    /// Why the claim is where it is, in one line.
    pub status_note: String,
    pub pack_version: u32,
    pub pack_hash: String,
    pub corroboration: String,
    pub cost_cents: u64,
    pub payout_cents: u64,
    pub recoverable_cents: u64,
    pub venue_cost_cents: u64,
    /// True once J1 (the reserve) is posted.
    pub reserved: bool,
    /// `consistent`, `needs_human`, `inconsistent`, `invalid` or empty.
    pub review_verdict: String,
    /// `rule`, `approver`, `code` or empty.
    pub decided_by: String,
    pub settlement_rule_id: u64,
    pub settlement_rule_version: u32,
    pub routed_to_role: String,
    /// The person the claim waits for; `Identity::ZERO` when nobody.
    #[index(btree)]
    pub routed_to: Identity,
    pub routed_to_name: String,
    pub refusal_reason: String,
    /// The Nessie deposit id, or `repair vendor` for property claims.
    pub payout_reference: String,
    pub fnol_hash: String,
    pub summary_hash: String,
    pub determination_hash: String,
    pub recovery_hash: String,
    pub opened_at: Timestamp,
    pub decided_at: Option<Timestamp>,
    pub settled_at: Option<Timestamp>,
    pub reconciled_at: Option<Timestamp>,
    pub updated_at: Timestamp,
}

/// One fact in one pack version. `seq` is the id the claims agent cites.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = evidence_fact)]
pub struct EvidenceFact {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub pack_version: u32,
    pub seq: u32,
    pub source: String,
    pub key: String,
    pub value: String,
    pub observed_at: Timestamp,
    pub read_at: Timestamp,
    /// `code`, `model` or `elastic`.
    pub reader: String,
    pub reference: String,
}

/// One hashed build of a claim's facts. Never edited; new evidence makes a new version.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = evidence_pack)]
pub struct EvidencePack {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub version: u32,
    pub fact_count: u32,
    /// SHA-256 over the version's facts (`bandit_insurance::pack`).
    pub hash: String,
    pub built_at: Timestamp,
    pub corroboration: String,
    /// Every check of the version, one per line.
    pub checks: String,
}

/// One comparison made while verifying a pack version, by code, Elastic or the model.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = claim_check)]
pub struct ClaimCheck {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub pack_version: u32,
    pub name: String,
    /// `pass`, `fail` or `info`.
    pub result: String,
    pub detail: String,
    pub reader: String,
    pub created_at: Timestamp,
}

/// The medical record filed for an injury claim: a PDF in the blob store and
/// what Claude read from it, validated by code.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = medical_record)]
pub struct MedicalRecord {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    #[index(btree)]
    pub file_hash: String,
    pub page_count: u32,
    /// `reading`, `extracted` or `failed`.
    pub status: String,
    pub job_id: u64,
    pub model_call_id: u64,
    pub document_kind: String,
    pub patient_name: String,
    pub provider_name: String,
    pub date_of_service: String,
    pub invoice_number: String,
    pub reason_for_visit: String,
    pub history: String,
    /// `code description`, one per diagnosis.
    pub diagnoses: Vec<String>,
    pub billed_cents: u64,
    pub covered_cents: u64,
    /// Items code dropped, with the reason.
    pub dropped: Vec<String>,
    /// The validated record as JSON.
    pub record_json: String,
    pub submitted_by: Identity,
    pub submitted_at: Timestamp,
    pub extracted_at: Option<Timestamp>,
}

/// One billed service and what the cover pays for it.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = claim_line)]
pub struct ClaimLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub record_id: u64,
    pub line_no: u32,
    pub code: String,
    pub description: String,
    pub service_date: String,
    pub units: u32,
    pub billed_cents: u64,
    pub allowed_cents: u64,
    pub covered_cents: u64,
    /// `covered`, `reduced` or `excluded`.
    pub outcome: String,
    pub reason: String,
    pub page: u32,
}

/// A similar past claim Elastic ranked by meaning, shown to the agent and the approver.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = claim_precedent)]
pub struct ClaimPrecedent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub pack_version: u32,
    pub reference: String,
    pub outcome: String,
    pub payout_cents: u64,
    pub narrative: String,
    pub score: f32,
}

/// The claims agent's review of one pack version.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = claim_review)]
pub struct ClaimReview {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub pack_version: u32,
    pub verdict: String,
    pub causation: String,
    pub summary: String,
    /// `kind: detail [facts]`, one per concern.
    pub concerns: Vec<String>,
    pub innocent_explanations: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub cited_fact_ids: Vec<u32>,
    /// Why code rejected the review, when it did.
    pub rejected: Vec<String>,
    pub model_call_id: u64,
    pub created_at: Timestamp,
}

/// The attendee's Nessie customer and account: their BandIt wallet, opened when they save their name, or on a first payout.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = claimant_account)]
pub struct ClaimantAccount {
    #[primary_key]
    pub identity: Identity,
    pub customer_id: String,
    pub account_id: String,
    pub created_at: Timestamp,
}

/// One version of a learned rule. Only an approval creates one.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = settlement_rule)]
pub struct SettlementRuleRow {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub incident_kind: String,
    pub cover_kind: String,
    /// 0 means any zone.
    pub zone_id: u64,
    pub requires_corroborated: bool,
    pub ceiling_cents: u64,
    pub approver: Identity,
    pub approver_name: String,
    pub approver_role: String,
    pub approval_id: u64,
    pub version: u32,
    /// `active` or `superseded`.
    pub status: String,
    pub created_at: Timestamp,
}

/// One human decision on a claim, with what the person was shown.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = approval)]
pub struct Approval {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub approver: Identity,
    pub approver_name: String,
    pub approver_role: String,
    /// `approve` or `refuse`.
    pub decision: String,
    pub amount_seen_cents: u64,
    pub pack_hash_seen: String,
    pub learn: bool,
    pub requested_ceiling_cents: Option<u64>,
    pub reason: String,
    pub decided_at: Timestamp,
}

/// One line of one double-entry journal.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = ledger_entry)]
pub struct LedgerEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub claim_id: u64,
    pub journal_id: u64,
    pub journal: String,
    pub account: String,
    pub debit_cents: u64,
    pub credit_cents: u64,
    pub memo: String,
    pub posted_at: Timestamp,
    pub posted_by: String,
}

/// A check reported by a worker (Elastic).
#[derive(SpacetimeType, Clone, Debug)]
pub struct CheckIn {
    pub name: String,
    pub result: String,
    pub detail: String,
}

/// A similar past claim reported by a worker (Elastic).
#[derive(SpacetimeType, Clone, Debug)]
pub struct PrecedentIn {
    pub reference: String,
    pub outcome: String,
    pub payout_cents: u64,
    pub narrative: String,
    pub score: f32,
}
