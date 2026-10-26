//! Insurance PDFs, one page per document in `<prefix>-documents`. Its default
//! pipeline `<prefix>-documents-extract` takes each page's text layer and marks a
//! page without one, a scan, for transcription. The `bandit-read-document`
//! workflow writes what it read to `<prefix>-document-terms`.

use anyhow::{Context, Result, bail};
use base64::Engine;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{ClaimsIndex, INFERENCE_ID, check_id, hits};

/// Most pages a document can have: the module files 1 to 50, and a lookup checks a fetched PDF of up to 100.
pub const MAX_DOCUMENT_PAGES: usize = 100;

/// One page as stored, after the pipeline.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct StoredPage {
    /// 1-based.
    pub page: u32,
    pub text: String,
    /// The page has no text layer and no transcription yet.
    pub needs_transcription: bool,
}

impl ClaimsIndex {
    /// `<prefix>-documents`, one document per page.
    pub fn documents_index(&self) -> String {
        format!("{}-documents", self.prefix)
    }

    /// `<prefix>-document-terms`, the workflow's answer, one document per PDF.
    pub fn terms_index(&self) -> String {
        format!("{}-document-terms", self.prefix)
    }

    fn extract_pipeline(&self) -> String {
        format!("{}-documents-extract", self.prefix)
    }

    /// Creates or updates the extract pipeline, and creates the page and answer indices if they are missing.
    pub async fn ensure_document_indices(&self) -> Result<()> {
        let pipeline = self.extract_pipeline();
        self.call(Method::PUT, &format!("_ingest/pipeline/{pipeline}"), Some(extract_pipeline_body())).await?;
        let pages = json!({ "settings": { "index.default_pipeline": pipeline }, "mappings": page_mappings() });
        self.ensure_index(&self.documents_index(), pages).await?;
        self.ensure_index(&self.terms_index(), json!({ "mappings": terms_mappings() })).await?;
        Ok(())
    }

    /// Writes page `page` (1-based) of a PDF through the extract pipeline as
    /// `<sha>-p<n>`. `text` is the transcription of a scanned page; without it
    /// the pipeline takes the page's own text layer.
    pub async fn put_page(&self, document_hash: &str, kind: &str, page: u32, pdf: &[u8], text: Option<&str>) -> Result<()> {
        let id = page_id(document_hash, page);
        check_id(&id)?;
        let path = format!("{}/_doc/{id}?refresh=wait_for", self.documents_index());
        let doc = page_doc(document_hash, kind, page, pdf, text);
        self.call(Method::PUT, &path, Some(doc)).await.with_context(|| format!("writing page {page} of {document_hash}"))?;
        Ok(())
    }

    /// Writes every page of a PDF through the extract pipeline, `PAGES_PER_BULK`
    /// pages per request, so a long PDF does not wait on one refresh per page.
    pub async fn put_pages(&self, document_hash: &str, kind: &str, pages: &[Vec<u8>]) -> Result<()> {
        let index = self.documents_index();
        for (c, chunk) in pages.chunks(PAGES_PER_BULK).enumerate() {
            let first = c * PAGES_PER_BULK + 1;
            let mut docs = Vec::with_capacity(chunk.len());
            for (i, pdf) in chunk.iter().enumerate() {
                let page = (first + i) as u32;
                let id = page_id(document_hash, page);
                check_id(&id)?;
                docs.push((index.clone(), id, page_doc(document_hash, kind, page, pdf, None)));
            }
            let last = first + chunk.len() - 1;
            self.bulk("refresh=wait_for", docs).await.with_context(|| format!("writing pages {first} to {last} of {document_hash}"))?;
        }
        Ok(())
    }

    /// Every stored page of a document, in page order.
    pub async fn document_pages(&self, document_hash: &str) -> Result<Vec<StoredPage>> {
        let query = json!({
            "size": MAX_DOCUMENT_PAGES,
            "query": { "term": { "document_hash": document_hash } },
            "sort": [{ "page": "asc" }],
            "_source": ["page", "text", "needs_transcription"]
        });
        let v = self.call(Method::POST, &format!("{}/_search", self.documents_index()), Some(query)).await?;
        hits(&v).map(|h| serde_json::from_value(h["_source"].clone()).context("a stored page has the wrong shape")).collect()
    }

