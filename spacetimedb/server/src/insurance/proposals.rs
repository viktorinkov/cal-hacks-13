//! Rules from precedents (Hyphenate track). Every organizer decision on a claim is kept as a precedent.
//! Once three approved simple claims of one shape (incident kind and cover) agree, the Decision Engine proposes a
//! payment rule from them; code holds the proposal to those claims and the policy, and only the organizer
//! approves it, never whoever proposed it. The approved rule then pays the claims of that shape waiting
//! for the organizer, and every later one, on its own. A complicated claim gets no proposal: a gap in
//! the policies leaves no term to set a ceiling from.

use super::evidence::*;
use super::flow::{amounts, apply, claim_complications, core_rules, corroboration_of, has_cover, mass_occurrence, organizer_name};
use super::*;
use crate::jobs::{self, Job, ModelCallIn};
use crate::roles::require_role;
use bandit_insurance::complications::Complication;
use bandit_insurance::money::format_cents;
use bandit_insurance::outcome::{Decision, DecisionInput, ReviewGate, decide};
use bandit_insurance::payloads::*;
use bandit_insurance::rules::{ProposedRule, RULE_PRECEDENTS, approval_scope, check_proposal, matching_rule, next_version};
use bandit_insurance::{CoverKind, IncidentKind};
use spacetimedb::{Identity, ReducerContext, Table};

/// Proposals still open: the Decision Engine is writing one, or it waits for the organizer.
const OPEN: [&str; 2] = ["proposing", "proposed"];

/// "falls under medical payments cover".
pub fn shape_words(incident_kind: &str, cover_kind: &str) -> String {
    let kind = match incident_kind {
        "fall" => "falls",
        "sos" => "SOS calls",
        "property" => "broken equipment",
        other => other,
    };
    let cover = match cover_kind {
        "medical_payments" => "medical payments",
        other => other,
    };
    format!("{kind} under {cover} cover")
}

/// "claims 2, 4 and 7".
pub fn claims_words(ids: &[u64]) -> String {
    let ids: Vec<String> = ids.iter().map(|i| i.to_string()).collect();
    match ids.as_slice() {
        [] => "no claims".into(),
        [one] => format!("claim {one}"),
        [rest @ .., last] => format!("claims {} and {last}", rest.join(", ")),
    }
}

/// Keeps the organizer's decision on a claim as a precedent.
pub(super) fn keep_precedent(ctx: &ReducerContext, claim: &Claim, approval: &Approval, found: &[Complication]) {
    ctx.db.organizer_precedent().insert(OrganizerPrecedent {
        id: 0,
        claim_id: claim.id,
        approval_id: approval.id,
        incident_kind: claim.incident_kind.clone(),
        cover_kind: claim.cover_kind.clone(),
        decision: approval.decision.clone(),
        payout_cents: claim.payout_cents,
        claimant_name: claim.claimant_name.clone(),
        zone_name: claim.zone_name.clone(),
        complications: found.iter().map(|c| c.label()).collect::<Vec<_>>().join("; "),
        reason: approval.reason.trim().to_string(),
        decided_by_name: approval.approver_name.clone(),
        proposal_id: 0,
        decided_at: ctx.timestamp,
    });
}

/// The shape's approved simple precedents that no proposal cites yet, oldest first.
fn uncited(ctx: &ReducerContext, incident_kind: &str, cover_kind: &str) -> Vec<OrganizerPrecedent> {
    let mut rows: Vec<OrganizerPrecedent> = ctx
        .db
        .organizer_precedent()
        .proposal_id()
        .filter(0u64)
        .filter(|p| p.decision == "approve" && p.complications.is_empty() && p.incident_kind == incident_kind && p.cover_kind == cover_kind)
        .collect();
    rows.sort_by_key(|p| p.id);
    rows
}

