//! Two independent sources must agree on time and zone before a claim can
//! settle without a person. The rule is deliberately dumb (zone equality and
//! time windows) so a judge or the organizer can re-run it by hand.

use crate::config::Config;
use crate::evidence::{EvidenceInput, IncidentInfo, VisionInfo};
use crate::time::local_hms;
use crate::{Check, CheckResult, Corroboration};

/// Decides corroboration and returns every comparison made, with both values
/// in each check's detail (times printed as local `HH:MM:SS`).
///
/// Injury incidents (`sos`, `fall`); the band is always the first source:
/// - `witness_zone`: count witnesses whose `zone_id` equals `incident.zone_id`
///   (same) and those in another zone (other). Pass when same >= `min_witnesses`,
///   detail `3 of 3 witnesses in zone 102`.
/// - `staff_note_time`: the earliest note must satisfy
///   `opened_at <= created_at <= resolved_at + note_window_secs`. Pass or fail;
///   fail with detail `no staff note` when there is none.
/// - `vision_confirmed`, `vision_zone`, `vision_time` (only when `vision` is
///   present): confirmed is yes; `camera_zone_id == incident.zone_id`; at least one
///   frame time within `photo_window_secs` of `opened_at`.
///
/// Status for injuries:
/// - `Disputed` when vision is present and any vision check fails, or when
///   other > same and other >= `min_witnesses` (the circle formed somewhere else).
/// - `Corroborated` when the note check passes and either `witness_zone` passes
///   or all vision checks pass.
/// - `Uncorroborated` otherwise.
///
/// Property incidents: the staff report is the first source and vision is the
/// only second source. Vision present with all three checks passing (the
/// confirmed check uses the assessment) is `Corroborated`; vision present with
/// any failure is `Disputed`; no vision is `Uncorroborated` with an info check
/// `vision_present: no assessment for this incident`.
///
/// Zone 0 means unzoned and never counts as agreement or disagreement.
pub fn corroborate(input: &EvidenceInput, cfg: &Config) -> (Corroboration, Vec<Check>) {
    let inc = &input.incident;
    let vision = input.vision.as_ref().map(|v| vision_checks(v, inc, cfg));
    let vision_ok = vision.as_ref().map(|checks| checks.iter().all(|c| c.result == CheckResult::Pass));

    if !inc.kind.is_injury() {
        return match (vision, vision_ok) {
            (Some(checks), Some(true)) => (Corroboration::Corroborated, checks),
            (Some(checks), _) => (Corroboration::Disputed, checks),
            _ => (Corroboration::Uncorroborated, vec![Check::info("vision_present", "no assessment for this incident")]),
        };
    }

    let zoned = |z: u64| z != 0;
    let same = input.witnesses.iter().filter(|w| zoned(w.zone_id) && w.zone_id == inc.zone_id).count() as u32;
    let other = input.witnesses.iter().filter(|w| zoned(w.zone_id) && zoned(inc.zone_id) && w.zone_id != inc.zone_id).count() as u32;
    let witness_ok = same >= cfg.min_witnesses;
    let mut detail = format!("{same} of {} witnesses in zone {}", input.witnesses.len(), inc.zone_id);
    if other > 0 {
        detail += &format!(", {other} in other zones");
    }
    if !witness_ok {
        detail += &format!(", need {}", cfg.min_witnesses);
    }
    let mut checks = vec![if witness_ok { Check::pass("witness_zone", detail) } else { Check::fail("witness_zone", detail) }];

    let tz = cfg.tz_offset_minutes;
    let note_ok = match input.notes.iter().min_by_key(|n| n.created_at) {
        None => {
            checks.push(Check::fail("staff_note_time", "no staff note"));
            false
        }
        Some(n) => {
            let until = inc.resolved_at.saturating_add(cfg.note_window_secs.saturating_mul(MICROS_PER_SEC));
            let ok = inc.opened_at <= n.created_at && n.created_at <= until;
            let detail = format!(
                "first note {}, incident {}-{}, window +{}",
                local_hms(n.created_at, tz),
                local_hms(inc.opened_at, tz),
                local_hms(inc.resolved_at, tz),
                duration(cfg.note_window_secs)
            );
            checks.push(if ok { Check::pass("staff_note_time", detail) } else { Check::fail("staff_note_time", detail) });
            ok
        }
    };
    checks.extend(vision.unwrap_or_default());

    let status = if vision_ok == Some(false) || (other > same && other >= cfg.min_witnesses) {
        Corroboration::Disputed
    } else if note_ok && (witness_ok || vision_ok == Some(true)) {
        Corroboration::Corroborated
    } else {
        Corroboration::Uncorroborated
    };
    (status, checks)
}

