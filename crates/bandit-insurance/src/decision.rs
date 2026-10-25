//! The Decision Engine's decision. Claude investigates a claim one evidence
//! source at a time (the bands, the light circle, the security cameras, the
//! medic's notes, the hospital report, the checks and the Evidence Engine's
//! past claims) and decides: pay, refuse, or ask the organizer. Code then
//! checks the answer and holds the decision to the limits a person set:
//!
//! - Claude never sets an amount. The fee schedule and the policy limits did.
//! - A claim with a complication, a gap or mismatch in the policies (no cover
//!   for the incident, a bill over the policy's limit, a billed service the
//!   fee schedule does not list), always goes to the organizer, who decides
//!   it one by one (`complications`).
//! - Claude pays only claims whose checks all passed, whose evidence is
//!   corroborated, and that fall inside the authority an organizer's approval
//!   gave the Decision Engine (a learned rule and its ceiling). Any other pay
//!   decision goes to the organizer as Claude's recommendation.
//! - Claude refuses on its own only when the refusal rests on a check that
//!   failed. A refusal on judgment alone goes to the organizer, because a
//!   wrong refusal hurts an injured attendee more than a wrong small payment
//!   hurts the venue.
//! - Claude pays only after it has read the band evidence, the light circle
//!   and, for an injury, the hospital report itself.

use crate::complications::{ClaimState, complications, reason};
use crate::coverage::Amounts;
use crate::letters::unknown_figures;
use crate::money::format_cents;
use crate::outcome::{Decision, failed_check_names};
use crate::payloads::ReviewPayload;
use crate::rules::SettlementRule;
use crate::{Causation, Cents, Check, CheckResult, Corroboration};
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
    /// Decided past claims from the Evidence Engine.
    PastClaims,
}

impl EvidenceSource {
    pub const ALL: [EvidenceSource; 9] = [
        EvidenceSource::Band,
        EvidenceSource::LightCircle,
        EvidenceSource::Camera,
        EvidenceSource::Medic,
        EvidenceSource::HospitalReport,
        EvidenceSource::Zone,
        EvidenceSource::Policy,
        EvidenceSource::Checks,
        EvidenceSource::PastClaims,
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
            EvidenceSource::PastClaims => "past_claims",
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
            EvidenceSource::PastClaims => "past claims",
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
}

impl Finding {
    /// The decision history's headline, for example "The light circle supports the claim".
    pub fn headline(&self) -> String {
        let label = self.source.label();
        let mut chars = label.chars();
        let label: String = chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default();
        let plural = matches!(self.source, EvidenceSource::Camera | EvidenceSource::Medic | EvidenceSource::Checks | EvidenceSource::PastClaims);
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
}

/// What Claude must have read before it may pay this claim: for an injury the
/// band and the light circle, and the hospital report once one is filed; for
/// property the security cameras.
pub fn required_reading(p: &ReviewPayload) -> Vec<EvidenceSource> {
    if p.cover_kind == "property" {
        return vec![EvidenceSource::Camera];
    }
    let mut v = vec![EvidenceSource::Band, EvidenceSource::LightCircle];
    if !p.lines.is_empty() {
        v.push(EvidenceSource::HospitalReport);
    }
    v
}

/// Code validation of a decision:
/// - every cited id (top level, concerns, findings) is one of `fact_seqs`;
/// - lengths: summary 1 to 800 characters, each concern and finding detail at
///   most 400, the question and the trusted source at most 400; at most 6
///   concerns, explanations and missing-evidence items; 1 to 10 findings;
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
        .chain(d.findings.iter().flat_map(|f| &f.fact_ids));
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

    let texts = std::iter::once(("summary".to_string(), &d.summary))
        .chain(d.concerns.iter().enumerate().map(|(i, c)| (format!("concern {}", i + 1), &c.detail)))
        .chain(d.findings.iter().enumerate().map(|(i, f)| (format!("finding {}", i + 1), &f.detail)))
        .chain([("question".to_string(), &d.question), ("trusted_source".to_string(), &d.trusted_source)]);
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

    let found = complications(&ClaimState { has_cover: input.has_cover, amounts: input.amounts, checks: input.checks });
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

    #[test]
    fn a_gap_in_the_policy_goes_to_the_organizer_whatever_claude_decided() {
        let rule = rule();
        let unlisted = vec![Check::fail("record_lines", "5 covered, 1 reduced, 1 excluded; not on the schedule: 90715")];
        let route = |g: Guarded| match g.decision {
            Decision::Route { reason } => reason,
            other => panic!("{other:?}"),
        };
        assert_eq!(
            route(guard(&pay(), &input(&unlisted, Some(&rule)))),
            "Complication: the policy's fee schedule does not list 90715. Claude would pay $180.00"
        );
        let mut refuse = refuse_at_home();
        refuse.refusal_checks = vec!["record_lines".into()];
        assert!(route(guard(&refuse, &input(&unlisted, Some(&rule)))).starts_with("Complication: the policy's fee schedule does not list 90715. Claude recommends refusing"));
        let (checks, capped) = (passing(), Amounts { cost_cents: 720_000, payout_cents: 500_000, recoverable_cents: 500_000, venue_cost_cents: 0 });
        assert_eq!(
            route(guard(&pay(), &GuardInput { amounts: capped, ..input(&checks, Some(&rule)) })),
            "Complication: the covered cost $7,200.00 is over the policy's limit, which pays at most $5,000.00. Claude would pay $5,000.00"
        );
    }

    #[test]
    fn sources_round_trip() {
        for s in EvidenceSource::ALL {
            assert_eq!(EvidenceSource::parse(s.as_str()), Some(s));
            assert_eq!(serde_json::to_value(s).unwrap(), s.as_str());
        }
    }
}
