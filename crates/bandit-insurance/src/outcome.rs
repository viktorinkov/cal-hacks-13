//! The three outcomes: auto-settle under a learned rule, route to a named
//! person, or refuse and show what was checked.

use crate::complications::{ClaimState, complications, reason};
use crate::coverage::Amounts;
use crate::money::format_cents;
use crate::rules::SettlementRule;
use crate::{Cents, Check, CheckResult, Corroboration};
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
    /// The cover's minimum payout from the confirmed policy terms.
    pub minimum_payout_cents: Cents,
    /// Code and Elastic checks of the current pack version.
    pub checks: &'a [Check],
    pub review: ReviewGate,
    /// From `Config::review_required`.
    pub review_required: bool,
    /// From `rules::matching_rule` for the claim's shape.
    pub rule: Option<&'a SettlementRule>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Decision {
    Refuse { reason: String },
    AutoSettle { rule_id: u64, rule_version: u32 },
    Route { reason: String },
}

/// First match wins:
/// 1. a complication (no cover, a bill over the policy's limit) ->
///    `Route("Complication: " + every one)`;
/// 2. `Disputed` -> `Refuse("evidence disputed: " + names of failed checks, comma-joined)`;
/// 3. payout 0 -> `Refuse("payout is zero after limits")`;
///    payout below the cover's minimum -> `Route("payout below the policy's minimum of $X")`;
/// 4. any check with result `Fail` -> `Route("failed checks: " + names)`;
/// 5. `review_required` and the review is not `Consistent` ->
///    `Route("claims agent: " + concerns text)` or `Route("claims agent review unavailable")`;
/// 6. not `Corroborated` -> `Route("evidence uncorroborated")`;
/// 7. no rule -> `Route("no learned rule for this kind of claim yet")`;
/// 8. rule requires corroboration (always true today) and payout above its
///    ceiling -> `Route("payout above the rule's ceiling")`;
/// 9. otherwise `AutoSettle` under the rule.
///
/// Rule 8 compares the ceiling for every rule, whatever `requires_corroborated`
/// says, so no rule can settle above the ceiling its approver gave it.
pub fn decide(input: &DecisionInput) -> Decision {
    let refuse = |reason: String| Decision::Refuse { reason };
    let route = |reason: String| Decision::Route { reason };
    let payout = input.amounts.payout_cents;

    let found = complications(&ClaimState { has_cover: input.has_cover, amounts: input.amounts });
    if !found.is_empty() {
        return route(reason("", &found));
    }
    if input.corroboration == Corroboration::Disputed {
        let failed = failed_check_names(input.checks);
        if failed.is_empty() {
            return refuse("evidence disputed".into());
        }
        return refuse(format!("evidence disputed: {}", failed.join(", ")));
    }
    if payout == 0 {
        return refuse("payout is zero after limits".into());
    }
    if payout < input.minimum_payout_cents {
        return route(format!("payout below the policy's minimum of {}", format_cents(input.minimum_payout_cents)));
    }
    let failed = failed_check_names(input.checks);
    if !failed.is_empty() {
        return route(format!("failed checks: {}", failed.join(", ")));
    }
    if input.review_required {
        match &input.review {
            ReviewGate::Consistent => {}
            ReviewGate::Concerns(text) => return route(format!("claims agent: {text}")),
            ReviewGate::Missing => return route("claims agent review unavailable".into()),
        }
    }
    if input.corroboration != Corroboration::Corroborated {
        return route("evidence uncorroborated".into());
    }
    let Some(rule) = input.rule else {
        return route("no learned rule for this kind of claim yet".into());
    };
    if payout > rule.ceiling_cents {
        return route("payout above the rule's ceiling".into());
    }
    Decision::AutoSettle { rule_id: rule.rule_id, rule_version: rule.version }
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
        Amounts { cost_cents: payout, payout_cents: payout, recoverable_cents: payout, venue_cost_cents: 0 }
    }

    /// The hero claim: every gate open, a v2 rule with a 25000 ceiling.
    fn happy<'a>(checks: &'a [Check], rule: &'a SettlementRule) -> DecisionInput<'a> {
        DecisionInput {
            has_cover: true,
            corroboration: Corroboration::Corroborated,
            amounts: amounts(18000),
            minimum_payout_cents: 0,
            checks,
            review: ReviewGate::Consistent,
            review_required: true,
            rule: Some(rule),
        }
    }

    fn refused(reason: &str) -> Decision {
        Decision::Refuse { reason: reason.into() }
    }

    fn routed(reason: &str) -> Decision {
        Decision::Route { reason: reason.into() }
    }

    #[test]
    fn happy_path_auto_settles() {
        let (checks, rule) = (passing(), rule());
        assert_eq!(decide(&happy(&checks, &rule)), Decision::AutoSettle { rule_id: 7, rule_version: 2 });
    }

    #[test]
    fn rule_1_a_gap_in_the_policy_goes_to_a_person_first() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { has_cover: false, corroboration: Corroboration::Disputed, amounts: amounts(0), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("Complication: no cover in the venue's policy pays for this kind of incident"));
        let capped = DecisionInput { amounts: Amounts { cost_cents: 30000, ..amounts(18000) }, ..happy(&checks, &rule) };
        assert_eq!(decide(&capped), routed("Complication: the covered cost $300.00 is over the policy's limit, which pays at most $180.00"));
    }

    #[test]
    fn rule_2_disputed_refuses_even_with_a_rule() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { corroboration: Corroboration::Disputed, amounts: amounts(0), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), refused("evidence disputed: witness_zone, vision_zone"));

        let checks = passing();
        let input = DecisionInput { corroboration: Corroboration::Disputed, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), refused("evidence disputed"));
    }

    #[test]
    fn rule_3_zero_payout_refuses() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { amounts: amounts(0), corroboration: Corroboration::Uncorroborated, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), refused("payout is zero after limits"));
    }

    #[test]
    fn rule_3_payout_below_the_minimum_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { minimum_payout_cents: 25_000, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("payout below the policy's minimum of $250.00"));
    }

    #[test]
    fn rule_4_failed_check_routes_even_when_a_rule_matches() {
        let (checks, rule) = (failing(), rule());
        let input = DecisionInput { review: ReviewGate::Missing, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("failed checks: witness_zone, vision_zone"));
    }

    #[test]
    fn rule_5_review_gate() {
        let (checks, rule) = (passing(), rule());
        let concerns = ReviewGate::Concerns("needs_human: causation: the record says the injury happened at home".into());
        let input = DecisionInput { review: concerns.clone(), corroboration: Corroboration::Uncorroborated, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("claims agent: needs_human: causation: the record says the injury happened at home"));

        let input = DecisionInput { review: concerns.clone(), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("claims agent: needs_human: causation: the record says the injury happened at home"));

        let input = DecisionInput { review: ReviewGate::Missing, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("claims agent review unavailable"));

        let input = DecisionInput { review: concerns, review_required: false, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), Decision::AutoSettle { rule_id: 7, rule_version: 2 });
    }

    #[test]
    fn rule_6_uncorroborated_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { corroboration: Corroboration::Uncorroborated, ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("evidence uncorroborated"));
    }

    #[test]
    fn rule_7_no_rule_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { rule: None, amounts: amounts(900000), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("no learned rule for this kind of claim yet"));
    }

    #[test]
    fn rule_8_above_ceiling_routes() {
        let (checks, rule) = (passing(), rule());
        let input = DecisionInput { amounts: amounts(25001), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("payout above the rule's ceiling"));

        let input = DecisionInput { amounts: amounts(25000), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), Decision::AutoSettle { rule_id: 7, rule_version: 2 });

        let retired = SettlementRule { ceiling_cents: 0, version: 3, ..rule.clone() };
        let input = DecisionInput { rule: Some(&retired), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("payout above the rule's ceiling"));

        let loose = SettlementRule { requires_corroborated: false, ..rule.clone() };
        let input = DecisionInput { rule: Some(&loose), amounts: amounts(90000), ..happy(&checks, &rule) };
        assert_eq!(decide(&input), routed("payout above the rule's ceiling"));
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
