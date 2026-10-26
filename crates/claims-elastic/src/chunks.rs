//! The chunks of every PDF a lookup fetched, in `<prefix>-policy-clauses` next
//! to the checked clauses (`kind` `chunk`): each page's own text, cut at line
//! breaks into passages of at most [`MAX_CHUNK_WORDS`] words. A lookup writes
//! them the moment the PDF arrives, so Elastic can search its wording by
//! meaning before anything reads it, and its check cites the chunk that best
//! matches what was typed ([`cite`]), found by the same hybrid search with
//! rerank as the clauses. The claim searches never read chunks.

use anyhow::{Context, Result};
use reqwest::{Method, StatusCode};
use serde_json::{Value, json};

use crate::{ClaimsIndex, ClauseHit, PolicyClause};

/// `kind` of a chunk; a checked clause is [`crate::CLAUSE`].
pub const CHUNK: &str = "chunk";
/// Most words in one chunk.
pub const MAX_CHUNK_WORDS: usize = 60;
/// A blank line ends a chunk once it has this many words.
const MIN_CHUNK_WORDS: usize = 12;
/// Most chunks kept from one page.
const MAX_PAGE_CHUNKS: usize = 40;

/// `<document_hash>-p<page>-k<n>`, n from 1 within the page, so the same page
/// text gives the same ids in any PDF it is part of.
pub fn chunk_id(document_hash: &str, page: u32, n: usize) -> String {
    format!("{document_hash}-p{page}-k{n}")
}

/// One page's text in chunks, in reading order: whole lines, at most
/// [`MAX_CHUNK_WORDS`] words each, a blank line ending a chunk that has
/// [`MIN_CHUNK_WORDS`]. A longer line is split into even parts.
pub fn chunk_page(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    let mut words = 0;
    let flush = |lines: &mut Vec<String>, words: &mut usize, chunks: &mut Vec<String>| {
        if !lines.is_empty() {
            chunks.push(lines.join("\n"));
        }
        lines.clear();
        *words = 0;
    };
    for raw in text.lines() {
        let line: Vec<&str> = raw.split_whitespace().collect();
        if line.is_empty() {
            if words >= MIN_CHUNK_WORDS {
                flush(&mut lines, &mut words, &mut chunks);
            }
            continue;
        }
        if words + line.len() > MAX_CHUNK_WORDS {
            flush(&mut lines, &mut words, &mut chunks);
        }
        if line.len() > MAX_CHUNK_WORDS {
            let parts = line.len().div_ceil(MAX_CHUNK_WORDS);
            for part in line.chunks(line.len().div_ceil(parts)) {
                chunks.push(part.join(" "));
            }
            continue;
        }
        words += line.len();
        lines.push(line.join(" "));
    }
    flush(&mut lines, &mut words, &mut chunks);
    chunks.truncate(MAX_PAGE_CHUNKS);
    chunks
}

/// Every chunk of a PDF of `pages` (page 1 first), as `policy`'s (`venue` or `attendee`).
pub fn chunk_docs(policy: &str, document_hash: &str, pages: &[String]) -> Vec<PolicyClause> {
    let mut docs = Vec::new();
    for (i, text) in pages.iter().enumerate() {
        let page = i as u32 + 1;
        for (n, chunk) in chunk_page(text).into_iter().enumerate() {
            docs.push(PolicyClause {
                clause_id: chunk_id(document_hash, page, n + 1),
                kind: CHUNK.into(),
                policy: policy.into(),
                document_hash: document_hash.into(),
                section: String::new(),
                page,
                text: chunk,
            });
        }
    }
    docs
}

/// Letters and digits only, lowercase, so line breaks and spacing never hide a name.
fn compact(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The chunk a check cites: the first hit, best first, that holds `printed`
/// (the plan name or form number code found on its page), else the first hit.
pub fn cite<'a>(hits: &'a [ClauseHit], printed: &str) -> Option<&'a ClauseHit> {
    let printed = compact(printed);
    hits.iter().find(|h| !printed.is_empty() && compact(&h.text).contains(&printed)).or_else(|| hits.first())
}