fn active_rule(ctx: &ReducerContext, incident_kind: &str, cover_kind: &str) -> Option<SettlementRuleRow> {
    ctx.db.settlement_rule().iter().filter(|r| rule_scope_approved(ctx, r) && r.incident_kind == incident_kind && r.cover_kind == cover_kind && r.zone_id == 0).max_by_key(|r| r.version)
}

/// After an approval of a simple claim: opens a proposal once enough precedents of its shape agree, and says
/// what the approval counts toward, for the decision history.
pub(super) fn after_approval(ctx: &ReducerContext, claim: &Claim) -> String {
    let shape = shape_words(&claim.incident_kind, &claim.cover_kind);
    let pool = uncited(ctx, &claim.incident_kind, &claim.cover_kind);
    let rule = active_rule(ctx, &claim.incident_kind, &claim.cover_kind);
    if ctx.db.rule_proposal().iter().any(|p| OPEN.contains(&p.status.as_str()) && p.incident_kind == claim.incident_kind && p.cover_kind == claim.cover_kind) {
        return format!("kept as a precedent; a rule for {shape} is already proposed");
    }
    if pool.len() < RULE_PRECEDENTS {
        return format!("precedent {} of {RULE_PRECEDENTS} for a rule on {shape}", pool.len());
    }
    let highest = pool.iter().map(|p| p.payout_cents).max().unwrap_or(0);
    if let Some(r) = rule.as_ref().filter(|r| r.ceiling_cents >= highest) {
        return format!("kept as a precedent; rule v{} already pays {shape} up to {}", r.version, format_cents(r.ceiling_cents));
    }
    open_proposal(ctx, claim, pool, rule);
    format!("precedent {RULE_PRECEDENTS} of {RULE_PRECEDENTS}: the Decision Engine proposes a rule on {shape}")
}

/// Opens a proposal citing `pool` and asks the Decision Engine for the rule.
fn open_proposal(ctx: &ReducerContext, claim: &Claim, pool: Vec<OrganizerPrecedent>, rule: Option<SettlementRuleRow>) {
    let s = settings(ctx);
    let cover = cover_of(claim);
    let limit_cents = policy_rule(ctx, claim.policy_id, cover).map(|r| r.per_claim_limit_cents).unwrap_or(0);
    let claim_ids: Vec<u64> = pool.iter().map(|p| p.claim_id).collect();
    let proposal = ctx.db.rule_proposal().insert(RuleProposal {
        id: 0,
        incident_kind: claim.incident_kind.clone(),
        cover_kind: claim.cover_kind.clone(),
        status: "proposing".into(),
        ceiling_cents: 0,
        limit_cents,
        claim_ids: claim_ids.clone(),
        rule: String::new(),
        summary: String::new(),
        job_id: 0,
        model_call_id: 0,
        proposed_by: Identity::ZERO,
        decided_by: Identity::ZERO,
        decided_by_name: String::new(),
        reason: String::new(),
        settlement_rule_id: 0,
        rule_version: 0,
        created_at: ctx.timestamp,
        proposed_at: None,
        decided_at: None,
    });
    for p in &pool {
        ctx.db.organizer_precedent().id().update(OrganizerPrecedent { proposal_id: proposal.id, ..p.clone() });
    }
    let approved = pool.iter().map(|p| approved_precedent(ctx, p, s.tz_offset_minutes)).collect();
    let refused = ctx
        .db
        .organizer_precedent()
        .iter()
        .filter(|p| p.decision == "refuse" && p.complications.is_empty() && p.incident_kind == claim.incident_kind && p.cover_kind == claim.cover_kind)
        .map(|p| RefusedPrecedent { claim_id: p.claim_id, claimant: p.claimant_name, zone: p.zone_name, payout_cents: p.payout_cents, reason: p.reason })
        .collect();
    let payload = RuleProposalPayload {
        proposal_id: proposal.id,
        venue_name: s.venue_name.clone(),
        incident_kind: claim.incident_kind.clone(),
        cover_kind: claim.cover_kind.clone(),
        policy_number: ctx.db.insurance_policy().id().find(claim.policy_id).map(|p| p.policy_number).unwrap_or_default(),
        limit_cents,
        minimum_payout_cents: super::documents::minimum_payout(ctx, claim.policy_id, cover),
        rule_in_force: rule.map(|r| RuleInForce { version: r.version, ceiling_cents: r.ceiling_cents }),
        approved,
        refused,
    };
    let job_id = jobs::enqueue(ctx, KIND_RULE_PROPOSAL, serde_json::to_string(&payload).unwrap(), "rule_proposal", proposal.id);
    ctx.db.rule_proposal().id().update(RuleProposal { job_id, ..proposal });
    crate::live::record(
        ctx,
        claim.incident_id,
        claim.id,
        "Decision Engine",
        "Decision Engine",
        format!("Proposing a rule from {}", claims_words(&claim_ids)),
        format!("{} approved {} no rule pays yet", pool.len(), shape_words(&claim.incident_kind, &claim.cover_kind)),
    );
}

