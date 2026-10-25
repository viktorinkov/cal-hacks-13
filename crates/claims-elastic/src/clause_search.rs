//! The policy clause search: the clauses of the venue's policy and, for an
//! injury, of the attendee's health plan that bear on a claim, from
//! `<prefix>-policy-clauses`.
//!
//! One hybrid search, filtered to the claim's policies and, when given, to
//! the sections that can decide its kind of incident: a keyword `match` on
//! `text.words` finds the policy's exact words ("employee", "pre-existing"), a
//! `semantic` query on `text` (embedded by Elastic with
//! `.jina-embeddings-v5-text-small`) finds the same idea in other words, `rrf`
//! fuses the two lists, and `.jina-reranker-v3` reads the query next to each
//! fused clause and reorders them. When the reranker fails the fused order is
//! kept. The search fails soft: a missing index or no hits is an empty list.

use anyhow::{Result, bail};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{ClaimsIndex, RERANK_ID, hits, short};

/// Every section a clause can be filed under.
pub const CLAUSE_SECTIONS: [&str; 8] =
    ["insuring_agreement", "limits", "schedule_of_benefits", "exclusions", "conditions", "theft", "other_insurance", "subrogation"];

/// The sections that can decide each kind of incident:
///
/// | Kind | The policy and cover | Sections |
/// |---|---|---|
/// | `fall`, `sos` | the venue's medical payments cover; the attendee's health plan | insuring agreement, limits, schedule of benefits, exclusions (staff, pre-existing, off premises), conditions (service window), other insurance |
/// | `property`, `breakage` | the venue's property policy | insuring agreement, limits and deductible, exclusions, subrogation |
/// | `theft` | the venue's property policy, theft as a cause of loss | insuring agreement, the theft clause, conditions, exclusions, limits and deductible, subrogation |
///
/// An unknown kind searches every section.
pub fn sections_for_kind(kind: &str) -> &'static [&'static str] {
    match kind {
        "sos" | "fall" => &["insuring_agreement", "limits", "schedule_of_benefits", "exclusions", "conditions", "other_insurance"],
        "property" | "breakage" => &["insuring_agreement", "limits", "exclusions", "subrogation"],
        "theft" => &["insuring_agreement", "theft", "conditions", "exclusions", "limits", "subrogation"],
        _ => &CLAUSE_SECTIONS,
    }
}

/// One clause the search found or read.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ClauseHit {
    /// `<sha256>-c<n>`.
    pub clause_id: String,
    /// `venue` or `attendee`.
    pub policy: String,
    /// SHA-256 of the policy document the clause was read from.
    pub document_hash: String,
    /// One of [`CLAUSE_SECTIONS`].
    pub section: String,
    pub page: u32,
    pub text: String,
    /// The reranker's relevance to the query (the fused rank score when the
    /// reranker failed); 0 for a clause read by id.
    pub score: f32,
}

/// Fields a search returns.
const SOURCE: [&str; 6] = ["clause_id", "policy", "document_hash", "section", "page", "text"];

/// A filter to one policy's clauses: `venue` (its document, when given) or
/// `attendee` (only that document).
fn policy_filter(policy: &str, document_hash: Option<&str>) -> Value {
    let mut filter = vec![json!({ "term": { "policy": policy } })];
    if let Some(h) = document_hash.filter(|h| !h.trim().is_empty()) {
        filter.push(json!({ "term": { "document_hash": h.trim() } }));
    }
    json!({ "bool": { "filter": filter } })
}

/// The search body: `query` by its words and by meaning, inside any of
/// `policies`, in `sections` (any when empty), fused and, with `rerank`,
/// reordered by the reranker.
fn search_body(query: &str, policies: Vec<Value>, sections: &[&str], k: usize, rerank: bool) -> Value {
    let mut filter = vec![json!({ "bool": { "should": policies, "minimum_should_match": 1 } })];
    if !sections.is_empty() {
        filter.push(json!({ "terms": { "section": sections } }));
    }
    let half = |q: Value| json!({ "standard": { "query": { "bool": { "must": q, "filter": filter } } } });
    // Over-fetch so the filters cannot starve either list, and the reranker reads more than it keeps.
    let window = (k * 4).max(20);
    let fused = json!({ "rrf": {
        "retrievers": [
            half(json!({ "match": { "text.words": query } })),
            half(json!({ "semantic": { "field": "text", "query": query } })),
        ],
        "rank_window_size": window
    }});
    let retriever = if rerank {
        json!({ "text_similarity_reranker": {
            "retriever": fused, "field": "text", "inference_id": RERANK_ID, "inference_text": query, "rank_window_size": window
        }})
    } else {
        fused
    };
    json!({ "size": k, "retriever": retriever, "_source": SOURCE })
}

fn clause_of(hit: &Value) -> Result<ClauseHit> {
    let mut c: ClauseHit = serde_json::from_value(hit["_source"].clone())?;
    if c.clause_id.is_empty() {
        c.clause_id = hit["_id"].as_str().unwrap_or_default().to_string();
    }
    c.score = hit["_score"].as_f64().unwrap_or_default() as f32;
    Ok(c)
}

