//! JSON schemas for Claude structured outputs, one per agent task, and the
//! letter output types. Each schema mirrors its Rust type exactly: every
//! property required, `additionalProperties: false`, no numeric or length
//! keywords (structured outputs do not enforce them; code validation does).
//!
//! Keywords used: `type`, `properties`, `required`, `additionalProperties`,
//! `items`, `enum` (strings only), `description`, and `anyOf` with `null` for
//! an object that is absent in some answers. Formats are left out on purpose:
//! a date the model cannot read must come back empty, not invented.

use crate::Causation;
use crate::decision::{Choice, EvidenceSource, Stance};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// The kinds listed on `decision::Concern`.
const CONCERN_KINDS: [&str; 7] = ["causation", "timing", "location", "identity", "amount", "duplicate", "other"];

/// An object whose properties are all required and nothing else is allowed.
fn object(props: Vec<(&str, Value)>) -> Value {
    let required: Vec<&str> = props.iter().map(|(k, _)| *k).collect();
    let properties: Map<String, Value> = props.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
}

fn typed(ty: &str, description: &str) -> Value {
    if description.is_empty() { json!({"type": ty}) } else { json!({"type": ty, "description": description}) }
}

fn string(description: &str) -> Value {
    typed("string", description)
}

fn integer(description: &str) -> Value {
    typed("integer", description)
}

fn array(items: Value) -> Value {
    json!({"type": "array", "items": items})
}

fn one_of(values: &[&str], description: &str) -> Value {
    let mut v = string(description);
    v["enum"] = json!(values);
    v
}

/// `schema`, or `null` when the answer has none.
fn nullable(schema: Value) -> Value {
    json!({"anyOf": [schema, {"type": "null"}]})
}

/// Schema for `medical::ExtractedRecord`.
pub fn medical_record_schema() -> Value {
    let page = || integer("1-based page of the PDF the item is printed on");
    let date = "YYYY-MM-DD as printed; empty when it cannot be read";
    object(vec![
        ("document_kind", one_of(&["first_aid_record", "urgent_care_record", "emergency_record", "other"], "")),
        (
            "patient",
            object(vec![("name", string("as printed")), ("date_of_birth", string("YYYY-MM-DD, or empty")), ("page", page())]),
        ),
        ("provider", object(vec![("name", string("")), ("address", string("empty when not printed")), ("page", page())])),
        (
            "encounter",
            object(vec![
                ("date_of_service", string(date)),
                ("time", string("HH:MM, or empty")),
                ("reason_for_visit", string("")),
                ("history", string("history of present illness, word for word: how the patient says it happened")),
                ("page", page()),
            ]),
        ),
        (
            "diagnoses",
            array(object(vec![
                ("code", string("ICD-10-CM code as printed, for example S63.501A")),
                ("description", string("")),
                ("page", page()),
            ])),
        ),
        (
            "services",
            array(object(vec![
                ("code", string("CPT or HCPCS Level II code as printed, for example 99211 or A6448")),
                ("description", string("")),
                ("date_of_service", string(date)),
                ("units", integer("")),
                ("charge_cents", integer("the line's total charge for all units, in cents")),
                ("page", page()),
            ])),
        ),
        ("invoice_number", string("empty when not printed")),
        ("total_billed_cents", integer("the bill's printed total, in cents")),
    ])
}

/// Schema for `decision::AgentDecision`. Enums carry the snake_case variant
/// names; concern `kind` is an enum of the kinds listed on `decision::Concern`.
pub fn agent_decision_schema() -> Value {
    let choices = [Choice::Pay, Choice::Refuse, Choice::AskOrganizer].map(Choice::as_str);
    let causations = [Causation::Supported, Causation::Unsupported, Causation::Unclear].map(Causation::as_str);
    let sources = EvidenceSource::ALL.map(EvidenceSource::as_str);
    let stances = [Stance::Supports, Stance::Contradicts, Stance::Neutral, Stance::Missing].map(Stance::as_str);
    object(vec![
        (
            "decision",
            one_of(&choices, "pay when the evidence shows a covered injury or loss at the event; refuse when it shows the claim is not one; ask_organizer when a person should look"),
        ),
        ("causation", one_of(&causations, "whether the treated injury or the damage follows from the incident")),
        ("summary", string("two to four sentences for the organizer, at most 800 characters; dollar figures only from the claim's amounts")),
        (
            "findings",
            array(object(vec![
                ("source", one_of(&sources, "")),
                ("stance", one_of(&stances, "how this source bears on the claim")),
                ("detail", string("what the source showed, at most 400 characters")),
                ("fact_ids", array(integer("seq of a fact from this source"))),
            ])),
        ),
        ("trusted_source", string("when sources disagree: the one you trust and why; empty when none disagree")),
        (
            "concerns",
            array(object(vec![
                ("kind", one_of(&CONCERN_KINDS, "")),
                ("detail", string("at most 400 characters")),
                ("fact_ids", array(integer("seq of a fact in the pack"))),
            ])),
        ),
        ("innocent_explanations", array(string("a benign reading of something that looks off"))),
        ("missing_evidence", array(string("evidence a person could fetch to settle a concern"))),
        ("refusal_checks", array(string("for a refusal: the name of a failed check it rests on"))),
        ("question", string("for ask_organizer: the one question the organizer should answer; empty otherwise")),
        ("cited_fact_ids", array(integer("seq of a fact the decision rests on"))),
        (
            "cited_clause_ids",
            array(string("clause_id of a policy clause the decision rests on: the clause that covers the claim for a pay, the exclusion for a refusal")),
        ),
        (
            "charge",
            nullable(object(vec![
                ("recommend", typed("boolean", "true to recommend charging the person security named, false for no charge")),
                ("reason", string("why, at most 400 characters; dollar figures only from the claim's amounts or the proposed charge")),
                ("fact_ids", array(integer("seq of a fact the recommendation rests on"))),
                ("clause_ids", array(string("clause_id of a clause it rests on, such as the subrogation clause"))),
            ])),
        ),
    ])
}

