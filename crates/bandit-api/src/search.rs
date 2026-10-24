//! bandit-api's Elastic side: query builders, the two requests it makes, and hits turned into ids.
//! The indices and their fields are written by bandit-indexer.

use anyhow::{Result, bail};
use reqwest::{Client, Method, RequestBuilder};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Duration;

/// An Elastic call that takes longer fails, and the route answers 503.
const TIMEOUT: Duration = Duration::from_secs(10);
/// How many hits each ranking contributes before reciprocal rank fusion; also the largest `limit`.
pub const RANK_WINDOW: usize = 50;

pub struct Elastic {
    http: Client,
    url: String,
    api_key: String,
    prefix: String,
}

impl Elastic {
    pub fn new(url: &str, api_key: &str, prefix: &str) -> Result<Self> {
        Ok(Elastic {
            http: Client::builder().timeout(TIMEOUT).build()?,
            url: url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            prefix: prefix.to_string(),
        })
    }

    /// The alias of a logical index, such as `bandit-booths`.
    pub fn alias(&self, index: &str) -> String {
        format!("{}-{index}", self.prefix)
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.http
            .request(method, format!("{}/{path}", self.url))
            .header("Authorization", format!("ApiKey {}", self.api_key))
    }

    pub async fn search(&self, index: &str, body: &Value) -> Result<Value> {
        let response = self
            .request(Method::POST, &format!("{}/_search", self.alias(index)))
            .json(body)
            .send()
            .await?;
        let status = response.status();
        let found: Value = response.json().await?;
        if !status.is_success() {
            bail!("search on {index} answered {status}: {found}");
        }
        Ok(found)
    }

    /// Several searches on one index in one request; one response per body, in order.
    pub async fn msearch(&self, index: &str, bodies: &[Value]) -> Result<Vec<Value>> {
        let header = json!({ "index": self.alias(index) }).to_string();
        let lines: String = bodies.iter().map(|b| format!("{header}\n{b}\n")).collect();
        let response = self
            .request(Method::POST, "_msearch")
            .header("Content-Type", "application/x-ndjson")
            .body(lines)
            .send()
            .await?;
        let status = response.status();
        let found: Value = response.json().await?;
        if !status.is_success() {
            bail!("msearch on {index} answered {status}: {found}");
        }
        let responses = found["responses"].as_array().cloned().unwrap_or_default();
        if let Some(failed) = responses.iter().find(|r| r.get("error").is_some()) {
            bail!("msearch on {index} failed: {}", failed["error"]);
        }
        Ok(responses)
    }

    /// For every person with interests, the `limit` people whose interests mean the most alike.
    pub async fn similar_pairs(&self, limit: usize) -> Result<Vec<Pair>> {
        let people = hits(&self.search("people", &people_query()).await?);
        if people.is_empty() {
            return Ok(Vec::new());
        }
        let queries: Vec<Value> = people
            .iter()
            .map(|p| {
                similar_query(
                    p["id"].as_str().unwrap_or_default(),
                    p["interests"].as_str().unwrap_or_default(),
                    limit,
                )
            })
            .collect();
        let responses = self.msearch("people", &queries).await?;
        let neighbours: Vec<(u64, Vec<(u64, f64)>)> = people
            .iter()
            .zip(&responses)
            .map(|(p, r)| {
                (
                    node_id(p),
                    hits(r)
                        .iter()
                        .map(|h| (node_id(h), h["score"].as_f64().unwrap_or_default()))
                        .collect(),
                )
            })
            .collect();
        Ok(pairs(&neighbours))
    }
}

fn node_id(doc: &Value) -> u64 {
    doc["node_id"].as_u64().unwrap_or_default()
}

/// Booths by name, tags and organisation name, fused with booths by the meaning of their description.
pub fn booths_query(q: &str, limit: usize) -> Value {
    let keyword = json!({ "multi_match": { "query": q, "fields": ["name", "tags", "org_name"] } });
    fused(keyword, "description", q, Vec::new(), limit)
}

/// The caller's own memories, by booth names fused with the meaning of the booths' text.
pub fn memories_query(attendee_id: &str, q: &str, kind: Option<&str>, limit: usize) -> Value {
    let mut filter = vec![json!({ "term": { "attendee_id": attendee_id } })];
    if let Some(kind) = kind {
        filter.push(json!({ "term": { "kind": kind } }));
    }
    let keyword = json!({ "match": { "booth_names": q } });
    fused(keyword, "booth_text", q, filter, limit)
}

/// Reciprocal rank fusion of a keyword ranking and a semantic ranking, both inside `filter`.
/// The semantic field is left out of the hits: it is long, and the app shows rows from its own subscriptions.
fn fused(keyword: Value, semantic_field: &str, q: &str, filter: Vec<Value>, limit: usize) -> Value {
    json!({
        "size": limit,
        "_source": { "excludes": [semantic_field] },
        "retriever": { "rrf": {
            "retrievers": [
                { "standard": { "query": keyword } },
                { "standard": { "query": { "semantic": { "field": semantic_field, "query": q } } } },
            ],
            "filter": { "bool": { "filter": filter } },
            "rank_window_size": RANK_WINDOW,
        } },
    })
}

