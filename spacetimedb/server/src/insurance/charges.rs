//! Charges to an attendee who broke or took something. Staff name the band; code checks it against what
//! the module recorded (the band in the incident's zone at the time, among the bands at the spot when it
//! opened, the security cameras agreeing); Claude recommends a charge or none; code sets the amount, the
//! claim's whole loss; the organizer approves or waives every charge; the charged attendee pays it from
//! their wallet or disputes it. No charge rests on a model or on one person alone, and nothing leaves a
//! wallet until the attendee presses pay.

use super::flow::{claim_by_id, post};
use super::*;
use crate::jobs::{self, Job};
use crate::roles::*;
use crate::safety::*;
use crate::tables::*;
use crate::venue::*;
use crate::view_as::viewed;
use crate::vision::vision_assessment;
use bandit_insurance::money::format_cents;
use bandit_insurance::payloads::{ChargeBrief, ChargePaymentPayload, KIND_CHARGE_PAYMENT};
use bandit_insurance::{Check, CheckResult};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

pub const PROPOSED: &str = "proposed";
pub const APPROVED: &str = "approved";
pub const PAYING: &str = "paying";
pub const PAID: &str = "paid";
pub const DISPUTED: &str = "disputed";
pub const WAIVED: &str = "waived";

const MAX_TEXT_CHARS: usize = 600;

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = charge)]
pub struct Charge {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub incident_id: u64,
    /// The incident's claim, 0 until it opens.
    pub claim_id: u64,
    #[index(btree)]
    pub attendee: Identity,
    pub attendee_name: String,
    pub band_id: u32,
    pub named_by: Identity,
    pub named_by_name: String,
    pub named_by_role: String,
    /// What staff wrote when they named the band.
    pub note: String,
    /// The claim's whole loss, set by code from the claim's cost.
    pub amount_cents: u64,
    /// The evidence pack the amount comes from.
    pub pack_hash: String,
    /// Code's checks of the band, `name: result: detail`, one per line.
    pub checks: Vec<String>,
    /// The band was in the zone or at the spot, and no camera contradicts it.
    pub checks_passed: bool,
    /// Claude's recommendation: `charge`, `no_charge`, or empty until it decided the claim.
    pub recommendation: String,
    pub recommendation_reason: String,
    /// The policy clauses Claude cited for it.
    pub clause_ids: Vec<String>,
    /// `proposed`, `approved`, `paying`, `paid`, `disputed` or `waived`.
    #[index(btree)]
    pub status: String,
    pub dispute_text: String,
    pub approved_by_name: String,
    pub waive_reason: String,
    /// The Nessie purchase that paid it.
    pub payment_reference: String,
    pub created_at: Timestamp,
    pub decided_at: Option<Timestamp>,
    pub paid_at: Option<Timestamp>,
    pub updated_at: Timestamp,
    /// The insurer's share, set on approval: what it paid on the claim, which the charge repays.
    #[default(0)]
    pub insurer_cents: u64,
    /// Kept from an earlier design, when a charge could return an attendee's deductible; always 0.
    #[default(0)]
    pub refund_cents: u64,
}

fn charge_by_id(ctx: &ReducerContext, charge_id: u64) -> Result<Charge, String> {
    ctx.db.charge().id().find(charge_id).ok_or_else(|| format!("no charge {charge_id}"))
}

fn save(ctx: &ReducerContext, c: Charge) -> Charge {
    ctx.db.charge().id().update(Charge { updated_at: ctx.timestamp, ..c })
}

fn kind_words(kind: IncidentKind) -> &'static str {
    match kind {
        IncidentKind::Property => "the broken equipment",
        IncidentKind::Theft => "what was stolen from the venue",
        IncidentKind::Breakage => "the broken equipment",
        IncidentKind::Sos | IncidentKind::Fall => "an injury",
    }
}

