//! Which medical service lines the medical-payments cover pays, and how much.
//! The venue's fee schedule caps each code at a reasonable and customary
//! amount per unit; anything the schedule does not list goes to a person.
//! The schedule is the confirmed policy's schedule of benefits, or
//! `FEE_SCHEDULE` when the policy states none.

use crate::medical::ValidRecord;
use crate::money::format_cents;
use crate::time::date_diff_days;
use crate::{Cents, Check};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeEntry {
    pub code: &'static str,
    pub description: &'static str,
    /// Most the cover pays per unit.
    pub max_allowed_cents: Cents,
}

const fn fee(code: &'static str, description: &'static str, max_allowed_cents: Cents) -> FeeEntry {
    FeeEntry { code, description, max_allowed_cents }
}

/// The venue's schedule (starting values). Codes cover what a fall at a
/// public event is treated with, from the first-aid tent to the ER:
///
/// | code | description | max per unit |
/// |---|---|---|
/// | 99211 | first-aid or office visit, minimal | $65.00 |
/// | 99202 | new patient visit, straightforward | $120.00 |
/// | 99203 | new patient visit, low complexity | $185.00 |
/// | 99204 | new patient visit, moderate complexity | $275.00 |
/// | 99213 | established patient visit, low complexity | $140.00 |
/// | 99283 | emergency department visit, moderate | $480.00 |
/// | 99284 | emergency department visit, high | $820.00 |
/// | 73100 | X-ray wrist, 2 views | $120.00 |
/// | 73110 | X-ray wrist, 3 or more views | $165.00 |
/// | 73610 | X-ray ankle, 3 or more views | $160.00 |
/// | 70450 | CT head without contrast | $1,100.00 |
/// | 29125 | short arm splint, application | $210.00 |
/// | 29515 | short leg splint, application | $220.00 |
/// | 12001 | simple wound repair up to 2.5 cm | $280.00 |
/// | 96372 | therapeutic injection | $65.00 |
/// | J1885 | ketorolac injection, 15 mg | $25.00 |
/// | L3908 | wrist-hand orthosis, prefabricated | $95.00 |
/// | A4570 | splint supply | $45.00 |
/// | A6448 | light compression bandage | $25.00 |
/// | A9273 | cold or hot pack | $30.00 |
/// | 99070 | supplies and materials | $60.00 |
pub const FEE_SCHEDULE: &[FeeEntry] = &[
    fee("99211", "first-aid or office visit, minimal", 6_500),
    fee("99202", "new patient visit, straightforward", 12_000),
    fee("99203", "new patient visit, low complexity", 18_500),
    fee("99204", "new patient visit, moderate complexity", 27_500),
    fee("99213", "established patient visit, low complexity", 14_000),
    fee("99283", "emergency department visit, moderate", 48_000),
    fee("99284", "emergency department visit, high", 82_000),
    fee("73100", "X-ray wrist, 2 views", 12_000),
    fee("73110", "X-ray wrist, 3 or more views", 16_500),
    fee("73610", "X-ray ankle, 3 or more views", 16_000),
    fee("70450", "CT head without contrast", 110_000),
    fee("29125", "short arm splint, application", 21_000),
    fee("29515", "short leg splint, application", 22_000),
    fee("12001", "simple wound repair up to 2.5 cm", 28_000),
    fee("96372", "therapeutic injection", 6_500),
    fee("J1885", "ketorolac injection, 15 mg", 2_500),
    fee("L3908", "wrist-hand orthosis, prefabricated", 9_500),
    fee("A4570", "splint supply", 4_500),
    fee("A6448", "light compression bandage", 2_500),
    fee("A9273", "cold or hot pack", 3_000),
    fee("99070", "supplies and materials", 6_000),
];

/// The schedule entry for a code; surrounding space and letter case are ignored.
pub fn lookup(code: &str) -> Option<&'static FeeEntry> {
    let code = code.trim();
    FEE_SCHEDULE.iter().find(|e| e.code.eq_ignore_ascii_case(code))
}

/// One code of a policy's schedule of benefits.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeeLine {
    pub code: String,
    pub description: String,
    /// Most the cover pays per unit.
    pub max_allowed_cents: Cents,
}

impl From<&FeeEntry> for FeeLine {
    fn from(e: &FeeEntry) -> Self {
        FeeLine { code: e.code.into(), description: e.description.into(), max_allowed_cents: e.max_allowed_cents }
    }
}

/// `FEE_SCHEDULE` as owned lines, for a policy that states no schedule of benefits.
pub fn default_schedule() -> Vec<FeeLine> {
    FEE_SCHEDULE.iter().map(FeeLine::from).collect()
}

