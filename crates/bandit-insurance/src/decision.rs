//! The Decision Engine's decision. Claude investigates a claim one evidence
//! source at a time (the bands, the light circle, the security cameras, the
//! staff notes, the hospital report, the person security named, the checks,
//! and the clauses of the venue's and the attendee's policies that the
//! Evidence Engine finds) and decides: pay, refuse, or ask the organizer. When
//! security named someone it also recommends a charge or none; code sets the
//! amount and the organizer approves or waives every charge. Code then checks
//! the answer and holds the decision to the limits a person set:
//!
//! - Claude never sets an amount. The fee schedule and the policy limits did.
//! - A claim with a complication, a gap or mismatch in the policies (no cover
//!   for the incident, a bill over the policy's limit), always goes to the
//!   organizer, who decides it one by one (`complications`).
//! - Claude pays only claims whose checks all passed, whose evidence is
//!   corroborated, and that fall inside the authority an organizer's approval
//!   gave the Decision Engine (a learned rule and its ceiling). Any other pay
//!   decision goes to the organizer as Claude's recommendation.
//! - Claude refuses on its own only when the refusal rests on a check that
//!   failed. A refusal on judgment alone goes to the organizer, because a
//!   wrong refusal hurts an injured attendee more than a wrong small payment
//!   hurts the venue.
//! - Claude pays only after it has read what decides its kind of claim:
//!   the band, the light circle and the hospital report for an injury; the
//!   security cameras for broken venue equipment; the cameras and the
//!   attendee's own policy for a theft or a breakage of their belonging.
//! - Every clause Claude cites is one the Evidence Engine found for this
//!   claim or one Claude found itself with its policy tools.

use crate::complications::{ClaimState, complications, reason};
use crate::coverage::Amounts;
use crate::letters::unknown_figures;
use crate::money::format_cents;
use crate::outcome::{Decision, failed_check_names};
use crate::payloads::ReviewPayload;
use crate::rules::SettlementRule;
use crate::{Causation, Cents, Check, CheckResult, Corroboration, IncidentKind};
use serde::{Deserialize, Serialize};

/// What Claude decides.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    Pay,
    Refuse,
    AskOrganizer,
}

impl Choice {
    pub fn as_str(self) -> &'static str {
        match self {
            Choice::Pay => "pay",
            Choice::Refuse => "refuse",
            Choice::AskOrganizer => "ask_organizer",
        }
    }
}

/// An evidence source Claude can read during an investigation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceSource {
    /// The subject band's own reports and where it had been.
    Band,
    /// The bands that lit up around the person.
    LightCircle,
    /// The security cameras' sightings.
    Camera,
    /// The medic's notes.
    Medic,
    /// The hospital report and its itemized bill.
    HospitalReport,
    /// The zone the incident happened in.
    Zone,
    /// The policy's cover.
    Policy,
    /// The code and Evidence Engine checks.
    Checks,
    /// The clauses of the venue's and the attendee's policies, from the Evidence Engine.
    PolicyClauses,
    /// The person security named as having broken or taken it, and code's checks of their band.
    Responsible,
}

impl EvidenceSource {
    pub const ALL: [EvidenceSource; 10] = [
        EvidenceSource::Band,
        EvidenceSource::LightCircle,
        EvidenceSource::Camera,
        EvidenceSource::Medic,
        EvidenceSource::HospitalReport,
        EvidenceSource::Zone,
        EvidenceSource::Policy,
        EvidenceSource::Checks,
        EvidenceSource::PolicyClauses,
        EvidenceSource::Responsible,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            EvidenceSource::Band => "band",
            EvidenceSource::LightCircle => "light_circle",
            EvidenceSource::Camera => "camera",
            EvidenceSource::Medic => "medic",
            EvidenceSource::HospitalReport => "hospital_report",
            EvidenceSource::Zone => "zone",
            EvidenceSource::Policy => "policy",
            EvidenceSource::Checks => "checks",
            EvidenceSource::PolicyClauses => "policy_clauses",
            EvidenceSource::Responsible => "responsible",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|v| v.as_str() == s)
    }

    /// How the decision history names it.
    pub fn label(self) -> &'static str {
        match self {
            EvidenceSource::Band => "the band",
            EvidenceSource::LightCircle => "the light circle",
            EvidenceSource::Camera => "the security cameras",
            EvidenceSource::Medic => "the medic's notes",
            EvidenceSource::HospitalReport => "the hospital report",
            EvidenceSource::Zone => "the zone",
            EvidenceSource::Policy => "the policy",
            EvidenceSource::Checks => "the checks",
            EvidenceSource::PolicyClauses => "the policy clauses",
            EvidenceSource::Responsible => "the attendee named",
        }
    }
}

/// How one source bears on the claim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stance {
    Supports,
    Contradicts,
    Neutral,
    Missing,
}

impl Stance {
    pub fn as_str(self) -> &'static str {
        match self {
            Stance::Supports => "supports",
            Stance::Contradicts => "contradicts",
            Stance::Neutral => "neutral",
            Stance::Missing => "missing",
        }
    }
}

/// What one evidence source showed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    pub source: EvidenceSource,
    pub stance: Stance,
    pub detail: String,
    pub fact_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Concern {
    /// `causation`, `timing`, `location`, `identity`, `amount`, `duplicate` or `other`.
    pub kind: String,
    pub detail: String,
    pub fact_ids: Vec<u32>,
}