const MICROS_PER_SEC: i64 = 1_000_000;

/// `vision_confirmed`, `vision_zone` and `vision_time`, in that order.
fn vision_checks(v: &VisionInfo, inc: &IncidentInfo, cfg: &Config) -> Vec<Check> {
    let tz = cfg.tz_offset_minutes;
    let confirmed = if v.confirmed {
        Check::pass("vision_confirmed", format!("assessment {} says confirmed yes", v.assessment_id))
    } else {
        Check::fail("vision_confirmed", format!("assessment {} says confirmed no, need yes", v.assessment_id))
    };

    let detail = format!("camera {} zone {}, incident zone {}", v.camera_id, v.camera_zone_id, inc.zone_id);
    let zone = if v.camera_zone_id != 0 && v.camera_zone_id == inc.zone_id {
        Check::pass("vision_zone", detail)
    } else {
        Check::fail("vision_zone", detail)
    };

    let window = cfg.photo_window_secs.max(0) as u64 * MICROS_PER_SEC as u64;
    let within = v.frame_times.iter().filter(|t| t.abs_diff(inc.opened_at) <= window).count();
    let mut detail = format!(
        "{within} of {} frames within {} s of open {}",
        v.frame_times.len(),
        cfg.photo_window_secs,
        local_hms(inc.opened_at, tz)
    );
    if let Some(t) = v.frame_times.iter().min_by_key(|t| t.abs_diff(inc.opened_at)) {
        detail += &format!(", nearest {}", local_hms(*t, tz));
    }
    let time = if within > 0 { Check::pass("vision_time", detail) } else { Check::fail("vision_time", detail) };

    vec![confirmed, zone, time]
}

