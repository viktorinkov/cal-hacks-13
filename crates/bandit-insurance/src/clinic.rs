//! The hospital report for an injury claim. The module draws which report the
//! hospital sends with its seeded generator: 3 in 6 match the incident, and 1
//! in 6 each say the injury happened at home, describe a different injury, or
//! are dated before the event. The writer is told the case and the visit date;
//! code rejects a report that does not follow them.

use crate::medical::{ExtractedRecord, name_tokens, validate_record};
use crate::money::format_cents;
use crate::time::{civil_from_days, parse_date};
use crate::payloads::ClinicPayload;
use serde::{Deserialize, Serialize};

/// A hospital report has its clinical note on page 1 and the itemized bill on page 2.
pub const REPORT_PAGES: u32 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scenario {
    Matches,
    HurtAtHome,
    DifferentInjury,
    VisitBeforeEvent,
}

impl Scenario {
    pub const MISMATCHES: [Scenario; 3] = [Scenario::HurtAtHome, Scenario::DifferentInjury, Scenario::VisitBeforeEvent];

    pub fn as_str(self) -> &'static str {
        match self {
            Scenario::Matches => "matches",
            Scenario::HurtAtHome => "hurt_at_home",
            Scenario::DifferentInjury => "different_injury",
            Scenario::VisitBeforeEvent => "visit_before_event",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [Scenario::Matches, Scenario::HurtAtHome, Scenario::DifferentInjury, Scenario::VisitBeforeEvent]
            .into_iter()
            .find(|c| c.as_str() == s)
    }

    /// One roll of the seeded generator: 3 in 6 match, 1 in 6 each for the three mismatches.
    pub fn draw(roll: u32) -> Self {
        match roll % 6 {
            0..=2 => Scenario::Matches,
            3 => Scenario::HurtAtHome,
            4 => Scenario::DifferentInjury,
            _ => Scenario::VisitBeforeEvent,
        }
    }

    /// The staff's choice when filing for an attendee: `matches`, `mismatch`
    /// (one of the three mismatches, by the roll) or `random` (the usual draw).
    pub fn pick(choice: &str, roll: u32) -> Result<Self, String> {
        match choice {
            "matches" => Ok(Scenario::Matches),
            "mismatch" => Ok(Scenario::MISMATCHES[(roll % 3) as usize]),
            "random" => Ok(Scenario::draw(roll)),
            other => Err(format!("report is matches, mismatch or random, not {other}")),
        }
    }

    pub fn matches(self) -> bool {
        self == Scenario::Matches
    }

    /// The visit date for the incident's local date: the incident day, or 1 to
    /// 3 days before it for a visit before the event.
    pub fn visit_date(self, incident_date: &str, roll: u32) -> String {
        let Some(day) = parse_date(incident_date) else {
            return incident_date.to_string();
        };
        let day = if self == Scenario::VisitBeforeEvent { day - 1 - (roll / 6 % 3) as i64 } else { day };
        let (y, m, d) = civil_from_days(day);
        format!("{y:04}-{m:02}-{d:02}")
    }

    /// What the writer is told the report says.
    pub fn instructions(self) -> &'static str {
        match self {
            Scenario::Matches => {
                "The report matches the incident: the patient was hurt at the event, in the zone and the way the medic's notes and the patient's own words describe, and the diagnoses are that injury. The history names the event."
            }
            Scenario::HurtAtHome => {
                "The patient was hurt at home, not at the event: the history says, in the patient's words to the clinician, that the injury happened at home before they went to the event (for example the evening before), and that it only got worse there. The diagnoses are that injury and include the place-of-occurrence code Y92.009 (private residence)."
            }
            Scenario::DifferentInjury => {
                "The report is for a different injury or illness from the one in the medic's notes and the patient's words: another part of the body and a cause the incident cannot explain (for example a cut hand from a kitchen knife, or a sore throat). The history describes that problem, not the incident."
            }
            Scenario::VisitBeforeEvent => {
                "The report matches the injury the medic's notes describe, but the visit happened before the event: the visit date is given below and comes before the incident, and the history tells the injury as it happened on that earlier day."
            }
        }
    }
}

/// Checks a written report against its case: the record must validate, be made
/// out to the claimant, be dated on the visit date throughout, add up, and say
/// what the case says where code can tell.
pub fn check_report(p: &ClinicPayload, record: &ExtractedRecord) -> Result<(), Vec<String>> {
    let valid = validate_record(record.clone(), REPORT_PAGES)?;
    let r = &valid.record;
    let mut problems: Vec<String> = valid.dropped.iter().map(|d| format!("dropped {d}")).collect();
    let want = name_tokens(&p.claimant_name);
    if !want.is_empty() && name_tokens(&r.patient.name) != want {
        problems.push(format!("the patient must be {}, not {}", p.claimant_name, r.patient.name));
    }
    if r.encounter.date_of_service != p.visit_date {
        problems.push(format!("the visit date must be {}, not {}", p.visit_date, r.encounter.date_of_service));
    }
    for s in r.services.iter().filter(|s| s.date_of_service != p.visit_date) {
        problems.push(format!("service {} must be dated {}, not {}", s.code, p.visit_date, s.date_of_service));
    }
    let sum: u64 = r.services.iter().map(|s| s.charge_cents).sum();
    if sum != r.total_billed_cents {
        problems.push(format!("the total billed {} is not the sum of the services, {}", format_cents(r.total_billed_cents), format_cents(sum)));
    }
    let history = r.encounter.history.to_lowercase();
    let scenario = Scenario::parse(&p.scenario);
    if scenario == Some(Scenario::HurtAtHome) && !history.contains("home") {
        problems.push("the history must say the injury happened at home".to_string());
    }
    if scenario == Some(Scenario::Matches) && !history.contains(&p.venue_name.to_lowercase()) {
        problems.push(format!("the history must name the event, {}", p.venue_name));
    }
    if problems.is_empty() { Ok(()) } else { Err(problems) }
}