fn approved_precedent(ctx: &ReducerContext, p: &OrganizerPrecedent, tz_offset_minutes: i32) -> ApprovedPrecedent {
    let claim = ctx.db.claim().id().find(p.claim_id);
    let record = extracted_record(ctx, p.claim_id);
    ApprovedPrecedent {
        claim_id: p.claim_id,
        claimant: p.claimant_name.clone(),
        zone: p.zone_name.clone(),
        payout_cents: p.payout_cents,
        billed_cents: record.as_ref().map(|r| r.billed_cents).unwrap_or(0),
        covered_cents: record.as_ref().map(|r| r.covered_cents).or(claim.as_ref().map(|c| c.cost_cents)).unwrap_or(0),
        diagnoses: record.map(|r| r.diagnoses).unwrap_or_default(),
        service_codes: ctx.db.claim_line().claim_id().filter(p.claim_id).map(|l| l.code).collect(),
        corroboration: claim.map(|c| c.corroboration).unwrap_or_default(),
        approver: p.decided_by_name.clone(),
        decided_at: bandit_insurance::time::local_datetime(micros(p.decided_at), tz_offset_minutes)[..16].to_string(),
    }
}

/// Lets the proposal's precedents feed a later proposal again, except those in `keep`.
fn release(ctx: &ReducerContext, proposal_id: u64, keep: &[u64]) {
    for p in ctx.db.organizer_precedent().proposal_id().filter(proposal_id).collect::<Vec<_>>() {
        if !keep.contains(&p.claim_id) {
            ctx.db.organizer_precedent().id().update(OrganizerPrecedent { proposal_id: 0, ..p });
        }
    }
}

/// The incident and claim a proposal's decision rows sit on: its newest precedent's.
fn anchor(ctx: &ReducerContext, p: &RuleProposal) -> (u64, u64) {
    p.claim_ids.iter().max().and_then(|id| ctx.db.claim().id().find(*id)).map(|c| (c.incident_id, c.id)).unwrap_or((0, 0))
}