/// Code's checks of a named band against what the module recorded when the incident opened.
fn band_checks(ctx: &ReducerContext, i: &Incident, band_id: u32) -> Vec<Check> {
    let at = i.opened_at;
    let station = i.station_id;
    let stay = ctx.db.zone_visit().band_id().filter(band_id).find(|v| v.zone == station && v.entered <= at && v.left.is_none_or(|l| l >= at));
    let zone_name = crate::venue::zone_for_station(ctx, station).map(|z| z.name).unwrap_or_else(|| format!("station {station}"));
    let in_zone = match stay {
        Some(_) => Check::pass("band_in_zone", format!("band {band_id} was in {zone_name} when the incident opened")),
        None => Check::fail("band_in_zone", format!("band {band_id} was not in {zone_name} when the incident opened")),
    };
    let present = ctx.db.incident_snapshot().incident_id().find(i.id).map(|s| s.bands_present).unwrap_or_default();
    let at_spot = if present.contains(&band_id) {
        Check::pass("band_at_spot", format!("band {band_id} is one of the {} bands at the spot when it opened", present.len()))
    } else {
        Check::fail("band_at_spot", format!("band {band_id} is not one of the {} bands at the spot when it opened", present.len()))
    };
    let camera = match ctx.db.vision_assessment().incident_id().filter(i.id).max_by_key(|a| a.id) {
        Some(a) if a.confirmed => Check::pass("camera_agrees", format!("the security cameras saw it: {}", a.description)),
        Some(a) => Check::fail("camera_agrees", format!("the security cameras did not confirm it: {}", a.description)),
        None => Check::info("camera_agrees", "no camera sighting of this incident"),
    };
    vec![in_zone, at_spot, camera]
}

/// Staff name the attendee who broke or took it, by their band. A band that was neither in the zone nor
/// at the spot is refused; otherwise the charge is proposed with every check, and the organizer decides it.
#[spacetimedb::reducer]
pub fn name_responsible_band(ctx: &ReducerContext, incident_id: u64, band_id: u32, note: String) -> Result<(), String> {
    require_role(ctx, &["ops", "medic"])?;
    let i = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
    if i.kind.is_injury() {
        return Err(format!("incident {incident_id} is an injury; nobody is charged for one"));
    }
    if band_id == 0 || band_id == i.subject_band {
        return Err("name the band of the attendee who broke or took it, not the claimant's".into());
    }
    let who = super::people::wore_band_at(ctx, band_id, i.opened_at).ok_or_else(|| format!("nobody wore band {band_id} when incident {incident_id} opened"))?;
    if let Some(old) = ctx.db.charge().incident_id().find(incident_id) {
        if old.status != PROPOSED {
            return Err(format!("the charge on incident {incident_id} is already {}", old.status));
        }
        ctx.db.charge().id().delete(old.id);
    }
    let checks = band_checks(ctx, &i, band_id);
    let failed = |name: &str| checks.iter().any(|c| c.name == name && c.result == CheckResult::Fail);
    if failed("band_in_zone") && failed("band_at_spot") {
        return Err(format!("band {band_id} was neither in the zone nor at the spot when incident {incident_id} opened"));
    }
    let name = super::people::display_name(ctx, who);
    let claim = ctx.db.claim().incident_id().find(incident_id);
    let charge = ctx.db.charge().insert(Charge {
        id: 0,
        incident_id,
        claim_id: claim.as_ref().map(|c| c.id).unwrap_or(0),
        attendee: who,
        attendee_name: name.clone(),
        band_id,
        named_by: ctx.sender(),
        named_by_name: caller_name(ctx),
        named_by_role: caller_role(ctx, STAFF_ROLES),
        note: note.trim().chars().take(MAX_TEXT_CHARS).collect(),
        amount_cents: claim.as_ref().map(|c| c.cost_cents).unwrap_or(0),
        pack_hash: claim.as_ref().map(|c| c.pack_hash.clone()).unwrap_or_default(),
        checks: checks.iter().map(Check::line).collect(),
        checks_passed: !failed("camera_agrees") && !(failed("band_in_zone") && failed("band_at_spot")),
        recommendation: String::new(),
        recommendation_reason: String::new(),
        clause_ids: Vec::new(),
        status: PROPOSED.into(),
        dispute_text: String::new(),
        approved_by_name: String::new(),
        waive_reason: String::new(),
        payment_reference: String::new(),
        created_at: ctx.timestamp,
        decided_at: None,
        paid_at: None,
        updated_at: ctx.timestamp,
        insurer_cents: 0,
        refund_cents: 0,
    });
    let actor = if charge.named_by_role == "medic" { "medic" } else { "organizer" };
    let passed: Vec<&str> = checks.iter().filter(|c| c.result == CheckResult::Pass).map(|c| c.name.as_str()).collect();
    crate::live::record(
        ctx,
        incident_id,
        charge.claim_id,
        actor,
        &charge.named_by_name,
        format!("Named {name} for {}", kind_words(i.kind)),
        format!("{}; checks passed: {}", charge.note, if passed.is_empty() { "none".to_string() } else { passed.join(", ") }),
    );
    Ok(())
}

