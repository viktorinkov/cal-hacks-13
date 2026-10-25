//! `document_read`: the Evidence Engine reads an insurance PDF. Each page goes
//! through the `<prefix>-documents-extract` pipeline (a scan is first written out
//! word for word by the Claude API), the `bandit-read-document` workflow reads
//! the terms and clauses, and code checks every quote against its page before
//! the clauses are indexed and the module gets the answer.

use std::time::Duration;

use anyhow::{Context, bail};
use bandit_bindings::ModelCallIn;
use bandit_insurance::policy::{CheckedPolicy, DocumentReadPayload, PolicyRead, VENUE_POLICY, check_policy, document_schema};
use claims_elastic::{PolicyClause, StoredPage, reader};
use claude_client::{Effort, MessageRequest};
use serde_json::{Value, json};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::Model;
use crate::sink::Finish;

const POLL_EVERY: Duration = Duration::from_secs(5);
const WORKFLOW_LIMIT: Duration = Duration::from_secs(10 * 60);

const TRANSCRIBE_SYSTEM: &str = "You transcribe one scanned page of an insurance document. \
Write out every word printed on the page exactly as printed, in reading order, one printed line per line, \
with the same numbers, signs and spelling. Keep table rows on one line. \
Do not summarize, correct, explain or pick anything out, and add nothing that is not printed.";

pub async fn run(ctx: &Ctx, job: &JobIn, p: DocumentReadPayload) -> Result<(), JobError> {
    let pdf = ctx.blobs.get(&p.file_hash).map_err(|e| JobError::msg(format!("reading PDF {}: {e}", p.file_hash)))?;
    let pages = split_pages(&pdf).map_err(|e| JobError::msg(format!("splitting PDF {}: {e:#}", p.file_hash)))?;
    if pages.len() != p.page_count as usize {
        return Err(JobError::msg(format!("the PDF has {} pages, not {}", pages.len(), p.page_count)));
    }
    let (es, kibana) = ctx.reader().await?;
    for (i, page) in pages.iter().enumerate() {
        es.put_page(&p.file_hash, &p.kind, i as u32 + 1, page, None).await?;
    }

    let mut calls = Vec::new();
    let scans: Vec<u32> = es.document_pages(&p.file_hash).await?.iter().filter(|s| s.needs_transcription).map(|s| s.page).collect();
    for n in scans {
        let page = pages.get(n as usize - 1).ok_or_else(|| JobError::msg(format!("page {n} is not in the PDF")))?;
        let text = transcribe(&ctx.claude, page, &mut calls).await?;
        es.put_page(&p.file_hash, &p.kind, n, page, Some(&text)).await.map_err(keep(&mut calls))?;
        tracing::info!(job_id = job.id, page = n, chars = text.len(), "scanned page transcribed");
    }
    let texts = page_texts(&es.document_pages(&p.file_hash).await.map_err(keep(&mut calls))?, p.page_count).map_err(keep(&mut calls))?;

    let inputs = json!({
        "document_hash": p.file_hash,
        "kind": p.kind,
        "page_count": p.page_count,
        "schema": document_schema(&p.kind).to_string(),
        "terms_index": es.terms_index(),
    });
    let execution = kibana.run_workflow(reader::WORKFLOW, inputs).await.map_err(keep(&mut calls))?;
    tracing::info!(job_id = job.id, execution = %execution, "{} started", reader::WORKFLOW);
    let done = kibana.wait_for(&execution, POLL_EVERY, WORKFLOW_LIMIT).await.map_err(keep(&mut calls))?;
    if done["status"] != "completed" {
        return Err(JobError { error: format!("{} execution {execution} {}", reader::WORKFLOW, reader::failure(&done)), calls });
    }
    let answer = es.document_terms(&p.file_hash).await.map_err(keep(&mut calls))?;
    let read = policy_read(&answer).map_err(keep(&mut calls))?;

    let checked = check_policy(&read, &texts);
    let clauses = clause_docs(&p, &checked);
    es.delete_policy_clauses(&p.file_hash).await.map_err(keep(&mut calls))?;
    es.index_policy_clauses(&clauses).await.map_err(keep(&mut calls))?;
    tracing::info!(
        job_id = job.id,
        kind = %p.kind,
        terms = read.terms.len(),
        clauses = clauses.len(),
        dropped = checked.dropped.len(),
        model = %answer["model"].as_str().unwrap_or(""),
        "document read"
    );
    let read_json = serde_json::to_string(&read).map_err(|e| JobError { error: format!("encoding the read: {e}"), calls: calls.clone() })?;
    ctx.sink.finish(job.id, Finish::DocumentTerms { read_json, pages: texts }, calls).await?;
    Ok(())
}