/// The Decision Engine's proposal. Code checks it again: it cites at least three of the approved precedents it was
/// offered, its ceiling is the highest payout among them, and that is within the policy's per-claim limit.
#[spacetimedb::reducer]
pub fn submit_rule_proposal(ctx: &ReducerContext, job_id: u64, proposal_json: String, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let payload: RuleProposalPayload = serde_json::from_str(&job.payload).map_err(|e| e.to_string())?;
    let call_id = jobs::record_call(ctx, job_id, &call);
    let proposal = ctx.db.rule_proposal().id().find(payload.proposal_id).ok_or("no such proposal")?;
    if proposal.status != "proposing" {
        jobs::finish(ctx, job, "the proposal is no longer open");
        return Ok(());
    }
    let (incident_id, claim_id) = anchor(ctx, &proposal);
    let offered: Vec<(u64, u64)> = payload.approved.iter().map(|p| (p.claim_id, p.payout_cents)).collect();
    let checked = serde_json::from_str::<ProposedRule>(&proposal_json)
        .map_err(|e| vec![format!("not a proposal: {e}")])
        .and_then(|p| check_proposal(&p, &offered, payload.limit_cents).map(|_| p));
    let base = RuleProposal { model_call_id: call_id, proposed_by: ctx.sender(), proposed_at: Some(ctx.timestamp), ..proposal };
    match checked {
        Err(problems) => {
            release(ctx, base.id, &[]);
            ctx.db.rule_proposal().id().update(RuleProposal { status: "failed".into(), summary: problems.join("; "), ..base });
            jobs::finish(ctx, job, "proposal set aside");
            crate::live::record(ctx, incident_id, claim_id, "Decision Engine", "code", "Set the Decision Engine's proposed rule aside".into(), problems.join("; "));
        }
        Ok(p) if !p.propose => {
            ctx.db.rule_proposal().id().update(RuleProposal { status: "declined".into(), summary: p.summary.trim().into(), ..base });
            jobs::finish(ctx, job, "no rule proposed");
            crate::live::record(ctx, incident_id, claim_id, "Decision Engine", "Decision Engine", "Proposed no rule".into(), p.summary.trim().into());
        }
        Ok(p) => {
            release(ctx, base.id, &p.precedent_claim_ids);
            let mut claim_ids = p.precedent_claim_ids.clone();
            claim_ids.sort();
            let summary = p.summary.trim().to_string();
            let kind = IncidentKind::parse(&base.incident_kind).ok_or("unknown proposal incident kind")?;
            let cover = CoverKind::parse(&base.cover_kind).ok_or("unknown proposal cover kind")?;
            let rule = approval_scope(kind, cover, 0, true, p.ceiling_cents);
            ctx.db.rule_proposal().id().update(RuleProposal { status: "proposed".into(), ceiling_cents: p.ceiling_cents, claim_ids: claim_ids.clone(), rule: rule.clone(), summary: summary.clone(), ..base });
            jobs::finish(ctx, job, "rule proposed");
            crate::live::record(ctx, incident_id, claim_id, "Decision Engine", "Decision Engine", format!("Proposed a rule: {rule}"), format!("{summary} From {}; waits for the organizer.", claims_words(&claim_ids)));
        }
    }
    Ok(())
}