/// The named attendee as evidence, for the claim's pack.
pub fn responsible_info(ctx: &ReducerContext, incident_id: u64) -> Option<bandit_insurance::evidence::ResponsibleInfo> {
    let c = ctx.db.charge().incident_id().find(incident_id).filter(|c| c.status != WAIVED)?;
    let passed = |name: &str| c.checks.iter().any(|l| l.starts_with(&format!("{name}: pass")));
    Some(bandit_insurance::evidence::ResponsibleInfo {
        charge_id: c.id,
        band_id: c.band_id,
        name: c.attendee_name.clone(),
        named_by_role: c.named_by_role.clone(),
        note: c.note.clone(),
        named_at: super::micros(c.created_at),
        in_zone: passed("band_in_zone"),
        at_spot: passed("band_at_spot"),
    })
}

/// The proposed charge for Claude's recommendation.
pub fn brief(ctx: &ReducerContext, claim: &Claim) -> Option<ChargeBrief> {
    let c = ctx.db.charge().incident_id().find(claim.incident_id).filter(|c| c.status == PROPOSED)?;
    let parse = |l: &String| {
        let mut parts = l.splitn(3, ": ");
        let name = parts.next().unwrap_or_default();
        let result = parts.next().unwrap_or_default();
        let detail = parts.next().unwrap_or_default();
        match result {
            "pass" => Check::pass(name, detail),
            "fail" => Check::fail(name, detail),
            _ => Check::info(name, detail),
        }
    };
    Some(ChargeBrief {
        charge_id: c.id,
        band_id: c.band_id,
        attendee_name: c.attendee_name.clone(),
        amount_cents: claim.cost_cents,
        named_by_role: c.named_by_role.clone(),
        note: c.note.clone(),
        checks: c.checks.iter().map(parse).collect(),
    })
}

/// Each new pack version fixes the claim's cost: the charge follows it.
pub fn on_pack_built(ctx: &ReducerContext, claim: &Claim) {
    if let Some(c) = ctx.db.charge().incident_id().find(claim.incident_id).filter(|c| c.status == PROPOSED || c.status == DISPUTED) {
        save(ctx, Charge { claim_id: claim.id, amount_cents: claim.cost_cents, pack_hash: claim.pack_hash.clone(), ..c });
    }
}

/// Claude's recommendation from its decision: `{"recommend": bool, "reason": "...", "clause_ids": [...]}`.
pub fn recommended(ctx: &ReducerContext, claim: &Claim, rec: Option<&serde_json::Value>) {
    let Some(c) = ctx.db.charge().incident_id().find(claim.incident_id).filter(|c| c.status == PROPOSED) else { return };
    let Some(rec) = rec.filter(|r| r.is_object()) else { return };
    let charge = rec.get("recommend").and_then(|v| v.as_bool()).unwrap_or(false);
    let reason: String = rec.get("reason").and_then(|v| v.as_str()).unwrap_or_default().chars().take(MAX_TEXT_CHARS).collect();
    let clause_ids: Vec<String> = rec.get("clause_ids").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let c = save(ctx, Charge { recommendation: if charge { "charge" } else { "no_charge" }.into(), recommendation_reason: reason.clone(), clause_ids, ..c });
    let what = if charge {
        format!("Recommends charging {} {}", c.attendee_name, format_cents(c.amount_cents))
    } else {
        format!("Recommends no charge to {}", c.attendee_name)
    };
    crate::live::record(ctx, claim.incident_id, claim.id, "Claude", "Claude", what, format!("{reason}; the organizer decides"));
}

