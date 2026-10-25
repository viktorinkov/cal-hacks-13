//! Complications: what makes a claim need a person. A claim is simple when its
//! sources agree, its checks agree with Claude, and its money fits inside the
//! policy's limits and an approval the organizer already gave. Only a simple
//! claim is paid or refused with nobody involved. Any complication sends it to
//! the organizer, whatever Claude decided, with every complication listed.
//!
//! Each complication is found from stored rows (the corroboration, the
//! checks, the amounts, the learned rules and the occurrence), so anyone can
//! re-run it later.

use crate::coverage::Amounts;
use crate::money::format_cents;
use crate::outcome::failed_check_names;
use crate::rules::SettlementRule;
use crate::{Cents, Check, Corroboration};

#[derive(Clone, Debug, PartialEq)]
pub enum Complication {
    /// The light circle or the security cameras place the incident in another
    /// zone, or at another time, than the band (`disputed`).
    SourcesDisagree,
    /// No second source confirms where and when it happened (`uncorroborated`).
    EvidenceMissing,
    /// Claude would pay, but these checks failed.
    ChecksFailed(Vec<String>),
    /// Claude would refuse, but every check passed.
    NoFailedCheck,
    /// A per-claim or aggregate limit capped the payout below the covered cost.
    OverLimit { cost_cents: Cents, payout_cents: Cents },
    /// No learned rule covers this kind of claim yet.
    NoApproval,
    /// The payout is above the ceiling of the learned rule for this kind of claim.
    AboveApproval { payout_cents: Cents, ceiling_cents: Cents, version: u32 },
    /// Several people were hurt in one occurrence; the text says how many and where.
    ManyHurt(String),
    /// Claude's answer failed validation twice, or the review never came back.
    ReviewMissing,
    /// Claude's concerns, when its review only flagged the claim.
    ClaudeConcerns(String),
}

impl Complication {
    /// How the organizer's queue words it.
    pub fn text(&self) -> String {
        match self {
            Complication::SourcesDisagree => "the sources disagree on where or when it happened".into(),
            Complication::EvidenceMissing => "no second source confirms where and when it happened".into(),
            Complication::ChecksFailed(names) => format!("failed checks: {}", names.join(", ")),
            Complication::NoFailedCheck => "every check passed".into(),
            Complication::OverLimit { cost_cents, payout_cents } => format!(
                "the covered cost {} is over the policy's limit, so the payout is capped at {}",
                format_cents(*cost_cents),
                format_cents(*payout_cents)
            ),
            Complication::NoApproval => "no approval covers this kind of claim yet".into(),
            Complication::AboveApproval { payout_cents, ceiling_cents, version } => {
                format!("{} is above the {} ceiling of rule v{version}", format_cents(*payout_cents), format_cents(*ceiling_cents))
            }
            Complication::ManyHurt(text) => text.clone(),
            Complication::ReviewMissing => "Claude's answer could not be used".into(),
            Complication::ClaudeConcerns(text) => format!("Claude: {text}"),
        }
    }

    /// Whether it holds a refusal too. A refusal on a failed check rests on
    /// evidence anyone can re-run, so missing evidence or the money does not
    /// weaken it; sources that disagree, a refusal with no failed check and a
    /// mass occurrence do.
    pub fn holds_refusal(&self) -> bool {
        matches!(
            self,
            Complication::SourcesDisagree
                | Complication::NoFailedCheck
                | Complication::ManyHurt(_)
                | Complication::ReviewMissing
                | Complication::ClaudeConcerns(_)
        )
    }
}

/// What code knows about a claim, whatever Claude decided.
#[derive(Clone, Copy, Debug)]
pub struct ClaimState<'a> {
    pub corroboration: Corroboration,
    pub amounts: Amounts,
    /// Code and Evidence Engine checks of the current pack version.
    pub checks: &'a [Check],
    /// The learned rule for this shape of claim, if any.
    pub rule: Option<&'a SettlementRule>,
    /// Set when several people were hurt in one occurrence.
    pub mass_occurrence: Option<&'a str>,
}

/// Every complication of the claim itself, in a fixed order. Claude's own
/// decision can add more (`NoFailedCheck`), in `decision::guard`.
pub fn complications(s: &ClaimState) -> Vec<Complication> {
    let mut found = Vec::new();
    match s.corroboration {
        Corroboration::Disputed => found.push(Complication::SourcesDisagree),
        Corroboration::Uncorroborated => found.push(Complication::EvidenceMissing),
        Corroboration::Corroborated => {}
    }
    let failed = failed_check_names(s.checks);
    if !failed.is_empty() {
        found.push(Complication::ChecksFailed(failed));
    }
    let a = s.amounts;
    if a.payout_cents > 0 && a.payout_cents < a.cost_cents {
        found.push(Complication::OverLimit { cost_cents: a.cost_cents, payout_cents: a.payout_cents });
    }
    if let Some(text) = s.mass_occurrence {
        found.push(Complication::ManyHurt(text.into()));
    }
    match s.rule {
        None => found.push(Complication::NoApproval),
        Some(rule) if a.payout_cents > rule.ceiling_cents => {
            found.push(Complication::AboveApproval { payout_cents: a.payout_cents, ceiling_cents: rule.ceiling_cents, version: rule.version })
        }
        Some(_) => {}
    }
    found
}