/// The organizer approves the Decision Engine's proposal: it becomes the next version of the shape's payment rule,
/// with the proposal's precedents as its evidence. Whoever proposed a rule can never approve it.
#[spacetimedb::reducer]
pub fn approve_rule_proposal(ctx: &ReducerContext, proposal_id: u64, ceiling_seen_cents: u64) -> Result<(), String> {
    require_role(ctx, CLAIM_ROLES)?;
    let p = ctx.db.rule_proposal().id().find(proposal_id).ok_or_else(|| format!("no proposal {proposal_id}"))?;
    if p.status != "proposed" {
        return Err(format!("proposal {proposal_id} is {}, not waiting for the organizer", p.status));
    }
    if p.proposed_by == ctx.sender() {
        return Err("separation of duties: whoever proposed a rule cannot approve it".into());
    }
    if ceiling_seen_cents != p.ceiling_cents {
        return Err(format!("stale: the proposed ceiling is {}", format_cents(p.ceiling_cents)));
    }
    let (kind, cover) = match (IncidentKind::parse(&p.incident_kind), CoverKind::parse(&p.cover_kind)) {
        (Some(k), Some(c)) => (k, c),
        _ => return Err("the proposal's shape is unknown".into()),
    };
    if p.rule != approval_scope(kind, cover, 0, true, p.ceiling_cents) {
        return Err("scope review required: this proposal's wording is not the code-enforced scope; refresh after rule scope review".into());
    }
    let limit = current_limit(ctx, cover);
    validate_precedents(ctx, &p, limit)?;
    if p.ceiling_cents > limit {
        return Err(format!("the policy's per-claim limit is now {}, under the proposed {}", format_cents(limit), format_cents(p.ceiling_cents)));
    }
    let version = next_version(&core_rules(ctx), kind, cover, 0);
    for old in ctx.db.settlement_rule().iter().filter(|r| ["active", "review_required"].contains(&r.status.as_str()) && r.incident_kind == p.incident_kind && r.cover_kind == p.cover_kind && r.zone_id == 0) {
        ctx.db.settlement_rule().id().update(SettlementRuleRow { status: "superseded".into(), ..old });
    }
    let name = organizer_name(ctx);
    let rule = ctx.db.settlement_rule().insert(SettlementRuleRow {
        id: 0,
        incident_kind: p.incident_kind.clone(),
        cover_kind: p.cover_kind.clone(),
        zone_id: 0,
        requires_corroborated: true,
        ceiling_cents: p.ceiling_cents,
        approver: ctx.sender(),
        approver_name: name.clone(),
        approver_role: "ops".into(),
        approval_id: 0,
        version,
        status: "active".into(),
        created_at: ctx.timestamp,
        proposal_id: p.id,
    });
    let (incident_id, claim_id) = anchor(ctx, &p);
    let shape = shape_words(&p.incident_kind, &p.cover_kind);
    let claims = claims_words(&p.claim_ids);
    ctx.db.rule_proposal().id().update(RuleProposal {
        status: "approved".into(),
        decided_by: ctx.sender(),
        decided_by_name: name.clone(),
        settlement_rule_id: rule.id,
        rule_version: version,
        decided_at: Some(ctx.timestamp),
        ..p
    });
    crate::live::record(ctx, incident_id, claim_id, "organizer", &name, format!("Approved rule v{version}: {shape} up to {}", format_cents(rule.ceiling_cents)), format!("from {claims}, proposed by the Decision Engine"));
    pay_waiting(ctx, kind, cover);
    Ok(())
}

/// Only an exact, reciprocally linked approval can authorize automatic payments. This gate runs
/// even before the post-publish review pass, so legacy prose is never silently reinterpreted.
pub(super) fn rule_scope_approved(ctx: &ReducerContext, r: &SettlementRuleRow) -> bool {
    if r.status != "active" || r.proposal_id == 0 {
        return false;
    }
    let (Some(kind), Some(cover)) = (IncidentKind::parse(&r.incident_kind), CoverKind::parse(&r.cover_kind)) else { return false };
    ctx.db.rule_proposal().id().find(r.proposal_id).is_some_and(|p| {
        p.status == "approved" && p.settlement_rule_id == r.id && p.rule_version == r.version
            && p.incident_kind == r.incident_kind && p.cover_kind == r.cover_kind
            && p.ceiling_cents == r.ceiling_cents && p.decided_by == r.approver
            && p.rule == approval_scope(kind, cover, r.zone_id, r.requires_corroborated, r.ceiling_cents)
    })
}

fn current_limit(ctx: &ReducerContext, cover: CoverKind) -> u64 {
    super::documents::current_policy(ctx).and_then(|pol| policy_rule(ctx, pol.id, cover)).filter(|r| r.active).map(|r| r.per_claim_limit_cents).unwrap_or(0)
}

/// Approval and review both recheck stored evidence, not just the worker's earlier payload.
fn validate_precedents(ctx: &ReducerContext, p: &RuleProposal, limit: u64) -> Result<(), String> {
    let offered: Vec<_> = ctx.db.organizer_precedent().iter()
        .filter(|a| a.decision == "approve" && a.complications.is_empty()
            && a.incident_kind == p.incident_kind && a.cover_kind == p.cover_kind)
        .map(|a| (a.claim_id, a.payout_cents)).collect();
    check_proposal(&ProposedRule {
        propose: true, precedent_claim_ids: p.claim_ids.clone(), ceiling_cents: p.ceiling_cents,
        rule: String::new(), summary: p.summary.clone(),
    }, &offered, limit).map_err(|e| format!("the proposal needs review: {}", e.join("; ")))
}