/// The line for a code in `schedule`; surrounding space and letter case are ignored.
pub fn lookup_in<'a>(schedule: &'a [FeeLine], code: &str) -> Option<&'a FeeLine> {
    let code = code.trim();
    schedule.iter().find(|e| e.code.eq_ignore_ascii_case(code))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineOutcome {
    /// Paid as billed.
    Covered,
    /// Paid at the schedule's cap.
    Reduced,
    /// Not paid.
    Excluded,
}

impl LineOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            LineOutcome::Covered => "covered",
            LineOutcome::Reduced => "reduced",
            LineOutcome::Excluded => "excluded",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LineDecision {
    /// 1-based position among the record's services.
    pub line_no: u32,
    pub code: String,
    pub description: String,
    pub service_date: String,
    pub units: u32,
    pub billed_cents: Cents,
    /// `min(billed, cap x units)`; 0 when excluded.
    pub allowed_cents: Cents,
    /// What the cover pays for this line; equals `allowed_cents`.
    pub covered_cents: Cents,
    pub outcome: LineOutcome,
    pub reason: String,
    pub page: u32,
}

const OUTSIDE_WINDOW: &str = "outside the service window";
const NOT_ON_SCHEDULE: &str = "not on the venue fee schedule";

/// Per service line against `schedule`, in order:
/// - dated before `incident_date` or more than `window_days` after it ->
///   `Excluded`, reason `outside the service window`;
/// - code not on the schedule -> `Excluded`, reason `not on the venue fee schedule`;
/// - billed at or under `cap x units` -> `Covered`, reason `within the schedule`;
/// - otherwise -> `Reduced` to `cap x units`, reason `reduced to the schedule cap of $X per unit`.
pub fn cover_lines(rec: &ValidRecord, incident_date: &str, window_days: u32, schedule: &[FeeLine]) -> Vec<LineDecision> {
    rec.record
        .services
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let in_window = date_diff_days(incident_date, &s.date_of_service).is_some_and(|d| (0..=window_days as i64).contains(&d));
            let (outcome, allowed, reason) = match lookup_in(schedule, &s.code) {
                _ if !in_window => (LineOutcome::Excluded, 0, OUTSIDE_WINDOW.to_string()),
                None => (LineOutcome::Excluded, 0, NOT_ON_SCHEDULE.to_string()),
                Some(e) => {
                    let cap = e.max_allowed_cents.saturating_mul(s.units as Cents);
                    if s.charge_cents <= cap {
                        (LineOutcome::Covered, s.charge_cents, "within the schedule".to_string())
                    } else {
                        let reason = format!("reduced to the schedule cap of {} per unit", format_cents(e.max_allowed_cents));
                        (LineOutcome::Reduced, cap, reason)
                    }
                }
            };
            LineDecision {
                line_no: i as u32 + 1,
                code: s.code.clone(),
                description: s.description.clone(),
                service_date: s.date_of_service.clone(),
                units: s.units,
                billed_cents: s.charge_cents,
                allowed_cents: allowed,
                covered_cents: allowed,
                outcome,
                reason,
                page: s.page,
            }
        })
        .collect()
}

/// Sum of `covered_cents`.
pub fn covered_total(lines: &[LineDecision]) -> Cents {
    lines.iter().map(|l| l.covered_cents).sum()
}