/// Everyone whose interests are known.
pub fn people_query() -> Value {
    json!({
        "size": 10000,
        "_source": ["node_id", "interests"],
        "query": { "exists": { "field": "interests" } },
    })
}

/// The people whose interests mean the most like `interests`, leaving out the person `id` themselves.
pub fn similar_query(id: &str, interests: &str, limit: usize) -> Value {
    json!({
        "size": limit,
        "_source": ["node_id"],
        "query": { "bool": {
            "must": { "semantic": { "field": "interests", "query": interests } },
            "must_not": { "ids": { "values": [id] } },
        } },
    })
}

/// Each hit as its stored fields plus its document `id` and `score`.
pub fn hits(response: &Value) -> Vec<Value> {
    let hits = response["hits"]["hits"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    hits.into_iter()
        .map(|h| {
            let mut doc = h["_source"].clone();
            doc["id"] = h["_id"].clone();
            doc["score"] = h["_score"].clone();
            doc
        })
        .collect()
}

/// A dashed "into the same things" link of the people graph.
#[derive(Serialize, Debug, PartialEq)]
pub struct Pair {
    pub node_a: u64,
    pub node_b: u64,
    pub score: f64,
}

/// One link per pair of people, lower node first; when both ranked each other the higher score stays.
pub fn pairs(neighbours: &[(u64, Vec<(u64, f64)>)]) -> Vec<Pair> {
    let mut best: BTreeMap<(u64, u64), f64> = BTreeMap::new();
    for (node, others) in neighbours {
        for &(other, score) in others {
            let key = (*node.min(&other), *node.max(&other));
            let kept = best.entry(key).or_insert(score);
            *kept = kept.max(score);
        }
    }
    best.into_iter()
        .map(|((node_a, node_b), score)| Pair {
            node_a,
            node_b,
            score,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn booths_fuse_keyword_and_meaning() {
        let q = booths_query("wearable robotics", 5);
        assert_eq!(q["size"], 5);
        let rrf = &q["retriever"]["rrf"];
        assert_eq!(
            rrf["retrievers"][0]["standard"]["query"]["multi_match"]["fields"],
            json!(["name", "tags", "org_name"])
        );
        assert_eq!(
            rrf["retrievers"][1]["standard"]["query"]["semantic"],
            json!({ "field": "description", "query": "wearable robotics" })
        );
        assert_eq!(rrf["filter"], json!({ "bool": { "filter": [] } }));
        assert_eq!(q["_source"]["excludes"], json!(["description"]));
    }

    #[test]
    fn memories_stay_inside_the_callers_own() {
        let q = memories_query("c200ab", "robots", Some("encounter"), 10);
        let rrf = &q["retriever"]["rrf"];
        assert_eq!(
            rrf["filter"]["bool"]["filter"],
            json!([{ "term": { "attendee_id": "c200ab" } }, { "term": { "kind": "encounter" } }])
        );
        assert_eq!(
            rrf["retrievers"][0]["standard"]["query"],
            json!({ "match": { "booth_names": "robots" } })
        );
        assert_eq!(
            rrf["retrievers"][1]["standard"]["query"]["semantic"]["field"],
            "booth_text"
        );
        let any_kind = memories_query("c200ab", "robots", None, 10);
        assert_eq!(
            any_kind["retriever"]["rrf"]["filter"]["bool"]["filter"],
            json!([{ "term": { "attendee_id": "c200ab" } }])
        );
    }

    #[test]
    fn similar_leaves_out_the_person_themselves() {
        let q = similar_query("c200ab", "drones and robot arms", 3);
        assert_eq!(q["size"], 3);
        assert_eq!(
            q["query"]["bool"]["must_not"],
            json!({ "ids": { "values": ["c200ab"] } })
        );
        assert_eq!(
            q["query"]["bool"]["must"]["semantic"]["query"],
            "drones and robot arms"
        );
    }

    #[test]
    fn hits_carry_id_and_score() {
        let response = json!({ "hits": { "hits": [{ "_id": "visit-4", "_score": 0.5, "_source": { "zone_id": 2 } }] } });
        assert_eq!(
            hits(&response),
            vec![json!({ "zone_id": 2, "id": "visit-4", "score": 0.5 })]
        );
    }

    #[test]
    fn pairs_are_deduplicated_lower_node_first() {
        let neighbours = vec![
            (5, vec![(2, 0.7), (9, 0.4)]),
            (2, vec![(5, 0.8)]),
            (9, vec![(5, 0.4)]),
        ];
        assert_eq!(
            pairs(&neighbours),
            vec![
                Pair {
                    node_a: 2,
                    node_b: 5,
                    score: 0.8
                },
                Pair {
                    node_a: 5,
                    node_b: 9,
                    score: 0.4
                }
            ]
        );
    }
}