/// `30 min`, or `45 s` when not a whole number of minutes.
fn duration(secs: i64) -> String {
    if secs % 60 == 0 { format!("{} min", secs / 60) } else { format!("{secs} s") }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evidence::{StaffNote, Witness};
    use crate::time::micros_at;
    use crate::IncidentKind;

    const PDT: i32 = -420;

    fn at(h: i64, m: i64, s: i64) -> i64 {
        micros_at(2026, 10, 24, h, m, s, PDT)
    }

    fn witness(band_id: u32, zone_id: u64) -> Witness {
        Witness { band_id, zone_id, rssi: -55, first_seen_at: at(22, 14, 6), last_seen_at: at(22, 20, 0) }
    }

    fn note(created_at: i64) -> StaffNote {
        StaffNote { note_id: 501, author_role: "medic".into(), text: "cold pack and wrap, first aid".into(), cost_cents: Some(18000), created_at }
    }

    fn vision(confirmed: bool, camera_zone_id: u64, frame_times: Vec<i64>) -> VisionInfo {
        VisionInfo {
            assessment_id: 21,
            confirmed,
            confidence: 0.91,
            description: "person falls near the barrier".into(),
            camera_id: 5,
            camera_zone_id,
            frame_shas: frame_times.iter().map(|t| format!("{t:x}")).collect(),
            frame_times,
            model_call_id: 61,
            created_at: at(22, 14, 20),
        }
    }

    /// The hero fall: band 7 in zone 102, bands 2, 4, 9 in the circle, a medic note at 22:26.
    fn fall() -> EvidenceInput {
        EvidenceInput {
            incident: IncidentInfo {
                incident_id: 1,
                kind: IncidentKind::Fall,
                opened_by: "band".into(),
                opened_at: at(22, 14, 5),
                resolved_at: at(22, 31, 0),
                zone_id: 102,
                band_id: 7,
            },
            snapshot: None,
            witnesses: vec![witness(2, 102), witness(4, 102), witness(9, 102)],
            notes: vec![note(at(22, 26, 0))],
            zone: None,
            presence: vec![],
            vision: None,
            record: None,
            policy: None,
        }
    }

    fn property() -> EvidenceInput {
        let mut input = fall();
        input.incident.kind = IncidentKind::Property;
        input.incident.opened_by = "ops".into();
        input.incident.opened_at = at(23, 40, 0);
        input.incident.resolved_at = at(23, 55, 0);
        input.incident.band_id = 0;
        input.witnesses.clear();
        input.notes = vec![note(at(23, 45, 0))];
        input
    }

    fn check<'a>(checks: &'a [Check], name: &str) -> &'a Check {
        checks.iter().find(|c| c.name == name).unwrap()
    }

    fn names(checks: &[Check]) -> Vec<&str> {
        checks.iter().map(|c| c.name.as_str()).collect()
    }

    #[test]
    fn hero_fall_with_witnesses_and_note() {
        let (status, checks) = corroborate(&fall(), &Config::default());
        assert_eq!(status, Corroboration::Corroborated);
        assert_eq!(names(&checks), ["witness_zone", "staff_note_time"]);
        assert_eq!(checks[0].line(), "witness_zone: pass: 3 of 3 witnesses in zone 102");
        assert_eq!(checks[1].line(), "staff_note_time: pass: first note 22:26:00, incident 22:14:05-22:31:00, window +30 min");
        assert!(checks.iter().all(|c| c.reader == crate::Reader::Code));
    }

    #[test]
    fn hero_fall_with_vision_too() {
        let mut input = fall();
        input.vision = Some(vision(true, 102, vec![at(22, 14, 3), at(22, 20, 0)]));
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Corroborated);
        assert_eq!(names(&checks), ["witness_zone", "staff_note_time", "vision_confirmed", "vision_zone", "vision_time"]);
        assert_eq!(check(&checks, "vision_confirmed").detail, "assessment 21 says confirmed yes");
        assert_eq!(check(&checks, "vision_zone").detail, "camera 5 zone 102, incident zone 102");
        assert_eq!(check(&checks, "vision_time").detail, "1 of 2 frames within 120 s of open 22:14:05, nearest 22:14:03");
    }

    #[test]
    fn vision_alone_corroborates_with_note() {
        let mut input = fall();
        input.witnesses = vec![witness(2, 102)];
        input.vision = Some(vision(true, 102, vec![at(22, 15, 0)]));
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Corroborated);
        assert_eq!(check(&checks, "witness_zone").line(), "witness_zone: fail: 1 of 1 witnesses in zone 102, need 2");
    }

    #[test]
    fn too_few_witnesses_is_uncorroborated() {
        let mut input = fall();
        input.witnesses = vec![witness(2, 102)];
        let (status, _) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Uncorroborated);

        input.witnesses.clear();
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Uncorroborated);
        assert_eq!(check(&checks, "witness_zone").detail, "0 of 0 witnesses in zone 102, need 2");
    }

    #[test]
    fn missing_or_late_note_is_uncorroborated() {
        let mut input = fall();
        input.notes.clear();
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Uncorroborated);
        assert_eq!(check(&checks, "staff_note_time").line(), "staff_note_time: fail: no staff note");

        input.notes = vec![note(at(23, 1, 1))];
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Uncorroborated);
        assert_eq!(check(&checks, "staff_note_time").line(), "staff_note_time: fail: first note 23:01:01, incident 22:14:05-22:31:00, window +30 min");

        input.notes = vec![note(at(22, 10, 0))];
        let (_, checks) = corroborate(&input, &Config::default());
        assert_eq!(check(&checks, "staff_note_time").result, CheckResult::Fail);
    }

    #[test]
    fn note_window_edges() {
        let mut input = fall();
        input.notes = vec![note(at(23, 1, 0)), note(at(22, 50, 0))];
        input.notes[0].note_id = 1;
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Corroborated);
        assert!(check(&checks, "staff_note_time").detail.starts_with("first note 22:50:00"));

        input.notes = vec![note(at(23, 1, 0))];
        assert_eq!(corroborate(&input, &Config::default()).0, Corroboration::Corroborated);
        input.notes = vec![note(at(22, 14, 5))];
        assert_eq!(corroborate(&input, &Config::default()).0, Corroboration::Corroborated);
    }

    #[test]
    fn circle_elsewhere_is_disputed() {
        let mut input = fall();
        input.witnesses = vec![witness(2, 105), witness(4, 105), witness(9, 102)];
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Disputed);
        assert_eq!(check(&checks, "witness_zone").line(), "witness_zone: fail: 1 of 3 witnesses in zone 102, 2 in other zones, need 2");
    }

    #[test]
    fn one_stray_witness_is_not_a_dispute() {
        let mut input = fall();
        input.witnesses.push(witness(11, 105));
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Corroborated);
        assert_eq!(check(&checks, "witness_zone").detail, "3 of 4 witnesses in zone 102, 1 in other zones");
    }

    #[test]
    fn failing_vision_disputes_an_injury() {
        let cases = [
            (vision(false, 102, vec![at(22, 14, 3)]), "vision_confirmed", "assessment 21 says confirmed no, need yes"),
            (vision(true, 105, vec![at(22, 14, 3)]), "vision_zone", "camera 5 zone 105, incident zone 102"),
            (vision(true, 102, vec![at(22, 17, 0)]), "vision_time", "0 of 1 frames within 120 s of open 22:14:05, nearest 22:17:00"),
            (vision(true, 102, vec![]), "vision_time", "0 of 0 frames within 120 s of open 22:14:05"),
        ];
        for (v, name, detail) in cases {
            let mut input = fall();
            input.vision = Some(v);
            let (status, checks) = corroborate(&input, &Config::default());
            assert_eq!(status, Corroboration::Disputed, "{name}");
            assert_eq!(check(&checks, name).result, CheckResult::Fail);
            assert_eq!(check(&checks, name).detail, detail);
        }
    }

    #[test]
    fn unzoned_never_agrees() {
        let mut input = fall();
        input.incident.zone_id = 0;
        input.witnesses = vec![witness(2, 0), witness(4, 0), witness(9, 102)];
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Uncorroborated);
        assert_eq!(check(&checks, "witness_zone").detail, "0 of 3 witnesses in zone 0, need 2");
    }

    #[test]
    fn sos_uses_the_injury_rule() {
        let mut input = fall();
        input.incident.kind = IncidentKind::Sos;
        assert_eq!(corroborate(&input, &Config::default()).0, Corroboration::Corroborated);
    }

    #[test]
    fn property_needs_vision() {
        let (status, checks) = corroborate(&property(), &Config::default());
        assert_eq!(status, Corroboration::Uncorroborated);
        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].line(), "vision_present: info: no assessment for this incident");

        let mut input = property();
        input.vision = Some(vision(true, 102, vec![at(23, 39, 30)]));
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Corroborated);
        assert_eq!(names(&checks), ["vision_confirmed", "vision_zone", "vision_time"]);

        input.vision = Some(vision(true, 101, vec![at(23, 39, 30)]));
        let (status, checks) = corroborate(&input, &Config::default());
        assert_eq!(status, Corroboration::Disputed);
        assert_eq!(check(&checks, "vision_zone").result, CheckResult::Fail);

        input.vision = Some(vision(false, 102, vec![at(23, 39, 30)]));
        assert_eq!(corroborate(&input, &Config::default()).0, Corroboration::Disputed);
    }

    #[test]
    fn config_changes_the_thresholds() {
        let cfg = Config { min_witnesses: 4, note_window_secs: 90, photo_window_secs: 1, ..Config::default() };
        let mut input = fall();
        input.notes = vec![note(at(22, 32, 0))];
        input.vision = Some(vision(true, 102, vec![at(22, 14, 3)]));
        let (status, checks) = corroborate(&input, &cfg);
        assert_eq!(status, Corroboration::Disputed);
        assert_eq!(check(&checks, "witness_zone").detail, "3 of 3 witnesses in zone 102, need 4");
        assert_eq!(check(&checks, "staff_note_time").detail, "first note 22:32:00, incident 22:14:05-22:31:00, window +90 s");
        assert_eq!(check(&checks, "vision_time").detail, "0 of 1 frames within 1 s of open 22:14:05, nearest 22:14:03");

        let utc = Config { tz_offset_minutes: 0, ..Config::default() };
        let (_, checks) = corroborate(&fall(), &utc);
        assert_eq!(check(&checks, "staff_note_time").detail, "first note 05:26:00, incident 05:14:05-05:31:00, window +30 min");
    }
}
