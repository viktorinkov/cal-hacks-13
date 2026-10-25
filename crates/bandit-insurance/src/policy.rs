//! The venue's insurance policy as the Evidence Engine reads it from the
//! policy PDF. Every term quotes the clause and page it was read from, and code
//! checks each one before it can set any money: the quote must be on its page
//! word for word, the amount must parse, and the limits must fit together. A
//! term the policy does not state, or one that fails a check, keeps its default.
//! The defaults are the covers the claims run seeds.

use crate::coverage::CoverageRule;
use crate::fee_schedule::{FeeLine, default_schedule};
use crate::medical::is_cpt_or_hcpcs;
use crate::money::{format_cents, parse_dollars};
use crate::time::parse_date;
use crate::{Cents, CoverKind, IncidentKind};
use serde::{Deserialize, Serialize};

/// The worker job that reads an insurance PDF in the Evidence Engine.
pub const KIND_DOCUMENT_READ: &str = "document_read";
/// The venue's general liability policy, uploaded at event setup.
pub const VENUE_POLICY: &str = "venue_policy";
/// An attendee's health plan document, such as the plan's summary of benefits.
pub const HEALTH_PLAN: &str = "health_plan";
/// An attendee's own policy, such as renters or personal property.
pub const ATTENDEE_POLICY: &str = "attendee_policy";
pub const DOCUMENT_KINDS: [&str; 3] = [VENUE_POLICY, HEALTH_PLAN, ATTENDEE_POLICY];

/// Input of `document_read`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentReadPayload {
    /// The module's `policy_document` row.
    pub document_id: u64,
    /// One of `DOCUMENT_KINDS`.
    pub kind: String,
    /// SHA-256 of the PDF in the blob store.
    pub file_hash: String,
    pub page_count: u32,
}

/// Policy-wide terms, with `cover` empty.
pub const POLICY_TERMS: [&str; 6] = ["insurer_name", "policy_number", "fnol_contact", "period_start", "period_end", "other_insurance"];
/// Terms each cover states, with `cover` = `medical_payments` or `property`.
pub const COVER_TERMS: [&str; 5] = ["per_claim_limit", "aggregate_limit", "deductible", "minimum_payout", "service_window_days"];
/// A term row for one code of the schedule of benefits; its `code` is the CPT or HCPCS code.
pub const FEE_CAP: &str = "fee_cap";
/// A term row for one exclusion; its `code` is the exclusion kind.
pub const EXCLUSION: &str = "exclusion";
pub const EXCLUSION_KINDS: [&str; 5] = ["staff", "pre_existing", "off_premises", "care_custody_control", "other"];
pub const SECTIONS: [&str; 8] =
    ["insuring_agreement", "limits", "schedule_of_benefits", "exclusions", "conditions", "theft", "other_insurance", "subrogation"];
pub const OTHER_INSURANCE: [&str; 2] = ["primary", "excess"];

/// The longest service window code accepts, in days.
pub const MAX_SERVICE_WINDOW_DAYS: u32 = 730;

/// What `bandit-read-document` returns for a venue policy, in the shape its
/// JSON schema asks for.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PolicyRead {
    #[serde(default)]
    pub terms: Vec<TermRead>,
    #[serde(default)]
    pub fee_schedule: Vec<FeeRead>,
    #[serde(default)]
    pub exclusions: Vec<ExclusionRead>,
    #[serde(default)]
    pub clauses: Vec<ClauseRead>,
}

/// One term as printed: `value` is the text, such as `$5,000`, `365 days` or `2026-10-01`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TermRead {
    pub name: String,
    /// `medical_payments` or `property` for a cover's term; empty for a policy-wide term.
    #[serde(default)]
    pub cover: String,
    pub value: String,
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FeeRead {
    pub code: String,
    #[serde(default)]
    pub description: String,
    /// The most the cover pays per unit, as printed.
    pub cap: String,
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExclusionRead {
    pub kind: String,
    pub quote: String,
    pub page: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClauseRead {
    pub section: String,
    pub page: u32,
    pub text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TermStatus {
    /// Read from the policy and passed every check.
    Read,
    /// Read, but a check failed: the default is in effect.
    Flagged,
    /// The policy does not state it: the default is in effect.
    Default,
    /// The organizer typed it from the declarations page of a policy found by its forms.
    Typed,
}

impl TermStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TermStatus::Read => "read",
            TermStatus::Flagged => "flagged",
            TermStatus::Default => "default",
            TermStatus::Typed => "typed",
        }
    }
}

/// One term after code's checks: what the organizer reviews and confirms.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CheckedTerm {
    /// Empty for a policy-wide term.
    pub cover: String,
    /// A `POLICY_TERMS` or `COVER_TERMS` name, `fee_cap` or `exclusion`.
    pub name: String,
    /// The fee code or the exclusion kind; empty otherwise.
    pub code: String,
    /// The value in effect, in code's form: cents, days, `YYYY-MM-DD` or text.
    /// For a fee cap the cents, or empty when the code is off the schedule.
    pub value: String,
    /// The value in effect for a person: `$5,000.00`, `365 days`.
    pub shown: String,
    /// What the policy printed, when it stated the term.
    pub read_value: String,
    pub quote: String,
    pub page: u32,
    /// 1-based position in `CheckedPolicy::clauses` of the clause the quote is in; 0 when none.
    pub clause: u32,
    pub status: TermStatus,
    /// Why a flagged term fell back to its default.
    pub problem: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CheckedPolicy {
    pub terms: Vec<CheckedTerm>,
    /// The clauses found word for word on their pages, numbered from 1 in this order.
    pub clauses: Vec<ClauseRead>,
    /// What code dropped: clauses not on their page, terms it does not know.
    pub dropped: Vec<String>,
}

