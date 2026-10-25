//! What a PDF prints about itself, as `bandit-read-document` reads it: the
//! kind of document, and the insurer, plan and plan year of an attendee's
//! health plan, or the coverage forms a venue policy lookup fetched, each with its
//! form number, title and pages. A plan lookup and a venue policy lookup keep
//! a fetched PDF only when this matches what was typed, and code finds every
//! printed name word for word on its page first.

use crate::policy::on_page;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// A kind only the lookups read: a PDF found on the web that should hold a
/// coverage form of the venue's policy. It is read to check it and never
/// filed, so it is not one of `policy::DOCUMENT_KINDS`.
pub const COVERAGE_FORM: &str = "coverage_form";

/// What a health plan's document is: a Summary of Benefits and Coverage, or anything else.
pub const PLAN_DOCUMENTS: [&str; 2] = ["sbc", "other"];
/// What one coverage form is: the liability part, the property part, or another form.
pub const FORM_DOCUMENTS: [&str; 3] = ["liability_form", "property_form", "other"];

/// The longest printed name kept.
const MAX_CHARS: usize = 120;

/// One name as printed and the 1-based page it is on; empty text and page 0 when it is not printed.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PrintedText {
    pub text: String,
    pub page: u32,
}

/// What an attendee's health plan document prints about itself: the `printed`
/// part of a `health_plan` read.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PlanPrinted {
    /// One of `PLAN_DOCUMENTS`.
    pub document: String,
    pub insurer: PrintedText,
    pub plan: PrintedText,
    pub plan_year: PrintedText,
}

/// One coverage form a fetched PDF holds.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FormPrinted {
    /// One of `FORM_DOCUMENTS`.
    pub document: String,
    pub form_number: PrintedText,
    pub title: PrintedText,
    /// The form's own pages in the PDF, 1-based and inclusive.
    pub first_page: u32,
    pub last_page: u32,
}

fn item_schema(what: &str) -> Value {
    json!({
        "type": "object",
        "required": ["text", "page"],
        "properties": {
            "text": {"type": "string", "description": format!("{what}, copied exactly as printed; empty when the document does not print it")},
            "page": {"type": "integer", "description": "the 1-based page it is printed on; 0 when it is not printed"}
        }
    })
}

/// The `printed` part of the schema of a `health_plan`.
pub fn plan_schema() -> Value {
    json!({
        "type": "object",
        "required": ["document", "insurer", "plan", "plan_year"],
        "properties": {
            "document": {"type": "string", "enum": PLAN_DOCUMENTS, "description": "sbc for a Summary of Benefits and Coverage, other for anything else"},
            "insurer": item_schema("the insurer's name"),
            "plan": item_schema("the plan's name"),
            "plan_year": item_schema("the plan year")
        }
    })
}

/// The schema of a `coverage_form`: every coverage form the PDF holds.
pub fn form_schema() -> Value {
    json!({
        "type": "object",
        "required": ["forms"],
        "properties": {
            "forms": {"type": "array", "items": {
                "type": "object",
                "required": ["document", "form_number", "title", "first_page", "last_page"],
                "properties": {
                    "document": {"type": "string", "enum": FORM_DOCUMENTS, "description": "liability_form for a commercial general liability coverage form, property_form for a commercial property coverage form, other for any other coverage form"},
                    "form_number": item_schema("the form number with its edition, such as CG 00 01 04 13, from the form's own pages"),
                    "title": item_schema("the form's title"),
                    "first_page": {"type": "integer", "description": "the 1-based page where the form itself starts"},
                    "last_page": {"type": "integer", "description": "the 1-based page where the form itself ends"}
                }
            }}
        }
    })
}

/// `item` when code finds it word for word on its page; `None` when it is not printed.
fn on_its_page(item: &PrintedText, pages: &[String], name: &str) -> Result<Option<PrintedText>, String> {
    let text = item.text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    if !on_page(pages, item.page, text) {
        return Err(format!("the {name} {text:?} is not on page {}", item.page));
    }
    Ok(Some(PrintedText { text: text.chars().take(MAX_CHARS).collect(), page: item.page }))
}

impl PlanPrinted {
    /// The `printed` part of the reader's answer; empty when it has none.
    pub fn from_read(read: &Value) -> Self {
        serde_json::from_value(read["printed"].clone()).unwrap_or_default()
    }

    /// The names code finds word for word on their pages, or why the reading
    /// cannot be trusted: an insurer or a plan that is not on the page it names.
    /// A plan year off its page is left out.
    pub fn checked(&self, pages: &[String]) -> Result<Self, String> {
        Ok(PlanPrinted {
            document: self.document.trim().to_string(),
            insurer: on_its_page(&self.insurer, pages, "insurer")?.unwrap_or_default(),
            plan: on_its_page(&self.plan, pages, "plan")?.unwrap_or_default(),
            plan_year: on_its_page(&self.plan_year, pages, "plan year").ok().flatten().unwrap_or_default(),
        })
    }
}