/// Claude's decision. `schemas::agent_decision_schema` mirrors it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentDecision {
    pub decision: Choice,
    pub causation: Causation,
    /// Two to four sentences for the organizer.
    pub summary: String,
    /// One per source examined.
    pub findings: Vec<Finding>,
    /// When sources disagree: the one Claude trusts and why. Empty when none disagree.
    pub trusted_source: String,
    pub concerns: Vec<Concern>,
    /// Benign readings of anything that looks off, for example a late note.
    pub innocent_explanations: Vec<String>,
    /// Evidence a person could fetch to settle a concern.
    pub missing_evidence: Vec<String>,
    /// For a refusal: the failed checks it rests on, by name.
    pub refusal_checks: Vec<String>,
    /// For `ask_organizer`: the one question the organizer should answer.
    pub question: String,
    /// Facts the decision rests on, by `seq`.
    pub cited_fact_ids: Vec<u32>,
    /// Policy clauses the decision rests on, by `clause_id`: the clause that
    /// covers the claim for a pay, the exclusion for a refusal.
    #[serde(default)]
    pub cited_clause_ids: Vec<String>,
    /// Required when security named someone and staff proposed a charge
    /// (`ReviewPayload.charge`), absent (`null`) otherwise. Claude only
    /// recommends: code sets the amount and the organizer decides.
    #[serde(default)]
    pub charge: Option<ChargeRecommendation>,
}

/// Claude's recommendation on the charge staff proposed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChargeRecommendation {
    /// True to recommend charging the person named, false for no charge.
    pub recommend: bool,
    /// Why, in at most 400 characters, for the organizer and the charged person.
    pub reason: String,
    /// Facts it rests on, by `seq`; at least one when it recommends a charge.
    #[serde(default)]
    pub fact_ids: Vec<u32>,
    /// Clauses it rests on, such as the subrogation clause of the policy that paid.
    #[serde(default)]
    pub clause_ids: Vec<String>,
}

impl Finding {
    /// The decision history's headline, for example "The light circle supports the claim".
    pub fn headline(&self) -> String {
        let label = self.source.label();
        let mut chars = label.chars();
        let label: String = chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default();
        let plural = matches!(self.source, EvidenceSource::Camera | EvidenceSource::Medic | EvidenceSource::Checks | EvidenceSource::PolicyClauses);
        let says = match (self.stance, plural) {
            (Stance::Supports, false) => "supports the claim",
            (Stance::Supports, true) => "support the claim",
            (Stance::Contradicts, false) => "contradicts the claim",
            (Stance::Contradicts, true) => "contradict the claim",
            (Stance::Neutral, false) => "says nothing either way",
            (Stance::Neutral, true) => "say nothing either way",
            (Stance::Missing, false) => "is missing",
            (Stance::Missing, true) => "are missing",
        };
        format!("{label} {says}")
    }
}

/// One step of an investigation, as the decision history shows it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Step {
    /// `Claude`, `Evidence Engine` or `Decision Engine`.
    pub actor: String,
    /// The tool, `decide` or `guardrail`.
    pub action: String,
    /// A short headline.
    pub summary: String,
    /// Claude's reason for the step, or what came back.
    pub detail: String,
    pub fact_ids: Vec<u32>,
}

/// What the worker sends back for a claim: the decision and every step that led to it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Investigation {
    /// Claude's last answer as JSON; code parses and validates it.
    pub decision: serde_json::Value,
    pub steps: Vec<Step>,
    /// The sources Claude read with the evidence tools.
    pub sources_read: Vec<EvidenceSource>,
    /// The clause ids Claude saw with `search_policy` and `read_clause`, each a
    /// clause of a policy on this claim; it may cite these and `ReviewPayload.clauses`.
    pub clauses_seen: Vec<String>,
}

/// What Claude must have read before it may pay this claim:
/// - an injury (`sos`, `fall`): the band and the light circle, and the
///   hospital report once one is filed;
/// - the venue's broken equipment (`property`): the security cameras;
/// - an attendee's belonging stolen or broken (`theft`, `breakage`): the
///   security cameras and the policy, which is the attendee's own;
/// - and, whenever security named someone (`p.charge`), the attendee named.
///
/// A kind code does not know is read by its cover, as an injury unless the
/// cover pays for property.
pub fn required_reading(p: &ReviewPayload) -> Vec<EvidenceSource> {
    let kind = IncidentKind::parse(&p.incident_kind);
    let mut v = match kind {
        Some(IncidentKind::Property) => vec![EvidenceSource::Camera],
        Some(IncidentKind::Theft | IncidentKind::Breakage) => vec![EvidenceSource::Camera, EvidenceSource::Policy],
        Some(IncidentKind::Sos | IncidentKind::Fall) => injury_reading(p),
        None if p.cover_kind == "property" => vec![EvidenceSource::Camera],
        None if p.cover_kind == "personal_property" => vec![EvidenceSource::Camera, EvidenceSource::Policy],
        None => injury_reading(p),
    };
    if p.charge.is_some() {
        v.push(EvidenceSource::Responsible);
    }
    v
}

fn injury_reading(p: &ReviewPayload) -> Vec<EvidenceSource> {
    let mut v = vec![EvidenceSource::Band, EvidenceSource::LightCircle];
    if !p.lines.is_empty() {
        v.push(EvidenceSource::HospitalReport);
    }
    v
}

/// The figures a decision may print: the four amounts, every line's billed,
/// allowed and covered cents, and what code would charge the person named.
pub fn allowed_amounts(p: &ReviewPayload) -> Vec<Cents> {
    let mut allowed = p.amounts.figures().to_vec();
    allowed.extend(p.lines.iter().flat_map(|l| [l.billed_cents, l.allowed_cents, l.covered_cents]));
    allowed.extend(p.charge.as_ref().map(|c| c.amount_cents));
    allowed
}