/// One cover's terms in effect.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoverTerms {
    pub cover: CoverKind,
    pub per_claim_limit_cents: Cents,
    pub aggregate_limit_cents: Cents,
    pub deductible_cents: Cents,
    pub minimum_payout_cents: Cents,
    pub service_window_days: u32,
}

impl CoverTerms {
    /// The incident kinds each cover pays for: injuries from medical payments, the venue's equipment from property.
    pub fn incident_kinds(&self) -> Vec<IncidentKind> {
        match self.cover {
            CoverKind::MedicalPayments => vec![IncidentKind::Sos, IncidentKind::Fall],
            CoverKind::Property => vec![IncidentKind::Property],
            CoverKind::PersonalProperty => vec![IncidentKind::Theft, IncidentKind::Breakage],
        }
    }

    pub fn rule(&self) -> CoverageRule {
        CoverageRule {
            cover_kind: self.cover,
            incident_kinds: self.incident_kinds(),
            per_claim_limit_cents: self.per_claim_limit_cents,
            aggregate_limit_cents: self.aggregate_limit_cents,
            deductible_cents: self.deductible_cents,
            minimum_payout_cents: self.minimum_payout_cents,
            service_window_days: self.service_window_days,
            active: true,
        }
    }
}

/// The policy in effect once the organizer confirms the checked terms.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EffectivePolicy {
    pub insurer_name: String,
    pub policy_number: String,
    pub fnol_contact: String,
    /// `YYYY-MM-DD`, or empty when the policy does not state its period (then it is not checked).
    pub period_start: String,
    pub period_end: String,
    /// `primary` or `excess`.
    pub other_insurance: String,
    pub covers: Vec<CoverTerms>,
    pub fee_schedule: Vec<FeeLine>,
    /// Exclusion kinds in effect.
    pub exclusions: Vec<String>,
}

/// The defaults: the policy and covers `bandit-claims setup` seeds.
pub fn defaults() -> EffectivePolicy {
    EffectivePolicy {
        insurer_name: "Northwind Mutual".into(),
        policy_number: "GL-2026-04417".into(),
        fnol_contact: "claims@northwind.test".into(),
        period_start: String::new(),
        period_end: String::new(),
        other_insurance: "primary".into(),
        covers: vec![
            CoverTerms {
                cover: CoverKind::MedicalPayments,
                per_claim_limit_cents: 500_000,
                aggregate_limit_cents: 2_500_000,
                deductible_cents: 0,
                minimum_payout_cents: 0,
                service_window_days: 365,
            },
            CoverTerms {
                cover: CoverKind::Property,
                per_claim_limit_cents: 1_000_000,
                aggregate_limit_cents: 5_000_000,
                deductible_cents: 50_000,
                minimum_payout_cents: 0,
                service_window_days: 0,
            },
        ],
        fee_schedule: default_schedule(),
        exclusions: vec!["staff".into()],
    }
}

/// Lowercase words, with curly quotes, dashes and the PDF's line breaks
/// evened out, so a quote matches the page's text layer word for word.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for word in text.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        for c in word.chars() {
            out.push(match c {
                '\u{2018}' | '\u{2019}' | '\u{201B}' | '\u{2032}' => '\'',
                '\u{201C}' | '\u{201D}' | '\u{201F}' | '\u{2033}' => '"',
                '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
                '\u{00A0}' => ' ',
                c => c.to_lowercase().next().unwrap_or(c),
            });
        }
    }
    out
}

/// `quote` appears word for word on `page` (1-based) of `pages`.
pub fn on_page(pages: &[String], page: u32, quote: &str) -> bool {
    let q = normalize(quote);
    !q.is_empty() && page >= 1 && pages.get(page as usize - 1).is_some_and(|p| normalize(p).contains(&q))
}

/// `$5,000`, `5,000.00 USD` or `USD 250` as cents.
pub fn parse_amount(s: &str) -> Option<Cents> {
    let t = s.trim().trim_start_matches("USD").trim_end_matches("USD").trim().trim_start_matches('$').trim();
    parse_dollars(t)
}

/// `365`, `365 days` or `30 calendar days` as days.
pub fn parse_days(s: &str) -> Option<u32> {
    let first = s.split_whitespace().next()?;
    first.replace(',', "").parse().ok()
}

fn days_text(days: u32) -> String {
    if days == 1 { "1 day".into() } else { format!("{days} days") }
}

fn date_text(s: &str) -> String {
    if s.is_empty() { "not stated".into() } else { s.into() }
}

/// What a person sees for the value of a term.
fn shown(name: &str, value: &str) -> String {
    match name {
        "per_claim_limit" | "aggregate_limit" | "deductible" | "minimum_payout" | FEE_CAP => {
            value.parse::<Cents>().map(format_cents).unwrap_or_else(|_| "not on the schedule".into())
        }
        "service_window_days" => value.parse().map(days_text).unwrap_or_default(),
        "period_start" | "period_end" => date_text(value),
        EXCLUSION => "applies".into(),
        _ => value.into(),
    }
}

