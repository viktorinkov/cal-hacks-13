//! JSON schemas for Claude structured outputs, one per agent task, and the
//! letter output types. Each schema mirrors its Rust type exactly: every
//! property required, `additionalProperties: false`, no numeric or length
//! keywords (structured outputs do not enforce them; code validation does).
//!
//! Keywords used: `type`, `properties`, `required`, `additionalProperties`,
//! `items`, `enum` (strings only) and `description`. Formats are left out on
//! purpose: a date the model cannot read must come back empty, not invented.

use crate::{Causation, Verdict};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// The kinds listed on `review::Concern`.
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

/// Schema for `review::AgentReview`. `verdict` and `causation` are enums of
/// the snake_case variant names; concern `kind` is an enum of the kinds listed
/// on `review::Concern`.
pub fn agent_review_schema() -> Value {
    let verdicts = [Verdict::Consistent, Verdict::NeedsHuman, Verdict::Inconsistent].map(Verdict::as_str);
    let causations = [Causation::Supported, Causation::Unsupported, Causation::Unclear].map(Causation::as_str);
    object(vec![
        (
            "verdict",
            one_of(&verdicts, "consistent only when nothing needs a person's eyes; needs_human when something does; inconsistent when the evidence contradicts the claim"),
        ),
        ("causation", one_of(&causations, "whether the treated injury plausibly follows from the incident")),
        ("summary", string("two to four sentences for the approver, at most 800 characters; dollar figures only from the claim's amounts")),
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
        ("cited_fact_ids", array(integer("seq of a fact the verdict rests on"))),
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
    use crate::review::{AgentReview, Concern};
    use std::collections::BTreeSet;

    /// What structured outputs accept and these schemas use.
    const KEYWORDS: [&str; 7] = ["type", "properties", "required", "additionalProperties", "items", "enum", "description"];

    /// Walks `schema` and `sample` together: only `KEYWORDS`, every object's
    /// property names equal the sample's keys, all required, nothing extra
    /// allowed, and every leaf has the schema's type.
    fn assert_mirrors(schema: &Value, sample: &Value, path: &str) {
        let node = schema.as_object().unwrap_or_else(|| panic!("{path}: schema is not an object"));
        for k in node.keys() {
            assert!(KEYWORDS.contains(&k.as_str()), "{path}: keyword {k}");
        }
        match schema["type"].as_str() {
            Some("object") => {
                let props = schema["properties"].as_object().unwrap();
                let fields = sample.as_object().unwrap_or_else(|| panic!("{path}: sample is not an object"));
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
                let items = sample.as_array().unwrap_or_else(|| panic!("{path}: sample is not an array"));
                assert!(!items.is_empty(), "{path}: give the sample an element");
                for (i, v) in items.iter().enumerate() {
                    assert_mirrors(&schema["items"], v, &format!("{path}[{i}]"));
                }
            }
            Some("string") => {
                assert!(sample.is_string(), "{path}: not a string");
                if let Some(values) = schema.get("enum") {
                    assert!(values.as_array().unwrap().contains(sample), "{path}: {sample} not in the enum");
                }
            }
            Some("integer") => {
                assert!(sample.is_u64(), "{path}: not an integer");
                assert!(schema.get("enum").is_none(), "{path}: enum on an integer");
            }
            other => panic!("{path}: unexpected type {other:?}"),
        }
    }

    fn review_sample() -> AgentReview {
        AgentReview {
            verdict: Verdict::NeedsHuman,
            causation: Causation::Unclear,
            summary: "The record says the wrist was hurt at home.".to_string(),
            concerns: vec![Concern { kind: "causation".to_string(), detail: "history says home".to_string(), fact_ids: vec![20] }],
            innocent_explanations: vec!["an older injury mentioned in passing".to_string()],
            missing_evidence: vec!["intake form".to_string()],
            cited_fact_ids: vec![1, 20],
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
            ("agent_review", agent_review_schema(), serde_json::to_value(review_sample()).unwrap()),
            ("claim_letters", claim_letters_schema(), serde_json::to_value(letters).unwrap()),
            ("recovery_letter", recovery_letter_schema(), serde_json::to_value(recovery).unwrap()),
        ];
        for (name, schema, sample) in &cases {
            assert_mirrors(schema, sample, name);
        }
    }

    #[test]
    fn enums_match_the_rust_enums() {
        let s = agent_review_schema();
        let verdicts = s["properties"]["verdict"]["enum"].as_array().unwrap();
        assert_eq!(verdicts.len(), 3);
        for v in verdicts {
            let parsed: Verdict = serde_json::from_value(v.clone()).unwrap();
            assert_eq!(json!(parsed.as_str()), *v);
        }
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
        let review: AgentReview = serde_json::from_value(serde_json::to_value(review_sample()).unwrap()).unwrap();
        assert_eq!(review, review_sample());
        let raw = json!({"stance": "query", "subject": "s", "body": "b?", "cited_fact_ids": []});
        assert_eq!(serde_json::from_value::<RecoveryLetter>(raw).unwrap().stance, "query");
    }
}
