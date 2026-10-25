//! Complications: a serious gap or mismatch in the policies, which a person
//! decides one claim at a time. No learned rule and no decision by Claude
//! settles or refuses such a claim on its own: it always goes to the
//! organizer, with every complication listed. Every other claim follows the
//! guard (`decision::guard`) as before.
//!
//! Each complication is found from stored rows (the cover, the amounts and
//! the checks), so anyone can re-run it later.

use crate::coverage::Amounts;
use crate::money::format_cents;
use crate::{Cents, Check, CheckResult};

#[derive(Clone, Debug, PartialEq)]
pub enum Complication {
    /// No active cover of the venue's policy pays for this kind of incident.
    NoCover,
    /// The covered cost is above the per-claim limit or what is left of the
    /// aggregate, so the policy pays only part of it, or nothing.
    OverLimit { cost_cents: Cents, payout_cents: Cents },
    /// The hospital report bills services the policy's fee schedule does not list.
    NotOnSchedule(String),
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
            Complication::NotOnSchedule(codes) => format!("the policy's fee schedule does not list {codes}"),
        }
    }
}

/// What code knows about a claim's cover, whatever Claude decided.
#[derive(Clone, Copy, Debug)]
pub struct ClaimState<'a> {
    /// An active cover of the policy pays for the incident kind.
    pub has_cover: bool,
    pub amounts: Amounts,
    /// Code and Evidence Engine checks of the current pack version.
    pub checks: &'a [Check],
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
    let unlisted = s.checks.iter().find(|c| c.name == "record_lines" && c.result == CheckResult::Fail);
    if let Some(c) = unlisted {
        let codes = c.detail.split_once("not on the schedule: ").map(|(_, codes)| codes).unwrap_or("a billed service");
        found.push(Complication::NotOnSchedule(codes.into()));
    }
    found
}

/// The route reason: the complications, then what Claude decided, for example
/// "Complication: the policy's fee schedule does not list 90715. Claude would
/// pay $895.00".
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

    fn state(checks: &[Check]) -> ClaimState<'_> {
        ClaimState { has_cover: true, amounts: amounts(18_000, 18_000), checks }
    }

    #[test]
    fn a_covered_claim_inside_its_limits_has_none() {
        let checks = vec![Check::pass("record_lines", "3 covered, 0 reduced, 0 excluded"), Check::fail("witness_zone", "0 of 3")];
        assert_eq!(complications(&state(&checks)), []);
    }

    #[test]
    fn every_gap_is_listed() {
        let checks = vec![Check::fail("record_lines", "5 covered, 1 reduced, 1 excluded; not on the schedule: 90715")];
        let s = ClaimState { has_cover: false, amounts: amounts(720_000, 500_000), checks: &checks };
        assert_eq!(
            complications(&s),
            [
                Complication::NoCover,
                Complication::OverLimit { cost_cents: 720_000, payout_cents: 500_000 },
                Complication::NotOnSchedule("90715".into()),
            ]
        );
    }

    #[test]
    fn a_used_up_aggregate_is_a_gap_too() {
        let s = ClaimState { amounts: amounts(18_000, 0), ..state(&[]) };
        assert_eq!(complications(&s), [Complication::OverLimit { cost_cents: 18_000, payout_cents: 0 }]);
    }

    #[test]
    fn the_reason_reads_as_one_note() {
        assert_eq!(
            reason("Claude would pay $895.00", &[Complication::NotOnSchedule("90715".into())]),
            "Complication: the policy's fee schedule does not list 90715. Claude would pay $895.00"
        );
        assert_eq!(
            reason("", &[Complication::NoCover, Complication::OverLimit { cost_cents: 30_000, payout_cents: 0 }]),
            "Complications: no cover in the venue's policy pays for this kind of incident; \
             the covered cost $300.00 is over the policy's limit, which pays at most $0.00"
        );
    }
}