fn cover_of(p: &EffectivePolicy, cover: CoverKind) -> &CoverTerms {
    p.covers.iter().find(|c| c.cover == cover).expect("both covers")
}

/// A term's default value in code's form.
fn default_value(d: &EffectivePolicy, cover: &str, name: &str) -> String {
    let c = CoverKind::parse(cover).map(|k| cover_of(d, k));
    match (name, c) {
        ("insurer_name", _) => d.insurer_name.clone(),
        ("policy_number", _) => d.policy_number.clone(),
        ("fnol_contact", _) => d.fnol_contact.clone(),
        ("period_start", _) => d.period_start.clone(),
        ("period_end", _) => d.period_end.clone(),
        ("other_insurance", _) => d.other_insurance.clone(),
        ("per_claim_limit", Some(c)) => c.per_claim_limit_cents.to_string(),
        ("aggregate_limit", Some(c)) => c.aggregate_limit_cents.to_string(),
        ("deductible", Some(c)) => c.deductible_cents.to_string(),
        ("minimum_payout", Some(c)) => c.minimum_payout_cents.to_string(),
        ("service_window_days", Some(c)) => c.service_window_days.to_string(),
        _ => String::new(),
    }
}

/// Parses one printed term into code's form, or says why it cannot.
fn parse_term(name: &str, value: &str) -> Result<String, String> {
    let v = value.trim();
    match name {
        "per_claim_limit" | "aggregate_limit" | "deductible" | "minimum_payout" => {
            parse_amount(v).map(|c| c.to_string()).ok_or_else(|| format!("\"{v}\" is not an amount"))
        }
        "service_window_days" => match parse_days(v) {
            Some(d) if d <= MAX_SERVICE_WINDOW_DAYS => Ok(d.to_string()),
            Some(d) => Err(format!("a service window of {d} days is over {MAX_SERVICE_WINDOW_DAYS}")),
            None => Err(format!("\"{v}\" is not a number of days")),
        },
        "period_start" | "period_end" => parse_date(v).map(|_| v.to_string()).ok_or_else(|| format!("\"{v}\" is not a YYYY-MM-DD date")),
        "other_insurance" => {
            let v = v.to_lowercase();
            OTHER_INSURANCE.contains(&v.as_str()).then_some(v.clone()).ok_or_else(|| format!("\"{v}\" is neither primary nor excess"))
        }
        _ if v.is_empty() => Err("the value is empty".into()),
        _ => Ok(v.to_string()),
    }
}

/// The first kept clause on `page` that holds `quote`.
fn clause_of(clauses: &[ClauseRead], page: u32, quote: &str) -> u32 {
    let q = normalize(quote);
    if q.is_empty() {
        return 0;
    }
    clauses.iter().position(|c| c.page == page && normalize(&c.text).contains(&q)).map(|i| i as u32 + 1).unwrap_or(0)
}

fn flag(t: &mut CheckedTerm, problem: String, default: String) {
    t.status = TermStatus::Flagged;
    t.problem = problem;
    t.shown = shown(&t.name, &default);
    t.value = default;
}