/// The filter to one PDF's chunks, and to pages `first` to `last` when given.
fn chunk_filter(document_hash: &str, pages: Option<(u32, u32)>) -> Vec<Value> {
    let mut filter = vec![json!({ "term": { "kind": CHUNK } }), json!({ "term": { "document_hash": document_hash } })];
    if let Some((first, last)) = pages {
        filter.push(json!({ "range": { "page": { "gte": first, "lte": last } } }));
    }
    filter
}

impl ClaimsIndex {
    /// Writes a PDF's chunks under their ids, unless that PDF has exactly as
    /// many chunks already, so the same PDF is embedded once however many
    /// lookups fetch it. Returns whether it wrote them.
    pub async fn index_chunks(&self, document_hash: &str, chunks: &[PolicyClause]) -> Result<bool> {
        if chunks.is_empty() || self.chunk_count(document_hash).await? == chunks.len() as u64 {
            return Ok(false);
        }
        self.delete_chunks(document_hash).await?;
        self.index_policy_clauses(chunks).await.context("indexing chunks")?;
        Ok(true)
    }

    /// How many chunks a PDF has; 0 when there is no clause index yet.
    pub async fn chunk_count(&self, document_hash: &str) -> Result<u64> {
        let body = json!({ "query": { "bool": { "filter": chunk_filter(document_hash, None) } } });
        let (status, v) = self.send(self.req(Method::POST, &format!("{}/_count", self.clauses_index())).json(&body)).await?;
        if status == StatusCode::NOT_FOUND {
            return Ok(0);
        }
        if !status.is_success() {
            anyhow::bail!("counting the chunks of {document_hash} returned {status}: {}", crate::short(&v));
        }
        Ok(v["count"].as_u64().unwrap_or(0))
    }

    /// Deletes every chunk of a PDF. Returns how many there were.
    pub async fn delete_chunks(&self, document_hash: &str) -> Result<u64> {
        let body = json!({ "query": { "bool": { "filter": chunk_filter(document_hash, None) } } });
        let path = format!("{}/_delete_by_query?refresh=true", self.clauses_index());
        let (status, v) = self.send(self.req(Method::POST, &path).json(&body)).await?;
        if status == StatusCode::NOT_FOUND {
            return Ok(0);
        }
        if !status.is_success() {
            anyhow::bail!("POST {path} returned {status}: {}", crate::short(&v));
        }
        Ok(v["deleted"].as_u64().unwrap_or(0))
    }

    /// The chunks of one PDF that best match `query`, best first, at most `k`,
    /// from pages `first` to `last` when given: the clause search's hybrid
    /// search with rerank, filtered to the PDF's chunks. A blank query, a
    /// missing index or no hits is an empty list.
    pub async fn search_chunks(&self, query: &str, document_hash: &str, pages: Option<(u32, u32)>, k: usize) -> Result<Vec<ClauseHit>> {
        self.run_clause_search(query, vec![chunks_of(document_hash, pages)], &[], k).await
    }
}

