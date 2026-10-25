//! The three outcomes: auto-settle under a learned rule, route to a named
//! person, or refuse and show what was checked. `decide` is the code-only
//! decision, used when Claude's answer could not be used.

use crate::complications::{ClaimState, Complication, complications, reason};
use crate::coverage::Amounts;
use crate::rules::SettlementRule;
use crate::{Check, CheckResult, Corroboration};
use serde::{Deserialize, Serialize};

/// What the claims agent's review means for automation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ReviewGate {
    /// The agent found the claim consistent.
    Consistent,
    /// The agent wants a person to look; the text says why.
    Concerns(String),
    /// No usable review (the agent was unavailable).
    Missing,
}

#[derive(Clone, Debug)]
pub struct DecisionInput<'a> {
    /// An active coverage rule applies to the incident kind.
    pub has_cover: bool,
    pub corroboration: Corroboration,
    pub amounts: Amounts,
    /// Code and Elastic checks of the current pack version.
    pub checks: &'a [Check],
    pub review: ReviewGate,
    /// From `Config::review_required`.
    pub review_required: bool,
    /// From `rules::matching_rule` for the claim's shape.
    pub rule: Option<&'a SettlementRule>,
    /// Set when several people were hurt in one occurrence.
    pub mass_occurrence: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Decision {
    Refuse { reason: String },
    AutoSettle { rule_id: u64, rule_version: u32 },
    Route { reason: String },
}

/// The code-only decision:
/// 1. no cover -> `Refuse("no active cover for this incident kind")`;
/// 2. payout 0 while the sources agree -> `Refuse("payout is zero after limits")`;
/// 3. any complication, including a missing or doubtful review when
///    `review_required` -> `Route("Complications: " + every complication)`;
/// 4. otherwise `AutoSettle` under the learned rule.
///
/// Disputed evidence is never refused here: the sources disagree, so a person
/// decides. A rule settles only at or under the ceiling its approver gave it,
/// whatever `requires_corroborated` says.
pub fn decide(input: &DecisionInput) -> Decision {
    if !input.has_cover {
        return Decision::Refuse { reason: "no active cover for this incident kind".into() };
    }
    if input.amounts.payout_cents == 0 && input.corroboration != Corroboration::Disputed {
        return Decision::Refuse { reason: "payout is zero after limits".into() };
    }
    let mut found = complications(&ClaimState {
        corroboration: input.corroboration,
        amounts: input.amounts,
        checks: input.checks,
        rule: input.rule,
        mass_occurrence: input.mass_occurrence.as_deref(),
    });
    if input.review_required {
        match &input.review {
            ReviewGate::Consistent => {}
            ReviewGate::Concerns(text) => found.insert(0, Complication::ClaudeConcerns(text.clone())),
            ReviewGate::Missing => found.insert(0, Complication::ReviewMissing),
        }
    }
    match input.rule {
        Some(rule) if found.is_empty() => Decision::AutoSettle { rule_id: rule.rule_id, rule_version: rule.version },
        _ => Decision::Route { reason: reason("", &found) },
    }
}