/// One check summarising the lines: `record_lines` fails when any line was
/// excluded because its code is not on the schedule (a person must look),
/// detail `5 covered, 2 reduced, 0 excluded`; otherwise pass.
pub fn lines_check(lines: &[LineDecision]) -> Check {
    let count = |o: LineOutcome| lines.iter().filter(|l| l.outcome == o).count();
    let detail = format!(
        "{} covered, {} reduced, {} excluded",
        count(LineOutcome::Covered),
        count(LineOutcome::Reduced),
        count(LineOutcome::Excluded)
    );
    let unlisted: Vec<&str> = lines.iter().filter(|l| l.reason == NOT_ON_SCHEDULE).map(|l| l.code.as_str()).collect();
    if unlisted.is_empty() {
        Check::pass("record_lines", detail)
    } else {
        Check::fail("record_lines", format!("{detail}; not on the schedule: {}", unlisted.join(", ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CheckResult;
    use crate::medical::fixtures::{jordan_record, maya_record, service};
    use crate::medical::validate_record;

    #[test]
    fn schedule_is_complete_and_unique() {
        assert_eq!(FEE_SCHEDULE.len(), 21);
        for (i, e) in FEE_SCHEDULE.iter().enumerate() {
            assert!(crate::medical::is_cpt_or_hcpcs(e.code), "{}", e.code);
            assert!(FEE_SCHEDULE[..i].iter().all(|o| o.code != e.code), "{} twice", e.code);
        }
        assert_eq!(lookup("70450").unwrap().max_allowed_cents, 110_000);
        assert_eq!(lookup(" l3908 ").unwrap().max_allowed_cents, 9_500);
        assert_eq!(lookup("99999"), None);
    }

    #[test]
    fn first_aid_bill_is_covered_in_full() {
        let v = validate_record(maya_record(), 1).unwrap();
        let lines = cover_lines(&v, "2026-10-24", 365, &default_schedule());
        assert_eq!(lines.len(), 5);
        assert!(lines.iter().all(|l| l.outcome == LineOutcome::Covered && l.reason == "within the schedule"));
        assert_eq!(covered_total(&lines), 18_000);
        let check = lines_check(&lines);
        assert_eq!(check.result, CheckResult::Pass);
        assert_eq!(check.detail, "5 covered, 0 reduced, 0 excluded");
    }

    #[test]
    fn urgent_care_bill_is_reduced_to_the_schedule() {
        let v = validate_record(jordan_record(), 2).unwrap();
        let lines = cover_lines(&v, "2026-10-24", 365, &default_schedule());
        let covered: Vec<Cents> = lines.iter().map(|l| l.covered_cents).collect();
        assert_eq!(covered, [27_500, 16_500, 21_000, 9_500, 6_000, 6_500, 2_500]);
        assert_eq!(covered_total(&lines), 89_500);
        assert!(lines.iter().all(|l| l.allowed_cents == l.covered_cents));
        assert_eq!(lines[0].outcome, LineOutcome::Reduced);
        assert_eq!(lines[0].reason, "reduced to the schedule cap of $275.00 per unit");
        assert_eq!(lines[4].outcome, LineOutcome::Covered);
        assert_eq!((lines[6].line_no, lines[6].code.as_str(), lines[6].page), (7, "J1885", 2));
        assert_eq!(lines_check(&lines).detail, "1 covered, 6 reduced, 0 excluded");
    }

    #[test]
    fn caps_scale_with_units() {
        let mut raw = maya_record();
        raw.services = vec![service("J1885", "ketorolac injection, 30 mg", "2026-10-24", 60, 1)];
        raw.services[0].units = 2;
        raw.total_billed_cents = 6_000;
        let lines = cover_lines(&validate_record(raw, 1).unwrap(), "2026-10-24", 365, &default_schedule());
        assert_eq!((lines[0].outcome, lines[0].allowed_cents), (LineOutcome::Reduced, 5_000));
    }

    #[test]
    fn excludes_early_lines_and_unknown_codes() {
        let mut raw = jordan_record();
        raw.services.push(service("99213", "earlier visit", "2026-10-20", 140, 2));
        raw.services.push(service("E0114", "crutches", "2026-10-25", 80, 2));
        raw.services.push(service("A4570", "splint supply", "2026-10-25", 45, 3));
        let v = validate_record(raw, 2).unwrap();
        assert_eq!(v.dropped, ["service 10 (A4570): page 3 is outside 1..=2"]);

        let lines = cover_lines(&v, "2026-10-24", 365, &default_schedule());
        assert_eq!(lines.len(), 9);
        assert_eq!((lines[7].outcome, lines[7].covered_cents, lines[7].reason.as_str()), (LineOutcome::Excluded, 0, "outside the service window"));
        assert_eq!((lines[8].outcome, lines[8].covered_cents, lines[8].reason.as_str()), (LineOutcome::Excluded, 0, "not on the venue fee schedule"));
        assert_eq!(covered_total(&lines), 89_500);

        let check = lines_check(&lines);
        assert_eq!(check.result, CheckResult::Fail);
        assert_eq!(check.detail, "1 covered, 6 reduced, 2 excluded; not on the schedule: E0114");
    }

    #[test]
    fn window_bounds_are_inclusive() {
        let v = validate_record(jordan_record(), 2).unwrap();
        assert_eq!(covered_total(&cover_lines(&v, "2026-10-24", 1, &default_schedule())), 89_500);
        assert_eq!(covered_total(&cover_lines(&v, "2026-10-24", 0, &default_schedule())), 0);
        assert_eq!(covered_total(&cover_lines(&v, "2026-10-26", 365, &default_schedule())), 0);
        let only_window = cover_lines(&v, "2026-10-24", 0, &default_schedule());
        assert_eq!(lines_check(&only_window).result, CheckResult::Pass);
    }
}
