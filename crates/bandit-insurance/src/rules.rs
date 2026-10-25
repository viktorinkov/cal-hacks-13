//! Payment rules. Claude proposes one from approved precedents of one shape;
//! only the organizer's approval of the proposal creates it, and it never
//! overwrites: a new rule for the same shape writes version n+1.

use crate::{Cents, CoverKind, IncidentKind};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettlementRule {
    pub rule_id: u64,
    pub incident_kind: IncidentKind,
    pub cover_kind: CoverKind,
    /// 0 means any zone.
    pub zone_id: u64,
    pub requires_corroborated: bool,
    pub ceiling_cents: Cents,
    pub version: u32,
    pub active: bool,
}

/// The active rule for this shape with the highest version. A rule with
/// `zone_id` 0 matches every zone; a rule naming a zone matches only that zone
/// and wins over an any-zone rule when both are active.
pub fn matching_rule(
    rules: &[SettlementRule],
    incident_kind: IncidentKind,
    cover_kind: CoverKind,
    zone_id: u64,
) -> Option<&SettlementRule> {
    rules
        .iter()
        .filter(|r| r.active && r.incident_kind == incident_kind && r.cover_kind == cover_kind)
        .filter(|r| r.zone_id == 0 || r.zone_id == zone_id)
        .max_by_key(|r| (r.zone_id != 0, r.version))
}

/// Approved simple precedents of one shape it takes before Claude proposes a rule.
pub const RULE_PRECEDENTS: usize = 3;

/// Claude's answer to `rule_proposal`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProposedRule {
    /// false when the precedents share no pattern worth a rule.
    pub propose: bool,
    pub precedent_claim_ids: Vec<u64>,
    pub ceiling_cents: Cents,
    /// The rule in one sentence.
    pub rule: String,
    /// Why, citing the claims.
    pub summary: String,
}

/// What is wrong with a proposal: it cites at least `RULE_PRECEDENTS` of the offered approved claims
/// (`(claim_id, payout_cents)`), each once, and its ceiling is the highest payout among them, so a rule
/// never pays more than an organizer already approved, and never above the policy's per-claim limit.
pub fn check_proposal(p: &ProposedRule, offered: &[(u64, Cents)], limit_cents: Cents) -> Result<(), Vec<String>> {
    let mut problems = Vec::new();
    if p.summary.trim().is_empty() {
        problems.push("the summary must say why".to_string());
    }
    if !p.propose {
        return if problems.is_empty() { Ok(()) } else { Err(problems) };
    }
    if p.rule.trim().is_empty() {
        problems.push("the rule must be one sentence".to_string());
    }
    let mut seen = Vec::new();
    for id in &p.precedent_claim_ids {
        if !offered.iter().any(|(c, _)| c == id) {
            problems.push(format!("claim {id} is not one of the approved precedents"));
        } else if seen.contains(id) {
            problems.push(format!("claim {id} is cited twice"));
        } else {
            seen.push(*id);
        }
    }
    if seen.len() < RULE_PRECEDENTS {
        problems.push(format!("a rule cites at least {RULE_PRECEDENTS} approved precedents, not {}", seen.len()));
    }
    let highest = offered.iter().filter(|(c, _)| seen.contains(c)).map(|(_, p)| *p).max().unwrap_or(0);
    if !seen.is_empty() && p.ceiling_cents != highest {
        problems.push(format!("the ceiling must be {highest} cents, the highest payout among the cited claims, not {}", p.ceiling_cents));
    }
    if p.ceiling_cents > limit_cents {
        problems.push(format!("the ceiling must be at most the policy's per-claim limit of {limit_cents} cents"));
    }
    if problems.is_empty() { Ok(()) } else { Err(problems) }
}

/// The ceiling a new rule gets: the requested ceiling (default: the approved
/// payout), clamped to the approver's authority ceiling (`None` = no ceiling).
pub fn learned_ceiling(requested_cents: Option<Cents>, approved_payout_cents: Cents, approver_ceiling_cents: Option<Cents>) -> Cents {
    let requested = requested_cents.unwrap_or(approved_payout_cents);
    approver_ceiling_cents.map_or(requested, |c| requested.min(c))
}