/// Every check of [`validate_decision`], with the payload's facts, checks,
/// figures ([`allowed_amounts`]) and reading ([`required_reading`]), plus the
/// clauses and the charge:
/// - every cited clause, at the top level and in the charge, is one the
///   Evidence Engine found for this pack version (`p.clauses`) or one Claude
///   saw with its policy tools (`clauses_seen`);
/// - a charge recommendation exactly when security named someone
///   (`p.charge`), made after reading the attendee named.
///
/// The worker and the module both call this on the same inputs.
pub fn validate_review(d: &AgentDecision, p: &ReviewPayload, read: &[EvidenceSource], clauses_seen: &[String]) -> Result<(), Vec<String>> {
    let seqs: Vec<u32> = p.facts.iter().map(|f| f.seq).collect();
    let must_read = required_reading(p);
    let mut errors = validate_decision(d, &seqs, &p.checks, &allowed_amounts(p), read, &must_read).err().unwrap_or_default();

    let known = |id: &str| p.clauses.iter().any(|c| c.clause_id == id) || clauses_seen.iter().any(|c| c == id);
    let mut unknown: Vec<&str> = Vec::new();
    for id in d.cited_clause_ids.iter().chain(d.charge.iter().flat_map(|c| &c.clause_ids)) {
        if !known(id) && !unknown.contains(&id.as_str()) {
            unknown.push(id);
        }
    }
    errors.extend(unknown.iter().map(|id| format!("cited clause {id} is not one the Evidence Engine found for this claim (search_policy or read_clause)")));

    match (&d.charge, &p.charge) {
        (None, Some(_)) => errors.push("security named someone, so charge needs your recommendation: recommend true or false, with the reason".into()),
        (Some(_), None) => errors.push("charge must be null: no one was named for this incident".into()),
        (Some(_), Some(_)) if !read.contains(&EvidenceSource::Responsible) && d.decision != Choice::Pay => {
            errors.push("a charge recommendation without reading the attendee named (call read_evidence with source responsible)".into());
        }
        _ => {}
    }
    if errors.is_empty() { Ok(()) } else { Err(errors) }
}

/// Code validation of a decision (see [`validate_review`] for the clauses
/// and whether a charge recommendation belongs):
/// - every cited id (top level, concerns, findings, the charge) is one of `fact_seqs`;
/// - lengths: summary 1 to 800 characters, each concern and finding detail at
///   most 400, the question and the trusted source at most 400, the charge
///   reason 1 to 400; at most 6 concerns, explanations and missing-evidence
///   items; 1 to 10 findings;
/// - a recommended charge cites at least one fact;
/// - every dollar figure in the text is one of `allowed_amounts`;
/// - `pay`: causation supported, no concerns, no refusal checks, no finding
///   that contradicts the claim unless `trusted_source` says why, and every
///   source in `must_read` was read;
/// - `refuse`: every refusal check is a check that failed, and the refusal
///   names at least one failed check or a contradicting finding with facts;
/// - `ask_organizer`: a question.
pub fn validate_decision(
    d: &AgentDecision,
    fact_seqs: &[u32],
    checks: &[Check],
    allowed_amounts: &[Cents],
    read: &[EvidenceSource],
    must_read: &[EvidenceSource],
) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    let mut unknown: Vec<u32> = Vec::new();
    let cited = d
        .cited_fact_ids
        .iter()
        .chain(d.concerns.iter().flat_map(|c| &c.fact_ids))
        .chain(d.findings.iter().flat_map(|f| &f.fact_ids))
        .chain(d.charge.iter().flat_map(|c| &c.fact_ids));
    for id in cited {
        if !fact_seqs.contains(id) && !unknown.contains(id) {
            unknown.push(*id);
        }
    }
    errors.extend(unknown.iter().map(|id| format!("cited fact {id} is not in the pack")));

    let n = d.summary.trim().chars().count();
    if !(1..=800).contains(&n) {
        errors.push(format!("summary is {n} characters, expected 1 to 800"));
    }
    for (i, c) in d.concerns.iter().enumerate() {
        let n = c.detail.chars().count();
        if n > 400 {
            errors.push(format!("concern {} detail is {n} characters, at most 400", i + 1));
        }
    }
    for (i, f) in d.findings.iter().enumerate() {
        let n = f.detail.chars().count();
        if n > 400 {
            errors.push(format!("finding {} detail is {n} characters, at most 400", i + 1));
        }
    }
    for (what, text) in [("question", &d.question), ("trusted_source", &d.trusted_source)] {
        let n = text.chars().count();
        if n > 400 {
            errors.push(format!("{what} is {n} characters, at most 400"));
        }
    }
    for (what, len) in [
        ("concerns", d.concerns.len()),
        ("innocent explanations", d.innocent_explanations.len()),
        ("missing evidence items", d.missing_evidence.len()),
    ] {
        if len > 6 {
            errors.push(format!("{len} {what}, at most 6"));
        }
    }
    if !(1..=10).contains(&d.findings.len()) {
        errors.push(format!("{} findings, expected 1 to 10 (one per source examined)", d.findings.len()));
    }
    if let Some(c) = &d.charge {
        let n = c.reason.trim().chars().count();
        if !(1..=400).contains(&n) {
            errors.push(format!("charge reason is {n} characters, expected 1 to 400"));
        }
        if c.recommend && c.fact_ids.is_empty() {
            errors.push("a recommended charge needs the facts it rests on in charge.fact_ids".into());
        }
    }

    let texts = std::iter::once(("summary".to_string(), &d.summary))
        .chain(d.concerns.iter().enumerate().map(|(i, c)| (format!("concern {}", i + 1), &c.detail)))
        .chain(d.findings.iter().enumerate().map(|(i, f)| (format!("finding {}", i + 1), &f.detail)))
        .chain([("question".to_string(), &d.question), ("trusted_source".to_string(), &d.trusted_source)])
        .chain(d.charge.iter().map(|c| ("charge reason".to_string(), &c.reason)));
    for (what, text) in texts {
        for f in unknown_figures(text, allowed_amounts) {
            errors.push(format!("{what} figure {f} is not one of the claim's amounts"));
        }
    }

    let failed = failed_check_names(checks);
    let contradicts = d.findings.iter().any(|f| f.stance == Stance::Contradicts);
    match d.decision {
        Choice::Pay => {
            if d.causation != Causation::Supported {
                errors.push(format!("pay with causation {}", d.causation.as_str()));
            }
            if !d.concerns.is_empty() {
                errors.push(format!("pay with {} concerns", d.concerns.len()));
            }
            if !d.refusal_checks.is_empty() {
                errors.push("pay with refusal checks".into());
            }
            if contradicts && d.trusted_source.trim().is_empty() {
                errors.push("pay while a finding contradicts the claim, and trusted_source does not say which source you trust".into());
            }
            for s in must_read {
                if !read.contains(s) {
                    errors.push(format!("pay without reading {} (call read_evidence with source {})", s.label(), s.as_str()));
                }
            }
        }
        Choice::Refuse => {
            for name in &d.refusal_checks {
                if !failed.contains(name) {
                    errors.push(format!("refusal check {name} is not a failed check"));
                }
            }
            let grounded = d.findings.iter().any(|f| f.stance == Stance::Contradicts && !f.fact_ids.is_empty());
            if d.refusal_checks.is_empty() && !grounded {
                errors.push("a refusal needs a failed check in refusal_checks or a contradicting finding that cites facts".into());
            }
        }
        Choice::AskOrganizer => {
            if d.question.trim().is_empty() {
                errors.push("ask_organizer needs a question".into());
            }
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(errors) }
}