fn organizer_check(ctx: &ReducerContext) -> Result<String, String> {
    require_role(ctx, &["ops"])?;
    Ok(ctx.db.staff_role().identity().filter(ctx.sender()).find(|r| r.role == "ops").map(|r| r.label).filter(|l| !l.is_empty()).unwrap_or_else(|| "Organizer".into()))
}

/// The organizer approves the charge they were shown, once the claim is decided; it fails closed when the
/// amount or the pack is no longer current, and needs the band's checks to have passed. The charge splits
/// into the insurer's share (what it paid on the claim) and the rest, the venue's deductible.
#[spacetimedb::reducer]
pub fn approve_charge(ctx: &ReducerContext, charge_id: u64, amount_seen_cents: u64, pack_hash_seen: String) -> Result<(), String> {
    let by = organizer_check(ctx)?;
    let c = charge_by_id(ctx, charge_id)?;
    if c.status != PROPOSED && c.status != DISPUTED {
        return Err(format!("charge {charge_id} is {}", c.status));
    }
    let claim = claim_by_id(ctx, c.claim_id).map_err(|_| format!("charge {charge_id} waits for its claim to open"))?;
    if claim.cost_cents == 0 {
        return Err("the claim has no cost logged yet".into());
    }
    let paid = matches!(claim.status, ClaimStatus::Paying | ClaimStatus::Settled | ClaimStatus::Reconciled);
    if !paid && claim.status != ClaimStatus::Refused {
        return Err(format!("the charge waits for claim {} to be decided", claim.id));
    }
    if amount_seen_cents != claim.cost_cents || amount_seen_cents != c.amount_cents || pack_hash_seen != claim.pack_hash {
        return Err(format!("stale: the charge is now {} on pack {}", format_cents(claim.cost_cents), bandit_insurance::pack::short_sha(&claim.pack_hash)));
    }
    if !c.checks_passed {
        return Err("a check of the named band failed; waive it or name the band again".into());
    }
    let insurer_cents = if paid { claim.recoverable_cents.min(c.amount_cents) } else { 0 };
    post(ctx, claim.id, bandit_insurance::ledger::charge_approved(c.amount_cents, insurer_cents), "approve_charge")?;
    let c = save(ctx, Charge { status: APPROVED.into(), approved_by_name: by.clone(), decided_at: Some(ctx.timestamp), insurer_cents, ..c });
    crate::live::record(
        ctx,
        c.incident_id,
        claim.id,
        "organizer",
        &by,
        format!("Approved a {} charge to {}", format_cents(c.amount_cents), c.attendee_name),
        format!(
            "the whole loss of claim {}: {} repays the insurer, {} repays the venue's deductible; it shows on their tap page to pay or dispute",
            claim.id,
            format_cents(c.insurer_cents),
            format_cents(c.amount_cents - c.insurer_cents)
        ),
    );
    Ok(())
}

/// The organizer drops a charge.
#[spacetimedb::reducer]
pub fn waive_charge(ctx: &ReducerContext, charge_id: u64, reason: String) -> Result<(), String> {
    let by = organizer_check(ctx)?;
    let c = charge_by_id(ctx, charge_id)?;
    if ![PROPOSED, APPROVED, DISPUTED].contains(&c.status.as_str()) {
        return Err(format!("charge {charge_id} is {}", c.status));
    }
    if reason.trim().is_empty() {
        return Err("waiving a charge needs a reason".into());
    }
    let posted = ctx.db.ledger_entry().claim_id().filter(c.claim_id).any(|e| e.journal == "J5 charge");
    if posted && c.status == APPROVED {
        post(ctx, c.claim_id, bandit_insurance::ledger::charge_waived(c.amount_cents, c.insurer_cents), "waive_charge")?;
    }
    let c = save(ctx, Charge { status: WAIVED.into(), waive_reason: reason.trim().into(), decided_at: Some(ctx.timestamp), ..c });
    crate::live::record(ctx, c.incident_id, c.claim_id, "organizer", &by, format!("Waived the charge to {}", c.attendee_name), c.waive_reason.clone());
    Ok(())
}

