//! A venue policy lookup inside an in-memory module: the organizer names the forms and types the
//! declarations, the worker finds the forms or nothing, a found policy is filed for the reading, its
//! terms take the typed declarations, and the organizer's confirmation makes them the event's policy.

use super::*;
use crate::insurance::documents::*;
use crate::insurance::tables::*;
use crate::tables::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, Table, Timestamp};

fn id(name: &str) -> Identity {
    Identity::from_claims("bandit-test", name)
}

fn auth(name: &str) -> TestAuth {
    let payload = format!(r#"{{"iss":"bandit-test","sub":"{name}"}}"#);
    TestAuth::from_jwt_payload(payload, ConnectionId::from_u128(name.len() as u128 + 1)).unwrap()
}

struct World {
    t: TestContext,
}

impl World {
    fn new() -> Self {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000));
        t.db.owner().insert(Owner { identity: id("owner") });
        for who in ["worker", "ops"] {
            t.db.staff_role().insert(StaffRole { id: 0, identity: id(who), role: who.into(), label: who.into(), granted_by: id("owner"), granted_at: t.clock.now() });
        }
        World { t }
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    fn try_as<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> Result<T, String> {
        self.t.with_reducer_tx(auth(who), f)
    }

    fn lease(&self, kind: &str) -> Job {
        let job = self.t.db.job().iter().filter(|j| j.kind == kind && j.status == JobStatus::Queued).max_by_key(|j| j.id).expect("a queued job");
        self.as_("worker", |ctx| claim_job(ctx, job.id));
        job
    }

    fn lookup(&self) -> VenuePolicyLookup {
        self.t.db.venue_policy_lookup().iter().max_by_key(|l| l.id).expect("a venue policy lookup")
    }

    fn ask(&self, who: &str, d: DeclarationsIn) -> Result<(), String> {
        self.try_as(who, |ctx| look_up_venue_policy(ctx, "Harborline Casualty".into(), "ca".into(), " cg 00 01  04 13 ".into(), "CP 00 10".into(), d))
    }
}

fn declarations() -> DeclarationsIn {
    DeclarationsIn {
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

fn form(part: &str, number: &str, first_page: u32) -> PolicyForm {
    PolicyForm { part: part.into(), url: format!("https://forms.test/{}.pdf", number.replace(' ', "")), form_number: number.into(), title: format!("{part} coverage form"), first_page, page_count: 1 }
}

fn found() -> VenuePolicyLookupResult {
    VenuePolicyLookupResult {
        status: FOUND.into(),
        forms: vec![form(LIABILITY, "CG 00 01 04 13", 1), form(PROPERTY, "CP 00 10 10 12", 2)],
        file_hash: "D".repeat(64),
        size_bytes: 300_000,
        page_count: 2,
        note: String::new(),
        liability_chunk: Some(ChunkMatch {
            chunk_id: format!("{}-p1-k1", "d".repeat(64)),
            page: 1,
            text: "COMMERCIAL GENERAL LIABILITY COVERAGE FORM CG 00 01 04 13".into(),
            score: 0.74,
        }),
        property_chunk: None,
    }
}

/// The text layer of the joined forms: a liability form and a property form that point at the declarations.
fn pages() -> Vec<String> {
    vec![
        "COMMERCIAL GENERAL LIABILITY COVERAGE FORM CG 00 01 04 13. Coverage C Medical Payments. We will pay medical expenses for bodily injury \
         caused by an accident, provided that the expenses are incurred and reported to us within 365 days of the date of the accident. \
         The Medical Expense Limit shown in the Declarations is the most we will pay. Exclusions. We will not pay expenses for bodily injury \
         to a person hired to do work for or on behalf of any insured."
            .into(),
        "BUILDING AND PERSONAL PROPERTY COVERAGE FORM CP 00 10 10 12. We will not pay for loss in any one occurrence until the amount of loss \
         exceeds the Deductible shown in the Declarations."
            .into(),
    ]
}

/// What the Evidence Engine read from the forms: no limits, which only the declarations print.
fn read() -> String {
    serde_json::json!({
        "terms": [
            {"name": "service_window_days", "cover": "medical_payments", "value": "365 days", "quote": "within 365 days of the date of the accident", "page": 1},
            {"name": "per_claim_limit", "cover": "medical_payments", "value": "shown in the Declarations", "quote": "The Medical Expense Limit shown in the Declarations is the most we will pay.", "page": 1}
        ],
        "fee_schedule": [],
        "exclusions": [{"kind": "staff", "quote": "to a person hired to do work for or on behalf of any insured", "page": 1}],
        "clauses": [
            {"section": "exclusions", "page": 1, "text": "We will not pay expenses for bodily injury to a person hired to do work for or on behalf of any insured."},
            {"section": "limits", "page": 2, "text": "We will not pay for loss in any one occurrence until the amount of loss exceeds the Deductible shown in the Declarations."}
        ]
    })
    .to_string()
}

#[test]
fn a_found_policy_is_read_with_the_typed_declarations_and_confirmed() {
    let w = World::new();
    assert!(w.ask("worker", declarations()).is_err(), "only the organizer looks up the venue's policy");
    w.ask("ops", declarations()).unwrap();
    let l = w.lookup();
    assert_eq!((l.state.as_str(), l.liability_form.as_str(), l.status.as_str()), ("CA", "CG 00 01 04 13", SEARCHING));
    assert_eq!(w.ask("ops", declarations()).unwrap_err(), "already looking up the venue's policy");

    let job = w.lease(KIND_VENUE_POLICY_LOOKUP);
    let payload: serde_json::Value = serde_json::from_str(&job.payload).unwrap();
    assert_eq!((payload["property_form"].as_str(), payload.get("policy_number")), (Some("CP 00 10"), None), "the search never holds the policy number");
    assert!(w.try_as("ops", |ctx| finish_venue_policy_lookup(ctx, job.id, found(), None)).is_err(), "only the worker finishes a lookup");
    w.as_("worker", |ctx| finish_venue_policy_lookup(ctx, job.id, found(), None));

    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.forms.len(), l.page_count), (FOUND, 2, 2));
    assert_eq!((l.liability_chunk.as_ref().map(|c| c.page), l.property_chunk.as_ref()), (Some(1), None), "each form keeps the chunk its check cites");
    let blob = w.t.db.blob_ref().hash().find("d".repeat(64)).unwrap();
    assert_eq!((blob.owner, blob.access.as_str(), blob.purpose.as_str()), (None, "staff", "policy"));
    let doc = w.t.db.policy_document().id().find(l.document_id).expect("the joined forms go to the reading");
    assert_eq!((doc.kind.as_str(), doc.source.as_str(), doc.source_url.as_str()), ("venue_policy", POLICY_LOOKUP, "https://forms.test/CG00010413.pdf"));

    let read_job = w.lease(bandit_insurance::policy::KIND_DOCUMENT_READ);
    w.as_("worker", |ctx| apply_document_terms(ctx, read_job.id, read(), pages()));
    let terms: Vec<PolicyTerm> = w.t.db.policy_term().document_id().filter(doc.id).collect();
    let term = |cover: &str, name: &str| terms.iter().find(|t| t.cover_kind == cover && t.name == name).unwrap().clone();
    let per = term("medical_payments", "per_claim_limit");
    assert_eq!((per.status.as_str(), per.value.as_str(), per.problem.as_str()), ("typed", "1000000", ""));
    assert_eq!(term("medical_payments", "service_window_days").status, "read");
    assert_eq!((term("property", "aggregate_limit").value.as_str(), term("", "policy_number").status.as_str()), ("25000000", "typed"));

    w.as_("ops", |ctx| confirm_policy_terms(ctx, doc.id));
    let policy = w.t.db.insurance_policy().policy_number().find("HCP-2026-7781".to_string()).unwrap();
    assert!(policy.period_checked && policy.staff_excluded);
    assert_eq!((policy.insurer_name.as_str(), policy.fnol_contact.as_str()), ("Harborline Casualty", "claims@harborline.test"));
    let rule = |cover: &str| w.t.db.coverage_rule().policy_id().filter(policy.id).find(|r| r.cover_kind == cover).unwrap();
    assert_eq!((rule("medical_payments").per_claim_limit_cents, rule("medical_payments").service_window_days), (1_000_000, 365));
    assert_eq!((rule("property").per_claim_limit_cents, rule("property").deductible_cents), (25_000_000, 100_000));
}