/// Schema for `ClaimLetters`.
pub fn claim_letters_schema() -> Value {
    object(vec![
        ("fnol", string("first notice of loss to the insurer")),
        ("summary", string("one paragraph for the approver's screen")),
        ("determination", string("the letter to the claimant")),
        ("cited_fact_ids", array(integer("seq of a fact the letters rely on"))),
    ])
}

/// Schema for `RecoveryLetter`; `stance` is an enum with the single value `query`.
pub fn recovery_letter_schema() -> Value {
    object(vec![
        ("stance", one_of(&["query"], "")),
        ("subject", string("")),
        ("body", string("a question about what happened, never an accusation")),
        ("cited_fact_ids", array(integer("seq of a fact the letter relies on"))),
    ])
}

/// The claim letters the agent drafts after a decision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClaimLetters {
    /// First notice of loss to the insurer.
    pub fnol: String,
    /// One paragraph for the approver's screen.
    pub summary: String,
    /// The letter to the claimant.
    pub determination: String,
    /// Fact seqs the letters rely on.
    pub cited_fact_ids: Vec<u32>,
}

/// A recovery letter to a vendor or contractor, always a question.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecoveryLetter {
    pub stance: String,
    pub subject: String,
    pub body: String,
    pub cited_fact_ids: Vec<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::medical::fixtures::maya_record;
    use crate::decision::{AgentDecision, ChargeRecommendation, Concern, Finding};
    use std::collections::BTreeSet;

    /// What structured outputs accept and these schemas use.
    const KEYWORDS: [&str; 8] = ["type", "properties", "required", "additionalProperties", "items", "enum", "description", "anyOf"];

    /// Walks `schema` and `example` together: only `KEYWORDS`, every object's
    /// property names equal the example's keys, all required, nothing extra
    /// allowed, and every leaf has the schema's type.
    fn assert_mirrors(schema: &Value, example: &Value, path: &str) {
        let node = schema.as_object().unwrap_or_else(|| panic!("{path}: schema is not an object"));
        for k in node.keys() {
            assert!(KEYWORDS.contains(&k.as_str()), "{path}: keyword {k}");
        }
        if let Some(branches) = schema.get("anyOf").and_then(Value::as_array) {
            assert_eq!(branches.len(), 2, "{path}: anyOf is a schema or null");
            assert_eq!(branches[1], json!({"type": "null"}), "{path}: the second branch is null");
            if !example.is_null() {
                assert_mirrors(&branches[0], example, path);
            }
            return;
        }
        match schema["type"].as_str() {
            Some("object") => {
                let props = schema["properties"].as_object().unwrap();
                let fields = example.as_object().unwrap_or_else(|| panic!("{path}: example is not an object"));
                let names: BTreeSet<&str> = props.keys().map(String::as_str).collect();
                assert_eq!(names, fields.keys().map(String::as_str).collect(), "{path}: property names");
                let required: BTreeSet<&str> = schema["required"].as_array().unwrap().iter().map(|r| r.as_str().unwrap()).collect();
                assert_eq!(required, names, "{path}: required");
                assert_eq!(schema["additionalProperties"], json!(false), "{path}: additionalProperties");
                for (k, v) in fields {
                    assert_mirrors(&props[k], v, &format!("{path}.{k}"));
                }
            }
            Some("array") => {
                let items = example.as_array().unwrap_or_else(|| panic!("{path}: example is not an array"));
                assert!(!items.is_empty(), "{path}: give the example an element");
                for (i, v) in items.iter().enumerate() {
                    assert_mirrors(&schema["items"], v, &format!("{path}[{i}]"));
                }
            }
            Some("string") => {
                assert!(example.is_string(), "{path}: not a string");
                if let Some(values) = schema.get("enum") {
                    assert!(values.as_array().unwrap().contains(example), "{path}: {example} not in the enum");
                }
            }
            Some("integer") => {
                assert!(example.is_u64(), "{path}: not an integer");
                assert!(schema.get("enum").is_none(), "{path}: enum on an integer");
            }
            Some("boolean") => assert!(example.is_boolean(), "{path}: not a boolean"),
            other => panic!("{path}: unexpected type {other:?}"),
        }
    }

    fn full_decision() -> AgentDecision {
        AgentDecision {
            decision: Choice::AskOrganizer,
            causation: Causation::Unclear,
            summary: "The hospital report says the wrist was hurt at home.".to_string(),
            findings: vec![Finding { source: EvidenceSource::HospitalReport, stance: Stance::Contradicts, detail: "history says home".to_string(), fact_ids: vec![20] }],
            trusted_source: "the hospital report".to_string(),
            concerns: vec![Concern { kind: "causation".to_string(), detail: "history says home".to_string(), fact_ids: vec![20] }],
            innocent_explanations: vec!["an older injury mentioned in passing".to_string()],
            missing_evidence: vec!["intake form".to_string()],
            refusal_checks: vec!["witness_zone".to_string()],
            question: "Was the attendee hurt at the event?".to_string(),
            cited_fact_ids: vec![1, 20],
            cited_clause_ids: vec!["9f2c-c4".to_string()],
            charge: Some(ChargeRecommendation {
                recommend: false,
                reason: "the camera did not see who took it".to_string(),
                fact_ids: vec![20],
                clause_ids: vec!["9f2c-c9".to_string()],
            }),
        }
    }

    #[test]
    fn schemas_mirror_the_rust_types() {
        let letters = ClaimLetters {
            fnol: "notice".to_string(),
            summary: "summary".to_string(),
            determination: "letter".to_string(),
            cited_fact_ids: vec![1],
        };
        let recovery = RecoveryLetter {
            stance: "query".to_string(),
            subject: "A question".to_string(),
            body: "Could you tell us what you saw?".to_string(),
            cited_fact_ids: vec![3],
        };
        let cases = [
            ("medical_record", medical_record_schema(), serde_json::to_value(maya_record()).unwrap()),
            ("agent_decision", agent_decision_schema(), serde_json::to_value(full_decision()).unwrap()),
            ("claim_letters", claim_letters_schema(), serde_json::to_value(letters).unwrap()),
            ("recovery_letter", recovery_letter_schema(), serde_json::to_value(recovery).unwrap()),
        ];
        for (name, schema, example) in &cases {
            assert_mirrors(schema, example, name);
        }
    }

    #[test]
    fn enums_match_the_rust_enums() {
        let s = agent_decision_schema();
        let choices = s["properties"]["decision"]["enum"].as_array().unwrap();
        assert_eq!(choices.len(), 3);
        for v in choices {
            let parsed: Choice = serde_json::from_value(v.clone()).unwrap();
            assert_eq!(json!(parsed.as_str()), *v);
        }
        let finding = &s["properties"]["findings"]["items"]["properties"];
        assert_eq!(finding["source"]["enum"].as_array().unwrap().len(), EvidenceSource::ALL.len());
        assert_eq!(finding["stance"]["enum"], json!(["supports", "contradicts", "neutral", "missing"]));
        let causations = s["properties"]["causation"]["enum"].as_array().unwrap();
        assert_eq!(causations.len(), 3);
        for c in causations {
            let parsed: Causation = serde_json::from_value(c.clone()).unwrap();
            assert_eq!(json!(parsed.as_str()), *c);
        }
        assert_eq!(
            s["properties"]["concerns"]["items"]["properties"]["kind"]["enum"],
            json!(["causation", "timing", "location", "identity", "amount", "duplicate", "other"])
        );
        assert_eq!(recovery_letter_schema()["properties"]["stance"]["enum"], json!(["query"]));
    }

    #[test]
    fn model_output_parses_into_the_types() {
        let decision: AgentDecision = serde_json::from_value(serde_json::to_value(full_decision()).unwrap()).unwrap();
        assert_eq!(decision, full_decision());
        let mut none = serde_json::to_value(full_decision()).unwrap();
        none["charge"] = Value::Null;
        assert_mirrors(&agent_decision_schema(), &none, "agent_decision");
        assert_eq!(serde_json::from_value::<AgentDecision>(none).unwrap().charge, None);
        let raw = json!({"stance": "query", "subject": "s", "body": "b?", "cited_fact_ids": []});
        assert_eq!(serde_json::from_value::<RecoveryLetter>(raw).unwrap().stance, "query");
    }
}