/// Quarantine legacy authority and offer the code-enforced scope for a fresh human decision.
/// Run once after publishing; safe to repeat. Historical approval wording stays unchanged.
#[spacetimedb::reducer]
pub fn review_rule_scopes(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops", "worker"])?;
    for r in ctx.db.settlement_rule().iter().filter(|r| r.status == "active").collect::<Vec<_>>() {
        if rule_scope_approved(ctx, &r) { continue; }
        ctx.db.settlement_rule().id().update(SettlementRuleRow { status: "review_required".into(), ..r.clone() });
        let old = ctx.db.rule_proposal().id().find(r.proposal_id);
        let (incident, claim) = old.as_ref().map(|p| anchor(ctx, p)).unwrap_or((0, 0));
        crate::live::record(ctx, incident, claim, "Decision Engine", "code",
            format!("Rule v{} needs scope review", r.version),
            "Future automatic decisions withheld: the earlier approval does not confirm the code-enforced scope. New and waiting claims require individual review until a new scope is approved.".into());
        // RuleProposal has no zone field. Never broaden a zone-specific legacy rule during review.
        if r.zone_id == 0 && r.requires_corroborated {
            if let Some(p) = old.filter(|p| p.status == "approved" && p.settlement_rule_id == r.id
                && p.incident_kind == r.incident_kind && p.cover_kind == r.cover_kind && p.ceiling_cents == r.ceiling_cents) {
                offer_scope_review(ctx, &p);
            }
        }
    }
    for p in ctx.db.rule_proposal().iter().filter(|p| p.status == "proposed").collect::<Vec<_>>() {
        let (Some(kind), Some(cover)) = (IncidentKind::parse(&p.incident_kind), CoverKind::parse(&p.cover_kind)) else { continue };
        if p.rule == approval_scope(kind, cover, 0, true, p.ceiling_cents) { continue; }
        ctx.db.rule_proposal().id().update(RuleProposal { status: "scope_review".into(), ..p.clone() });
        offer_scope_review(ctx, &p);
    }
    Ok(())
}

fn offer_scope_review(ctx: &ReducerContext, old: &RuleProposal) {
    let (Some(kind), Some(cover)) = (IncidentKind::parse(&old.incident_kind), CoverKind::parse(&old.cover_kind)) else { return };
    let limit = current_limit(ctx, cover);
    if validate_precedents(ctx, old, limit).is_err() { return; }
    let scope = approval_scope(kind, cover, 0, true, old.ceiling_cents);
    if ctx.db.rule_proposal().iter().any(|p| OPEN.contains(&p.status.as_str())
        && p.incident_kind == old.incident_kind && p.cover_kind == old.cover_kind && p.rule == scope) { return; }
    ctx.db.rule_proposal().insert(RuleProposal {
        id: 0, status: "proposed".into(), rule: scope, limit_cents: limit,
        summary: format!("Scope review of proposal #{}. Earlier wording: {} Rationale only: {}", old.id, old.rule, old.summary),
        decided_by: Identity::ZERO, decided_by_name: String::new(), reason: String::new(),
        settlement_rule_id: 0, rule_version: 0, created_at: ctx.timestamp, decided_at: None,
        ..old.clone()
    });
}