#[test]
fn the_declarations_and_form_numbers_are_checked() {
    let w = World::new();
    let d = DeclarationsIn { property_deductible_cents: 30_000_000, ..declarations() };
    assert_eq!(w.ask("ops", d).unwrap_err(), "the property deductible must be below the property limit");
    let d = DeclarationsIn { period_end: "2026-01-01".into(), ..declarations() };
    assert_eq!(w.ask("ops", d).unwrap_err(), "the policy period must end after it starts");
    let bad = w.try_as("ops", |ctx| look_up_venue_policy(ctx, "Harborline".into(), "CA".into(), "CGL".into(), "CP 00 10".into(), declarations()));
    assert!(bad.unwrap_err().contains("liability form number"));
    assert!(w.t.db.venue_policy_lookup().iter().next().is_none());
}

#[test]
fn nothing_found_files_nothing_and_a_dead_job_ends_failed() {
    let w = World::new();
    w.ask("ops", declarations()).unwrap();
    let job = w.lease(KIND_VENUE_POLICY_LOOKUP);
    let none = VenuePolicyLookupResult { status: WRONG_FORM.into(), note: "3 PDFs came back, none of them CG 00 01 04 13".into(), ..Default::default() };
    w.as_("worker", |ctx| finish_venue_policy_lookup(ctx, job.id, none, None));
    assert_eq!((w.lookup().status.as_str(), w.lookup().document_id), (WRONG_FORM, 0));
    assert!(w.t.db.policy_document().iter().next().is_none());

    w.ask("ops", declarations()).unwrap();
    for attempt in 1..=MAX_ATTEMPTS {
        let job = w.lease(KIND_VENUE_POLICY_LOOKUP);
        w.as_("worker", |ctx| fail_job(ctx, job.id, format!("search failed {attempt}"), None));
        let ready = w.t.db.job().id().find(job.id).unwrap().not_before.unwrap_or(w.t.clock.now());
        w.t.clock.set(ready);
    }
    let l = w.lookup();
    assert_eq!((l.status.as_str(), l.note.as_str()), (FAILED, "search failed 3"));
}