/// What code knows when it holds Claude's decision to its limits.
#[derive(Clone, Debug)]
pub struct GuardInput<'a> {
    /// An active coverage rule applies to the incident kind.
    pub has_cover: bool,
    pub corroboration: Corroboration,
    pub amounts: Amounts,
    /// The cover's minimum payout from the confirmed policy terms.
    pub minimum_payout_cents: Cents,
    /// Code and Evidence Engine checks of the current pack version.
    pub checks: &'a [Check],
    /// The authority an organizer's approval gave for this shape of claim.
    pub rule: Option<&'a SettlementRule>,
    /// Set when several people were hurt in one occurrence: why the organizer decides every claim of it.
    pub mass_occurrence: Option<String>,
}

/// The outcome and the guardrail that produced it, for the decision history.
#[derive(Clone, Debug, PartialEq)]
pub struct Guarded {
    pub decision: Decision,
    /// `claude` (Claude paid inside a learned rule, or refused on a failed check) or `code`.
    pub decided_by: &'static str,
    /// The limit that applied, in a sentence.
    pub guardrail: String,
}

fn concerns_text(d: &AgentDecision) -> String {
    let parts: Vec<String> = d.concerns.iter().map(|c| format!("{}: {}", c.kind, c.detail)).collect();
    if parts.is_empty() { d.summary.clone() } else { parts.join("; ") }
}

/// Holds a valid decision to the limits, first match wins:
/// 1. a complication (a gap or mismatch in the policies): to the organizer,
///    whatever Claude decided, with every complication listed;
/// 2. `refuse` resting on failed checks: refused by Claude; any other refusal goes to the organizer;
/// 3. `ask_organizer`: to the organizer with Claude's question;
/// 4. `pay` goes through only with every check passed, a payout above zero,
///    corroborated evidence, no mass occurrence, a learned rule, and a payout
///    within its ceiling; otherwise it goes to the organizer (or, at zero with
///    every check passed, is refused).
pub fn guard(d: &AgentDecision, input: &GuardInput) -> Guarded {
    let refuse = |reason: String, by: &'static str, guardrail: &str| Guarded { decision: Decision::Refuse { reason }, decided_by: by, guardrail: guardrail.into() };
    let route = |reason: String, guardrail: String| Guarded { decision: Decision::Route { reason }, decided_by: "code", guardrail };
    let payout = format_cents(input.amounts.payout_cents);

    let found = complications(&ClaimState { has_cover: input.has_cover, amounts: input.amounts });
    if !found.is_empty() {
        let head = match d.decision {
            Choice::Pay => format!("Claude would pay {payout}"),
            Choice::Refuse => format!("Claude recommends refusing: {}", concerns_text(d).trim_end_matches('.')),
            Choice::AskOrganizer => format!("Claude asks: {}", d.question.trim()),
        };
        return route(reason(&head, &found), "a gap or mismatch in the policies is decided one by one".into());
    }
    match d.decision {
        Choice::Refuse if !d.refusal_checks.is_empty() => refuse(
            format!("Claude refused: failed {}: {}", d.refusal_checks.join(", "), concerns_text(d)),
            "claude",
            "a refusal that rests on failed checks goes through on its own",
        ),
        Choice::Refuse => route(
            format!("Claude recommends refusing: {}. Every check passed, so a person decides", concerns_text(d).trim_end_matches('.')),
            "every check passed, so a refusal on Claude's judgment alone needs a person".into(),
        ),
        Choice::AskOrganizer => route(format!("Claude asks: {}", d.question.trim()), "Claude chose to ask a person".into()),
        Choice::Pay => {
            let failed = failed_check_names(input.checks);
            if !failed.is_empty() {
                return route(format!("Claude would pay {payout}, but checks failed: {}", failed.join(", ")), "Claude pays only when every check passed".into());
            }
            if input.amounts.payout_cents == 0 {
                return refuse("payout is zero after limits".into(), "code", "nothing is payable after the fee schedule and the limits");
            }
            if input.amounts.payout_cents < input.minimum_payout_cents {
                let minimum = format_cents(input.minimum_payout_cents);
                return route(
                    format!("Claude would pay {payout}, below the policy's minimum payout of {minimum}"),
                    format!("the policy pays on its own only from {minimum}"),
                );
            }
            if input.corroboration != Corroboration::Corroborated {
                return route(
                    format!("Claude would pay {payout}, but the evidence is {}", input.corroboration.as_str()),
                    "Claude pays only on corroborated evidence".into(),
                );
            }
            if let Some(reason) = &input.mass_occurrence {
                return route(reason.clone(), "in a mass occurrence the organizer decides every claim".into());
            }
            let Some(rule) = input.rule else {
                return route(
                    format!("Claude would pay {payout}; no approval has given it authority for this kind of claim yet"),
                    "Claude pays only inside the authority an organizer's approval gave".into(),
                );
            };
            if input.amounts.payout_cents > rule.ceiling_cents {
                return route(
                    format!("Claude would pay {payout}, above the {} authority of rule v{}", format_cents(rule.ceiling_cents), rule.version),
                    format!("rule v{} lets Claude pay up to {}", rule.version, format_cents(rule.ceiling_cents)),
                );
            }
            Guarded {
                decision: Decision::AutoSettle { rule_id: rule.rule_id, rule_version: rule.version },
                decided_by: "claude",
                guardrail: format!("{payout} is inside the {} authority of rule v{}", format_cents(rule.ceiling_cents), rule.version),
            }
        }
    }
}

