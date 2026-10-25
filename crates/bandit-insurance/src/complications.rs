//! Complications: a serious gap or mismatch in the policies, which a person
//! decides one claim at a time. No learned rule and no decision by Claude
//! settles or refuses such a claim on its own: it always goes to the
//! organizer, with every complication listed. Approving one never teaches a
//! rule, because the policies give it none; the organizer's decision is kept
//! as a precedent the next such claim shows, and never applied by itself.
//! Every other claim follows the guard (`decision::guard`) as before.
//!
//! A billed service missing from the fee schedule is not a complication: the
//! schedule answers it, the line is excluded and the rest is paid.
//!
//! Each complication is found from stored rows (the cover and the amounts),
//! so anyone can re-run it later.

use crate::coverage::Amounts;
use crate::money::format_cents;
use crate::Cents;

#[derive(Clone, Debug, PartialEq)]
pub enum Complication {
    /// No active cover of the venue's policy pays for this kind of incident.
    NoCover,
    /// The covered cost is above the per-claim limit or what is left of the
    /// aggregate, so the policy pays only part of it, or nothing.
    OverLimit { cost_cents: Cents, payout_cents: Cents },
}

impl Complication {
    /// How the organizer's queue words it.
    pub fn text(&self) -> String {
        match self {
            Complication::NoCover => "no cover in the venue's policy pays for this kind of incident".into(),
            Complication::OverLimit { cost_cents, payout_cents } => format!(
                "the covered cost {} is over the policy's limit, which pays at most {}",
                format_cents(*cost_cents),
                format_cents(*payout_cents)
            ),
        }
    }

    /// The kind of gap, the same for every claim that has it: how a precedent is matched.
    pub fn label(&self) -> &'static str {
        match self {
            Complication::NoCover => "no cover",
            Complication::OverLimit { .. } => "over the policy's limit",
        }
    }
}

/// What code knows about a claim's cover, whatever Claude decided.
#[derive(Clone, Copy, Debug)]
pub struct ClaimState {
    /// An active cover of the policy pays for the incident kind.
    pub has_cover: bool,
    pub amounts: Amounts,
}

/// Every complication of the claim, in a fixed order.
pub fn complications(s: &ClaimState) -> Vec<Complication> {
    let mut found = Vec::new();
    if !s.has_cover {
        found.push(Complication::NoCover);
    }
    let a = s.amounts;
    if a.payout_cents < a.cost_cents {
        found.push(Complication::OverLimit { cost_cents: a.cost_cents, payout_cents: a.payout_cents });
    }
    found
}

/// The route reason: the complications, then what Claude decided, for example
/// "Complication: the covered cost $7,200.00 is over the policy's limit, which
/// pays at most $5,000.00. Claude would pay $5,000.00".
pub fn reason(head: &str, list: &[Complication]) -> String {
    let word = if list.len() == 1 { "Complication" } else { "Complications" };
    let listed = format!("{word}: {}", list.iter().map(Complication::text).collect::<Vec<_>>().join("; "));
    let head = head.trim();
    if head.is_empty() { listed } else { format!("{listed}. {head}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn amounts(cost: Cents, payout: Cents) -> Amounts {
        Amounts { cost_cents: cost, payout_cents: payout, recoverable_cents: payout, venue_cost_cents: 0 }
    }

    #[test]
    fn a_covered_claim_inside_its_limits_has_none() {
        assert_eq!(complications(&ClaimState { has_cover: true, amounts: amounts(18_000, 18_000) }), []);
    }

    #[test]
    fn every_gap_is_listed() {
        let s = ClaimState { has_cover: false, amounts: amounts(720_000, 500_000) };
        assert_eq!(complications(&s), [Complication::NoCover, Complication::OverLimit { cost_cents: 720_000, payout_cents: 500_000 }]);
        assert_eq!(complications(&s).iter().map(Complication::label).collect::<Vec<_>>(), ["no cover", "over the policy's limit"]);
    }

    #[test]
    fn a_used_up_aggregate_is_a_gap_too() {
        let s = ClaimState { has_cover: true, amounts: amounts(18_000, 0) };
        assert_eq!(complications(&s), [Complication::OverLimit { cost_cents: 18_000, payout_cents: 0 }]);
    }

    #[test]
    fn the_reason_reads_as_one_note() {
        assert_eq!(
            reason("Claude would pay $5,000.00", &[Complication::OverLimit { cost_cents: 720_000, payout_cents: 500_000 }]),
            "Complication: the covered cost $7,200.00 is over the policy's limit, which pays at most $5,000.00. Claude would pay $5,000.00"
        );
        assert_eq!(
            reason("", &[Complication::NoCover, Complication::OverLimit { cost_cents: 30_000, payout_cents: 0 }]),
            "Complications: no cover in the venue's policy pays for this kind of incident; \
             the covered cost $300.00 is over the policy's limit, which pays at most $0.00"
        );
    }
}