/// A clause id as the index writes them: ASCII letters, digits, `-`, `_` or `.`.
pub(crate) fn valid_clause_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

impl ClaimsIndex {
    /// `<prefix>-policy-clauses`, from the same prefix as `<prefix>-claims`.
    fn clause_search_index(&self) -> String {
        let prefix = self.index.strip_suffix("-claims").unwrap_or(&self.index);
        format!("{prefix}-policy-clauses")
    }

    /// The clauses of a claim's policies that best match `query`, best
    /// first, at most `k`: the venue's (`policy` `venue`, and its document when
    /// `venue_hash` is given) and, only when `attendee_hash` is given, the
    /// attendee's health plan (`policy` `attendee` with that `document_hash`). With
    /// `sections` the clauses are limited to those sections
    /// ([`sections_for_kind`]). A missing index, a blank query or no hits is an
    /// empty list.
    pub async fn search_clauses(
        &self,
        query: &str,
        venue_hash: Option<&str>,
        attendee_hash: Option<&str>,
        sections: &[&str],
        k: usize,
    ) -> Result<Vec<ClauseHit>> {
        let mut policies = vec![policy_filter("venue", venue_hash)];
        if let Some(h) = attendee_hash.filter(|h| !h.trim().is_empty()) {
            policies.push(policy_filter("attendee", Some(h)));
        }
        self.run_clause_search(query, policies, sections, k).await
    }

    /// The clauses of one policy that best match `query`, best first, at
    /// most `k`: `venue` (its document when `document_hash` is given), or
    /// `attendee`, which needs the attendee's health plan document. Fails soft like
    /// [`ClaimsIndex::search_clauses`].
    pub async fn search_policy_clauses(&self, query: &str, policy: &str, document_hash: Option<&str>, sections: &[&str], k: usize) -> Result<Vec<ClauseHit>> {
        let hash = document_hash.filter(|h| !h.trim().is_empty());
        match (policy, hash) {
            ("venue", _) => {}
            ("attendee", Some(_)) => {}
            ("attendee", None) => return Ok(Vec::new()),
            (other, _) => bail!("policy {other:?} is not venue or attendee"),
        }
        self.run_clause_search(query, vec![policy_filter(policy, hash)], sections, k).await
    }

    /// One clause by id, with its section, page and full text; `None` when there
    /// is no such clause or no clause index.
    pub async fn read_clause(&self, clause_id: &str) -> Result<Option<ClauseHit>> {
        let id = clause_id.trim();
        if !valid_clause_id(id) {
            bail!("clause id {id:?} must be ASCII letters, digits, '-', '_' or '.'");
        }
        let body = json!({
            "size": 1,
            "query": { "bool": {
                "should": [{ "ids": { "values": [id] } }, { "term": { "clause_id": id } }],
                "minimum_should_match": 1
            }},
            "_source": SOURCE
        });
        let Some(v) = self.clause_query(body).await? else {
            return Ok(None);
        };
        let Some(hit) = hits(&v).next() else {
            return Ok(None);
        };
        let mut c = clause_of(hit)?;
        c.score = 0.0;
        Ok(Some(c))
    }

    async fn run_clause_search(&self, query: &str, policies: Vec<Value>, sections: &[&str], k: usize) -> Result<Vec<ClauseHit>> {
        let query = query.trim();
        if query.is_empty() || k == 0 {
            return Ok(Vec::new());
        }
        let reranked = self.clause_query(search_body(query, policies.clone(), sections, k, true)).await;
        let found = match reranked {
            Ok(found) => found,
            Err(e) => {
                eprintln!("clause rerank failed, keeping the fused order: {e:#}");
                self.clause_query(search_body(query, policies, sections, k, false)).await?
            }
        };
        let Some(v) = found else {
            return Ok(Vec::new());
        };
        hits(&v).take(k).map(clause_of).collect()
    }

