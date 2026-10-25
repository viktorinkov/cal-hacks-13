//! The hospital report as the Evidence Engine reads it from the report's PDF:
//! the `hospital_report` kind of `bandit-read-document`. Every fact quotes the
//! printed line it was copied from and that line's page, and code checks each
//! one before a claim uses it: the quote must be on its page word for word, and
//! the value must be inside its quote. What passes becomes the record that
//! `validate_record` checks and the fee schedule prices, as for any record.

use crate::Cents;
use crate::medical::{ExtractedDiagnosis, ExtractedEncounter, ExtractedPatient, ExtractedProvider, ExtractedRecord, ExtractedService};
use crate::money::format_cents;
use crate::policy::{normalize, on_page, parse_amount};
use crate::time::{civil_from_days, parse_date};
use serde::{Deserialize, Serialize};

/// The hospital's report on an injury claim, read by the `document_read` job.
pub const HOSPITAL_REPORT: &str = "hospital_report";
pub const RECORD_KINDS: [&str; 4] = ["first_aid_record", "urgent_care_record", "emergency_record", "other"];

/// What `bandit-read-document` returns for a hospital report, in the shape its JSON schema asks for.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReportRead {
    pub document_kind: String,
    pub patient: PatientRead,
    pub provider: ProviderRead,
    pub encounter: EncounterRead,
    pub diagnoses: Vec<DiagnosisRead>,
    pub services: Vec<ServiceRead>,
    pub invoice_number: Quoted,
    pub total_billed: Quoted,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PatientRead {
    pub name: String,
    /// `YYYY-MM-DD`, or empty.
    pub date_of_birth: String,
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProviderRead {
    pub name: String,
    pub address: String,
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EncounterRead {
    /// `YYYY-MM-DD`.
    pub date_of_service: String,
    /// `HH:MM`, or empty.
    pub time: String,
    pub reason_for_visit: String,
    /// The history of present illness, word for word.
    pub history: String,
    /// The line that prints the date of service.
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DiagnosisRead {
    pub code: String,
    pub description: String,
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ServiceRead {
    pub code: String,
    pub description: String,
    /// `YYYY-MM-DD`.
    pub date_of_service: String,
    pub units: u32,
    /// The line's charge for all units, as printed, such as `$385.00`.
    pub charge: String,
    pub quote: String,
    pub page: u32,
}

/// One printed value with the words it is copied from.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Quoted {
    pub value: String,
    pub quote: String,
    pub page: u32,
}

/// The record code built from the facts it found on their pages.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CheckedReport {
    pub record: ExtractedRecord,
    /// What code dropped or left empty, and why.
    pub dropped: Vec<String>,
    /// Facts found word for word on their pages.
    pub quoted: u32,
}

/// `value` appears inside `quote`, after both are normalized.
fn holds(quote: &str, value: &str) -> bool {
    let v = normalize(value);
    !v.is_empty() && normalize(quote).contains(&v)
}

/// `text` appears word for word on some page.
fn printed(pages: &[String], text: &str) -> bool {
    (1..=pages.len() as u32).any(|p| on_page(pages, p, text))
}

/// A `YYYY-MM-DD` date as `quote` may print it: `2026-10-24`, `10/24/2026` or `October 24, 2026`.
fn has_date(quote: &str, date: &str) -> bool {
    const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let Some(days) = parse_date(date) else { return false };
    let (y, m, d) = civil_from_days(days);
    let forms = [
        format!("{y:04}-{m:02}-{d:02}"),
        format!("{m:02}/{d:02}/{y:04}"),
        format!("{m}/{d}/{y:04}"),
        format!("{} {d}, {y:04}", MONTHS[m as usize - 1]),
    ];
    forms.iter().any(|f| holds(quote, f))
}

/// `n` is one of the words of `quote`.
fn has_number(quote: &str, n: u32) -> bool {
    let n = n.to_string();
    normalize(quote).split(' ').any(|w| w.trim_end_matches([',', '.']) == n)
}

/// Empties a field code could not find in the report, with a line in `dropped`.
fn keep(ok: bool, text: &mut String, what: &str, dropped: &mut Vec<String>) {
    if !ok && !text.trim().is_empty() {
        dropped.push(format!("{what} \"{}\": not printed in the report", text.trim()));
        text.clear();
    }
}

/// Checks everything the reader returned against the report's pages (the text
/// layer, one string per page). Run in the worker before the module gets the
/// read, and again in the module before anything is stored. A patient or an
/// encounter that is not quoted from its page rejects the read; a diagnosis or
/// a service line that fails is dropped; any other field that fails is left empty.
pub fn check_report_read(read: &ReportRead, pages: &[String]) -> Result<CheckedReport, Vec<String>> {
    let mut dropped = Vec::new();
    let mut errors = Vec::new();
    let mut quoted = 0;

    let p = &read.patient;
    let patient_ok = on_page(pages, p.page, &p.quote) && holds(&p.quote, &p.name);
    if patient_ok {
        quoted += 1;
    } else {
        errors.push(format!("the patient's name is not quoted from page {}", p.page));
    }
    let mut date_of_birth = p.date_of_birth.trim().to_string();
    let dob_ok = p.page >= 1 && pages.get(p.page as usize - 1).is_some_and(|page| has_date(page, &date_of_birth));
    keep(dob_ok, &mut date_of_birth, "date of birth", &mut dropped);

    let v = &read.provider;
    let mut provider_name = v.name.trim().to_string();
    let provider_ok = on_page(pages, v.page, &v.quote) && holds(&v.quote, &provider_name);
    quoted += provider_ok as u32;
    keep(provider_ok, &mut provider_name, "provider", &mut dropped);
    let mut address = v.address.trim().to_string();
    keep(printed(pages, &address), &mut address, "provider address", &mut dropped);

    let e = &read.encounter;
    let date = e.date_of_service.trim().to_string();
    if on_page(pages, e.page, &e.quote) && has_date(&e.quote, &date) {
        quoted += 1;
    } else {
        errors.push(format!("the date of service {date} is not quoted from page {}", e.page));
    }
    let mut time = e.time.trim().to_string();
    let time_ok = e.page >= 1 && pages.get(e.page as usize - 1).is_some_and(|page| holds(page, &time));
    keep(time_ok, &mut time, "visit time", &mut dropped);
    let mut reason = e.reason_for_visit.trim().to_string();
    keep(printed(pages, &reason), &mut reason, "reason for visit", &mut dropped);
    let mut history = e.history.trim().to_string();
    let history_ok = printed(pages, &history);
    quoted += (history_ok && !history.is_empty()) as u32;
    keep(history_ok, &mut history, "history", &mut dropped);

    let mut diagnoses = Vec::new();
    for (i, d) in read.diagnoses.iter().enumerate() {
        let code = d.code.trim().to_uppercase();
        if !on_page(pages, d.page, &d.quote) {
            dropped.push(format!("diagnosis {} ({code}): the quote is not on page {}", i + 1, d.page));
        } else if !holds(&d.quote, &code) {
            dropped.push(format!("diagnosis {} ({code}): the code is not in its quote", i + 1));
        } else {
            let mut description = d.description.trim().to_string();
            keep(on_page(pages, d.page, &description), &mut description, &format!("diagnosis {code} description"), &mut dropped);
            diagnoses.push(ExtractedDiagnosis { code, description, page: d.page });
            quoted += 1;
        }
    }

    let mut services = Vec::new();
    for (i, s) in read.services.iter().enumerate() {
        let code = s.code.trim().to_uppercase();
        let charge = parse_amount(&s.charge);
        let why = if !on_page(pages, s.page, &s.quote) {
            Some(format!("the quote is not on page {}", s.page))
        } else if !holds(&s.quote, &code) {
            Some("the code is not in its quote".to_string())
        } else if !has_date(&s.quote, &s.date_of_service) {
            Some(format!("the date {} is not in its quote", s.date_of_service.trim()))
        } else if !charge.is_some_and(|c| c > 0) || !holds(&s.quote, &s.charge) {
            Some(format!("the charge \"{}\" is not in its quote", s.charge.trim()))
        } else if !has_number(&s.quote, s.units) {
            Some(format!("{} units are not in its quote", s.units))
        } else {
            None
        };
        if let Some(why) = why {
            dropped.push(format!("service {} ({code}): {why}", i + 1));
            continue;
        }
        let mut description = s.description.trim().to_string();
        keep(on_page(pages, s.page, &description), &mut description, &format!("service {code} description"), &mut dropped);
        services.push(ExtractedService {
            code,
            description,
            date_of_service: s.date_of_service.trim().to_string(),
            units: s.units,
            charge_cents: charge.unwrap_or(0),
            page: s.page,
        });
        quoted += 1;
    }

    let n = &read.invoice_number;
    let mut invoice_number = n.value.trim().to_string();
    let invoice_ok = on_page(pages, n.page, &n.quote) && holds(&n.quote, &invoice_number);
    quoted += invoice_ok as u32;
    keep(invoice_ok, &mut invoice_number, "invoice number", &mut dropped);

    let t = &read.total_billed;
    let total = parse_amount(&t.value).filter(|_| on_page(pages, t.page, &t.quote) && holds(&t.quote, &t.value));
    match total {
        Some(_) => quoted += 1,
        None => dropped.push(format!("total billed \"{}\": not quoted from page {}", t.value.trim(), t.page)),
    }

    if !errors.is_empty() {
        return Err(errors);
    }
    let kind = read.document_kind.trim().to_lowercase();
    let record = ExtractedRecord {
        document_kind: if RECORD_KINDS.contains(&kind.as_str()) { kind } else { "other".into() },
        patient: ExtractedPatient { name: p.name.trim().to_string(), date_of_birth, page: p.page },
        provider: ExtractedProvider { name: provider_name, address, page: v.page },
        encounter: ExtractedEncounter { date_of_service: date, time, reason_for_visit: reason, history, page: e.page },
        diagnoses,
        services,
        invoice_number,
        total_billed_cents: total.unwrap_or(0),
    };
    Ok(CheckedReport { record, dropped, quoted })
}

/// One line for a person: how much of the report code found on its pages.
pub fn summary(c: &CheckedReport) -> String {
    let billed = format_cents(c.record.total_billed_cents as Cents);
    match c.dropped.len() {
        0 => format!("{} facts quoted from their pages, {billed} billed", c.quoted),
        n => format!("{} facts quoted from their pages, {n} dropped, {billed} billed", c.quoted),
    }
}

fn patient_line(r: &ExtractedRecord) -> String {
    format!("Patient: {}", r.patient.name)
}

fn service_date_line(r: &ExtractedRecord) -> String {
    format!("Date of service: {}", r.encounter.date_of_service)
}

fn diagnosis_line(d: &ExtractedDiagnosis) -> String {
    format!("{}  {}", d.code, d.description)
}

fn service_line(s: &ExtractedService) -> String {
    format!("{}  {}  {}  {}  {}", s.date_of_service, s.code, s.description, s.units, format_cents(s.charge_cents))
}

/// The report's title, which says what kind of record it is, so the reader classifies it by what it prints.
fn title(document_kind: &str) -> &'static str {
    match document_kind {
        "first_aid_record" => "FIRST AID RECORD",
        "urgent_care_record" => "URGENT CARE VISIT NOTE",
        "emergency_record" => "EMERGENCY DEPARTMENT RECORD",
        _ => "HOSPITAL REPORT",
    }
}

/// The page the bill's invoice number and total are printed on: the last service line's.
fn bill_page(r: &ExtractedRecord) -> u32 {
    r.services.last().map(|s| s.page).unwrap_or(r.encounter.page)
}

/// The text a hospital report prints, one string per page, with each fact on
/// the page the record names: how the hospital in the scripted claims run
/// prints its report as a PDF.
pub fn print_record(r: &ExtractedRecord, page_count: u32) -> Vec<String> {
    let count = page_count.max(1);
    let mut pages = vec![Vec::<String>::new(); count as usize];
    let mut put = |page: u32, line: String| pages[(page.clamp(1, count) - 1) as usize].push(line);
    let e = &r.encounter;
    put(r.provider.page, r.provider.name.clone());
    if !r.provider.address.is_empty() {
        put(r.provider.page, r.provider.address.clone());
    }
    put(r.provider.page, title(&r.document_kind).into());
    put(r.patient.page, patient_line(r));
    if !r.patient.date_of_birth.is_empty() {
        put(r.patient.page, format!("Date of birth: {}", r.patient.date_of_birth));
    }
    put(e.page, service_date_line(r));
    if !e.time.is_empty() {
        put(e.page, format!("Time seen: {}", e.time));
    }
    put(e.page, format!("Reason for visit: {}", e.reason_for_visit));
    put(e.page, "History of present illness".into());
    put(e.page, e.history.clone());
    if let Some(first) = r.diagnoses.first() {
        put(first.page, "Assessment".into());
    }
    for d in &r.diagnoses {
        put(d.page, diagnosis_line(d));
    }
    put(bill_page(r), "ITEMIZED BILL".into());
    put(bill_page(r), format!("Invoice {}", r.invoice_number));
    for s in &r.services {
        put(s.page, service_line(s));
    }
    put(bill_page(r), format!("Total billed: {}", format_cents(r.total_billed_cents)));
    pages.into_iter().map(|lines| lines.join("\n")).collect()
}

/// What a faithful reader returns for a report printed by `print_record`: every fact with its printed line.
pub fn quoted_read(r: &ExtractedRecord) -> ReportRead {
    let e = &r.encounter;
    ReportRead {
        document_kind: r.document_kind.clone(),
        patient: PatientRead { name: r.patient.name.clone(), date_of_birth: r.patient.date_of_birth.clone(), quote: patient_line(r), page: r.patient.page },
        provider: ProviderRead { name: r.provider.name.clone(), address: r.provider.address.clone(), quote: r.provider.name.clone(), page: r.provider.page },
        encounter: EncounterRead {
            date_of_service: e.date_of_service.clone(),
            time: e.time.clone(),
            reason_for_visit: e.reason_for_visit.clone(),
            history: e.history.clone(),
            quote: service_date_line(r),
            page: e.page,
        },
        diagnoses: r.diagnoses.iter().map(|d| DiagnosisRead { code: d.code.clone(), description: d.description.clone(), quote: diagnosis_line(d), page: d.page }).collect(),
        services: r
            .services
            .iter()
            .map(|s| ServiceRead {
                code: s.code.clone(),
                description: s.description.clone(),
                date_of_service: s.date_of_service.clone(),
                units: s.units,
                charge: format_cents(s.charge_cents),
                quote: service_line(s),
                page: s.page,
            })
            .collect(),
        invoice_number: Quoted { value: r.invoice_number.clone(), quote: format!("Invoice {}", r.invoice_number), page: bill_page(r) },
        total_billed: Quoted {
            value: format_cents(r.total_billed_cents),
            quote: format!("Total billed: {}", format_cents(r.total_billed_cents)),
            page: bill_page(r),
        },
    }
}

/// The JSON schema `bandit-read-document` gives the reader for a hospital report.
pub fn report_schema() -> serde_json::Value {
    use serde_json::json;
    let quoted = |fields: serde_json::Value| {
        let mut props = fields.as_object().unwrap().clone();
        props.insert("quote".into(), json!({"type": "string", "description": "the printed line or table row this is copied from, word for word"}));
        props.insert("page".into(), json!({"type": "integer", "description": "the 1-based page the quote is printed on"}));
        let required: Vec<String> = props.keys().cloned().collect();
        json!({"type": "object", "required": required, "properties": props})
    };
    let text = |d: &str| json!({"type": "string", "description": d});
    json!({
        "type": "object",
        "required": ["document_kind", "patient", "provider", "encounter", "diagnoses", "services", "invoice_number", "total_billed"],
        "properties": {
            "document_kind": {"type": "string", "enum": RECORD_KINDS},
            "patient": quoted(json!({"name": text("as printed"), "date_of_birth": text("YYYY-MM-DD, or empty when not printed")})),
            "provider": quoted(json!({"name": text("the clinic or hospital, as printed"), "address": text("as printed, or empty")})),
            "encounter": quoted(json!({
                "date_of_service": text("YYYY-MM-DD; the quote is the line that prints it"),
                "time": text("HH:MM as printed, or empty"),
                "reason_for_visit": text("the chief complaint or reason for visit, word for word"),
                "history": text("the history of present illness, word for word, all of it")
            })),
            "diagnoses": {"type": "array", "items": quoted(json!({
                "code": text("the ICD-10-CM code as printed, such as S63.501A"),
                "description": text("as printed")
            }))},
            "services": {"type": "array", "items": quoted(json!({
                "code": text("the CPT or HCPCS code as printed"),
                "description": text("as printed"),
                "date_of_service": text("YYYY-MM-DD"),
                "units": {"type": "integer"},
                "charge": text("the line's charge as printed, such as $385.00")
            }))},
            "invoice_number": quoted(json!({"value": text("as printed")})),
            "total_billed": quoted(json!({"value": text("the total charges as printed, such as $1,308.00")}))
        }
    })
}

#[cfg(test)]
pub mod fixtures {
    use super::*;

    /// The text layer of a two-page urgent care report: the note, then the bill.
    pub fn pages() -> Vec<String> {
        vec![
            "Wrenfield Urgent Care URGENT CARE VISIT NOTE\n880 Tamsin Street, Suite 120, Port Alder, CA 94999\n\
             Name Jordan Alvarez Date of birth 1999-08-02 Sex M\nDate of service 2026-10-25 Arrival time 10:40\n\
             Chief complaint Left wrist pain and swelling after a fall last night.\nHISTORY OF PRESENT ILLNESS\n\
             Patient presents with left wrist pain. Last night he was attending Cal\nHacks 13.0 when the crowd surged and he fell.\n\
             ASSESSMENT\n1 S63.502A Sprain of left wrist, initial encounter\n2 W01.0XXA Fall on same level"
                .into(),
            "Wrenfield Urgent Care ITEMIZED STATEMENT Invoice No. UC-2025-1188\n\
             2026-10-25 99204 New patient visit, moderate complexity 1 $385.00\n\
             2026-10-25 73110 X-ray wrist, 3 views, left 1 $215.00\nTotal charges $600.00"
                .into(),
        ]
    }

    pub fn read() -> ReportRead {
        let service = |code: &str, description: &str, charge: &str| ServiceRead {
            code: code.into(),
            description: description.into(),
            date_of_service: "2026-10-25".into(),
            units: 1,
            charge: charge.into(),
            quote: format!("2026-10-25 {code} {description} 1 {charge}"),
            page: 2,
        };
        ReportRead {
            document_kind: "urgent_care_record".into(),
            patient: PatientRead { name: "Jordan Alvarez".into(), date_of_birth: "1999-08-02".into(), quote: "Name Jordan Alvarez".into(), page: 1 },
            provider: ProviderRead {
                name: "Wrenfield Urgent Care".into(),
                address: "880 Tamsin Street, Suite 120, Port Alder, CA 94999".into(),
                quote: "Wrenfield Urgent Care URGENT CARE VISIT NOTE".into(),
                page: 1,
            },
            encounter: EncounterRead {
                date_of_service: "2026-10-25".into(),
                time: "10:40".into(),
                reason_for_visit: "Left wrist pain and swelling after a fall last night.".into(),
                history: "Patient presents with left wrist pain. Last night he was attending Cal Hacks 13.0 when the crowd surged and he fell.".into(),
                quote: "Date of service 2026-10-25".into(),
                page: 1,
            },
            diagnoses: vec![DiagnosisRead {
                code: "S63.502A".into(),
                description: "Sprain of left wrist, initial encounter".into(),
                quote: "1 S63.502A Sprain of left wrist, initial encounter".into(),
                page: 1,
            }],
            services: vec![service("99204", "New patient visit, moderate complexity", "$385.00"), service("73110", "X-ray wrist, 3 views, left", "$215.00")],
            invoice_number: Quoted { value: "UC-2025-1188".into(), quote: "Invoice No. UC-2025-1188".into(), page: 2 },
            total_billed: Quoted { value: "$600.00".into(), quote: "Total charges $600.00".into(), page: 2 },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use crate::medical::validate_record;

    #[test]
    fn every_fact_found_on_its_page_becomes_the_record() {
        let c = check_report_read(&read(), &pages()).unwrap();
        assert!(c.dropped.is_empty(), "{:?}", c.dropped);
        assert_eq!(c.quoted, 9);
        let r = &c.record;
        assert_eq!((r.patient.name.as_str(), r.encounter.date_of_service.as_str(), r.total_billed_cents), ("Jordan Alvarez", "2026-10-25", 60_000));
        assert_eq!(r.services.iter().map(|s| s.charge_cents).collect::<Vec<_>>(), [38_500, 21_500]);
        assert!(r.encounter.history.contains("Cal Hacks 13.0"));
        let valid = validate_record(c.record.clone(), 2).unwrap();
        assert!(valid.dropped.is_empty());
        assert_eq!(summary(&c), "9 facts quoted from their pages, $600.00 billed");
    }

    #[test]
    fn a_line_off_its_page_is_dropped_and_a_paraphrase_left_empty() {
        let mut r = read();
        r.services[1].charge = "$251.00".into();
        r.services[0].page = 1;
        r.diagnoses[0].code = "S63.501A".into();
        r.encounter.history = "He fell at the event.".into();
        r.invoice_number.value = "UC-9".into();
        let c = check_report_read(&r, &pages()).unwrap();
        assert_eq!(
            c.dropped,
            [
                "history \"He fell at the event.\": not printed in the report",
                "diagnosis 1 (S63.501A): the code is not in its quote",
                "service 1 (99204): the quote is not on page 1",
                "service 2 (73110): the charge \"$251.00\" is not in its quote",
                "invoice number \"UC-9\": not printed in the report",
            ]
        );
        assert!(c.record.services.is_empty() && c.record.diagnoses.is_empty() && c.record.encounter.history.is_empty());
        assert!(validate_record(c.record, 2).is_err(), "no diagnosis and no service left");
    }

    #[test]
    fn an_unquoted_patient_or_date_rejects_the_read() {
        let mut r = read();
        r.patient.name = "Sam Patel".into();
        r.encounter.date_of_service = "2026-10-24".into();
        let e = check_report_read(&r, &pages()).unwrap_err();
        assert_eq!(e, ["the patient's name is not quoted from page 1", "the date of service 2026-10-24 is not quoted from page 1"]);
    }

    #[test]
    fn a_total_not_on_its_page_bills_nothing() {
        let mut r = read();
        r.total_billed.page = 1;
        let c = check_report_read(&r, &pages()).unwrap();
        assert_eq!((c.record.total_billed_cents, c.dropped.len()), (0, 1));
    }

    #[test]
    fn a_printed_record_reads_back_to_itself() {
        let r = crate::medical::fixtures::maya_record();
        let pages = print_record(&r, 1);
        assert!(pages[0].contains("Patient: Maya Chen") && pages[0].contains("ITEMIZED BILL"), "{}", pages[0]);
        let c = check_report_read(&quoted_read(&r), &pages).unwrap();
        assert!(c.dropped.is_empty(), "{:?}", c.dropped);
        assert_eq!(c.record, r);
        let mut two = r.clone();
        two.services.iter_mut().for_each(|s| s.page = 2);
        let pages = print_record(&two, 2);
        assert!(pages[1].starts_with("ITEMIZED BILL") && pages[1].contains("Total billed: $180.00"), "{}", pages[1]);
        assert_eq!(check_report_read(&quoted_read(&two), &pages).unwrap().record, two);
    }

    #[test]
    fn dates_and_units_as_printed() {
        assert!(has_date("Date of service 10/25/2026", "2026-10-25"));
        assert!(has_date("Saturday, October 24, 2026, at 21:45", "2026-10-24"));
        assert!(!has_date("Date of service 2026-10-25", "2026-10-24"));
        assert!(has_number("99204 visit 2 $10.00", 2) && !has_number("99204 visit 12 $10.00", 2));
    }

    #[test]
    fn the_schema_asks_for_a_quote_behind_every_fact() {
        let s = report_schema();
        for key in ["patient", "provider", "encounter", "invoice_number", "total_billed"] {
            assert!(s["properties"][key]["required"].as_array().unwrap().iter().any(|k| k == "quote"), "{key}");
        }
        assert!(s["properties"]["services"]["items"]["required"].as_array().unwrap().iter().any(|k| k == "charge"));
        let read: ReportRead = serde_json::from_value(serde_json::json!({"patient": {"name": "x"}})).unwrap();
        assert_eq!((read.patient.page, read.services.len()), (0, 0));
    }
}