/// 1 + the highest version of any rule (active or not) with exactly this
/// shape (same kind, cover and `zone_id`), or 1 when there is none.
pub fn next_version(rules: &[SettlementRule], incident_kind: IncidentKind, cover_kind: CoverKind, zone_id: u64) -> u32 {
    rules
        .iter()
        .filter(|r| r.incident_kind == incident_kind && r.cover_kind == cover_kind && r.zone_id == zone_id)
        .map(|r| r.version)
        .max()
        .map_or(1, |v| v.saturating_add(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(rule_id: u64, kind: IncidentKind, zone_id: u64, version: u32, active: bool) -> SettlementRule {
        SettlementRule {
            rule_id,
            incident_kind: kind,
            cover_kind: CoverKind::for_incident(kind),
            zone_id,
            requires_corroborated: true,
            ceiling_cents: 25000,
            version,
            active,
        }
    }

    const FALL: IncidentKind = IncidentKind::Fall;
    const MED: CoverKind = CoverKind::MedicalPayments;

    #[test]
    fn highest_active_version_wins() {
        let rules = [rule(1, FALL, 0, 1, false), rule(2, FALL, 0, 2, true), rule(3, FALL, 0, 3, false)];
        assert_eq!(matching_rule(&rules, FALL, MED, 102).unwrap().rule_id, 2);
        let rules = [rule(4, FALL, 0, 3, true), rule(2, FALL, 0, 2, true)];
        assert_eq!(matching_rule(&rules, FALL, MED, 102).unwrap().rule_id, 4);
    }

    #[test]
    fn zone_rule_beats_any_zone_rule() {
        let rules = [rule(1, FALL, 0, 5, true), rule(2, FALL, 102, 1, true), rule(3, FALL, 103, 9, true)];
        assert_eq!(matching_rule(&rules, FALL, MED, 102).unwrap().rule_id, 2);
        assert_eq!(matching_rule(&rules, FALL, MED, 103).unwrap().rule_id, 3);
        assert_eq!(matching_rule(&rules, FALL, MED, 104).unwrap().rule_id, 1);
        assert_eq!(matching_rule(&rules, FALL, MED, 0).unwrap().rule_id, 1);
    }

    #[test]
    fn shape_must_match() {
        let rules = [rule(1, FALL, 102, 1, true), rule(2, IncidentKind::Property, 0, 1, true)];
        assert!(matching_rule(&rules, IncidentKind::Sos, MED, 102).is_none());
        assert!(matching_rule(&rules, FALL, CoverKind::Property, 102).is_none());
        assert!(matching_rule(&rules, FALL, MED, 101).is_none());
        assert!(matching_rule(&rules[..1], FALL, MED, 0).is_none());
        assert!(matching_rule(&[], FALL, MED, 102).is_none());
    }

    #[test]
    fn learned_ceiling_clamps_to_authority() {
        assert_eq!(learned_ceiling(Some(60000), 18000, Some(50000)), 50000);
        assert_eq!(learned_ceiling(None, 89500, Some(500000)), 89500);
        assert_eq!(learned_ceiling(Some(25000), 12000, Some(500000)), 25000);
        assert_eq!(learned_ceiling(None, 900000, None), 900000);
        assert_eq!(learned_ceiling(Some(2000000), 900000, None), 2000000);
        assert_eq!(learned_ceiling(None, 60000, Some(50000)), 50000);
    }

    fn proposed(ids: &[u64], ceiling: Cents) -> ProposedRule {
        ProposedRule { propose: true, precedent_claim_ids: ids.to_vec(), ceiling_cents: ceiling, rule: "Pay falls up to $180.00".into(), summary: "Three alike.".into() }
    }

    #[test]
    fn a_proposal_stays_inside_its_precedents_and_the_policy() {
        let offered = [(2, 18000), (4, 18000), (7, 15000), (9, 89500)];
        assert_eq!(check_proposal(&proposed(&[2, 4, 7], 18000), &offered, 500000), Ok(()));
        let e = check_proposal(&proposed(&[2, 4], 18000), &offered, 500000).unwrap_err();
        assert!(e[0].contains("at least 3"), "{e:?}");
        let e = check_proposal(&proposed(&[2, 4, 7], 25000), &offered, 500000).unwrap_err();
        assert!(e[0].contains("must be 18000 cents"), "{e:?}");
        let e = check_proposal(&proposed(&[2, 4, 4, 5], 18000), &offered, 500000).unwrap_err();
        assert!(e.iter().any(|p| p.contains("cited twice")) && e.iter().any(|p| p.contains("claim 5 is not")), "{e:?}");
        let e = check_proposal(&proposed(&[2, 4, 9], 89500), &offered, 50000).unwrap_err();
        assert!(e[0].contains("per-claim limit"), "{e:?}");
        let none = ProposedRule { propose: false, precedent_claim_ids: vec![], ceiling_cents: 0, rule: String::new(), summary: "No pattern.".into() };
        assert_eq!(check_proposal(&none, &offered, 500000), Ok(()));
    }

    #[test]
    fn next_version_counts_every_rule_of_the_shape() {
        let rules = [rule(1, FALL, 0, 1, false), rule(2, FALL, 0, 2, false), rule(3, FALL, 102, 7, true)];
        assert_eq!(next_version(&rules, FALL, MED, 0), 3);
        assert_eq!(next_version(&rules, FALL, MED, 102), 8);
        assert_eq!(next_version(&rules, FALL, MED, 103), 1);
        assert_eq!(next_version(&rules, IncidentKind::Sos, MED, 0), 1);
        assert_eq!(next_version(&[], IncidentKind::Property, CoverKind::Property, 102), 1);
    }
}