/// Checks everything the reader returned against the policy's pages (the
/// text layer, one string per page) and lists every term with the value in
/// effect. Run in the worker before indexing the clauses, and again in the
/// module before anything is stored.
pub fn check_policy(read: &PolicyRead, pages: &[String]) -> CheckedPolicy {
    let d = defaults();
    let mut dropped = Vec::new();

    let mut clauses = Vec::new();
    for (i, c) in read.clauses.iter().enumerate() {
        if !SECTIONS.contains(&c.section.as_str()) {
            dropped.push(format!("clause {}: unknown section {}", i + 1, c.section));
        } else if !on_page(pages, c.page, &c.text) {
            dropped.push(format!("clause {} ({}): not word for word on page {}", i + 1, c.section, c.page));
        } else {
            clauses.push(c.clone());
        }
    }

    let read_term = |t: &TermRead, name: &str, cover: &str, code: &str, value: Result<String, String>, default: String| {
        let mut term = CheckedTerm {
            cover: cover.into(),
            name: name.into(),
            code: code.into(),
            value: String::new(),
            shown: String::new(),
            read_value: t.value.trim().into(),
            quote: t.quote.trim().into(),
            page: t.page,
            clause: clause_of(&clauses, t.page, &t.quote),
            status: TermStatus::Read,
            problem: String::new(),
        };
        match value {
            _ if !on_page(pages, t.page, &t.quote) => flag(&mut term, format!("the quote is not on page {}", t.page), default),
            Err(problem) => flag(&mut term, problem, default),
            Ok(v) => {
                term.shown = shown(name, &v);
                term.value = v;
            }
        }
        term
    };
    let unstated = |name: &str, cover: &str, code: &str, default: String| CheckedTerm {
        cover: cover.into(),
        name: name.into(),
        code: code.into(),
        shown: shown(name, &default),
        value: default,
        read_value: String::new(),
        quote: String::new(),
        page: 0,
        clause: 0,
        status: TermStatus::Default,
        problem: String::new(),
    };

    let mut terms = Vec::new();
    let slot = |name: &str, cover: &str| {
        let default = default_value(&d, cover, name);
        match read.terms.iter().find(|t| t.name == name && t.cover == cover) {
            Some(t) => read_term(t, name, cover, "", parse_term(name, &t.value), default),
            None => unstated(name, cover, "", default),
        }
    };
    for name in POLICY_TERMS {
        terms.push(slot(name, ""));
    }
    for cover in [CoverKind::MedicalPayments, CoverKind::Property] {
        for name in COVER_TERMS {
            terms.push(slot(name, cover.as_str()));
        }
    }
    for t in &read.terms {
        let known = if t.cover.is_empty() { POLICY_TERMS.contains(&t.name.as_str()) } else { CoverKind::parse(&t.cover).is_some() && COVER_TERMS.contains(&t.name.as_str()) };
        if !known {
            dropped.push(format!("unknown term {} {}", t.cover, t.name).replace("  ", " "));
        }
    }
    fit_limits(&mut terms, &d);
    fit_period(&mut terms);

    let mut seen: Vec<String> = Vec::new();
    for f in &read.fee_schedule {
        let code = f.code.trim().to_uppercase();
        let default = d.fee_schedule.iter().find(|l| l.code == code).map(|l| l.max_allowed_cents.to_string()).unwrap_or_default();
        let value = if !is_cpt_or_hcpcs(&code) {
            Err(format!("{code} is not a CPT or HCPCS code"))
        } else if seen.contains(&code) {
            Err(format!("{code} is listed twice"))
        } else {
            match parse_amount(&f.cap) {
                Some(c) if c > 0 => Ok(c.to_string()),
                _ => Err(format!("\"{}\" is not a cap above $0", f.cap.trim())),
            }
        };
        seen.push(code.clone());
        let as_term = TermRead { name: FEE_CAP.into(), cover: CoverKind::MedicalPayments.as_str().into(), value: f.cap.clone(), quote: f.quote.clone(), page: f.page };
        let mut t = read_term(&as_term, FEE_CAP, CoverKind::MedicalPayments.as_str(), &code, value, default);
        t.read_value = format!("{} {}", f.description.trim(), f.cap.trim()).trim().into();
        terms.push(t);
    }
    if read.fee_schedule.is_empty() {
        for l in &d.fee_schedule {
            terms.push(unstated(FEE_CAP, CoverKind::MedicalPayments.as_str(), &l.code, l.max_allowed_cents.to_string()));
        }
    }

    for e in &read.exclusions {
        let kind = e.kind.trim().to_lowercase();
        let value = if EXCLUSION_KINDS.contains(&kind.as_str()) { Ok(kind.clone()) } else { Err(format!("unknown exclusion kind {kind}")) };
        let as_term = TermRead { name: EXCLUSION.into(), cover: String::new(), value: kind.clone(), quote: e.quote.clone(), page: e.page };
        let default = if d.exclusions.contains(&kind) { kind.clone() } else { String::new() };
        terms.push(read_term(&as_term, EXCLUSION, "", &kind, value, default));
    }
    for kind in &d.exclusions {
        if !terms.iter().any(|t| t.name == EXCLUSION && &t.code == kind) {
            terms.push(unstated(EXCLUSION, "", kind, kind.clone()));
        }
    }

    CheckedPolicy { terms, clauses, dropped }
}

fn cents_of(terms: &[CheckedTerm], cover: &str, name: &str) -> Cents {
    terms.iter().find(|t| t.cover == cover && t.name == name).and_then(|t| t.value.parse().ok()).unwrap_or(0)
}

/// Per cover: deductible <= per-claim limit <= aggregate limit, and the minimum
/// payout <= the per-claim limit. A relation that fails flags the read terms in
/// it, which fall back to their defaults; the defaults always fit.
fn fit_limits(terms: &mut [CheckedTerm], d: &EffectivePolicy) {
    for cover in [CoverKind::MedicalPayments, CoverKind::Property] {
        let c = cover.as_str();
        for _ in 0..3 {
            let get = |n: &str| cents_of(terms, c, n);
            let (per, agg, ded, min) = (get("per_claim_limit"), get("aggregate_limit"), get("deductible"), get("minimum_payout"));
            let broken: Option<(&[&str], String)> = if ded > per {
                Some((&["deductible", "per_claim_limit"], format!("the deductible {} is above the per-claim limit {}", format_cents(ded), format_cents(per))))
            } else if per > agg {
                Some((&["per_claim_limit", "aggregate_limit"], format!("the per-claim limit {} is above the aggregate limit {}", format_cents(per), format_cents(agg))))
            } else if min > per {
                Some((&["minimum_payout", "per_claim_limit"], format!("the minimum payout {} is above the per-claim limit {}", format_cents(min), format_cents(per))))
            } else {
                None
            };
            let Some((names, problem)) = broken else { break };
            for t in terms.iter_mut().filter(|t| t.cover == c && names.contains(&t.name.as_str()) && t.status == TermStatus::Read) {
                let default = default_value(d, c, &t.name);
                flag(t, problem.clone(), default);
            }
        }
    }
}

/// The period must end after it starts; otherwise both dates fall back to not stated.
fn fit_period(terms: &mut [CheckedTerm]) {
    let day = |terms: &[CheckedTerm], n: &str| terms.iter().find(|t| t.name == n).and_then(|t| parse_date(&t.value));
    if let (Some(start), Some(end)) = (day(terms, "period_start"), day(terms, "period_end")) {
        if end <= start {
            for t in terms.iter_mut().filter(|t| t.name.starts_with("period_") && t.status == TermStatus::Read) {
                flag(t, "the period does not end after it starts".into(), String::new());
            }
        }
    }
}