/// The charged attendee pays it from their wallet: a Nessie purchase at the venue.
#[spacetimedb::reducer]
pub fn pay_charge(ctx: &ReducerContext, charge_id: u64) -> Result<(), String> {
    let c = charge_by_id(ctx, charge_id)?;
    if c.attendee != ctx.sender() {
        return Err(format!("charge {charge_id} is not yours"));
    }
    if c.status != APPROVED {
        return Err(format!("charge {charge_id} is {}", c.status));
    }
    let spendable = crate::wallet::spendable(ctx, c.attendee);
    if spendable < c.amount_cents as i64 {
        return Err(format!("your wallet has {}; the charge is {}", format_cents(spendable.max(0) as u64), format_cents(c.amount_cents)));
    }
    let account = ctx.db.claimant_account().identity().find(c.attendee);
    let payload = ChargePaymentPayload {
        charge_id: c.id,
        payer: c.attendee.to_hex().to_string(),
        payer_name: c.attendee_name.clone(),
        customer_id: account.as_ref().map(|a| a.customer_id.clone()).unwrap_or_default(),
        account_id: account.as_ref().map(|a| a.account_id.clone()).unwrap_or_default(),
        amount_cents: c.amount_cents,
        merchant_name: settings(ctx).venue_name,
        memo: format!("BandIt charge {} for incident {}", c.id, c.incident_id),
    };
    jobs::enqueue(ctx, KIND_CHARGE_PAYMENT, serde_json::to_string(&payload).unwrap(), "charge", c.id);
    save(ctx, Charge { status: PAYING.into(), ..c });
    Ok(())
}

/// The worker's Nessie purchase for a charge.
#[spacetimedb::reducer]
pub fn record_charge_payment(ctx: &ReducerContext, job_id: u64, customer_id: String, account_id: String, purchase_id: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let c = charge_by_id(ctx, job.subject_id)?;
    jobs::finish(ctx, job, purchase_id.clone());
    if c.status != PAYING {
        return Ok(());
    }
    if ctx.db.claimant_account().identity().find(c.attendee).is_none() {
        ctx.db.claimant_account().insert(ClaimantAccount { identity: c.attendee, customer_id, account_id, created_at: ctx.timestamp });
    }
    crate::wallet::add_entry(ctx, c.attendee, "charge", -(c.amount_cents as i64), format!("BandIt charge {} for incident {}", c.id, c.incident_id), purchase_id.clone());
    post(ctx, c.claim_id, bandit_insurance::ledger::charge_paid(c.amount_cents), "record_charge_payment")?;
    let c = save(ctx, Charge { status: PAID.into(), payment_reference: format!("Nessie purchase {purchase_id}"), paid_at: Some(ctx.timestamp), ..c });
    crate::live::record(ctx, c.incident_id, c.claim_id, "wallet", "Capital One", format!("{} paid the {} charge", c.attendee_name, format_cents(c.amount_cents)), c.payment_reference.clone());
    Ok(())
}

/// The charged attendee disputes it in their own words; it goes back to the organizer.
#[spacetimedb::reducer]
pub fn dispute_charge(ctx: &ReducerContext, charge_id: u64, text: String) -> Result<(), String> {
    let c = charge_by_id(ctx, charge_id)?;
    if c.attendee != ctx.sender() {
        return Err(format!("charge {charge_id} is not yours"));
    }
    if c.status != APPROVED {
        return Err(format!("charge {charge_id} is {}", c.status));
    }
    let text: String = text.trim().chars().take(MAX_TEXT_CHARS).collect();
    if text.is_empty() {
        return Err("say why in your own words".into());
    }
    post(ctx, c.claim_id, bandit_insurance::ledger::charge_waived(c.amount_cents, c.insurer_cents), "dispute_charge")?;
    let c = save(ctx, Charge { status: DISPUTED.into(), dispute_text: text.clone(), ..c });
    crate::live::record(ctx, c.incident_id, c.claim_id, "attendee", &c.attendee_name, "Disputed the charge".into(), text);
    Ok(())
}

/// A charge payment that ran out of attempts goes back to approved, so the attendee can press pay again.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_CHARGE_PAYMENT {
        return;
    }
    if let Some(c) = ctx.db.charge().id().find(job.subject_id).filter(|c| c.status == PAYING) {
        save(ctx, Charge { status: APPROVED.into(), ..c });
    }
}

