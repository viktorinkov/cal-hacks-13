//! The authority matrix: which named person a claim goes to.

use crate::Cents;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AuthorityLimit {
    /// `floor_manager`, `risk_manager`, `adjuster`.
    pub role: String,
    /// Lower ranks are asked first.
    pub rank: u8,
    /// `None` means no ceiling.
    pub ceiling_cents: Option<Cents>,
    /// The named person who gets claims at this level, for example `Dana Ruiz`.
    pub assignee_name: String,
}

impl AuthorityLimit {
    pub fn covers(&self, payout_cents: Cents) -> bool {
        self.ceiling_cents.is_none_or(|c| payout_cents <= c)
    }
}

/// The lowest-ranked limit whose ceiling covers `payout_cents`.
pub fn route(limits: &[AuthorityLimit], payout_cents: Cents) -> Option<&AuthorityLimit> {
    limits.iter().filter(|l| l.covers(payout_cents)).min_by_key(|l| l.rank)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(role: &str, rank: u8, ceiling_cents: Option<Cents>, name: &str) -> AuthorityLimit {
        AuthorityLimit { role: role.into(), rank, ceiling_cents, assignee_name: name.into() }
    }

    fn matrix() -> Vec<AuthorityLimit> {
        vec![
            limit("adjuster", 3, None, "Priya Nair"),
            limit("floor_manager", 1, Some(50000), "Sam Okafor"),
            limit("risk_manager", 2, Some(500000), "Dana Ruiz"),
        ]
    }

    fn who(limits: &[AuthorityLimit], payout: Cents) -> Option<(&str, &str)> {
        route(limits, payout).map(|l| (l.role.as_str(), l.assignee_name.as_str()))
    }

    #[test]
    fn routes_to_lowest_covering_rank() {
        let m = matrix();
        assert_eq!(who(&m, 18000), Some(("floor_manager", "Sam Okafor")));
        assert_eq!(who(&m, 89500), Some(("risk_manager", "Dana Ruiz")));
        assert_eq!(who(&m, 900000), Some(("adjuster", "Priya Nair")));
    }

    #[test]
    fn ceilings_are_inclusive() {
        let m = matrix();
        assert_eq!(who(&m, 50000).unwrap().0, "floor_manager");
        assert_eq!(who(&m, 50001).unwrap().0, "risk_manager");
        assert_eq!(who(&m, 500000).unwrap().0, "risk_manager");
        assert_eq!(who(&m, 500001).unwrap().0, "adjuster");
        assert_eq!(who(&m, 0).unwrap().0, "floor_manager");
    }

    #[test]
    fn no_covering_limit() {
        let m = matrix();
        assert_eq!(who(&m[1..], 900000), None);
        assert_eq!(who(&[], 18000), None);
    }
}
