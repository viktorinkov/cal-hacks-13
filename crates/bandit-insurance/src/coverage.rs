//! Coverage and amounts, in integer cents. The model never sees a figure
//! before this file has fixed it.

use crate::{Cents, CoverKind, IncidentKind};
use serde::{Deserialize, Serialize};

/// One cover: medical payments in the venue's general liability, property in the venue's property policy.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoverageRule {
    pub cover_kind: CoverKind,
    pub incident_kinds: Vec<IncidentKind>,
    pub per_claim_limit_cents: Cents,
    pub aggregate_limit_cents: Cents,
    pub deductible_cents: Cents,
    /// A payout below this goes to a person instead of being paid on its own.
    #[serde(default)]
    pub minimum_payout_cents: Cents,
    /// Medical services count only when dated on or after the incident date
    /// and at most this many days later.
    pub service_window_days: u32,
    pub active: bool,
}

impl CoverageRule {
    pub fn applies_to(&self, kind: IncidentKind) -> bool {
        self.active && self.incident_kinds.contains(&kind)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Amounts {
    /// What the claimant's covered costs add up to.
    pub cost_cents: Cents,
    /// What the claimant receives.
    pub payout_cents: Cents,
    /// What the insurer owes the venue.
    pub recoverable_cents: Cents,
    /// The venue's own share (the deductible part).
    pub venue_cost_cents: Cents,
}

impl Amounts {
    /// The four figures in a fixed order, for letter and review guardrails.
    pub fn figures(&self) -> [Cents; 4] {
        [self.cost_cents, self.payout_cents, self.recoverable_cents, self.venue_cost_cents]
    }
}

/// The first rule that applies to `kind`, in the order given.
pub fn rule_for(rules: &[CoverageRule], kind: IncidentKind) -> Option<&CoverageRule> {
    rules.iter().find(|r| r.applies_to(kind))
}

/// In order:
/// 1. `payout = min(cost, per_claim_limit, aggregate_limit - aggregate_used)`
///    (the aggregate remainder floors at 0);
/// 2. `recoverable = payout - deductible`, floored at 0;
/// 3. `venue_cost = payout - recoverable`.
pub fn compute_amounts(cost_cents: Cents, rule: &CoverageRule, aggregate_used_cents: Cents) -> Amounts {
    let aggregate_remaining = rule.aggregate_limit_cents.saturating_sub(aggregate_used_cents);
    let payout_cents = cost_cents.min(rule.per_claim_limit_cents).min(aggregate_remaining);
    let recoverable_cents = payout_cents.saturating_sub(rule.deductible_cents);
    Amounts { cost_cents, payout_cents, recoverable_cents, venue_cost_cents: payout_cents - recoverable_cents }
}

/// What the venue's medical payments cover owes of `covered_cents`. A primary
/// cover pays it all. An excess cover pays second: the attendee's own plan pays
/// first and leaves them its copay for the visit, so the cover pays that copay,
/// at most the covered amount. With no plan on file, or no copay for the visit
/// (first aid), an excess cover pays it all too.
pub fn venue_share(covered_cents: Cents, other_insurance: &str, plan_copay_cents: Option<Cents>) -> Cents {
    match plan_copay_cents {
        Some(copay) if other_insurance == "excess" => copay.min(covered_cents),
        _ => covered_cents,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn medical() -> CoverageRule {
        CoverageRule {
            cover_kind: CoverKind::MedicalPayments,
            incident_kinds: vec![IncidentKind::Sos, IncidentKind::Fall],
            per_claim_limit_cents: 500000,
            aggregate_limit_cents: 2500000,
            deductible_cents: 0,
            minimum_payout_cents: 0,
            service_window_days: 30,
            active: true,
        }
    }

    fn property() -> CoverageRule {
        CoverageRule {
            cover_kind: CoverKind::Property,
            incident_kinds: vec![IncidentKind::Property],
            per_claim_limit_cents: 1000000,
            aggregate_limit_cents: 5000000,
            deductible_cents: 50000,
            minimum_payout_cents: 0,
            service_window_days: 0,
            active: true,
        }
    }

    fn amounts(cost: Cents, payout: Cents, recoverable: Cents, venue: Cents) -> Amounts {
        Amounts { cost_cents: cost, payout_cents: payout, recoverable_cents: recoverable, venue_cost_cents: venue }
    }

    #[test]
    fn an_excess_cover_pays_what_the_plan_leaves() {
        assert_eq!(venue_share(89_500, "excess", Some(5_500)), 5_500, "the plan pays the rest of the urgent care visit");
        assert_eq!(venue_share(89_500, "primary", Some(5_500)), 89_500);
        assert_eq!(venue_share(18_000, "excess", None), 18_000, "first aid has no copay");
        assert_eq!(venue_share(3_000, "excess", Some(5_500)), 3_000, "never more than the covered amount");
    }

    #[test]
    fn hero_medical_claim() {
        assert_eq!(compute_amounts(18000, &medical(), 0), amounts(18000, 18000, 18000, 0));
    }

    #[test]
    fn hero_property_claim() {
        let a = compute_amounts(240000, &property(), 0);
        assert_eq!(a, amounts(240000, 240000, 190000, 50000));
        assert_eq!(a.figures(), [240000, 240000, 190000, 50000]);
    }

    #[test]
    fn aggregate_nearly_used() {
        assert_eq!(compute_amounts(18000, &medical(), 2495000), amounts(18000, 5000, 5000, 0));
    }

    #[test]
    fn aggregate_exhausted_or_overdrawn() {
        assert_eq!(compute_amounts(18000, &medical(), 2500000), amounts(18000, 0, 0, 0));
        assert_eq!(compute_amounts(18000, &medical(), 9000000), amounts(18000, 0, 0, 0));
    }

    #[test]
    fn per_claim_limit_caps_payout() {
        assert_eq!(compute_amounts(750000, &medical(), 0), amounts(750000, 500000, 500000, 0));
        assert_eq!(compute_amounts(1500000, &property(), 0), amounts(1500000, 1000000, 950000, 50000));
    }

    #[test]
    fn deductible_larger_than_payout() {
        assert_eq!(compute_amounts(30000, &property(), 0), amounts(30000, 30000, 0, 30000));
        assert_eq!(compute_amounts(0, &property(), 0), amounts(0, 0, 0, 0));
    }

    #[test]
    fn rule_for_skips_inactive_and_other_kinds() {
        let mut off = medical();
        off.active = false;
        off.per_claim_limit_cents = 1;
        let rules = [off, property(), medical()];
        assert_eq!(rule_for(&rules, IncidentKind::Fall).unwrap().per_claim_limit_cents, 500000);
        assert_eq!(rule_for(&rules, IncidentKind::Property).unwrap().cover_kind, CoverKind::Property);
        assert!(rule_for(&rules[..2], IncidentKind::Sos).is_none());
    }
}
