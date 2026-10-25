//! The named people: the approver's grid and decision, the organizer's call on a
//! proposed rule, the insurer's payment and the recovery letter request.

use crate::app::*;
use anyhow::{Context, Result, bail};
use bandit_bindings::*;
use spacetimedb_sdk::Table;

/// What the approver sees, captured once so the reducer gets exactly that.
pub struct Grid {
    pub payout_cents: u64,
    pub pack_hash: String,
}

/// Reads the claim and prints the approval grid.
pub fn grid(app: &App, claim_id: u64, verbose: bool) -> Result<Grid> {
    let db = app.db()?;
    let c = app.claim(claim_id)?;
    let waiting = if c.status == ClaimStatus::Routed {
        format!("waiting for {} ({})", c.routed_to_name, c.routed_to_role)
    } else {
        format!("{} (not waiting for a person)", status_name(c.status))
    };
    say!(app, "claim {}  {}  {}  {}  {waiting}", c.id, claimant(&c), c.incident_kind, c.zone_name);
    if verbose {
        let rule = db.db.coverage_rule().iter().find(|r| r.policy_id == c.policy_id && r.cover_kind == c.cover_kind);
        let policy = db.db.insurance_policy().id().find(&c.policy_id);
        let used = policy.map(|p| if c.cover_kind == "property" { p.property_used_cents } else { p.medical_used_cents }).unwrap_or(0);
        let checks: Vec<ClaimCheck> =
            db.db.claim_check().iter().filter(|k| k.claim_id == c.id && k.pack_version == c.pack_version).collect();
        let n = |r: &str| checks.iter().filter(|k| k.result == r).count();
        say!(app, "  why          {}", c.status_note);
        say!(app, "  cost         {}", money(c.cost_cents));
        if let Some(r) = &rule {
            say!(
                app,
                "  limit        {} per claim, {} of {} aggregate left",
                money(r.per_claim_limit_cents),
                money(r.aggregate_limit_cents.saturating_sub(used)),
                money(r.aggregate_limit_cents)
            );
            say!(app, "  deductible   {}", money(r.deductible_cents));
        }
        say!(app, "  payout       {}", money(c.payout_cents));
        say!(app, "  recoverable  {}", money(c.recoverable_cents));
        say!(app, "  venue cost   {}", money(c.venue_cost_cents));
        say!(app, "  pack         v{} {} ({})", c.pack_version, short_hash(&c.pack_hash), c.corroboration);
        say!(app, "  checks       {} pass, {} fail, {} info", n("pass"), n("fail"), n("info"));
        for k in checks.iter().filter(|k| k.result == "fail") {
            say!(app, "               fail {} ({}): {}", k.name, k.reader, k.detail);
        }
        if !c.review_verdict.is_empty() {
            say!(app, "  Claude       {}", c.review_verdict);
        }
    }
    Ok(Grid { payout_cents: c.payout_cents, pack_hash: c.pack_hash.clone() })
}

fn claimant(c: &Claim) -> &str {
    if c.claimant_name.is_empty() { "the venue" } else { &c.claimant_name }
}

/// The actor who decides: `as_`, else the organizer, whom every routed claim waits for.
fn decider(as_: Option<&str>) -> String {
    as_.unwrap_or("ops").to_string()
}

/// Shows the grid and approves with exactly what it showed (or, with `stale`,
/// a wrong amount, to show the module failing closed).
pub fn approve(app: &App, claim_id: u64, as_: Option<&str>, stale: bool, verbose: bool) -> Result<Claim> {
    let g = grid(app, claim_id, verbose)?;
    let who = decider(as_);
    let conn = app.actor(&who)?;
    let name = app.person(spacetimedb_sdk::DbContext::identity(&*conn));
    let amount = if stale { g.payout_cents + 10_000 } else { g.payout_cents };
    say!(
        app,
        "{name} approves {} on pack {}{}",
        money(amount),
        short_hash(&g.pack_hash),
        if stale { " (a stale screen, on purpose)" } else { "" }
    );
    let sent = call!(conn, approve_claim_then(claim_id, amount, g.pack_hash.clone()));
    if let Err(e) = sent {
        if stale {
            say!(app, "  refused, fail-closed: {e}; nothing moved");
            return app.claim(claim_id);
        }
        return Err(e);
    }
    if stale {
        bail!("the module accepted a stale amount");
    }
    let c = until(5.0, || app.claim(claim_id).ok().filter(|c| c.status != ClaimStatus::Routed)).unwrap_or(app.claim(claim_id)?);
    say!(app, "  -> {}: {}", status_name(c.status), c.status_note);
    let db = app.db()?;
    if let Some(p) = db.db.rule_proposal().iter().filter(|p| p.claim_ids.contains(&claim_id) && p.status == "proposing").max_by_key(|p| p.id) {
        say!(app, "  -> precedent for a rule: Claude is proposing one from claims {:?}", p.claim_ids);
    }
    Ok(c)
}