/// The search's one "policy": this PDF's chunks.
fn chunks_of(document_hash: &str, pages: Option<(u32, u32)>) -> Value {
    json!({ "bool": { "filter": chunk_filter(document_hash, pages) } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_cut_at_line_breaks() {
        let page = "Blue Shield of California: Silver 70 PPO 2500/55   Coverage Period: 01/01/2026 - 12/31/2026\n\
Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services\n\n\
Important Questions Answers Why This Matters\nWhat is the overall deductible? $2,500 individual / $5,000 family";
        let chunks = chunk_page(page);
        assert_eq!(chunks.len(), 2, "{chunks:?}");
        assert_eq!(chunks[0], "Blue Shield of California: Silver 70 PPO 2500/55 Coverage Period: 01/01/2026 - 12/31/2026\nSummary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services");
        assert!(chunks[1].starts_with("Important Questions"));
        assert!(chunk_page(" \n\n ").is_empty());
    }

    #[test]
    fn no_chunk_is_over_the_limit() {
        let long_line = vec!["word"; 150].join(" ");
        let lines = vec!["ten words on this line and then a few more"; 20].join("\n");
        for text in [long_line.as_str(), lines.as_str()] {
            let chunks = chunk_page(text);
            assert!(chunks.iter().all(|c| c.split_whitespace().count() <= MAX_CHUNK_WORDS), "{chunks:?}");
            assert_eq!(chunks.iter().map(|c| c.split_whitespace().count()).sum::<usize>(), text.split_whitespace().count(), "no word is lost");
        }
        assert_eq!(chunk_page(&long_line).len(), 3, "150 words in three even parts");
        let many = vec!["a line of exactly twelve words that ends a chunk at blank\n"; 100].join("\n");
        assert_eq!(chunk_page(&many).len(), MAX_PAGE_CHUNKS);
    }

    #[test]
    fn chunks_are_numbered_by_page() {
        let pages = vec!["COMMERCIAL GENERAL LIABILITY COVERAGE FORM\nCG 00 01 04 13".to_string(), String::new(), "COVERAGE C MEDICAL PAYMENTS".to_string()];
        let docs = chunk_docs("venue", "ab12", &pages);
        assert_eq!(docs.iter().map(|d| d.clause_id.as_str()).collect::<Vec<_>>(), ["ab12-p1-k1", "ab12-p3-k1"]);
        assert!(docs.iter().all(|d| d.kind == CHUNK && d.policy == "venue" && d.section.is_empty()));
        assert_eq!((docs[1].page, docs[1].text.as_str()), (3, "COVERAGE C MEDICAL PAYMENTS"));
        assert!(docs.iter().all(|d| crate::clause_search::valid_clause_id(&d.clause_id)));
    }

    fn hit(id: &str, text: &str, score: f32) -> ClauseHit {
        ClauseHit { clause_id: id.into(), text: text.into(), score, page: 1, ..Default::default() }
    }

    #[test]
    fn the_cited_chunk_holds_the_printed_name() {
        let hits = [hit("a-p2-k1", "In-network urgent care: $55 copay", 0.9), hit("a-p1-k1", "Blue Shield of California: Silver 70\nPPO 2500/55 Coverage Period", 0.8)];
        assert_eq!(cite(&hits, "Silver 70 PPO 2500/55").unwrap().clause_id, "a-p1-k1", "a line break does not hide the name");
        assert_eq!(cite(&hits, "Gold 80 HMO").unwrap().clause_id, "a-p2-k1", "else the best hit");
        assert_eq!(cite(&hits, "").unwrap().clause_id, "a-p2-k1");
        assert!(cite(&[], "Silver 70").is_none());
        let forms = [hit("b-p4-k1", "CG 00 01 04 13 Page 1 of 16", 0.7)];
        assert_eq!(cite(&forms, "cg 00 01 04 13").unwrap().clause_id, "b-p4-k1");
    }

    #[test]
    fn the_chunk_search_reads_one_pdfs_chunks() {
        let filter = &chunks_of("ab12", Some((4, 19)))["bool"]["filter"];
        assert_eq!(filter[0], json!({ "term": { "kind": "chunk" } }));
        assert_eq!(filter[1], json!({ "term": { "document_hash": "ab12" } }));
        assert_eq!(filter[2], json!({ "range": { "page": { "gte": 4, "lte": 19 } } }));
        assert_eq!(chunks_of("ab12", None)["bool"]["filter"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_blank_query_never_reaches_elastic() {
        let es = ClaimsIndex::new("https://example.invalid", "k").unwrap();
        assert!(es.search_chunks(" ", "ab12", None, 5).await.unwrap().is_empty());
    }
}