    /// Runs a search on the clause index; `None` when the index does not exist yet.
    async fn clause_query(&self, body: Value) -> Result<Option<Value>> {
        let path = format!("{}/_search", self.clause_search_index());
        let (status, v) = self.send(self.req(Method::POST, &path).json(&body)).await?;
        if status == StatusCode::NOT_FOUND || v["error"]["type"] == "index_not_found_exception" {
            return Ok(None);
        }
        if !status.is_success() {
            bail!("POST {path} returned {status}: {}", short(&v));
        }
        Ok(Some(v))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clause_index_follows_the_claims_prefix() {
        let es = ClaimsIndex::new("https://example.invalid", "k").unwrap();
        assert_eq!(es.clause_search_index(), "bandit-policy-clauses");
        assert_eq!(es.with_prefix("e2e-7-").clause_search_index(), "e2e-7-policy-clauses");
    }

    #[test]
    fn every_kind_searches_known_sections() {
        for kind in ["sos", "fall", "property", "theft", "breakage"] {
            let sections = sections_for_kind(kind);
            assert!(!sections.is_empty() && sections.len() < CLAUSE_SECTIONS.len(), "{kind}");
            assert!(sections.iter().all(|s| CLAUSE_SECTIONS.contains(s)), "{kind}");
        }
        let theft = sections_for_kind("theft");
        for s in ["theft", "conditions", "exclusions", "limits", "subrogation"] {
            assert!(theft.contains(&s), "theft searches {s}");
        }
        assert!(!theft.contains(&"other_insurance") && !theft.contains(&"schedule_of_benefits"));
        assert!(sections_for_kind("fall").contains(&"other_insurance"));
        assert_eq!(sections_for_kind("breakage"), sections_for_kind("property"), "breakage is answered like property");
        assert_eq!(sections_for_kind("slip"), CLAUSE_SECTIONS);
    }

    #[test]
    fn the_search_is_filtered_to_the_claims_policies() {
        let policies = vec![policy_filter("venue", None), policy_filter("attendee", Some("ab12"))];
        let q = "injury that began before the event";
        let body = search_body(q, policies, &["exclusions", "other_insurance"], 5, true);
        assert_eq!(body["size"], 5);
        let rerank = &body["retriever"]["text_similarity_reranker"];
        assert_eq!((&rerank["field"], &rerank["inference_id"], &rerank["inference_text"]), (&json!("text"), &json!(RERANK_ID), &json!(q)));
        assert_eq!(rerank["rank_window_size"], 20);
        let halves = &rerank["retriever"]["rrf"]["retrievers"];
        assert_eq!(halves[0]["standard"]["query"]["bool"]["must"], json!({ "match": { "text.words": q } }));
        assert_eq!(halves[1]["standard"]["query"]["bool"]["must"], json!({ "semantic": { "field": "text", "query": q } }));
        assert_eq!(halves[0]["standard"]["query"]["bool"]["filter"], halves[1]["standard"]["query"]["bool"]["filter"], "both halves keep the filters");
        let filter = &halves[1]["standard"]["query"]["bool"]["filter"];
        let should = &filter[0]["bool"]["should"];
        assert_eq!(filter[0]["bool"]["minimum_should_match"], 1);
        assert_eq!(should[0], json!({ "bool": { "filter": [{ "term": { "policy": "venue" } }] } }));
        assert_eq!(should[1], json!({ "bool": { "filter": [{ "term": { "policy": "attendee" } }, { "term": { "document_hash": "ab12" } }] } }));
        assert_eq!(filter[1], json!({ "terms": { "section": ["exclusions", "other_insurance"] } }));
        let theft = search_body("theft of merchandise from a booth", vec![policy_filter("venue", None)], sections_for_kind("theft"), 5, true);
        let theft_filter = &theft["retriever"]["text_similarity_reranker"]["retriever"]["rrf"]["retrievers"][0]["standard"]["query"]["bool"]["filter"];
        assert_eq!(theft_filter[0]["bool"]["should"].as_array().unwrap().len(), 1, "a theft searches the venue's policy only");
        let any = search_body("q", vec![policy_filter("venue", Some(" "))], &[], 3, false);
        let filter = &any["retriever"]["rrf"]["retrievers"][0]["standard"]["query"]["bool"]["filter"];
        assert_eq!(filter.as_array().unwrap().len(), 1, "no section filter");
        assert_eq!(filter[0]["bool"]["should"][0]["bool"]["filter"].as_array().unwrap().len(), 1, "a blank hash filters nothing");
        assert!(any["retriever"].get("text_similarity_reranker").is_none(), "no reranker");
    }

    #[test]
    fn hits_become_clauses() {
        let hit = json!({
            "_id": "ab12-c3", "_score": 0.82,
            "_source": { "policy": "venue", "document_hash": "ab12", "section": "theft", "page": 4, "text": "We pay for theft of covered property." }
        });
        let c = clause_of(&hit).unwrap();
        assert_eq!((c.clause_id.as_str(), c.policy.as_str(), c.section.as_str(), c.page), ("ab12-c3", "venue", "theft", 4));
        assert!((c.score - 0.82).abs() < 1e-6);
    }

    #[test]
    fn clause_ids_are_checked() {
        assert!(valid_clause_id("9f2c0a-c12"));
        assert!(!valid_clause_id(""));
        assert!(!valid_clause_id("a/b"));
        assert!(!valid_clause_id("a b"));
    }

    #[tokio::test]
    async fn bad_input_never_reaches_elastic() {
        let es = ClaimsIndex::new("https://example.invalid", "k").unwrap();
        assert!(es.search_clauses("  ", None, None, &[], 5).await.unwrap().is_empty());
        assert!(es.search_policy_clauses("q", "attendee", None, &[], 5).await.unwrap().is_empty());
        assert!(es.search_policy_clauses("q", "insurer", None, &[], 5).await.is_err());
        assert!(es.read_clause("../_all").await.is_err());
    }
}