/// The report as the hospital prints it: the clinical note on page 1 and the itemized bill on page 2.
pub fn as_printed(record: &ExtractedRecord) -> ExtractedRecord {
    let mut r = record.clone();
    r.patient.page = 1;
    r.provider.page = 1;
    r.encounter.page = 1;
    r.diagnoses.iter_mut().for_each(|d| d.page = 1);
    r.services.iter_mut().for_each(|s| s.page = 2);
    r
}

/// The report's text, one string per page, as the hospital prints it.
pub fn printed_pages(record: &ExtractedRecord) -> Vec<String> {
    crate::report::print_record(&as_printed(record), REPORT_PAGES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::medical::*;

    fn payload(scenario: Scenario) -> ClinicPayload {
        ClinicPayload {
            claim_id: 1,
            report_id: 1,
            scenario: scenario.as_str().into(),
            visit_date: scenario.visit_date("2026-10-24", 3),
            incident_date: "2026-10-24".into(),
            incident_time: "21:40".into(),
            incident_kind: "fall".into(),
            venue_name: "Cal Hacks 13.0".into(),
            zone_name: "Main stage".into(),
            claimant_name: "Maya Chen".into(),
            statement: "I slipped on a spilled drink by the stage and hurt my wrist.".into(),
            medic_notes: vec!["right wrist sprain, ice and wrap".into()],
        }
    }

    fn record(date: &str, history: &str) -> ExtractedRecord {
        ExtractedRecord {
            document_kind: "urgent_care_record".into(),
            patient: ExtractedPatient { name: "Maya Chen".into(), date_of_birth: "2001-03-14".into(), page: 1 },
            provider: ExtractedProvider { name: "Wrenfield Urgent Care".into(), address: "1 Shattuck Ave, Berkeley CA".into(), page: 1 },
            encounter: ExtractedEncounter { date_of_service: date.into(), time: "23:05".into(), reason_for_visit: "wrist pain".into(), history: history.into(), page: 1 },
            diagnoses: vec![ExtractedDiagnosis { code: "S63.501A".into(), description: "Sprain of right wrist".into(), page: 1 }],
            services: vec![ExtractedService { code: "99213".into(), description: "Office visit".into(), date_of_service: date.into(), units: 1, charge_cents: 18_000, page: 2 }],
            invoice_number: "UC-1".into(),
            total_billed_cents: 18_000,
        }
    }

    #[test]
    fn half_the_draws_match() {
        let matched = (0..600u32).filter(|r| Scenario::draw(*r).matches()).count();
        assert_eq!(matched, 300);
        for m in Scenario::MISMATCHES {
            assert_eq!((0..600u32).filter(|r| Scenario::draw(*r) == m).count(), 100);
        }
    }

    #[test]
    fn staff_choices() {
        assert_eq!(Scenario::pick("matches", 5).unwrap(), Scenario::Matches);
        assert!((0..9).all(|r| !Scenario::pick("mismatch", r).unwrap().matches()));
        assert_eq!(Scenario::pick("random", 4).unwrap(), Scenario::DifferentInjury);
        assert!(Scenario::pick("fake", 1).is_err());
    }

    #[test]
    fn a_visit_before_the_event_is_dated_earlier() {
        assert_eq!(Scenario::Matches.visit_date("2026-10-24", 7), "2026-10-24");
        assert_eq!(Scenario::VisitBeforeEvent.visit_date("2026-10-01", 0), "2026-09-30");
        assert_eq!(Scenario::VisitBeforeEvent.visit_date("2026-10-24", 12), "2026-10-21");
    }

    #[test]
    fn code_rejects_a_report_off_its_case() {
        let p = payload(Scenario::Matches);
        assert!(check_report(&p, &record("2026-10-24", "Slipped on a drink near the main stage at Cal Hacks 13.0.")).is_ok());
        let wrong = check_report(&p, &record("2026-10-23", "Fell at home.")).unwrap_err();
        assert!(wrong.iter().any(|w| w.contains("visit date must be 2026-10-24")), "{wrong:?}");
        assert!(wrong.iter().any(|w| w.contains("name the event")), "{wrong:?}");
        let home = payload(Scenario::HurtAtHome);
        assert!(check_report(&home, &record("2026-10-24", "Twisted it at the event.")).unwrap_err().iter().any(|w| w.contains("at home")));
        let mut other = record("2026-10-24", "Cal Hacks 13.0");
        other.patient.name = "Sam Patel".into();
        other.total_billed_cents = 1;
        let e = check_report(&p, &other).unwrap_err();
        assert!(e.iter().any(|w| w.contains("patient must be Maya Chen")) && e.iter().any(|w| w.contains("total billed")), "{e:?}");
    }

    #[test]
    fn prints_the_note_then_the_bill() {
        let pages = printed_pages(&record("2026-10-24", "Slipped near the stage."));
        assert_eq!(pages.len(), 2);
        assert!(pages[0].starts_with("Wrenfield Urgent Care") && pages[0].contains("HOSPITAL REPORT") && pages[0].contains("S63.501A"), "{}", pages[0]);
        assert!(pages[1].contains("99213") && pages[1].contains("Total billed: $180.00") && !pages[1].contains("Patient"), "{}", pages[1]);
    }
}