/// The route reason: what was decided, then every complication, for example
/// "Claude would pay $895.00. Complications: failed checks: record_lines; no
/// approval covers this kind of claim yet". With no head it is the list alone.
pub fn reason(head: &str, list: &[Complication]) -> String {
    let head = head.trim();
    if list.is_empty() {
        return head.into();
    }
    let listed = format!("Complications: {}", list.iter().map(Complication::text).collect::<Vec<_>>().join("; "));
    match head.chars().last() {
        None => listed,
        Some('.' | '?' | '!') => format!("{head} {listed}"),
        Some(_) => format!("{head}. {listed}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CoverKind, IncidentKind};

    fn rule(ceiling_cents: Cents) -> SettlementRule {
        SettlementRule {
            rule_id: 7,
            incident_kind: IncidentKind::Fall,
            cover_kind: CoverKind::MedicalPayments,
            zone_id: 0,
            requires_corroborated: true,
            ceiling_cents,
            version: 1,
            active: true,
        }
    }

    fn amounts(cost: Cents, payout: Cents) -> Amounts {
        Amounts { cost_cents: cost, payout_cents: payout, recoverable_cents: payout, venue_cost_cents: 0 }
    }

    fn state<'a>(checks: &'a [Check], rule: Option<&'a SettlementRule>) -> ClaimState<'a> {
        ClaimState { corroboration: Corroboration::Corroborated, amounts: amounts(18_000, 18_000), checks, rule, mass_occurrence: None }
    }

    #[test]
    fn a_simple_claim_has_none() {
        let (checks, r) = (vec![Check::pass("witness_zone", "2 of 2")], rule(89_500));
        assert_eq!(complications(&state(&checks, Some(&r))), []);
    }

    #[test]
    fn every_complication_is_listed_not_only_the_first() {
        let checks = vec![Check::fail("witness_zone", "0 of 3"), Check::fail("vision_zone", "camera in 105")];
        let r = rule(10_000);
        let s = ClaimState {
            corroboration: Corroboration::Disputed,
            amounts: amounts(720_000, 500_000),
            mass_occurrence: Some("3 people hurt in Main stage within 5 minutes"),
            ..state(&checks, Some(&r))
        };
        assert_eq!(
            complications(&s),
            [
                Complication::SourcesDisagree,
                Complication::ChecksFailed(vec!["witness_zone".into(), "vision_zone".into()]),
                Complication::OverLimit { cost_cents: 720_000, payout_cents: 500_000 },
                Complication::ManyHurt("3 people hurt in Main stage within 5 minutes".into()),
                Complication::AboveApproval { payout_cents: 500_000, ceiling_cents: 10_000, version: 1 },
            ]
        );
    }

    #[test]
    fn missing_evidence_and_no_approval() {
        let checks = vec![];
        let s = ClaimState { corroboration: Corroboration::Uncorroborated, ..state(&checks, None) };
        assert_eq!(complications(&s), [Complication::EvidenceMissing, Complication::NoApproval]);
    }

    #[test]
    fn a_zero_payout_is_not_over_a_limit() {
        let (checks, r) = (vec![], rule(89_500));
        let s = ClaimState { amounts: amounts(18_000, 0), ..state(&checks, Some(&r)) };
        assert_eq!(complications(&s), []);
    }

    #[test]
    fn only_some_complications_hold_a_refusal() {
        let holds: Vec<bool> = [
            Complication::SourcesDisagree,
            Complication::EvidenceMissing,
            Complication::OverLimit { cost_cents: 2, payout_cents: 1 },
            Complication::NoApproval,
            Complication::ManyHurt(String::new()),
        ]
        .iter()
        .map(Complication::holds_refusal)
        .collect();
        assert_eq!(holds, [true, false, false, false, true]);
    }

    #[test]
    fn the_reason_reads_as_one_note() {
        let list = [Complication::ChecksFailed(vec!["record_lines".into()]), Complication::NoApproval];
        assert_eq!(
            reason("Claude would pay $895.00", &list),
            "Claude would pay $895.00. Complications: failed checks: record_lines; no approval covers this kind of claim yet"
        );
        assert_eq!(reason("Claude asks: Was she at the event?", &[Complication::EvidenceMissing]), "Claude asks: Was she at the event? Complications: no second source confirms where and when it happened");
        assert_eq!(reason("Claude asks: Was she at the event?", &[]), "Claude asks: Was she at the event?");
        assert_eq!(reason("", &[Complication::ReviewMissing]), "Complications: Claude's answer could not be used");
    }
}