/// An error that carries the Claude calls made before it, so they are recorded.
fn keep(calls: &mut Vec<ModelCallIn>) -> impl FnOnce(anyhow::Error) -> JobError + '_ {
    move |e| JobError { error: format!("{e:#}"), calls: std::mem::take(calls) }
}

/// Each page of `pdf` as a PDF of its own, in page order.
pub fn split_pages(pdf: &[u8]) -> anyhow::Result<Vec<Vec<u8>>> {
    let doc = lopdf::Document::load_mem(pdf)?;
    let numbers: Vec<u32> = doc.get_pages().into_keys().collect();
    numbers
        .iter()
        .map(|&n| {
            let mut one = doc.clone();
            one.delete_pages(&numbers.iter().copied().filter(|&m| m != n).collect::<Vec<_>>());
            one.prune_objects();
            let mut out = Vec::new();
            one.save_to(&mut out).with_context(|| format!("writing page {n}"))?;
            Ok(out)
        })
        .collect()
}

/// The text of pages 1 to `page_count`, one string per page.
fn page_texts(stored: &[StoredPage], page_count: u32) -> anyhow::Result<Vec<String>> {
    (1..=page_count)
        .map(|n| match stored.iter().find(|s| s.page == n) {
            Some(s) => Ok(s.text.clone()),
            None => bail!("page {n} is not indexed"),
        })
        .collect()
}

/// The reader's answer as saved by the workflow's `save_terms` step.
fn policy_read(answer: &Value) -> anyhow::Result<PolicyRead> {
    serde_json::from_value(answer["read"].clone()).context("the reader's answer is not a policy read")
}

/// The clauses code kept, numbered as the module numbers them: `<sha>-c<n>`, n from 1.
pub fn clause_docs(p: &DocumentReadPayload, checked: &CheckedPolicy) -> Vec<PolicyClause> {
    let policy = if p.kind == VENUE_POLICY { "venue" } else { "attendee" };
    checked
        .clauses
        .iter()
        .enumerate()
        .map(|(i, c)| PolicyClause {
            clause_id: format!("{}-c{}", p.file_hash, i + 1),
            policy: policy.into(),
            document_hash: p.file_hash.clone(),
            section: c.section.clone(),
            page: c.page,
            text: c.text.clone(),
        })
        .collect()
}

