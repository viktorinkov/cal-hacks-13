//! The decision history: one row each time someone or something decides about an incident or its claim, with
//! who decided, what and why. Bands raise incidents, the medic treats, Claude reads the clinic record, the
//! Evidence Engine checks the evidence and finds the policy clauses, Claude investigates it source by source and
//! decides, the Decision Engine holds that decision to its limits in code, and the organizer approves and
//! teaches a rule. The 3D page lists it live.

use super::{IncidentMarker, incident_marker};
use crate::insurance::{Claim, ClaimStatus, MedicalRecord, settlement_rule};
use bandit_insurance::money::format_cents;
use spacetimedb::{ReducerContext, Table, Timestamp};

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = decision, public)]
pub struct Decision {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub at: Timestamp,
    #[index(btree)]
    pub incident_id: u64,
    #[index(btree)]
    pub claim_id: u64,
    /// `band`, `camera`, `medic`, `organizer`, `Claude`, `Evidence Engine`, `Decision Engine`, `wallet` or
    /// `venue`.
    pub actor: String,
    /// Their name: a band code, "Ari Ramos", "rule v2", "Ops desk".
    pub who: String,
    pub what: String,
    pub why: String,
}

pub fn record(ctx: &ReducerContext, incident_id: u64, claim_id: u64, actor: &str, who: &str, what: String, why: String) {
    ctx.db.decision().insert(Decision { id: 0, at: ctx.timestamp, incident_id, claim_id, actor: actor.into(), who: who.into(), what, why });
}

fn update_marker(ctx: &ReducerContext, incident_id: u64, f: impl FnOnce(IncidentMarker) -> IncidentMarker) {
    if let Some(m) = ctx.db.incident_marker().incident_id().find(incident_id) {
        ctx.db.incident_marker().incident_id().update(f(m));
    }
}

/// The claim's status in the words the 3D page shows.
pub fn status_words(s: ClaimStatus) -> &'static str {
    match s {
        ClaimStatus::AwaitingRecord => "waiting for the clinic record",
        ClaimStatus::ReadingRecord => "reading the clinic record",
        ClaimStatus::Verifying => "checking the evidence",
        ClaimStatus::Reviewing => "reviewing",
        ClaimStatus::Routed => "waiting for the organizer",
        ClaimStatus::Paying => "paying",
        ClaimStatus::Settled => "paid",
        ClaimStatus::Refused => "refused",
        ClaimStatus::Reconciled => "paid by the insurer",
    }
}

fn person(c: &Claim) -> String {
    if c.claimant_name.is_empty() { "the venue".into() } else { c.claimant_name.clone() }
}

/// Called with the claim before and after every save: a status change is a decision.
pub fn on_claim_saved(ctx: &ReducerContext, before: Option<&Claim>, c: &Claim) {
    let changed = before.is_none_or(|b| b.status != c.status);
    update_marker(ctx, c.incident_id, |m| IncidentMarker { claim_id: c.id, claim_status: status_words(c.status).into(), payout_cents: c.payout_cents, ..m });
    if !changed {
        return;
    }
    let (actor, who, what, why): (&str, String, String, String) = match c.status {
        // A claim with no hospital report is saved once before its evidence is read; it opens on the next save.
        ClaimStatus::AwaitingRecord if c.cover_kind != "medical_payments" => return,
        ClaimStatus::AwaitingRecord => (
            "Decision Engine",
            format!("claim {}", c.id),
            format!("Claim opened for {}", person(c)),
            "an injury with a medic's note is a medical payments claim; it waits for the clinic record".into(),
        ),
        ClaimStatus::ReadingRecord => ("Claude", "Claude".into(), "Reading the clinic record".into(), "the medic filed it on the claim".into()),
        ClaimStatus::Verifying if c.incident_kind == "theft" && before.is_some_and(|b| b.status == ClaimStatus::AwaitingRecord) => (
            "Decision Engine",
            format!("claim {}", c.id),
            format!("Theft claim opened for {}", format_cents(c.cost_cents)),
            "venue property taken: the venue's property cover answers it where its theft clause covers the loss".into(),
        ),
        ClaimStatus::Verifying if c.incident_kind == "belongings" && before.is_some_and(|b| b.status == ClaimStatus::AwaitingRecord) => (
            "Decision Engine",
            format!("claim {}", c.id),
            format!("Claim opened for {}'s own things: {}", person(c), format_cents(c.cost_cents)),
            "the venue's policy excludes property in its care; the attendee's own policy answers it".into(),
        ),
        ClaimStatus::Verifying if c.cover_kind == "property" && before.is_some_and(|b| b.status == ClaimStatus::AwaitingRecord) => (
            "Decision Engine",
            format!("claim {}", c.id),
            format!("Property claim opened for {}", format_cents(c.payout_cents)),
            "the organizer logged the repair cost; the camera's assessment is evidence".into(),
        ),
        ClaimStatus::Verifying => return,
        ClaimStatus::Reviewing => return,
        ClaimStatus::Routed => ("Decision Engine", "code".into(), format!("Sent to the organizer: {}", format_cents(c.payout_cents)), c.status_note.clone()),
        ClaimStatus::Paying => {
            let paying = "paying into their Capital One wallet";
            match c.decided_by.as_str() {
                "claude" => {
                    let ceiling = ctx.db.settlement_rule().id().find(c.settlement_rule_id).map(|r| format_cents(r.ceiling_cents)).unwrap_or_default();
                    (
                        "Decision Engine",
                        format!("rule v{}", c.settlement_rule_version),
                        format!("Paid on Claude's decision: {} to {}", format_cents(c.payout_cents), person(c)),
                        format!("every check passed and {} is inside the {ceiling} authority rule v{} gives; {paying}", format_cents(c.payout_cents), c.settlement_rule_version),
                    )
                }
                "rule" => (
                    "Decision Engine",
                    format!("rule v{}", c.settlement_rule_version),
                    format!("Settled on its own: {} to {}", format_cents(c.payout_cents), person(c)),
                    paying.into(),
                ),
                _ => ("organizer", c.routed_to_name.clone(), format!("Approved: {} to {}", format_cents(c.payout_cents), person(c)), paying.into()),
            }
        }
        ClaimStatus::Settled if c.incident_kind == "theft" => {
            ("wallet", "Ledger".into(), format!("Stolen property paid: {}", format_cents(c.payout_cents)), c.status_note.clone())
        }
        ClaimStatus::Settled if c.cover_kind == "property" => {
            ("wallet", "Ledger".into(), format!("Repair paid: {}", format_cents(c.payout_cents)), c.status_note.clone())
        }
        ClaimStatus::Settled => ("wallet", "Capital One".into(), format!("{} landed in {}'s wallet", format_cents(c.payout_cents), person(c)), c.payout_reference.clone()),
        ClaimStatus::Refused => {
            let actor = if c.decided_by == "approver" { "organizer" } else { "Decision Engine" };
            let who = match c.decided_by.as_str() {
                "approver" => c.routed_to_name.clone(),
                "claude" => "Claude".into(),
                _ => "code".into(),
            };
            (actor, who, format!("Refused {}'s claim", person(c)), c.refusal_reason.clone())
        }
        ClaimStatus::Reconciled => ("wallet", "Insurer".into(), "The insurer paid the venue back".into(), c.payout_reference.clone()),
    };
    record(ctx, c.incident_id, c.id, actor, &who, what, why);
}