/// What the organizer typed from the declarations page of a policy found by its forms: the policy's
/// own numbers, which a public coverage form never prints. Dates are `YYYY-MM-DD`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Declarations {
    pub insurer_name: String,
    pub policy_number: String,
    pub fnol_contact: String,
    pub period_start: String,
    pub period_end: String,
    /// The liability form's medical expense limit for any one person, and its general aggregate.
    pub medical_limit_cents: Cents,
    pub medical_aggregate_cents: Cents,
    /// The property form's limit of insurance, which is also its aggregate, and its deductible.
    pub property_limit_cents: Cents,
    pub property_deductible_cents: Cents,
}

impl Declarations {
    /// Each typed term as (cover, name, value in code's form).
    fn terms(&self) -> Vec<(&'static str, &'static str, String)> {
        let (m, p) = (CoverKind::MedicalPayments.as_str(), CoverKind::Property.as_str());
        vec![
            ("", "insurer_name", self.insurer_name.clone()),
            ("", "policy_number", self.policy_number.clone()),
            ("", "fnol_contact", self.fnol_contact.clone()),
            ("", "period_start", self.period_start.clone()),
            ("", "period_end", self.period_end.clone()),
            (m, "per_claim_limit", self.medical_limit_cents.to_string()),
            (m, "aggregate_limit", self.medical_aggregate_cents.to_string()),
            (p, "per_claim_limit", self.property_limit_cents.to_string()),
            (p, "aggregate_limit", self.property_limit_cents.to_string()),
            (p, "deductible", self.property_deductible_cents.to_string()),
        ]
    }

    /// Why these numbers cannot be a policy's, or `None` when they fit.
    pub fn problem(&self) -> Option<String> {
        let empty = [("insurer", &self.insurer_name), ("policy number", &self.policy_number), ("claims contact", &self.fnol_contact)];
        if let Some((what, _)) = empty.iter().find(|(_, v)| v.trim().is_empty()) {
            return Some(format!("type the {what} from the declarations page"));
        }
        let (Some(start), Some(end)) = (parse_date(&self.period_start), parse_date(&self.period_end)) else {
            return Some("type the policy period as two dates".into());
        };
        if end <= start {
            return Some("the policy period must end after it starts".into());
        }
        if self.medical_limit_cents == 0 {
            return Some("type the medical expense limit".into());
        }
        if self.medical_limit_cents > self.medical_aggregate_cents {
            return Some("the medical expense limit must be at most the general aggregate".into());
        }
        if self.property_limit_cents == 0 {
            return Some("type the property limit".into());
        }
        if self.property_deductible_cents >= self.property_limit_cents {
            return Some("the property deductible must be below the property limit".into());
        }
        None
    }
}

/// Puts the typed declarations over the checked terms they name: each becomes `typed`, whatever the
/// forms gave for it. The forms point at "the Declarations" for these numbers and never print them.
pub fn apply_declarations(terms: &mut [CheckedTerm], d: &Declarations) {
    for (cover, name, value) in d.terms() {
        let Some(t) = terms.iter_mut().find(|t| t.cover == cover && t.name == name) else { continue };
        t.shown = shown(name, &value);
        t.read_value = t.shown.clone();
        t.value = value;
        t.quote = String::new();
        t.page = 0;
        t.clause = 0;
        t.status = TermStatus::Typed;
        t.problem = String::new();
    }
}

/// The policy in effect from checked terms: each term's `value`, which is the
/// default when the term was flagged or not stated.
pub fn effective(terms: &[CheckedTerm]) -> EffectivePolicy {
    let d = defaults();
    let text = |name: &str| terms.iter().find(|t| t.cover.is_empty() && t.name == name).map(|t| t.value.clone()).unwrap_or_else(|| default_value(&d, "", name));
    let covers = [CoverKind::MedicalPayments, CoverKind::Property]
        .into_iter()
        .map(|cover| {
            let c = cover.as_str();
            let def = cover_of(&d, cover);
            let cents = |n: &str, dflt: Cents| terms.iter().find(|t| t.cover == c && t.name == n).and_then(|t| t.value.parse().ok()).unwrap_or(dflt);
            CoverTerms {
                cover,
                per_claim_limit_cents: cents("per_claim_limit", def.per_claim_limit_cents),
                aggregate_limit_cents: cents("aggregate_limit", def.aggregate_limit_cents),
                deductible_cents: cents("deductible", def.deductible_cents),
                minimum_payout_cents: cents("minimum_payout", def.minimum_payout_cents),
                service_window_days: cents("service_window_days", def.service_window_days as Cents) as u32,
            }
        })
        .collect();
    let fee_schedule = terms
        .iter()
        .filter(|t| t.name == FEE_CAP)
        .filter_map(|t| {
            let cap: Cents = t.value.parse().ok()?;
            let description = d.fee_schedule.iter().find(|l| l.code == t.code).map(|l| l.description.clone());
            let read = t.read_value.rsplit_once(' ').map(|(desc, _)| desc.to_string()).unwrap_or_default();
            Some(FeeLine { code: t.code.clone(), description: if read.is_empty() { description.unwrap_or_default() } else { read }, max_allowed_cents: cap })
        })
        .collect();
    let exclusions = terms.iter().filter(|t| t.name == EXCLUSION && !t.value.is_empty()).map(|t| t.value.clone()).collect();
    EffectivePolicy {
        insurer_name: text("insurer_name"),
        policy_number: text("policy_number"),
        fnol_contact: text("fnol_contact"),
        period_start: text("period_start"),
        period_end: text("period_end"),
        other_insurance: text("other_insurance"),
        covers,
        fee_schedule,
        exclusions,
    }
}

