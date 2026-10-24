//! Learned settlement rules. A rule is only ever created by a human approval,
//! inherits that approver's ceiling, and never overwrites: a new decision on
//! the same shape writes version n+1.

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