/// Claude's reading of the clinic record.
pub fn record_read(ctx: &ReducerContext, c: &Claim, r: &MedicalRecord) {
    let dx = r.diagnoses.first().cloned().unwrap_or_default();
    record(
        ctx,
        c.incident_id,
        c.id,
        "Claude",
        "Claude",
        format!("Read the clinic record: {} billed, {} covered", format_cents(r.billed_cents), format_cents(r.covered_cents)),
        format!("{}, {}: {dx}", r.provider_name, r.date_of_service),
    );
}

/// The Evidence Engine's checks and the policy clauses it found.
pub fn checks_done(ctx: &ReducerContext, c: &Claim, failed: &[String], clauses: usize) {
    let what = if failed.is_empty() { "Checked the evidence: nothing failed".to_string() } else { format!("Flagged: {}", failed.join(", ")) };
    let policies = if c.cover_kind == "personal_property" { "the venue's policy and the attendee's own" } else { "the venue's policy" };
    record(ctx, c.incident_id, c.id, "Evidence Engine", "Evidence Engine", what, format!("{clauses} clauses of {policies} bear on this {} claim", c.incident_kind));
}

/// Code set Claude's decision aside: it failed validation even after one more try.
pub fn set_aside(ctx: &ReducerContext, c: &Claim, problems: &[String]) {
    record(ctx, c.incident_id, c.id, "Decision Engine", "code", "Set Claude's decision aside".into(), problems.join("; "));
}

/// The organizer's approval, and the rule it taught.
pub fn approved(ctx: &ReducerContext, c: &Claim, approver: &str, rule: Option<(u32, u64)>) {
    let why = match rule {
        Some((v, ceiling)) => format!("learned rule v{v}: the next similar claim up to {} settles on its own", format_cents(ceiling)),
        None => "approved without teaching a rule".into(),
    };
    record(ctx, c.incident_id, c.id, "organizer", approver, format!("Approved {}'s claim", person(c)), why);
}

/// The medic or the organizer on an incident.
pub fn responding(ctx: &ReducerContext, incident_id: u64, medic: &str) {
    update_marker(ctx, incident_id, |m| IncidentMarker { status: "responding".into(), medic: medic.into(), responding_at: Some(ctx.timestamp), ..m });
    record(ctx, incident_id, 0, "medic", medic, "On the way".into(), "took the incident".into());
}

pub fn noted(ctx: &ReducerContext, incident_id: u64, author: &str, role: &str, text: &str, cost_cents: Option<u64>) {
    let actor = if role == "medic" { "medic" } else { "organizer" };
    let what = match cost_cents {
        Some(c) => format!("Logged the cost: {}", format_cents(c)),
        None => "Note on scene".into(),
    };
    record(ctx, incident_id, 0, actor, author, what, text.into());
}

pub fn resolved(ctx: &ReducerContext, incident_id: u64, by: &str, role: &str, resolution: &str) {
    update_marker(ctx, incident_id, |m| IncidentMarker { status: "resolved".into(), resolved_at: Some(ctx.timestamp), ..m });
    let actor = if role == "medic" { "medic" } else { "organizer" };
    record(ctx, incident_id, 0, actor, by, "Resolved".into(), resolution.into());
}