/// The organizer approves Claude's proposed rule with the ceiling it shows; the module refuses whoever proposed it.
pub fn approve_proposal(app: &App, proposal_id: u64, as_: Option<&str>) -> Result<RuleProposal> {
    let conn = app.actor(&decider(as_))?;
    let name = app.person(spacetimedb_sdk::DbContext::identity(&*conn));
    let p = app.db()?.db.rule_proposal().id().find(&proposal_id).with_context(|| format!("no proposal {proposal_id}"))?;
    say!(app, "{name} approves the proposed rule {proposal_id}: {} up to {}, from claims {:?}", p.incident_kind, money(p.ceiling_cents), p.claim_ids);
    call!(conn, approve_rule_proposal_then(proposal_id, p.ceiling_cents))?;
    let p = until(5.0, || app.db().ok()?.db.rule_proposal().id().find(&proposal_id).filter(|p| p.status != "proposed")).with_context(|| format!("proposal {proposal_id} did not change"))?;
    say!(app, "  -> {}: rule v{}", p.status, p.rule_version);
    Ok(p)
}

/// The organizer rejects Claude's proposed rule.
pub fn reject_proposal(app: &App, proposal_id: u64, as_: Option<&str>, reason: &str) -> Result<()> {
    let conn = app.actor(&decider(as_))?;
    let name = app.person(spacetimedb_sdk::DbContext::identity(&*conn));
    say!(app, "{name} rejects the proposed rule {proposal_id}: {reason}");
    call!(conn, reject_rule_proposal_then(proposal_id, reason.to_string()))
}

/// Every proposed rule waiting for the organizer, approved.
pub fn approve_proposals(app: &App) -> Result<Vec<RuleProposal>> {
    let waiting: Vec<u64> = app.db()?.db.rule_proposal().iter().filter(|p| p.status == "proposed").map(|p| p.id).collect();
    waiting.into_iter().map(|id| approve_proposal(app, id, None)).collect()
}

pub fn refuse(app: &App, claim_id: u64, as_: Option<&str>, reason: &str, verbose: bool) -> Result<Claim> {
    let g = grid(app, claim_id, verbose)?;
    let who = decider(as_);
    let conn = app.actor(&who)?;
    let name = app.person(spacetimedb_sdk::DbContext::identity(&*conn));
    say!(app, "{name} refuses on pack {}: {reason}", short_hash(&g.pack_hash));
    call!(conn, refuse_claim_then(claim_id, g.pack_hash.clone(), reason.to_string()))?;
    let c = until(5.0, || app.claim(claim_id).ok().filter(|c| c.status == ClaimStatus::Refused)).unwrap_or(app.claim(claim_id)?);
    say!(app, "  -> {}: {}", status_name(c.status), c.status_note);
    Ok(c)
}

/// The insurer's payment against the receivable (J4), recorded by the organizer by default.
pub fn insurer_paid(app: &App, claim_id: u64, amount: u64, reference: &str, as_: Option<&str>) -> Result<Claim> {
    let conn = app.actor(as_.unwrap_or("ops"))?;
    let c = app.claim(claim_id)?;
    say!(app, "Northwind Mutual paid {} on claim {claim_id} ({reference}); recoverable was {}", money(amount), money(c.recoverable_cents));
    call!(conn, record_insurer_payment_then(claim_id, amount, reference.to_string()))?;
    let c = until(5.0, || app.claim(claim_id).ok().filter(|c| c.status == ClaimStatus::Reconciled)).unwrap_or(app.claim(claim_id)?);
    say!(app, "  -> {}: {}", status_name(c.status), c.status_note);
    Ok(c)
}

/// Asks the worker for a recovery letter to whoever handled the damaged equipment, as the organizer by default.
pub fn recovery(app: &App, claim_id: u64, to: &str, contact: &str, as_: Option<&str>) -> Result<()> {
    let conn = app.actor(as_.unwrap_or("ops"))?;
    call!(conn, request_recovery_letter_then(claim_id, to.to_string(), contact.to_string()))?;
    say!(app, "recovery   letter to {to} ({contact}) requested on claim {claim_id}; `letters {claim_id}` prints it once drafted");
    Ok(())
}