impl FormPrinted {
    /// The forms of a `coverage_form` read; none when it has none.
    pub fn from_read(read: &Value) -> Vec<Self> {
        serde_json::from_value(read["forms"].clone()).unwrap_or_default()
    }

    /// The form as code finds it in a PDF of `pages`, or why not: its form
    /// number must be on its page word for word and inside the form's own pages,
    /// which must be pages of the PDF. A title off its page is left out.
    pub fn checked(&self, pages: &[String]) -> Result<Self, String> {
        let form_number = on_its_page(&self.form_number, pages, "form number")?.ok_or("it prints no form number")?;
        let (first, last, n) = (self.first_page, self.last_page, pages.len() as u32);
        if first < 1 || first > last || last > n {
            return Err(format!("its pages {first} to {last} are not pages of a PDF of {n}"));
        }
        if !(first..=last).contains(&form_number.page) {
            return Err(format!("its form number is on page {}, outside its own pages {first} to {last}", form_number.page));
        }
        Ok(FormPrinted {
            document: self.document.trim().to_string(),
            title: on_its_page(&self.title, pages, "title").ok().flatten().unwrap_or_default(),
            form_number,
            first_page: first,
            last_page: last,
        })
    }
}

/// The words that tell plans and insurers apart: lowercase, three letters or more, or a number.
pub fn telling_words(s: &str) -> Vec<String> {
    const COMMON: [&str; 12] = ["the", "and", "for", "inc", "plan", "plans", "insurance", "company", "corp", "group", "policy", "coverage"];
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| (w.len() >= 3 || w.chars().all(|c| c.is_ascii_digit())) && !w.is_empty() && !COMMON.contains(w))
        .map(String::from)
        .collect()
}

/// Two names of one plan: the same telling words of the insurer and of the plan, in order. A plan
/// lookup reuses a plan already found only under this, since no search narrowed it down.
pub fn same_plan_name(insurer: &str, plan: &str, other_insurer: &str, other_plan: &str) -> bool {
    let (i, p) = (telling_words(insurer), telling_words(plan));
    !i.is_empty() && !p.is_empty() && i == telling_words(other_insurer) && p == telling_words(other_plan)
}

