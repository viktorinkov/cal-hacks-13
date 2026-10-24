//! `medical_extract`: Claude reads an attendee's medical history PDF or health insurance card into
//! the fields of their medical card. Code keeps only items that cite a page of the document.

use claude_client::{Effort, MessageRequest};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::sink::Finish;

pub const KIND: &str = "medical_extract";

#[derive(Clone, Debug, Deserialize)]
pub struct Payload {
    pub kind: String,
    pub file_hash: String,
    pub page_count: u32,
}

const SYSTEM: &str = "You read an event attendee's own medical paperwork so a medic can help them in an emergency. \
Copy only what is printed in the document into the JSON schema. Every item cites the 1-based page it is printed on. \
Leave a field empty when the document does not show it; never guess.";

const BLOOD_TYPES: [&str; 9] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"];

fn prompt(kind: &str, pages: u32) -> String {
    let what = if kind == "insurance" {
        "This is the attendee's health insurance card. Fill `insurance`; leave the medical fields empty."
    } else {
        "This is the attendee's medical history. Fill blood type, allergies, conditions, medications, the emergency contact and short notes a medic should know; leave `insurance` empty."
    };
    format!("{what} The document has {pages} page(s).")
}

fn item(fields: &[&str]) -> Value {
    let mut props = serde_json::Map::new();
    for f in fields {
        props.insert((*f).into(), json!({"type": "string"}));
    }
    props.insert("page".into(), json!({"type": "integer"}));
    let mut required: Vec<&str> = fields.to_vec();
    required.push("page");
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "blood_type": {"type": "string", "enum": BLOOD_TYPES},
            "allergies": {"type": "array", "items": item(&["name", "reaction"])},
            "conditions": {"type": "array", "items": item(&["name"])},
            "medications": {"type": "array", "items": item(&["name", "dose"])},
            "emergency_contact": {"anyOf": [item(&["name", "relation", "phone"]), {"type": "null"}]},
            "insurance": {"anyOf": [item(&["insurer", "plan", "member_id", "group_number", "phone"]), {"type": "null"}]},
            "notes": {"type": "string"}
        },
        "required": ["blood_type", "allergies", "conditions", "medications", "emergency_contact", "insurance", "notes"],
        "additionalProperties": false
    })
}

/// The card fields the module stores: one line per item with its page, and what code dropped.
fn check(v: &Value, pages: u32) -> Result<Value, Vec<String>> {
    let mut dropped = Vec::new();
    let mut lines = |key: &str, show: &dyn Fn(&Value) -> String| -> Vec<String> {
        let mut out = Vec::new();
        for it in v[key].as_array().into_iter().flatten().take(20) {
            let text = show(it);
            match it["page"].as_u64() {
                Some(p) if p >= 1 && p <= pages as u64 => out.push(format!("{text} (p. {p})")),
                _ => dropped.push(format!("{key}: {text} (no page on the document)")),
            }
        }
        out
    };
    let s = |it: &Value, k: &str| it[k].as_str().unwrap_or("").trim().to_string();
    let allergies = lines("allergies", &|it| format!("{}: {}", s(it, "name"), s(it, "reaction")));
    let conditions = lines("conditions", &|it| s(it, "name"));
    let medications = lines("medications", &|it| format!("{} {}", s(it, "name"), s(it, "dose")).trim().to_string());
    let paged = |it: &Value| it["page"].as_u64().is_some_and(|p| p >= 1 && p <= pages as u64);
    let contact = &v["emergency_contact"];
    let emergency_contact = if contact.is_object() && paged(contact) {
        let phone: String = s(contact, "phone").chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
        format!("{} ({}), {}", s(contact, "name"), s(contact, "relation"), phone)
    } else {
        String::new()
    };
    let ins = &v["insurance"];
    let has_ins = ins.is_object() && paged(ins);
    let get = |k: &str| if has_ins { s(ins, k) } else { String::new() };
    let blood = v["blood_type"].as_str().filter(|b| BLOOD_TYPES.contains(b)).unwrap_or("unknown");
    let notes: String = v["notes"].as_str().unwrap_or("").chars().take(1000).collect();
    Ok(json!({
        "blood_type": blood,
        "allergies": allergies,
        "conditions": conditions,
        "medications": medications,
        "emergency_contact": emergency_contact,
        "insurer": get("insurer"),
        "plan": get("plan"),
        "member_id": get("member_id"),
        "group_number": get("group_number"),
        "insurer_phone": get("phone"),
        "notes": notes,
        "dropped": dropped,
    }))
}

pub async fn read<M: Model>(model: &M, pdf: &[u8], p: &Payload) -> Result<Tries<Value>, JobError> {
    let request = || MessageRequest::new().system(SYSTEM).pdf(pdf).text(prompt(&p.kind, p.page_count)).json_schema(schema());
    ask_twice(model, KIND, Effort::Low, request, |v| check(v, p.page_count)).await
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: Payload) -> Result<(), JobError> {
    let pdf = ctx.blobs.get(&p.file_hash).map_err(|e| JobError::msg(format!("reading PDF {}: {e}", p.file_hash)))?;
    let tries = read(&ctx.claude, &pdf, &p).await?;
    let card = tries.checked.map_err(|e| JobError::msg(e.join("; ")))?;
    tracing::info!(job_id = job.id, kind = %p.kind, "medical document read");
    ctx.sink.finish(job.id, Finish::MedicalCard { card_json: card.to_string() }, tries.calls).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_without_a_page_on_the_document_are_dropped() {
        let v = json!({
            "blood_type": "O+",
            "allergies": [{"name": "Penicillin", "reaction": "hives", "page": 1}, {"name": "Latex", "reaction": "rash", "page": 4}],
            "conditions": [], "medications": [],
            "emergency_contact": {"name": "Ana Minchev", "relation": "mother", "phone": "+1 (805) 555-0142", "page": 1},
            "insurance": null, "notes": ""
        });
        let card = check(&v, 2).unwrap();
        assert_eq!(card["allergies"], json!(["Penicillin: hives (p. 1)"]));
        assert_eq!(card["dropped"].as_array().unwrap().len(), 1);
        assert_eq!(card["emergency_contact"], "Ana Minchev (mother), +18055550142");
    }
}