/// What the charges being paid hold in a wallet.
pub fn held_cents(ctx: &ReducerContext, who: Identity) -> i64 {
    ctx.db.charge().attendee().filter(who).filter(|c| c.status == PAYING).map(|c| c.amount_cents as i64).sum()
}

pub fn my_held_cents(ctx: &ViewContext, who: Identity) -> i64 {
    ctx.db.charge().attendee().filter(who).filter(|c| c.status == PAYING).map(|c| c.amount_cents as i64).sum()
}

/// One charge as the charged attendee reads it, like a receipt.
#[derive(SpacetimeType, Clone, Debug)]
pub struct MyCharge {
    pub id: u64,
    pub incident_id: u64,
    /// `property`, `theft` or `breakage`.
    pub incident_kind: String,
    pub zone_name: String,
    pub happened_at: Timestamp,
    pub amount_cents: u64,
    /// `approved`, `paying`, `paid`, `disputed` or `waived`.
    pub status: String,
    /// The evidence in plain words.
    pub why: String,
    /// The policy clause it rests on, as "the venue's policy, section, page"; empty when none was cited.
    pub clause: String,
    pub dispute_text: String,
    pub paid_at: Option<Timestamp>,
}

fn why_words(ctx: &ViewContext, c: &Charge) -> String {
    let passed = |name: &str| c.checks.iter().any(|l| l.starts_with(&format!("{name}: pass")));
    let mut parts = Vec::new();
    if passed("band_in_zone") {
        parts.push("your band was in the zone at the time".to_string());
    }
    if passed("band_at_spot") {
        parts.push("it was one of the bands at the spot".to_string());
    }
    if passed("camera_agrees") {
        parts.push("a security camera saw it".to_string());
    }
    let staff = ctx.db.staff_role().identity().filter(c.named_by).next().map(|_| c.named_by_name.clone()).unwrap_or_else(|| "staff".into());
    if !c.note.is_empty() {
        parts.push(format!("{staff} wrote: {}", c.note));
    }
    parts.join("; ")
}

fn clause_words(ctx: &ViewContext, c: &Charge) -> String {
    let Some(id) = c.clause_ids.first() else { return String::new() };
    let found = ctx.db.claim_clause().claim_id().filter(c.claim_id).find(|k| &k.clause_id == id);
    match found {
        Some(k) => {
            let whose = if k.policy == "attendee" { "your own policy" } else { "the venue's policy" };
            format!("{whose}, {}, page {}", k.section.replace('_', " "), k.page)
        }
        None => String::new(),
    }
}

/// The caller's charges once the organizer decided them: what happened, where and when, the evidence,
/// the clause and the amount.
#[spacetimedb::view(accessor = my_charges, public)]
pub fn my_charges(ctx: &ViewContext) -> Vec<MyCharge> {
    ctx.db
        .charge()
        .attendee()
        .filter(viewed(ctx))
        .filter(|c| c.status != PROPOSED)
        .map(|c| {
            let incident = ctx.db.incident().id().find(c.incident_id);
            MyCharge {
                id: c.id,
                incident_id: c.incident_id,
                incident_kind: incident.as_ref().map(|i| i.kind.as_str().to_string()).unwrap_or_default(),
                zone_name: incident.as_ref().and_then(|i| ctx.db.zone().id().find(i.zone_id)).map(|z| z.name).unwrap_or_default(),
                happened_at: incident.as_ref().map(|i| i.opened_at).unwrap_or(c.created_at),
                amount_cents: c.amount_cents,
                status: c.status.clone(),
                why: why_words(ctx, &c),
                clause: clause_words(ctx, &c),
                dispute_text: c.dispute_text.clone(),
                paid_at: c.paid_at,
            }
        })
        .collect()
}

/// Every charge, for the organizer's Claims tab.
#[spacetimedb::view(accessor = board_charges, public)]
pub fn board_charges(ctx: &ViewContext) -> Vec<Charge> {
    let staff = ctx.db.owner().identity().find(viewed(ctx)).is_some()
        || ctx.db.staff_role().identity().filter(viewed(ctx)).any(|r| r.role == "ops" || r.role == "medic");
    if !staff {
        return Vec::new();
    }
    ctx.db.charge().attendee().filter(Identity::ZERO..).collect()
}