/// Names of the checks that failed, in order.
pub fn failed_check_names(checks: &[Check]) -> Vec<String> {
    checks.iter().filter(|c| c.result == CheckResult::Fail).map(|c| c.name.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CoverKind, IncidentKind};

    fn rule() -> SettlementRule {
        SettlementRule {
            rule_id: 7,
            incident_kind: IncidentKind::Fall,
            cover_kind: CoverKind::MedicalPayments,
            zone_id: 0,
            requires_corroborated: true,
            ceiling_cents: 25000,
            version: 2,
            active: true,
        }
    }

    fn passing() -> Vec<Check> {
        vec![Check::pass("witness_zone", "3 of 3 witnesses in zone 102"), Check::pass("staff_note_time", "first note 22:26:00")]
    }

    fn failing() -> Vec<Check> {
        vec![
            Check::fail("witness_zone", "1 of 3 witnesses in zone 102"),
            Check::pass("staff_note_time", "first note 22:26:00"),
            Check::fail("vision_zone", "camera 5 zone 105, incident zone 102"),
            Check::info("vision_present", "no assessment"),
        ]
    }

    fn amounts(payout: u64) -> Amounts {
        Amounts { cost_cents: payout.max(18000), payout_cents: payout, recoverable_cents: payout, venue_cost_cents: 0 }
    }

    /// The small fall: every gate open, a v2 rule with a 25000 ceiling.
    fn happy<'a>(checks: &'a [Check], rule: &'a SettlementRule) -> DecisionInput<'a> {
        DecisionInput {
            has_cover: true,
            corroboration: Corroboration::Corroborated,
            amounts: amounts(18000),
            checks,
            review: ReviewGate::Consistent,
            review_required: true,
            rule: Some(rule),
            mass_occurrence: None,
        }
    }

    fn refused(reason: &str) -> Decision {
        Decision::Refuse { reason: reason.into() }
    }

    fn routed(reason: &str) -> Decision {
        Decision::Route { reason: reason.into() }
    }

    #[test]
    fn a_simple_claim_auto_settles() {
        let (checks, rule) = (passing(), rule());
        assert_eq!(decide(&happy(&checks, &rule)), Decision::AutoSettle { rule_id: 7, rule_version: 2 });
    }

    #[test]
    fn no_cover_refuses_first() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { has_cover: false, corroboration: Corroboration::Disputed, amounts: amounts(0), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), refused("no active cover for this incident kind"));
    }

    #[test]
    fn disputed_evidence_goes_to_a_person_not_a_refusal() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { corroboration: Corroboration::Disputed, amounts: amounts(0), review: ReviewGate::Missing, ..happy(&checks, &rule) };
        assert_eq!(
            decide(&input),
            routed(
                "Complications: Claude's answer could not be used; the sources disagree on where or when it happened; \
                 failed checks: witness_zone, vision_zone"
            )
        );
    }

    #[test]
    fn zero_payout_refuses() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { amounts: amounts(0), corroboration: Corroboration::Uncorroborated, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), refused("payout is zero after limits"));
    }

    #[test]
    fn a_failed_check_routes_even_when_a_rule_matches() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { review: ReviewGate::Missing, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: Claude's answer could not be used; failed checks: witness_zone, vision_zone"));
    }

    #[test]
    fn the_review_gate() {
        let (checks, rule) = (passing(), rule());
        let concerns = ReviewGate::Concerns("causation: the record says the injury happened at home".into());
        let input = DecisionInput { review: concerns.clone(), corroboration: Corroboration::Uncorroborated, ..happy(&checks, &rule) };
        assert_eq!(
            decide(&input),
            routed(
                "Complications: Claude: causation: the record says the injury happened at home; \
                 no second source confirms where and when it happened"
            )
        );

        let input = DecisionInput { review: ReviewGate::Missing, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: Claude's answer could not be used"));

        let input = DecisionInput { review: concerns, review_required: false, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), Decision::AutoSettle { rule_id: 7, rule_version: 2 });
    }

    #[test]
    fn missing_evidence_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { corroboration: Corroboration::Uncorroborated, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: no second source confirms where and when it happened"));
    }

    #[test]
    fn no_rule_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { rule: None, amounts: amounts(900000), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: no approval covers this kind of claim yet"));
    }

    #[test]
    fn above_the_ceiling_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { amounts: amounts(25001), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: $250.01 is above the $250.00 ceiling of rule v2"));

        let input = DecisionInput { amounts: amounts(25000), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), Decision::AutoSettle { rule_id: 7, rule_version: 2 });

        let retired = SettlementRule { ceiling_cents: 0, version: 3, ..rule.clone() };
        let input = DecisionInput { rule: Some(&retired), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: $180.00 is above the $0.00 ceiling of rule v3"));

        let loose = SettlementRule { requires_corroborated: false, ..rule.clone() };
        let input = DecisionInput { rule: Some(&loose), amounts: amounts(90000), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complications: $900.00 is above the $250.00 ceiling of rule v2"));
    }

    #[test]
    fn a_bill_over_the_limit_and_a_mass_occurrence_route() {
        let (checks, rule) = (passing(), rule());
        let capped = Amounts { cost_cents: 30000, ..amounts(18000) };
        let input = DecisionInput { amounts: capped, mass_occurrence: Some("3 people hurt in Main stage within 5 minutes".into()), ..happy(&checks, &rule) };
        assert_eq!(
            decide(&input),
            routed(
                "Complications: the covered cost $300.00 is over the policy's limit, so the payout is capped at $180.00; \
                 3 people hurt in Main stage within 5 minutes"
            )
        );
    }

    #[test]
    fn info_checks_do_not_route() {
        let rule = rule();
        let checks = vec![Check::pass("witness_zone", "3 of 3"), Check::info("vision_present", "no assessment for this incident")];
        assert_eq!(decide(&happy(&checks, &rule)), Decision::AutoSettle { rule_id: 7, rule_version: 2 });
    }

    #[test]
    fn failed_names_in_order() {
        assert_eq!(failed_check_names(&failing()), ["witness_zone", "vision_zone"]);
        assert!(failed_check_names(&passing()).is_empty());
    }
}