/// The JSON schema `bandit-read-document` gives the reader for a venue policy.
pub fn venue_policy_schema() -> serde_json::Value {
    let quoted = |extra: serde_json::Value| {
        let mut props = serde_json::json!({
            "quote": {"type": "string", "description": "the words of the policy this is read from, copied exactly"},
            "page": {"type": "integer", "description": "the 1-based page the quote is printed on"}
        });
        props.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        props
    };
    serde_json::json!({
        "type": "object",
        "required": ["terms", "fee_schedule", "exclusions", "clauses"],
        "properties": {
            "terms": {"type": "array", "items": {"type": "object", "required": ["name", "cover", "value", "quote", "page"], "properties": quoted(serde_json::json!({
                "name": {"type": "string", "enum": POLICY_TERMS.iter().chain(COVER_TERMS.iter()).collect::<Vec<_>>()},
                "cover": {"type": "string", "enum": ["", "medical_payments", "property"], "description": "empty for insurer_name, policy_number, fnol_contact, period_start, period_end and other_insurance"},
                "value": {"type": "string", "description": "as printed: an amount such as $5,000, a number of days, a date as YYYY-MM-DD, primary or excess, or text"}
            }))}},
            "fee_schedule": {"type": "array", "items": {"type": "object", "required": ["code", "description", "cap", "quote", "page"], "properties": quoted(serde_json::json!({
                "code": {"type": "string", "description": "the CPT or HCPCS code"},
                "description": {"type": "string"},
                "cap": {"type": "string", "description": "the most paid per unit: the amount alone as printed, such as $65.00"}
            }))}},
            "exclusions": {"type": "array", "items": {"type": "object", "required": ["kind", "quote", "page"], "properties": quoted(serde_json::json!({
                "kind": {"type": "string", "enum": EXCLUSION_KINDS}
            }))}},
            "clauses": {"type": "array", "items": {"type": "object", "required": ["section", "page", "text"], "properties": {
                "section": {"type": "string", "enum": SECTIONS},
                "page": {"type": "integer"},
                "text": {"type": "string", "description": "the clause's words, copied exactly from one page"}
            }}}
        }
    })
}

/// The JSON schema `bandit-read-document` gives the reader for `kind`: the
/// venue policy's terms and clauses, or only the clauses of an attendee's
/// health plan or own policy.
pub fn document_schema(kind: &str) -> serde_json::Value {
    let venue = venue_policy_schema();
    if kind == VENUE_POLICY {
        return venue;
    }
    serde_json::json!({
        "type": "object",
        "required": ["clauses"],
        "properties": {"clauses": venue["properties"]["clauses"].clone()}
    })
}

#[cfg(test)]
pub mod fixtures {
    use super::*;

    /// The text layer of a two-page policy.
    pub fn pages() -> Vec<String> {
        vec![
            "COMMERCIAL GENERAL LIABILITY POLICY\nInsurer: Northwind Mutual Insurance Company\nPolicy number: NWM-GL-2026-0413\nPolicy period: 2026-10-01 to 2027-09-30\nReport every claim to claims@northwind.test.\n\
             SECTION III LIMITS OF INSURANCE\nMedical payments: $5,000 any one person, $25,000 aggregate, no deductible. \
             We will not pay a medical payments claim of less than $25.00. Expenses must be incurred within one year (365 days) of the accident.\n\
             Damage to premises: $10,000 any one occurrence, $50,000 aggregate, subject to a $500 deductible per occurrence."
                .into(),
            "SCHEDULE OF BENEFITS\n99211 First aid visit, minimal $65.00 per unit\n73110 X-ray wrist, three or more views $165.00 per unit\n\
             EXCLUSIONS\nThis insurance does not apply to bodily injury to any employee or volunteer of the insured.\n\
             OTHER INSURANCE\nThis insurance is primary."
                .into(),
        ]
    }

    pub fn term(name: &str, cover: &str, value: &str, quote: &str, page: u32) -> TermRead {
        TermRead { name: name.into(), cover: cover.into(), value: value.into(), quote: quote.into(), page }
    }