    /// The workflow's answer for a document.
    pub async fn document_terms(&self, document_hash: &str) -> Result<Value> {
        match self.saved_terms(document_hash).await? {
            Some(answer) => Ok(answer),
            None => bail!("{} has no answer for {document_hash}", self.terms_index()),
        }
    }

    /// The workflow's answer for a document, if one is saved.
    pub async fn saved_terms(&self, document_hash: &str) -> Result<Option<Value>> {
        check_id(document_hash)?;
        let query = json!({ "size": 1, "query": { "ids": { "values": [document_hash] } } });
        let v = self.call(Method::POST, &format!("{}/_search", self.terms_index()), Some(query)).await?;
        Ok(hits(&v).next().map(|h| h["_source"].clone()))
    }

    /// Deletes a document's pages and answer, for a PDF a lookup only checked.
    pub async fn delete_document(&self, document_hash: &str) -> Result<()> {
        check_id(document_hash)?;
        let body = json!({ "query": { "term": { "document_hash": document_hash } } });
        for index in [self.documents_index(), self.terms_index()] {
            self.call(Method::POST, &format!("{index}/_delete_by_query?refresh=true"), Some(body.clone())).await?;
        }
        Ok(())
    }
}

/// Pages sent in one `_bulk` request; a page carries its whole PDF in base64.
const PAGES_PER_BULK: usize = 10;

pub(crate) fn page_id(document_hash: &str, page: u32) -> String {
    format!("{document_hash}-p{page}")
}

fn page_doc(document_hash: &str, kind: &str, page: u32, pdf: &[u8], text: Option<&str>) -> Value {
    let mut doc = json!({
        "document_hash": document_hash,
        "kind": kind,
        "page": page,
        "data": base64::engine::general_purpose::STANDARD.encode(pdf),
    });
    if let Some(t) = text {
        doc["text"] = json!(t);
        doc["transcribed"] = json!(true);
    }
    doc
}

fn extract_pipeline_body() -> Value {
    json!({
        "description": "BandIt insurance documents: the text layer of one PDF page; a page without one is marked for transcription",
        "processors": [
            { "attachment": {
                "field": "data", "target_field": "attachment", "properties": ["content"],
                "indexed_chars": -1, "remove_binary": true, "ignore_missing": true
            }},
            { "set": {
                "description": "the text layer, unless the worker sent a transcription",
                "if": "ctx.attachment?.content != null && ctx.attachment.content.trim() != '' && (ctx.text == null || ctx.text == '')",
                "field": "text", "copy_from": "attachment.content"
            }},
            { "script": {
                "lang": "painless",
                "source": "ctx.needs_transcription = ctx.text == null || ctx.text.trim().isEmpty();"
            }},
            { "remove": { "field": "attachment", "ignore_missing": true } },
            { "set": { "field": "indexed_at", "value": "{{{_ingest.timestamp}}}" } }
        ]
    })
}

fn page_mappings() -> Value {
    let kw = json!({ "type": "keyword" });
    json!({
        "dynamic": false,
        "properties": {
            "document_hash": kw, "kind": kw, "page": { "type": "integer" },
            "text": { "type": "semantic_text", "inference_id": INFERENCE_ID },
            "needs_transcription": { "type": "boolean" }, "transcribed": { "type": "boolean" },
            "indexed_at": { "type": "date" }
        }
    })
}

/// `read` is the reader's structured answer, kept as it came and not indexed.
fn terms_mappings() -> Value {
    let kw = json!({ "type": "keyword" });
    json!({
        "dynamic": false,
        "properties": {
            "document_hash": kw, "kind": kw, "reader": kw, "model": kw, "pages_indexed": { "type": "integer" },
            "read": { "type": "object", "enabled": false }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_carries_its_bytes_and_any_transcription() {
        let doc = page_doc("ab12", "venue_policy", 2, b"%PDF-1.5", None);
        assert_eq!(page_id("ab12", 2), "ab12-p2");
        assert_eq!(doc["data"], "JVBERi0xLjU=");
        assert!(doc.get("text").is_none());
        let doc = page_doc("ab12", "venue_policy", 2, b"%PDF-1.5", Some("SCHEDULE OF BENEFITS"));
        assert_eq!((doc["text"].as_str(), doc["transcribed"].as_bool()), (Some("SCHEDULE OF BENEFITS"), Some(true)));
        for key in ["document_hash", "kind", "page", "text", "transcribed"] {
            assert!(page_mappings()["properties"].get(key).is_some(), "{key} is not mapped");
        }
    }
}