/// Every form of a `coverage_form` read that passes `FormPrinted::checked`, and why each other one did not.
pub fn checked_forms(read: &Value, pages: &[String]) -> (Vec<FormPrinted>, Vec<String>) {
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    for (i, f) in FormPrinted::from_read(read).iter().enumerate() {
        match f.checked(pages) {
            Ok(f) => kept.push(f),
            Err(why) => dropped.push(format!("form {}: {why}", i + 1)),
        }
    }
    (kept, dropped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sbc() -> Vec<String> {
        vec![
            "Blue Shield of California: Silver 70 PPO 2500/55 Coverage Period: 01/01/2026 - 12/31/2026\nSummary of Benefits and Coverage".into(),
            "Important Questions Answers\nWhat is the overall deductible? $2,500 individual".into(),
        ]
    }

    fn item(text: &str, page: u32) -> PrintedText {
        PrintedText { text: text.into(), page }
    }

    #[test]
    fn one_plan_has_one_set_of_telling_words() {
        assert_eq!(telling_words("Blue Shield of California, Inc."), ["blue", "shield", "california"]);
        assert_eq!(telling_words("Silver 70 PPO plan"), ["silver", "70", "ppo"]);
        assert!(same_plan_name("blue shield  of california", "Silver 70 PPO", "Blue Shield of California", "Silver 70 PPO"));
        assert!(same_plan_name("Kaiser Permanente", "Bronze 60 HMO", "KAISER PERMANENTE", "Bronze 60 HMO plan"));
        assert!(!same_plan_name("Blue Shield", "Silver 70", "Blue Shield of California", "Silver 70 PPO"), "a shorter name runs its own search");
        assert!(!same_plan_name("Blue Shield of California", "Silver 70 PPO", "Blue Shield of California", "Silver 70 HMO"));
        assert!(!same_plan_name("Blue Shield of California", "PPO 70 Silver", "Blue Shield of California", "Silver 70 PPO"), "in order");
        assert!(!same_plan_name("The Plan", "Plan", "The Plan", "Plan"), "no telling words names no plan");
    }

    #[test]
    fn plan_names_must_be_on_their_pages() {
        let read = json!({"printed": {"document": "sbc", "insurer": {"text": "Blue Shield of California", "page": 1}, "plan": {"text": "Silver 70 PPO 2500/55", "page": 1}, "plan_year": {"text": "01/01/2026 - 12/31/2026", "page": 1}}});
        let p = PlanPrinted::from_read(&read).checked(&sbc()).unwrap();
        assert_eq!((p.document.as_str(), p.insurer.text.as_str(), p.plan.page), ("sbc", "Blue Shield of California", 1));
        assert_eq!(p.plan_year.text, "01/01/2026 - 12/31/2026");

        let off = PlanPrinted { insurer: item("Blue Shield of California", 2), ..p.clone() };
        assert_eq!(off.checked(&sbc()).unwrap_err(), "the insurer \"Blue Shield of California\" is not on page 2");
        let made_up = PlanPrinted { plan: item("Gold 80 HMO", 1), ..p.clone() };
        assert!(made_up.checked(&sbc()).unwrap_err().contains("Gold 80 HMO"));
        let year_off = PlanPrinted { plan_year: item("2027", 1), ..p.clone() };
        assert_eq!(year_off.checked(&sbc()).unwrap().plan_year, PrintedText::default(), "a plan year off its page is left out");
        let unprinted = PlanPrinted { plan: item("", 0), ..p };
        assert_eq!(unprinted.checked(&sbc()).unwrap().plan, PrintedText::default());
        assert_eq!(PlanPrinted::from_read(&json!({"clauses": []})), PlanPrinted::default());
    }

    /// A specimen policy: declarations with the forms schedule, then two forms with their footers.
    fn specimen() -> Vec<String> {
        vec![
            "COMMERCIAL GENERAL LIABILITY DECLARATIONS\nForms schedule: CG 00 01 04 13, CP 00 10 10 12".into(),
            "COMMERCIAL GENERAL LIABILITY COVERAGE FORM\nSECTION I COVERAGES\nCG 00 01 04 13 Page 1 of 2".into(),
            "COVERAGE C MEDICAL PAYMENTS\nCG 00 01 04 13 Page 2 of 2".into(),
            "BUILDING AND PERSONAL PROPERTY COVERAGE FORM\nCP 00 10 10 12 Page 1 of 1".into(),
        ]
    }

    fn form(document: &str, number: &str, at: u32, first: u32, last: u32) -> Value {
        json!({"document": document, "form_number": {"text": number, "page": at}, "title": {"text": "COMMERCIAL GENERAL LIABILITY COVERAGE FORM", "page": first}, "first_page": first, "last_page": last})
    }

    #[test]
    fn each_form_is_found_on_its_own_pages() {
        let read = json!({"forms": [form("liability_form", "CG 00 01 04 13", 3, 2, 3), form("property_form", "CP 00 10 10 12", 4, 4, 4)]});
        let (forms, dropped) = checked_forms(&read, &specimen());
        assert!(dropped.is_empty(), "{dropped:?}");
        assert_eq!((forms[0].first_page, forms[0].last_page, forms[0].form_number.text.as_str()), (2, 3, "CG 00 01 04 13"));
        assert_eq!(forms[0].title.text, "COMMERCIAL GENERAL LIABILITY COVERAGE FORM");
        assert_eq!(forms[1].title, PrintedText::default(), "the liability title is not on page 4");
    }

    #[test]
    fn a_form_off_its_pages_is_dropped() {
        let check = |f: Value| FormPrinted::from_read(&json!({"forms": [f]}))[0].checked(&specimen());
        assert_eq!(check(form("liability_form", "CG 00 01 04 13", 1, 2, 3)).unwrap_err(), "its form number is on page 1, outside its own pages 2 to 3", "the forms schedule is not the form");
        assert_eq!(check(form("liability_form", "CG 00 01 04 13", 3, 2, 9)).unwrap_err(), "its pages 2 to 9 are not pages of a PDF of 4");
        assert!(check(form("liability_form", "CG 00 01 04 13", 3, 3, 2)).is_err());
        assert!(check(form("liability_form", "CG 00 01 12 07", 3, 2, 3)).unwrap_err().contains("not on page 3"));
        assert_eq!(check(form("liability_form", "", 0, 2, 3)).unwrap_err(), "it prints no form number");
        let (kept, dropped) = checked_forms(&json!({"forms": [form("other", "CG 00 01 04 13", 1, 2, 3)]}), &specimen());
        assert_eq!((kept.len(), dropped[0].starts_with("form 1:")), (0, true));
        assert!(FormPrinted::from_read(&json!({})).is_empty());
    }

    #[test]
    fn the_schemas_ask_for_names_with_pages() {
        assert_eq!(plan_schema()["properties"]["document"]["enum"], json!(PLAN_DOCUMENTS));
        assert_eq!(plan_schema()["properties"]["insurer"]["required"], json!(["text", "page"]));
        let form = &form_schema()["properties"]["forms"]["items"];
        assert_eq!(form["properties"]["document"]["enum"], json!(FORM_DOCUMENTS));
        assert_eq!(form["required"].as_array().unwrap().len(), 5);
    }
}