/// The Claude API writes out one scanned page word for word.
async fn transcribe<M: Model>(model: &M, page: &[u8], calls: &mut Vec<ModelCallIn>) -> Result<String, JobError> {
    let schema = json!({
        "type": "object",
        "properties": {"text": {"type": "string", "description": "every word on the page, as printed"}},
        "required": ["text"],
        "additionalProperties": false
    });
    let request = MessageRequest::new().system(TRANSCRIBE_SYSTEM).pdf(page).text("Write out this page.").json_schema(schema);
    let answer = model.ask("document_transcribe", Effort::Low, request).await.map_err(|f| JobError::from_call(f, calls))?;
    calls.push(answer.call);
    Ok(answer.json["text"].as_str().unwrap_or_default().trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use bandit_insurance::policy::ATTENDEE_POLICY;
    use lopdf::content::{Content, Operation};
    use lopdf::{Document, Object, Stream, dictionary};

    /// A PDF with one line of text on each page.
    fn pdf(lines: &[&str]) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
        let kids: Vec<Object> = lines
            .iter()
            .map(|line| {
                let content = Content {
                    operations: vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec!["F1".into(), 12.into()]),
                        Operation::new("Td", vec![72.into(), 720.into()]),
                        Operation::new("Tj", vec![Object::string_literal(*line)]),
                        Operation::new("ET", vec![]),
                    ],
                };
                let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
                doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => content_id }).into()
            })
            .collect();
        let pages = dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => lines.len() as i64,
            "Resources" => resources_id, "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn splits_a_pdf_into_one_page_pdfs_in_order() {
        let lines = ["LIMITS OF INSURANCE Medical payments: $5,000", "SCHEDULE OF BENEFITS 99211 $65.00", "EXCLUSIONS staff"];
        let pages = split_pages(&pdf(&lines)).unwrap();
        assert_eq!(pages.len(), 3);
        for (bytes, line) in pages.iter().zip(lines) {
            let one = Document::load_mem(bytes).unwrap();
            assert_eq!(one.get_pages().len(), 1);
            let text = one.extract_text(&[1]).unwrap();
            assert!(text.contains(line), "{text:?} does not hold {line:?}");
        }
        assert!(split_pages(b"not a pdf").is_err());
    }

    fn payload(kind: &str) -> DocumentReadPayload {
        serde_json::from_value(json!({"document_id": 4, "kind": kind, "file_hash": "ab12", "page_count": 2})).unwrap()
    }

    fn pages() -> Vec<String> {
        vec![
            "LIMITS OF INSURANCE\nMedical payments: $5,000 any one person.".into(),
            "EXCLUSIONS\nThis insurance does not apply to bodily injury to any employee or volunteer of the insured.".into(),
        ]
    }

    /// What the workflow saves: one clause off its page, which code drops.
    fn answer() -> Value {
        json!({"document_hash": "ab12", "kind": "venue_policy", "pages_indexed": 2, "read": {
            "terms": [{"name": "per_claim_limit", "cover": "medical_payments", "value": "$5,000", "quote": "Medical payments: $5,000 any one person.", "page": 1}],
            "fee_schedule": [],
            "exclusions": [{"kind": "staff", "quote": "does not apply to bodily injury to any employee or volunteer", "page": 2}],
            "clauses": [
                {"section": "limits", "page": 1, "text": "Medical payments: $5,000 any one person."},
                {"section": "limits", "page": 2, "text": "Medical payments: $9,000 any one person."},
                {"section": "exclusions", "page": 2, "text": "This insurance does not apply to bodily injury to any employee or volunteer of the insured."}
            ]
        }})
    }

    #[test]
    fn clause_docs_number_the_kept_clauses_like_the_module() {
        let checked = check_policy(&policy_read(&answer()).unwrap(), &pages());
        assert_eq!(checked.dropped, ["clause 2 (limits): not word for word on page 2"]);
        let docs = clause_docs(&payload(VENUE_POLICY), &checked);
        assert_eq!(docs.len(), 2);
        assert_eq!((docs[0].clause_id.as_str(), docs[0].section.as_str(), docs[0].page), ("ab12-c1", "limits", 1));
        assert_eq!((docs[1].clause_id.as_str(), docs[1].policy.as_str(), docs[1].page), ("ab12-c2", "venue", 2));
        let staff = checked.terms.iter().find(|t| t.code == "staff").unwrap();
        assert_eq!(docs[staff.clause as usize - 1].section, "exclusions");
        assert!(clause_docs(&payload(ATTENDEE_POLICY), &checked).iter().all(|c| c.policy == "attendee"));
    }

    #[test]
    fn payload_and_answer_parse() {
        let p = payload(VENUE_POLICY);
        assert_eq!((p.document_id, p.page_count, p.file_hash.as_str()), (4, 2, "ab12"));
        let read = policy_read(&answer()).unwrap();
        assert_eq!((read.terms.len(), read.exclusions.len(), read.clauses.len()), (1, 1, 3));
        let clauses_only = policy_read(&json!({"read": {"clauses": [{"section": "conditions", "page": 1, "text": "x"}]}})).unwrap();
        assert_eq!((clauses_only.terms.len(), clauses_only.clauses.len()), (0, 1));
        assert!(policy_read(&json!({"read": {"terms": "none"}})).is_err());
    }

    #[test]
    fn every_page_must_be_indexed() {
        let stored = vec![StoredPage { page: 1, text: "one".into(), needs_transcription: false }, StoredPage { page: 2, text: "two".into(), ..Default::default() }];
        assert_eq!(page_texts(&stored, 2).unwrap(), ["one", "two"]);
        assert_eq!(page_texts(&stored[..1], 2).unwrap_err().to_string(), "page 2 is not indexed");
    }

    #[tokio::test]
    async fn a_scan_is_written_out_by_the_model() {
        let model = FakeModel::new(vec![Ok(json!({"text": "  EXCLUSIONS\nThis insurance does not apply.  "}))]);
        let mut calls = Vec::new();
        let text = transcribe(&model, b"%PDF-1.5", &mut calls).await.ok().unwrap();
        assert_eq!(text, "EXCLUSIONS\nThis insurance does not apply.");
        assert_eq!((calls.len(), calls[0].kind.as_str()), (1, "document_transcribe"));
        let body = model.body(0);
        assert_eq!(body["messages"][0]["content"][0]["type"], "document");
    }
}
