//! The medical record: a synthetic PDF (first-aid record, urgent-care record
//! with an itemised bill) that Claude reads into `ExtractedRecord`. Code then
//! validates it and checks it against the incident; coverage and amounts are
//! decided in `fee_schedule`.

use crate::money::format_cents;
use crate::time::{date_diff_days, parse_date};
use crate::{Cents, Check};
use serde::{Deserialize, Serialize};

/// What the model returns. `schemas::medical_record_schema` mirrors these
/// structs field for field. Unknown text fields are empty strings, never guesses.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExtractedRecord {
    /// `first_aid_record`, `urgent_care_record`, `emergency_record` or `other`.
    pub document_kind: String,
    pub patient: ExtractedPatient,
    pub provider: ExtractedProvider,
    pub encounter: ExtractedEncounter,
    pub diagnoses: Vec<ExtractedDiagnosis>,
    pub services: Vec<ExtractedService>,
    pub invoice_number: String,
    pub total_billed_cents: Cents,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExtractedPatient {
    pub name: String,
    /// `YYYY-MM-DD` or empty.
    pub date_of_birth: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExtractedProvider {
    pub name: String,
    pub address: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExtractedEncounter {
    /// `YYYY-MM-DD`.
    pub date_of_service: String,
    /// `HH:MM` or empty.
    pub time: String,
    pub reason_for_visit: String,
    /// The history of present illness as written: how the patient says it happened.
    pub history: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExtractedDiagnosis {
    /// ICD-10-CM, for example `S63.501A`.
    pub code: String,
    pub description: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExtractedService {
    /// CPT (`99213`, `0001T` style: 4 digits and a digit or letter) or HCPCS
    /// Level II (`A4570`: a letter A-V and 4 digits).
    pub code: String,
    pub description: String,
    /// `YYYY-MM-DD`.
    pub date_of_service: String,
    pub units: u32,
    /// The line's total charge (all units), in cents.
    pub charge_cents: Cents,
    pub page: u32,
}

/// A record that passed validation, plus what was dropped and why.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ValidRecord {
    pub record: ExtractedRecord,
    /// One line per dropped item, for example `service 3 (A9999): page 7 is outside 1..=2`.
    pub dropped: Vec<String>,
}

/// ICD-10-CM shape: a letter (not U), a digit, a digit or letter, then
/// optionally a dot and 1 to 4 digits or letters. `S63.501A`, `W01.XXXA`, `J02.0`.
pub fn is_icd10(code: &str) -> bool {
    let b = code.as_bytes();
    let head = b.len() >= 3
        && b[0].is_ascii_alphabetic()
        && !b[0].eq_ignore_ascii_case(&b'U')
        && b[1].is_ascii_digit()
        && b[2].is_ascii_alphanumeric();
    head && match &b[3..] {
        [] => true,
        [b'.', rest @ ..] => (1..=4).contains(&rest.len()) && rest.iter().all(u8::is_ascii_alphanumeric),
        _ => false,
    }
}

/// CPT (4 digits then a digit or a letter) or HCPCS Level II (a letter A-V then 4 digits).
pub fn is_cpt_or_hcpcs(code: &str) -> bool {
    let b = code.as_bytes();
    if b.len() != 5 {
        return false;
    }
    let cpt = b[..4].iter().all(u8::is_ascii_digit) && b[4].is_ascii_alphanumeric();
    let hcpcs = (b'A'..=b'V').contains(&b[0].to_ascii_uppercase()) && b[1..].iter().all(u8::is_ascii_digit);
    cpt || hcpcs
}

/// Lowercase alphabetic tokens of a name, punctuation removed, single letters
/// (middle initials) dropped: `Jane A. Doe` -> `["jane", "doe"]`.
pub fn name_tokens(name: &str) -> Vec<String> {
    // Hyphens and commas separate words (`Garcia-Lopez`, `Doe, Jane`); other punctuation is removed (`O'Brien`).
    name.split(|c: char| c.is_whitespace() || c == '-' || c == ',')
        .map(|t| t.chars().filter(|c| c.is_alphabetic()).flat_map(char::to_lowercase).collect::<String>())
        .filter(|t| t.chars().count() > 1)
        .collect()
}

fn trim(s: &mut String) {
    *s = s.trim().to_string();
}

fn trim_code(s: &mut String) {
    *s = s.trim().to_uppercase();
}

/// Validation, in this order:
/// - `page_count` must be at least 1;
/// - trims every text field; codes are uppercased;
/// - a diagnosis or service whose `page` is outside `1..=page_count`, whose
///   code fails the shape check, or (services) whose date does not parse or whose
///   `units` is 0 is dropped, with a line in `dropped`;
/// - the patient and encounter pages must be in range and the encounter date
///   must parse, otherwise the whole record is rejected;
/// - the record is rejected when no diagnosis or no service remains.
///
/// `Err` carries the reasons for rejection.
pub fn validate_record(raw: ExtractedRecord, page_count: u32) -> Result<ValidRecord, Vec<String>> {
    if page_count == 0 {
        return Err(vec!["page_count must be at least 1".to_string()]);
    }
    let mut rec = raw;
    for s in [
        &mut rec.document_kind,
        &mut rec.patient.name,
        &mut rec.patient.date_of_birth,
        &mut rec.provider.name,
        &mut rec.provider.address,
        &mut rec.encounter.date_of_service,
        &mut rec.encounter.time,
        &mut rec.encounter.reason_for_visit,
        &mut rec.encounter.history,
        &mut rec.invoice_number,
    ] {
        trim(s);
    }
    let page_problem = |page: u32| (!(1..=page_count).contains(&page)).then(|| format!("page {page} is outside 1..={page_count}"));

    let mut dropped = Vec::new();
    let mut diagnoses = Vec::new();
    for (i, mut d) in std::mem::take(&mut rec.diagnoses).into_iter().enumerate() {
        trim_code(&mut d.code);
        trim(&mut d.description);
        let mut why: Vec<String> = page_problem(d.page).into_iter().collect();
        if !is_icd10(&d.code) {
            why.push("not an ICD-10-CM code".to_string());
        }
        if why.is_empty() {
            diagnoses.push(d);
        } else {
            dropped.push(format!("diagnosis {} ({}): {}", i + 1, d.code, why.join("; ")));
        }
    }
    let mut services = Vec::new();
    for (i, mut s) in std::mem::take(&mut rec.services).into_iter().enumerate() {
        trim_code(&mut s.code);
        trim(&mut s.description);
        trim(&mut s.date_of_service);
        let mut why: Vec<String> = page_problem(s.page).into_iter().collect();
        if !is_cpt_or_hcpcs(&s.code) {
            why.push("not a CPT or HCPCS code".to_string());
        }
        if parse_date(&s.date_of_service).is_none() {
            why.push(format!("date \"{}\" does not parse", s.date_of_service));
        }
        if s.units == 0 {
            why.push("units is 0".to_string());
        }
        if why.is_empty() {
            services.push(s);
        } else {
            dropped.push(format!("service {} ({}): {}", i + 1, s.code, why.join("; ")));
        }
    }
    rec.diagnoses = diagnoses;
    rec.services = services;

    let mut errors = Vec::new();
    if let Some(p) = page_problem(rec.patient.page) {
        errors.push(format!("patient {p}"));
    }
    if let Some(p) = page_problem(rec.encounter.page) {
        errors.push(format!("encounter {p}"));
    }
    if parse_date(&rec.encounter.date_of_service).is_none() {
        errors.push(format!("encounter date \"{}\" does not parse", rec.encounter.date_of_service));
    }
    if rec.diagnoses.is_empty() {
        errors.push("no valid diagnosis".to_string());
    }
    if rec.services.is_empty() {
        errors.push("no valid service".to_string());
    }
    if errors.is_empty() { Ok(ValidRecord { record: rec, dropped }) } else { Err(errors) }
}

/// Code checks of the record against the claim, each with both values:
/// - `record_patient_match`: pass when every token of the shorter of the two
///   names (claimant name, patient name) appears in the other;
/// - `record_date_window`: pass when the encounter date is on or after
///   `incident_date` and at most `window_days` later;
/// - `record_injury_code`: pass when at least one diagnosis starts with `S` or `T`
///   (ICD-10 chapter 19, injuries);
/// - `record_totals`: pass when the service charges add up to `total_billed_cents`
///   (detail shows both sums as dollars).
pub fn record_checks(rec: &ValidRecord, claimant_name: &str, incident_date: &str, window_days: u32) -> Vec<Check> {
    let r = &rec.record;
    let mut checks = Vec::new();

    let patient = &r.patient.name;
    let (a, b) = (name_tokens(claimant_name), name_tokens(patient));
    let (short, long) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
    let detail = format!("claimant \"{claimant_name}\", record patient \"{patient}\"");
    checks.push(if !short.is_empty() && short.iter().all(|t| long.contains(t)) {
        Check::pass("record_patient_match", detail)
    } else {
        Check::fail("record_patient_match", detail)
    });

    let encounter = &r.encounter.date_of_service;
    checks.push(match date_diff_days(incident_date, encounter) {
        Some(d) => {
            let detail = format!("encounter {encounter}, incident {incident_date}: {d} days after, window {window_days} days");
            if (0..=window_days as i64).contains(&d) {
                Check::pass("record_date_window", detail)
            } else {
                Check::fail("record_date_window", detail)
            }
        }
        None => Check::fail("record_date_window", format!("encounter {encounter}, incident {incident_date}: a date does not parse")),
    });

    let codes: Vec<&str> = r.diagnoses.iter().map(|d| d.code.as_str()).collect();
    let detail = format!("diagnoses {}", if codes.is_empty() { "none".to_string() } else { codes.join(", ") });
    checks.push(if codes.iter().any(|c| c.starts_with(['S', 'T'])) {
        Check::pass("record_injury_code", detail)
    } else {
        Check::fail("record_injury_code", format!("no S or T code in {detail}"))
    });

    let sum = r.services.iter().fold(0 as Cents, |acc, s| acc.saturating_add(s.charge_cents));
    let detail = format!("service lines sum to {}, total billed {}", format_cents(sum), format_cents(r.total_billed_cents));
    checks.push(if sum == r.total_billed_cents {
        Check::pass("record_totals", detail)
    } else {
        Check::fail("record_totals", detail)
    });
    checks
}

/// The two fictional records the tests share.
#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;

    pub fn diagnosis(code: &str, description: &str, page: u32) -> ExtractedDiagnosis {
        ExtractedDiagnosis { code: code.to_string(), description: description.to_string(), page }
    }

    /// One unit, charge in whole dollars.
    pub fn service(code: &str, description: &str, date: &str, dollars: Cents, page: u32) -> ExtractedService {
        ExtractedService {
            code: code.to_string(),
            description: description.to_string(),
            date_of_service: date.to_string(),
            units: 1,
            charge_cents: dollars * 100,
            page,
        }
    }

    /// First-aid tent, 2026-10-24 22:20, one page, $180.00.
    pub fn maya_record() -> ExtractedRecord {
        let day = "2026-10-24";
        ExtractedRecord {
            document_kind: "first_aid_record".to_string(),
            patient: ExtractedPatient { name: "Maya Chen".to_string(), date_of_birth: "1999-04-12".to_string(), page: 1 },
            provider: ExtractedProvider {
                name: "Main Stage First-Aid Tent".to_string(),
                address: "North Field, Gate B".to_string(),
                page: 1,
            },
            encounter: ExtractedEncounter {
                date_of_service: day.to_string(),
                time: "22:20".to_string(),
                reason_for_visit: "right wrist pain after a fall".to_string(),
                history: "slipped on a spilled drink near the main stage and fell onto her outstretched right hand".to_string(),
                page: 1,
            },
            diagnoses: vec![
                diagnosis("S63.501A", "sprain of right wrist", 1),
                diagnosis("W01.0XXA", "fall on same level from slipping", 1),
            ],
            services: vec![
                service("99211", "first-aid visit, minimal", day, 65, 1),
                service("A6448", "light compression bandage", day, 25, 1),
                service("A9273", "cold pack", day, 30, 1),
                service("L3908", "wrist-hand orthosis, prefabricated", day, 40, 1),
                service("99070", "supplies and materials", day, 20, 1),
            ],
            invoice_number: "FA-1024-017".to_string(),
            total_billed_cents: 18_000,
        }
    }

    /// Urgent care the next day, two pages, $1,240.00 billed.
    pub fn jordan_record() -> ExtractedRecord {
        let day = "2026-10-25";
        ExtractedRecord {
            document_kind: "urgent_care_record".to_string(),
            patient: ExtractedPatient { name: "Jordan Alvarez".to_string(), date_of_birth: "".to_string(), page: 1 },
            provider: ExtractedProvider {
                name: "Bayside Urgent Care".to_string(),
                address: "200 Harbor Way, Suite 4".to_string(),
                page: 1,
            },
            encounter: ExtractedEncounter {
                date_of_service: day.to_string(),
                time: "".to_string(),
                reason_for_visit: "left wrist pain and swelling".to_string(),
                history: "fell in the crowd at the festival last night and landed on the left wrist".to_string(),
                page: 1,
            },
            diagnoses: vec![
                diagnosis("S63.502A", "sprain of left wrist", 1),
                diagnosis("W01.0XXA", "fall on same level from slipping", 1),
            ],
            services: vec![
                service("99204", "new patient visit, moderate complexity", day, 385, 2),
                service("73110", "X-ray wrist, 3 or more views", day, 215, 2),
                service("29125", "short arm splint, application", day, 295, 2),
                service("L3908", "wrist-hand orthosis, prefabricated", day, 145, 2),
                service("99070", "supplies and materials", day, 60, 2),
                service("96372", "therapeutic injection", day, 90, 2),
                service("J1885", "ketorolac injection, 15 mg", day, 50, 2),
            ],
            invoice_number: "BUC-55102".to_string(),
            total_billed_cents: 124_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use crate::CheckResult;

    fn result_of(checks: &[Check], name: &str) -> CheckResult {
        checks.iter().find(|c| c.name == name).unwrap().result
    }

    #[test]
    fn icd10_shapes() {
        for code in ["S63.501A", "W01.XXXA", "W01.0XXA", "J02.0", "S63", "T14.90"] {
            assert!(is_icd10(code), "{code}");
        }
        for code in ["U07.1", "163.5", "S6", "SA3.1", "S63.", "S63.12345", "S63-501", "S63.5O1A ", ""] {
            assert!(!is_icd10(code), "{code}");
        }
    }

    #[test]
    fn cpt_and_hcpcs_shapes() {
        for code in ["99213", "0001T", "73110", "A4570", "L3908", "J1885", "V2020"] {
            assert!(is_cpt_or_hcpcs(code), "{code}");
        }
        for code in ["9921", "992134", "W1234", "A457", "A45701", "AB123", "S63.5", ""] {
            assert!(!is_cpt_or_hcpcs(code), "{code}");
        }
    }

    #[test]
    fn tokens_drop_initials_and_punctuation() {
        assert_eq!(name_tokens("Jane A. Doe"), ["jane", "doe"]);
        assert_eq!(name_tokens("  Doe,  Jane "), ["doe", "jane"]);
        assert_eq!(name_tokens("Sean O'Brien"), ["sean", "obrien"]);
        assert_eq!(name_tokens("Ana Garcia-Lopez"), ["ana", "garcia", "lopez"]);
        assert!(name_tokens("J. .").is_empty());
    }

    #[test]
    fn valid_records_pass_untouched() {
        for (raw, pages) in [(maya_record(), 1), (jordan_record(), 2)] {
            let v = validate_record(raw.clone(), pages).unwrap();
            assert_eq!(v.record, raw);
            assert!(v.dropped.is_empty());
        }
    }

    #[test]
    fn trims_and_uppercases() {
        let mut raw = maya_record();
        raw.patient.name = "  Maya Chen ".to_string();
        raw.diagnoses[0].code = " s63.501a ".to_string();
        raw.services[1].code = "a6448".to_string();
        raw.services[1].date_of_service = " 2026-10-24\n".to_string();
        let v = validate_record(raw, 1).unwrap();
        assert_eq!(v.record, maya_record());
    }

    #[test]
    fn drops_bad_items_with_reasons() {
        let mut raw = jordan_record();
        raw.services.push(service("A4570", "splint supply", "2026-10-25", 45, 3));
        raw.services.push(service("XYZ", "unreadable line", "2026-10-25", 10, 2));
        raw.services.push(service("A6448", "bandage", "2026-13-01", 25, 2));
        let mut zero = service("A9273", "cold pack", "2026-10-25", 30, 2);
        zero.units = 0;
        raw.services.push(zero);
        raw.diagnoses.push(diagnosis("S93.401A", "sprain of right ankle", 4));
        let v = validate_record(raw, 2).unwrap();
        assert_eq!(v.record.services, jordan_record().services);
        assert_eq!(v.record.diagnoses, jordan_record().diagnoses);
        assert_eq!(
            v.dropped,
            [
                "diagnosis 3 (S93.401A): page 4 is outside 1..=2",
                "service 8 (A4570): page 3 is outside 1..=2",
                "service 9 (XYZ): not a CPT or HCPCS code",
                "service 10 (A6448): date \"2026-13-01\" does not parse",
                "service 11 (A9273): units is 0",
            ]
        );
    }

    #[test]
    fn rejects_unusable_records() {
        assert_eq!(validate_record(maya_record(), 0).unwrap_err(), ["page_count must be at least 1"]);

        let mut raw = maya_record();
        raw.patient.page = 2;
        raw.encounter.page = 0;
        raw.encounter.date_of_service = "10/24/2026".to_string();
        assert_eq!(
            validate_record(raw, 1).unwrap_err(),
            ["patient page 2 is outside 1..=1", "encounter page 0 is outside 1..=1", "encounter date \"10/24/2026\" does not parse"]
        );

        let mut raw = maya_record();
        raw.diagnoses = vec![diagnosis("not a code", "", 1)];
        for s in &mut raw.services {
            s.page = 5;
        }
        let err = validate_record(raw, 1).unwrap_err();
        assert_eq!(err, ["no valid diagnosis", "no valid service"]);
    }

    #[test]
    fn checks_pass_for_a_matching_record() {
        let v = validate_record(maya_record(), 1).unwrap();
        let checks = record_checks(&v, "Maya L. Chen", "2026-10-24", 365);
        assert_eq!(checks.len(), 4);
        assert!(checks.iter().all(|c| c.result == CheckResult::Pass), "{checks:?}");
        assert_eq!(checks[3].detail, "service lines sum to $180.00, total billed $180.00");

        let v = validate_record(jordan_record(), 2).unwrap();
        let checks = record_checks(&v, "Jordan Alvarez", "2026-10-24", 365);
        assert!(checks.iter().all(|c| c.result == CheckResult::Pass), "{checks:?}");
        assert_eq!(checks[1].detail, "encounter 2026-10-25, incident 2026-10-24: 1 days after, window 365 days");
    }

    #[test]
    fn catches_patient_name_mismatch() {
        let v = validate_record(maya_record(), 1).unwrap();
        let checks = record_checks(&v, "Jordan Alvarez", "2026-10-24", 365);
        assert_eq!(result_of(&checks, "record_patient_match"), CheckResult::Fail);
        assert_eq!(checks[0].detail, "claimant \"Jordan Alvarez\", record patient \"Maya Chen\"");
        assert_eq!(result_of(&record_checks(&v, "Chen", "2026-10-24", 365), "record_patient_match"), CheckResult::Pass);
        assert_eq!(result_of(&record_checks(&v, "", "2026-10-24", 365), "record_patient_match"), CheckResult::Fail);
    }

    #[test]
    fn catches_dates_outside_the_window() {
        let mut raw = maya_record();
        raw.encounter.date_of_service = "2026-10-23".to_string();
        let v = validate_record(raw, 1).unwrap();
        assert_eq!(result_of(&record_checks(&v, "Maya Chen", "2026-10-24", 365), "record_date_window"), CheckResult::Fail);

        let v = validate_record(jordan_record(), 2).unwrap();
        assert_eq!(result_of(&record_checks(&v, "Jordan Alvarez", "2026-10-24", 0), "record_date_window"), CheckResult::Fail);
        assert_eq!(result_of(&record_checks(&v, "Jordan Alvarez", "2026-10-24", 1), "record_date_window"), CheckResult::Pass);
        assert_eq!(result_of(&record_checks(&v, "Jordan Alvarez", "Oct 24", 365), "record_date_window"), CheckResult::Fail);
    }

    #[test]
    fn catches_a_record_without_an_injury_code() {
        let mut raw = maya_record();
        raw.diagnoses = vec![diagnosis("J02.0", "strep throat", 1)];
        let v = validate_record(raw, 1).unwrap();
        let checks = record_checks(&v, "Maya Chen", "2026-10-24", 365);
        assert_eq!(result_of(&checks, "record_injury_code"), CheckResult::Fail);
        assert_eq!(checks[2].detail, "no S or T code in diagnoses J02.0");
    }

    #[test]
    fn catches_totals_that_do_not_add_up() {
        let mut raw = maya_record();
        raw.total_billed_cents = 20_000;
        let v = validate_record(raw, 1).unwrap();
        let checks = record_checks(&v, "Maya Chen", "2026-10-24", 365);
        assert_eq!(result_of(&checks, "record_totals"), CheckResult::Fail);
        assert_eq!(checks[3].detail, "service lines sum to $180.00, total billed $200.00");
    }
}