/// The checks that failed, for the refusal check list.
pub fn failed_checks(checks: &[Check]) -> Vec<&Check> {
    checks.iter().filter(|c| c.result == CheckResult::Fail).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CoverKind, IncidentKind};

    const SEQS: [u32; 6] = [1, 2, 3, 4, 5, 6];
    const AMOUNTS: [Cents; 4] = [18_000, 18_000, 8_000, 10_000];
    const READ: [EvidenceSource; 3] = [EvidenceSource::Band, EvidenceSource::LightCircle, EvidenceSource::HospitalReport];
    const MUST: [EvidenceSource; 3] = READ;

    fn finding(source: EvidenceSource, stance: Stance, ids: &[u32]) -> Finding {
        Finding { source, stance, detail: format!("{} {}", source.label(), stance.as_str()), fact_ids: ids.to_vec() }
    }

    fn pay() -> AgentDecision {
        AgentDecision {
            decision: Choice::Pay,
            causation: Causation::Supported,
            summary: "Two witnesses in the main stage zone and a medic note within minutes back the fall. Covered cost is $180.00.".into(),
            findings: vec![
                finding(EvidenceSource::Band, Stance::Supports, &[1]),
                finding(EvidenceSource::LightCircle, Stance::Supports, &[2, 3]),
                finding(EvidenceSource::HospitalReport, Stance::Supports, &[5]),
            ],
            trusted_source: String::new(),
            concerns: vec![],
            innocent_explanations: vec![],
            missing_evidence: vec![],
            refusal_checks: vec![],
            question: String::new(),
            cited_fact_ids: vec![1, 2, 5],
            cited_clause_ids: vec![],
            charge: None,
        }
    }

    fn refuse_at_home() -> AgentDecision {
        AgentDecision {
            decision: Choice::Refuse,
            causation: Causation::Unsupported,
            summary: "The bands place a fall in the zone, but the hospital report says the ankle was hurt at home.".into(),
            findings: vec![finding(EvidenceSource::Band, Stance::Supports, &[1]), finding(EvidenceSource::HospitalReport, Stance::Contradicts, &[5])],
            trusted_source: "the hospital report, written by the clinic from the patient's own account".into(),
            concerns: vec![Concern { kind: "causation".into(), detail: "the report says the injury happened at home".into(), fact_ids: vec![5] }],
            innocent_explanations: vec![],
            missing_evidence: vec![],
            refusal_checks: vec![],
            question: String::new(),
            cited_fact_ids: vec![5],
            cited_clause_ids: vec![],
            charge: None,
        }
    }

    fn passing() -> Vec<Check> {
        vec![Check::pass("witness_zone", "2 of 2 witnesses in zone 101"), Check::pass("record_duplicate", "no other claim has this bill")]
    }

    fn failing() -> Vec<Check> {
        vec![Check::fail("witness_zone", "0 of 3 witnesses in zone 101"), Check::pass("record_duplicate", "no other claim has this bill")]
    }

    fn rule() -> SettlementRule {
        SettlementRule {
            rule_id: 7,
            incident_kind: IncidentKind::Fall,
            cover_kind: CoverKind::MedicalPayments,
            zone_id: 0,
            requires_corroborated: true,
            ceiling_cents: 25_000,
            version: 1,
            active: true,
        }
    }

    fn input<'a>(checks: &'a [Check], rule: Option<&'a SettlementRule>) -> GuardInput<'a> {
        GuardInput {
            has_cover: true,
            corroboration: Corroboration::Corroborated,
            amounts: Amounts { cost_cents: 18_000, payout_cents: 18_000, recoverable_cents: 18_000, venue_cost_cents: 0 },
            minimum_payout_cents: 0,
            checks,
            rule,
            mass_occurrence: None,
        }
    }

    #[test]
    fn a_grounded_pay_is_valid() {
        assert_eq!(validate_decision(&pay(), &SEQS, &passing(), &AMOUNTS, &READ, &MUST), Ok(()));
    }

    #[test]
    fn pay_needs_the_reading_done() {
        let errors = validate_decision(&pay(), &SEQS, &passing(), &AMOUNTS, &[EvidenceSource::Band], &MUST).unwrap_err();
        assert_eq!(
            errors,
            [
                "pay without reading the light circle (call read_evidence with source light_circle)",
                "pay without reading the hospital report (call read_evidence with source hospital_report)"
            ]
        );
    }

    #[test]
    fn pay_over_a_contradiction_must_say_whom_it_trusts() {
        let mut d = pay();
        d.findings.push(finding(EvidenceSource::Camera, Stance::Contradicts, &[4]));
        assert!(validate_decision(&d, &SEQS, &passing(), &AMOUNTS, &READ, &[]).unwrap_err()[0].starts_with("pay while a finding contradicts"));
        d.trusted_source = "the light circle: two bands next to the person, while the camera saw only the edge of the zone".into();
        assert_eq!(validate_decision(&d, &SEQS, &passing(), &AMOUNTS, &READ, &[]), Ok(()));
    }

    #[test]
    fn rejects_invented_facts_figures_and_checks() {
        let mut d = refuse_at_home();
        d.findings[1].fact_ids.push(99);
        d.summary.push_str(" The bill was $1,240.00.");
        d.refusal_checks = vec!["witness_zone".into()];
        assert_eq!(
            validate_decision(&d, &SEQS, &passing(), &AMOUNTS, &READ, &[]).unwrap_err(),
            [
                "cited fact 99 is not in the pack",
                "summary figure $1,240.00 is not one of the claim's amounts",
                "refusal check witness_zone is not a failed check"
            ]
        );
    }

    #[test]
    fn a_refusal_must_be_grounded() {
        let mut d = refuse_at_home();
        d.findings[1].fact_ids.clear();
        assert_eq!(
            validate_decision(&d, &SEQS, &passing(), &AMOUNTS, &READ, &[]).unwrap_err(),
            ["a refusal needs a failed check in refusal_checks or a contradicting finding that cites facts"]
        );
        let mut d = AgentDecision { decision: Choice::AskOrganizer, ..pay() };
        assert_eq!(validate_decision(&d, &SEQS, &passing(), &AMOUNTS, &READ, &[]).unwrap_err(), ["ask_organizer needs a question"]);
        d.question = "Was the attendee at the event when the clinic says the ankle was hurt?".into();
        assert_eq!(validate_decision(&d, &SEQS, &passing(), &AMOUNTS, &READ, &[]), Ok(()));
    }

    #[test]
    fn claude_pays_inside_its_authority() {
        let (checks, rule) = (passing(), rule());
        let g = guard(&pay(), &input(&checks, Some(&rule)));
        assert_eq!(g.decision, Decision::AutoSettle { rule_id: 7, rule_version: 1 });
        assert_eq!(g.decided_by, "claude");
        assert_eq!(g.guardrail, "$180.00 is inside the $250.00 authority of rule v1");
    }

    #[test]
    fn a_pay_outside_the_limits_goes_to_the_organizer() {
        let (checks, rule) = (passing(), rule());
        let route = |g: Guarded| match g.decision {
            Decision::Route { reason } => reason,
            other => panic!("{other:?}"),
        };
        assert_eq!(route(guard(&pay(), &input(&checks, None))), "Claude would pay $180.00; no approval has given it authority for this kind of claim yet");
        let small = SettlementRule { ceiling_cents: 10_000, ..rule.clone() };
        assert_eq!(route(guard(&pay(), &input(&checks, Some(&small)))), "Claude would pay $180.00, above the $100.00 authority of rule v1");
        let bad = failing();
        assert_eq!(route(guard(&pay(), &input(&bad, Some(&rule)))), "Claude would pay $180.00, but checks failed: witness_zone");
        let thin = GuardInput { corroboration: Corroboration::Uncorroborated, ..input(&checks, Some(&rule)) };
        assert_eq!(route(guard(&pay(), &thin)), "Claude would pay $180.00, but the evidence is uncorroborated");
        let mass = GuardInput { mass_occurrence: Some("3 people hurt in Main stage within 5 minutes".into()), ..input(&checks, Some(&rule)) };
        assert_eq!(route(guard(&pay(), &mass)), "3 people hurt in Main stage within 5 minutes");
    }

    #[test]
    fn claude_refuses_on_a_failed_check_and_asks_a_person_otherwise() {
        let (bad, good, rule) = (failing(), passing(), rule());
        let mut fake = refuse_at_home();
        fake.refusal_checks = vec!["witness_zone".into()];
        fake.concerns = vec![Concern { kind: "location".into(), detail: "every witness band was in the sponsor hall".into(), fact_ids: vec![2] }];
        let g = guard(&fake, &input(&bad, Some(&rule)));
        assert_eq!(g.decision, Decision::Refuse { reason: "Claude refused: failed witness_zone: location: every witness band was in the sponsor hall".into() });
        assert_eq!(g.decided_by, "claude");

        let g = guard(&refuse_at_home(), &input(&good, Some(&rule)));
        assert_eq!(g.decision, Decision::Route { reason: "Claude recommends refusing: causation: the report says the injury happened at home. Every check passed, so a person decides".into() });
        assert_eq!(g.decided_by, "code");

        let ask = AgentDecision { decision: Choice::AskOrganizer, question: " Was the attendee at the event? ".into(), ..pay() };
        assert_eq!(guard(&ask, &input(&good, Some(&rule))).decision, Decision::Route { reason: "Claude asks: Was the attendee at the event?".into() });
    }

    #[test]
    fn no_cover_and_no_payout_refuse_in_code() {
        let (checks, rule) = (passing(), rule());
        let g = guard(&pay(), &GuardInput { has_cover: false, ..input(&checks, Some(&rule)) });
        let gap = "Complication: no cover in the venue's policy pays for this kind of incident. Claude would pay $180.00";
        assert_eq!((g.decision, g.decided_by), (Decision::Route { reason: gap.into() }, "code"));
        let zero = GuardInput { amounts: Amounts::default(), ..input(&checks, Some(&rule)) };
        assert_eq!(guard(&pay(), &zero).decision, Decision::Refuse { reason: "payout is zero after limits".into() });
    }

    /// A claim of `kind` with facts 1 to 6, the passing checks and the payout of [`input`].
    fn payload(kind: IncidentKind) -> ReviewPayload {
        let fact = |seq: u32| crate::Fact {
            seq,
            source: crate::Source::StaffNote,
            key: "note".into(),
            value: format!("fact {seq}"),
            observed_at: 0,
            reader: crate::Reader::Code,
            reference: format!("incident_note:{seq}"),
        };
        ReviewPayload {
            claim_id: 12,
            pack_version: 2,
            pack_hash: "ab".repeat(32),
            incident_kind: kind.as_str().into(),
            cover_kind: CoverKind::for_incident(kind).as_str().into(),
            zone_name: "Hacking floor".into(),
            incident_time: "2026-10-24 21:10:00".into(),
            claimant_name: "Maya Chen".into(),
            corroboration: "corroborated".into(),
            facts: SEQS.iter().map(|s| fact(*s)).collect(),
            checks: passing(),
            amounts: Amounts { cost_cents: 18_000, payout_cents: 18_000, recoverable_cents: 18_000, venue_cost_cents: 0 },
            lines: vec![],
            record_history: String::new(),
            record_reason: String::new(),
            clauses: vec![crate::payloads::ClauseRef {
                clause_id: "att-c2".into(),
                policy: "attendee".into(),
                section: "insuring_agreement".into(),
                page: 2,
                text: "We cover your personal property against theft.".into(),
                score: 0.8,
            }],
            policy_summary: "the attendee's own personal property cover".into(),
            claimant_statement: String::new(),
            charge: None,
            attendee_policy_hash: "att".into(),
            venue_policy_hash: String::new(),
        }
    }

    fn charge_brief() -> crate::payloads::ChargeBrief {
        crate::payloads::ChargeBrief {
            charge_id: 3,
            band_id: 41,
            attendee_name: "Sam Patel".into(),
            amount_cents: 119_900,
            named_by_role: "ops".into(),
            note: "seen at the table".into(),
            checks: vec![Check::pass("responsible_at_spot", "band 41 was 4 m away")],
        }
    }

    fn theft_pay() -> AgentDecision {
        AgentDecision {
            findings: vec![finding(EvidenceSource::Camera, Stance::Supports, &[4]), finding(EvidenceSource::Policy, Stance::Supports, &[6])],
            summary: "The camera saw the laptop taken from the table; the attendee's own policy covers theft.".into(),
            cited_fact_ids: vec![4, 6],
            cited_clause_ids: vec!["att-c2".into()],
            ..pay()
        }
    }

    #[test]
    fn each_kind_has_its_reading() {
        let mut fall = payload(IncidentKind::Fall);
        assert_eq!(required_reading(&fall), [EvidenceSource::Band, EvidenceSource::LightCircle]);
        fall.lines.push(crate::fee_schedule::LineDecision {
            line_no: 1,
            code: "99211".into(),
            description: "first-aid visit".into(),
            service_date: "2026-10-24".into(),
            units: 1,
            billed_cents: 18_000,
            allowed_cents: 6_500,
            covered_cents: 6_500,
            outcome: crate::fee_schedule::LineOutcome::Reduced,
            reason: String::new(),
            page: 2,
        });
        assert_eq!(required_reading(&fall), READ);
        assert_eq!(required_reading(&payload(IncidentKind::Property)), [EvidenceSource::Camera]);
        assert_eq!(required_reading(&payload(IncidentKind::Theft)), [EvidenceSource::Camera, EvidenceSource::Policy]);
        let mut broken = payload(IncidentKind::Breakage);
        broken.charge = Some(charge_brief());
        assert_eq!(required_reading(&broken), [EvidenceSource::Camera, EvidenceSource::Policy, EvidenceSource::Responsible]);
        let mut odd = payload(IncidentKind::Theft);
        odd.incident_kind = "slip".into();
        assert_eq!(required_reading(&odd), [EvidenceSource::Camera, EvidenceSource::Policy], "read by its cover");
    }

    #[test]
    fn cited_clauses_must_be_found_for_this_claim() {
        let p = payload(IncidentKind::Theft);
        let read = [EvidenceSource::Camera, EvidenceSource::Policy];
        assert_eq!(validate_review(&theft_pay(), &p, &read, &[]), Ok(()), "a clause the Evidence Engine found");
        let mut d = theft_pay();
        d.cited_clause_ids = vec!["att-c2".into(), "venue-c7".into(), "other-c1".into(), "other-c1".into()];
        assert_eq!(validate_review(&d, &p, &read, &["venue-c7".into()]).unwrap_err(), [
            "cited clause other-c1 is not one the Evidence Engine found for this claim (search_policy or read_clause)"
        ]);
        assert_eq!(validate_review(&theft_pay(), &p, &[EvidenceSource::Camera], &[]).unwrap_err(), [
            "pay without reading the policy (call read_evidence with source policy)"
        ]);
    }

    #[test]
    fn a_named_person_needs_a_charge_recommendation() {
        let mut p = payload(IncidentKind::Theft);
        p.charge = Some(charge_brief());
        let all = [EvidenceSource::Camera, EvidenceSource::Policy, EvidenceSource::Responsible];
        let errors = validate_review(&theft_pay(), &p, &all, &[]).unwrap_err();
        assert_eq!(errors, ["security named someone, so charge needs your recommendation: recommend true or false, with the reason"]);

        let mut d = theft_pay();
        d.charge = Some(ChargeRecommendation {
            recommend: true,
            reason: "The camera and the band put the person named at the table when the laptop went; charge $1,199.00.".into(),
            fact_ids: vec![4, 5],
            clause_ids: vec!["att-sub-c9".into()],
        });
        assert_eq!(validate_review(&d, &p, &all, &["att-sub-c9".into()]), Ok(()), "the charge's figure is what code would charge");
        let errors = validate_review(&d, &p, &[EvidenceSource::Camera, EvidenceSource::Policy], &[]).unwrap_err();
        assert_eq!(errors, [
            "pay without reading the attendee named (call read_evidence with source responsible)",
            "cited clause att-sub-c9 is not one the Evidence Engine found for this claim (search_policy or read_clause)",
        ]);

        let mut ask = AgentDecision { decision: Choice::AskOrganizer, question: "Was the laptop left unattended?".into(), ..d.clone() };
        ask.charge.as_mut().unwrap().fact_ids = vec![9];
        ask.charge.as_mut().unwrap().reason = format!("{} The bill was $2,000.00.", "x".repeat(380));
        let errors = validate_review(&ask, &p, &[EvidenceSource::Camera], &["att-sub-c9".into()]).unwrap_err();
        assert_eq!(errors, [
            "cited fact 9 is not in the pack",
            "charge reason is 404 characters, expected 1 to 400",
            "charge reason figure $2,000.00 is not one of the claim's amounts",
            "a charge recommendation without reading the attendee named (call read_evidence with source responsible)",
        ]);
        ask.charge = Some(ChargeRecommendation { recommend: true, reason: "the camera saw it".into(), fact_ids: vec![], clause_ids: vec![] });
        assert_eq!(validate_review(&ask, &p, &all, &[]).unwrap_err(), ["a recommended charge needs the facts it rests on in charge.fact_ids"]);
        ask.charge.as_mut().unwrap().recommend = false;
        assert_eq!(validate_review(&ask, &p, &all, &[]), Ok(()), "no charge needs no facts");

        p.charge = None;
        assert_eq!(validate_review(&ask, &p, &all, &[]).unwrap_err(), ["charge must be null: no one was named for this incident"]);
    }

    #[test]
    fn a_decision_without_the_new_fields_still_parses() {
        let mut v = serde_json::to_value(pay()).unwrap();
        let o = v.as_object_mut().unwrap();
        o.remove("cited_clause_ids");
        o.remove("charge");
        let d: AgentDecision = serde_json::from_value(v).unwrap();
        assert_eq!((d.cited_clause_ids.len(), d.charge), (0, None));
        let inv: Investigation = serde_json::from_value(serde_json::json!({ "decision": {}, "steps": [], "sources_read": ["policy_clauses", "responsible"] })).unwrap();
        assert_eq!((inv.sources_read, inv.clauses_seen.len()), (vec![EvidenceSource::PolicyClauses, EvidenceSource::Responsible], 0));
    }

    #[test]
    fn a_gap_in_the_policy_goes_to_the_organizer_whatever_claude_decided() {
        let rule = rule();
        let route = |g: Guarded| match g.decision {
            Decision::Route { reason } => reason,
            other => panic!("{other:?}"),
        };
        let (checks, capped) = (failing(), Amounts { cost_cents: 720_000, payout_cents: 500_000, recoverable_cents: 500_000, venue_cost_cents: 0 });
        let mut fake = refuse_at_home();
        fake.refusal_checks = vec!["witness_zone".into()];
        assert!(
            route(guard(&fake, &GuardInput { amounts: capped, ..input(&checks, Some(&rule)) }))
                .starts_with("Complication: the covered cost $7,200.00 is over the policy's limit, which pays at most $5,000.00. Claude recommends refusing")
        );
        let checks = passing();
        assert_eq!(
            route(guard(&pay(), &GuardInput { amounts: capped, ..input(&checks, Some(&rule)) })),
            "Complication: the covered cost $7,200.00 is over the policy's limit, which pays at most $5,000.00. Claude would pay $5,000.00"
        );
    }

    #[test]
    fn a_payout_below_the_policy_minimum_goes_to_a_person() {
        let (checks, rule) = (passing(), rule());
        let small = GuardInput { minimum_payout_cents: 25_000, ..input(&checks, Some(&rule)) };
        let g = guard(&pay(), &small);
        assert_eq!(g.decision, Decision::Route { reason: "Claude would pay $180.00, below the policy's minimum payout of $250.00".into() });
        let at = GuardInput { minimum_payout_cents: 18_000, ..input(&checks, Some(&rule)) };
        assert!(matches!(guard(&pay(), &at).decision, Decision::AutoSettle { .. }));
    }

    #[test]
    fn sources_round_trip() {
        for s in EvidenceSource::ALL {
            assert_eq!(EvidenceSource::parse(s.as_str()), Some(s));
            assert_eq!(serde_json::to_value(s).unwrap(), s.as_str());
        }
    }
}