    pub fn read() -> PolicyRead {
        let m = "medical_payments";
        PolicyRead {
            terms: vec![
                term("insurer_name", "", "Northwind Mutual Insurance Company", "Insurer: Northwind Mutual Insurance Company", 1),
                term("policy_number", "", "NWM-GL-2026-0413", "Policy number: NWM-GL-2026-0413", 1),
                term("period_start", "", "2026-10-01", "Policy period: 2026-10-01 to 2027-09-30", 1),
                term("period_end", "", "2027-09-30", "Policy period: 2026-10-01 to 2027-09-30", 1),
                term("fnol_contact", "", "claims@northwind.test", "Report every claim to claims@northwind.test.", 1),
                term("other_insurance", "", "primary", "This insurance is primary.", 2),
                term("per_claim_limit", m, "$5,000", "Medical payments: $5,000 any one person", 1),
                term("aggregate_limit", m, "$25,000", "$25,000 aggregate, no deductible", 1),
                term("minimum_payout", m, "$25.00", "We will not pay a medical payments claim of less than $25.00.", 1),
                term("service_window_days", m, "365 days", "within one year (365 days) of the accident", 1),
                term("per_claim_limit", "property", "$10,000", "Damage to premises: $10,000 any one occurrence", 1),
                term("deductible", "property", "$500", "subject to a $500 deductible per occurrence", 1),
            ],
            fee_schedule: vec![
                FeeRead { code: "99211".into(), description: "First aid visit, minimal".into(), cap: "$65.00".into(), quote: "99211 First aid visit, minimal $65.00 per unit".into(), page: 2 },
                FeeRead { code: "73110".into(), description: "X-ray wrist, three or more views".into(), cap: "$165.00".into(), quote: "73110 X-ray wrist, three or more views $165.00".into(), page: 2 },
            ],
            exclusions: vec![ExclusionRead {
                kind: "staff".into(),
                quote: "This insurance does not apply to bodily injury to any employee or volunteer of the insured.".into(),
                page: 2,
            }],
            clauses: vec![
                ClauseRead {
                    section: "limits".into(),
                    page: 1,
                    text: "Medical payments: $5,000 any one person, $25,000 aggregate, no deductible. We will not pay a medical payments claim of less than $25.00."
                        .into(),
                },
                ClauseRead { section: "exclusions".into(), page: 2, text: "This insurance does not apply to bodily injury to any employee or volunteer of the insured.".into() },
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    fn find<'a>(c: &'a CheckedPolicy, cover: &str, name: &str) -> &'a CheckedTerm {
        c.terms.iter().find(|t| t.cover == cover && t.name == name).unwrap_or_else(|| panic!("{cover} {name}"))
    }

    #[test]
    fn reads_every_term_with_its_quote_and_clause() {
        let c = check_policy(&read(), &pages());
        assert!(c.dropped.is_empty(), "{:?}", c.dropped);
        assert_eq!(c.clauses.len(), 2);
        let min = find(&c, "medical_payments", "minimum_payout");
        assert_eq!((min.value.as_str(), min.shown.as_str(), min.status, min.clause), ("2500", "$25.00", TermStatus::Read, 1));
        assert_eq!(find(&c, "medical_payments", "service_window_days").value, "365");
        assert_eq!(find(&c, "", "policy_number").value, "NWM-GL-2026-0413");
        let agg = find(&c, "property", "aggregate_limit");
        assert_eq!((agg.status, agg.value.as_str()), (TermStatus::Default, "5000000"));
        let staff = c.terms.iter().find(|t| t.name == EXCLUSION && t.code == "staff").unwrap();
        assert_eq!((staff.status, staff.clause), (TermStatus::Read, 2));

        let p = effective(&c.terms);
        assert_eq!(p.policy_number, "NWM-GL-2026-0413");
        assert_eq!((p.period_start.as_str(), p.period_end.as_str()), ("2026-10-01", "2027-09-30"));
        let med = &p.covers[0];
        assert_eq!((med.per_claim_limit_cents, med.aggregate_limit_cents, med.minimum_payout_cents, med.service_window_days), (500_000, 2_500_000, 2_500, 365));
        assert_eq!(p.covers[1].deductible_cents, 50_000);
        assert_eq!(p.fee_schedule.len(), 2, "a stated schedule replaces the default one");
        assert_eq!(p.fee_schedule[1], FeeLine { code: "73110".into(), description: "X-ray wrist, three or more views".into(), max_allowed_cents: 16_500 });
        assert_eq!(p.exclusions, ["staff"]);
    }

    fn declarations() -> Declarations {
        Declarations {
            insurer_name: "Harborline Casualty".into(),
            policy_number: "HCP-2026-7781".into(),
            fnol_contact: "claims@harborline.test".into(),
            period_start: "2026-09-01".into(),
            period_end: "2027-08-31".into(),
            medical_limit_cents: 1_000_000,
            medical_aggregate_cents: 200_000_000,
            property_limit_cents: 25_000_000,
            property_deductible_cents: 100_000,
        }
    }

    #[test]
    fn typed_declarations_stand_over_what_the_forms_gave() {
        let mut c = check_policy(&read(), &pages());
        apply_declarations(&mut c.terms, &declarations());
        let per = find(&c, "medical_payments", "per_claim_limit");
        assert_eq!((per.status, per.value.as_str(), per.shown.as_str(), per.quote.as_str(), per.page), (TermStatus::Typed, "1000000", "$10,000.00", "", 0));
        assert_eq!(find(&c, "property", "aggregate_limit").value, "25000000", "the property limit is its aggregate too");
        assert_eq!(find(&c, "medical_payments", "minimum_payout").status, TermStatus::Read, "what no declaration names stays as read");
        let p = effective(&c.terms);
        assert_eq!((p.insurer_name.as_str(), p.policy_number.as_str(), p.period_end.as_str()), ("Harborline Casualty", "HCP-2026-7781", "2027-08-31"));
        assert_eq!((p.covers[1].per_claim_limit_cents, p.covers[1].deductible_cents), (25_000_000, 100_000));
        assert_eq!(p.covers[0].service_window_days, 365);
    }

    #[test]
    fn declarations_must_fit_together() {
        assert_eq!(declarations().problem(), None);
        let d = Declarations { period_end: "2026-08-31".into(), ..declarations() };
        assert_eq!(d.problem().unwrap(), "the policy period must end after it starts");
        let d = Declarations { medical_aggregate_cents: 5_000, ..declarations() };
        assert!(d.problem().unwrap().contains("general aggregate"));
        let d = Declarations { property_deductible_cents: 25_000_000, ..declarations() };
        assert!(d.problem().unwrap().contains("property deductible"));
        let d = Declarations { fnol_contact: " ".into(), ..declarations() };
        assert_eq!(d.problem().unwrap(), "type the claims contact from the declarations page");
    }

    #[test]
    fn a_quote_off_its_page_keeps_the_default() {
        let mut r = read();
        r.terms[6].quote = "Medical payments: $9,000 any one person".into();
        r.terms[6].value = "$9,000".into();
        let c = check_policy(&r, &pages());
        let per = find(&c, "medical_payments", "per_claim_limit");
        assert_eq!((per.status, per.value.as_str(), per.read_value.as_str()), (TermStatus::Flagged, "500000", "$9,000"));
        assert_eq!(per.problem, "the quote is not on page 1");
    }

    #[test]
    fn limits_that_do_not_fit_fall_back() {
        let mut r = read();
        r.terms.push(term("deductible", "medical_payments", "$6,000", "Medical payments: $5,000 any one person", 1));
        let c = check_policy(&r, &pages());
        let ded = find(&c, "medical_payments", "deductible");
        assert_eq!((ded.status, ded.value.as_str()), (TermStatus::Flagged, "0"));
        assert_eq!(ded.problem, "the deductible $6,000.00 is above the per-claim limit $5,000.00");
        assert_eq!(find(&c, "medical_payments", "per_claim_limit").status, TermStatus::Flagged);
    }

    #[test]
    fn bad_values_codes_and_clauses_are_flagged_or_dropped() {
        let mut r = read();
        r.terms[9].value = "a reasonable time".into();
        r.fee_schedule.push(FeeRead { code: "9921".into(), description: "short".into(), cap: "$10".into(), quote: "99211 First aid visit".into(), page: 2 });
        r.clauses.push(ClauseRead { section: "limits".into(), page: 2, text: "Medical payments: $5,000".into() });
        r.terms.push(term("liquor_liability", "", "$1,000,000", "x", 1));
        let c = check_policy(&r, &pages());
        let window = find(&c, "medical_payments", "service_window_days");
        assert_eq!((window.status, window.value.as_str(), window.problem.as_str()), (TermStatus::Flagged, "365", "\"a reasonable time\" is not a number of days"));
        let bad = c.terms.iter().find(|t| t.code == "9921").unwrap();
        assert_eq!((bad.status, bad.value.as_str()), (TermStatus::Flagged, ""));
        assert_eq!(c.dropped, ["clause 3 (limits): not word for word on page 2", "unknown term liquor_liability"]);
        assert_eq!(effective(&c.terms).fee_schedule.len(), 2);
    }

    #[test]
    fn nothing_read_means_the_defaults() {
        let c = check_policy(&PolicyRead::default(), &pages());
        assert!(c.terms.iter().all(|t| t.status == TermStatus::Default));
        assert_eq!(effective(&c.terms), defaults());
    }

    #[test]
    fn quotes_match_across_line_breaks_and_curly_quotes() {
        let pages = vec!["We will pay \u{201C}reasonable\u{201D}\nexpenses \u{2014} incurred".to_string()];
        assert!(on_page(&pages, 1, "we will pay \"reasonable\" expenses - incurred"));
        assert!(!on_page(&pages, 2, "we will pay"));
        assert!(!on_page(&pages, 1, ""));
    }

    #[test]
    fn amounts_and_days_parse() {
        assert_eq!(parse_amount("$5,000"), Some(500_000));
        assert_eq!(parse_amount("USD 250.00"), Some(25_000));
        assert_eq!(parse_amount("five thousand"), None);
        assert_eq!(parse_days("30 calendar days"), Some(30));
    }

    #[test]
    fn the_schema_lists_every_term() {
        let s = venue_policy_schema();
        assert_eq!(s["properties"]["terms"]["items"]["properties"]["name"]["enum"].as_array().unwrap().len(), 11);
        assert_eq!(s["properties"]["clauses"]["items"]["properties"]["section"]["enum"].as_array().unwrap().len(), 8);
    }

    #[test]
    fn an_attendee_document_is_read_for_its_clauses_only() {
        assert_eq!(document_schema(VENUE_POLICY), venue_policy_schema());
        for kind in [HEALTH_PLAN, ATTENDEE_POLICY] {
            let s = document_schema(kind);
            assert_eq!(s["required"], serde_json::json!(["clauses"]));
            assert_eq!(s["properties"].as_object().unwrap().len(), 1);
            assert_eq!(s["properties"]["clauses"], venue_policy_schema()["properties"]["clauses"]);
        }
        let read: PolicyRead = serde_json::from_value(serde_json::json!({"clauses": [{"section": "limits", "page": 1, "text": "x"}]})).unwrap();
        assert_eq!((read.terms.len(), read.clauses.len()), (0, 1));
    }
}