/// The organizer rejects the Decision Engine's proposal. Its precedents stay cited, so the next three approvals of the
/// shape can start a new one.
#[spacetimedb::reducer]
pub fn reject_rule_proposal(ctx: &ReducerContext, proposal_id: u64, reason: String) -> Result<(), String> {
    require_role(ctx, CLAIM_ROLES)?;
    let p = ctx.db.rule_proposal().id().find(proposal_id).ok_or_else(|| format!("no proposal {proposal_id}"))?;
    if p.status != "proposed" {
        return Err(format!("proposal {proposal_id} is {}, not waiting for the organizer", p.status));
    }
    if reason.trim().is_empty() {
        return Err("a rejection needs a reason".into());
    }
    let name = organizer_name(ctx);
    let (incident_id, claim_id) = anchor(ctx, &p);
    ctx.db.rule_proposal().id().update(RuleProposal {
        status: "rejected".into(),
        decided_by: ctx.sender(),
        decided_by_name: name.clone(),
        reason: reason.trim().into(),
        decided_at: Some(ctx.timestamp),
        ..p
    });
    crate::live::record(ctx, incident_id, claim_id, "organizer", &name, "Rejected the proposed rule".into(), reason.trim().into());
    Ok(())
}

/// Claims of the shape waiting for the organizer that the Decision Engine decided to pay: each one the new rule covers
/// (no complication, no mass occurrence, every check passed, corroborated, at or under the ceiling) is
/// paid on the Decision Engine's decision inside the rule, with nobody involved.
fn pay_waiting(ctx: &ReducerContext, kind: IncidentKind, cover: CoverKind) {
    let rules = core_rules(ctx);
    let waiting: Vec<Claim> = ctx
        .db
        .claim()
        .iter()
        .filter(|c| c.status == ClaimStatus::Routed && c.review_verdict == "pay" && kind_of(c) == kind && cover_of(c) == cover)
        .collect();
    for claim in waiting {
        if !claim_complications(ctx, &claim).is_empty() || mass_occurrence(ctx, &claim).is_some() {
            continue;
        }
        let checks = pack_checks(ctx, claim.id, claim.pack_version);
        let decision = decide(&DecisionInput {
            has_cover: has_cover(ctx, &claim),
            corroboration: corroboration_of(&claim),
            amounts: amounts(&claim),
            minimum_payout_cents: super::documents::minimum_payout(ctx, claim.policy_id, cover),
            checks: &checks,
            review: ReviewGate::Consistent,
            review_required: settings(ctx).review_required,
            rule: matching_rule(&rules, kind, cover, claim.zone_id),
        });
        if matches!(decision, Decision::AutoSettle { .. }) {
            let _ = apply(ctx, claim, decision, "claude");
        }
    }
}

/// A fresh live run: the precedents go with the decision history, and open proposals are retired with the rules.
pub fn start_fresh(ctx: &ReducerContext) {
    for p in ctx.db.rule_proposal().iter().filter(|p| OPEN.contains(&p.status.as_str())).collect::<Vec<_>>() {
        ctx.db.rule_proposal().id().update(RuleProposal { status: "retired".into(), decided_at: Some(ctx.timestamp), ..p });
    }
    for p in ctx.db.organizer_precedent().iter().collect::<Vec<_>>() {
        ctx.db.organizer_precedent().id().delete(p.id);
    }
}

/// A proposal job that ran out of attempts: no rule is proposed and its precedents are free again.
pub fn on_job_dead(ctx: &ReducerContext, dead: &Job) {
    if dead.kind != KIND_RULE_PROPOSAL {
        return;
    }
    let Some(p) = ctx.db.rule_proposal().id().find(dead.subject_id).filter(|p| p.status == "proposing") else {
        return;
    };
    release(ctx, p.id, &[]);
    let (incident_id, claim_id) = anchor(ctx, &p);
    ctx.db.rule_proposal().id().update(RuleProposal { status: "failed".into(), summary: dead.error.clone(), decided_at: Some(ctx.timestamp), ..p });
    crate::live::record(ctx, incident_id, claim_id, "Decision Engine", "code", "No rule was proposed".into(), format!("The rule proposer was unavailable: {}", dead.error));
}
