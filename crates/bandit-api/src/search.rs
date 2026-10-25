//! bandit-api's Elastic side: it ranks the recap's suggestions, finds the closest booths of people who
//! share none with the attendee, and keeps each attendee's latest ranking in
//! `<prefix>-recap-rankings` for the Kibana recap dashboard. Every ranking is a hybrid search: a
//! keyword match on the `words` subfield and a semantic query, fused with RRF, then reordered by a
//! reranker.
//! The people and booths indices and their fields are written by bandit-indexer.

use anyhow::{Result, bail};
use futures_util::{StreamExt, TryStreamExt, stream};
use reqwest::{Client, Method};
use serde_json::{Value, json};
use std::time::Duration;

/// An Elastic call that takes longer fails, and the recap falls back to minutes.
const TIMEOUT: Duration = Duration::from_secs(10);
/// Rerank endpoint that reads the attendee's interests next to each fused candidate.
const RERANK_ID: &str = ".jina-reranker-v3";

pub struct Elastic {
    http: Client,
    url: String,
    api_key: String,
    prefix: String,
}

/// Candidate ids with their scores, best first, as Elastic ranked them, and the interests text
/// they were ranked by.
pub struct Ranking {
    pub people: Vec<(u64, f64)>,
    pub booths: Vec<(u64, f64)>,
    /// The booths of the people who share none with the attendee, closest to their interests first.
    pub theirs: Vec<Closest>,
    pub interests: String,
}

/// A booth Elastic matched to the interests, with its tags: the booth's own, then its organisation's.
#[derive(Clone, Debug, PartialEq)]
pub struct Closest {
    pub booth_id: u64,
    pub score: f64,
    pub tags: Vec<String>,
}

/// The index of each attendee's latest ranked recap, read only by Kibana.
const RANKINGS: &str = "recap-rankings";

impl Elastic {
    pub fn new(url: &str, api_key: &str, prefix: &str) -> Result<Self> {
        Ok(Elastic {
            http: Client::builder().timeout(TIMEOUT).build()?,
            url: url.trim_end_matches('/').to_string(),
            api_key: api_key.to_string(),
            prefix: prefix.to_string(),
        })
    }

    async fn call(&self, method: Method, path: &str, body: &Value) -> Result<Value> {
        let response = self
            .http
            .request(method, format!("{}/{}-{path}", self.url, self.prefix))
            .header("Authorization", format!("ApiKey {}", self.api_key))
            .json(body)
            .send()
            .await?;
        let status = response.status();
        let found: Value = response.json().await?;
        if !status.is_success() {
            bail!("{path} answered {status}: {found}");
        }
        Ok(found)
    }

    async fn search(&self, index: &str, body: &Value) -> Result<Value> {
        self.call(Method::POST, &format!("{index}/_search"), body).await
    }

    /// Creates the rankings index with its mapping when it is missing.
    pub async fn ensure_rankings(&self) -> Result<()> {
        let exists = self
            .http
            .head(format!("{}/{}-{RANKINGS}", self.url, self.prefix))
            .header("Authorization", format!("ApiKey {}", self.api_key))
            .send()
            .await?;
        if exists.status().is_success() {
            // Adds the fields a newer bandit-api writes; the ones already there keep their type.
            return self
                .call(Method::PUT, &format!("{RANKINGS}/_mapping"), &rankings_mapping())
                .await
                .map(|_| ());
        }
        self.call(Method::PUT, RANKINGS, &json!({ "mappings": rankings_mapping() }))
            .await
            .map(|_| ())
    }

    /// Writes an attendee's latest ranking over their previous one.
    pub async fn log_ranking(&self, attendee_id: &str, doc: &Value) -> Result<()> {
        self.call(Method::PUT, &format!("{RANKINGS}/_doc/{attendee_id}"), doc)
            .await
            .map(|_| ())
    }

    /// Ranks the candidate people (node ids) and booths (booth ids) by how well they match the
    /// attendee's own interests: their people document, or `fallback` when they have none. `theirs`, the
    /// booths of the people who share none with the attendee, are ordered the same way.
    pub async fn rank(
        &self,
        attendee_id: &str,
        fallback: &str,
        people: &[u64],
        booths: &[u64],
        theirs: &[u64],
    ) -> Result<Ranking> {
        let own = self
            .search("people", &own_interests_query(attendee_id))
            .await?;
        let interests = own["hits"]["hits"][0]["_source"]["interests"]
            .as_str()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(fallback);
        if interests.trim().is_empty() {
            bail!("nothing to rank by: no interests and no visits");
        }
        let (people, booths, theirs) = tokio::try_join!(
            self.ranked("people", "interests", "node_id", interests, people),
            self.ranked("booths", "description", "booth_id", interests, booths),
            self.closest(interests, theirs),
        )?;
        Ok(Ranking {
            people,
            booths,
            theirs,
            interests: interests.to_string(),
        })
    }

    /// The booths among `ids` that best match `text`, best first, with their tags. No call when
    /// there are no `ids`.
    pub async fn closest(&self, text: &str, ids: &[u64]) -> Result<Vec<Closest>> {
        if ids.is_empty() || text.trim().is_empty() {
            return Ok(Vec::new());
        }
        let found = self
            .reranked("booths", |rerank| closest_query(text, ids, rerank))
            .await?;
        Ok(closest_hits(&found))
    }

    /// Ranks the caller's already-grounded encounter evidence without storing personal history
    /// in an index. Returned positions can refer only to the supplied documents.
    pub async fn rank_evidence(&self, query: &str, documents: &[String]) -> Result<Vec<(usize, f64)>> {
        if documents.is_empty() {
            return Ok(Vec::new());
        }
        // Every eligible person is searched. Bound each provider request and concurrency instead
        // of cutting off people whose wording has no exact match before semantic ranking.
        let mut requests = Vec::new();
        for (batch, chunk) in documents.chunks(100).enumerate() {
            let input = chunk.to_vec();
            requests.push(async move {
                self.rank_evidence_batch(query, &input).await.map(|scores| {
                    scores.into_iter().map(|(index, score)| (batch * 100 + index, score)).collect::<Vec<_>>()
                })
            });
        }
        let batches = stream::iter(requests).buffer_unordered(3).try_collect::<Vec<_>>();
        let mut scores: Vec<_> = tokio::time::timeout(Duration::from_secs(25), batches)
            .await??
            .into_iter()
            .flatten()
            .collect();
        scores.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        Ok(scores)
    }

    async fn rank_evidence_batch(&self, query: &str, documents: &[String]) -> Result<Vec<(usize, f64)>> {
        let response = self
            .http
            .post(format!("{}/_inference/rerank/{RERANK_ID}", self.url))
            .header("Authorization", format!("ApiKey {}", self.api_key))
            .json(&json!({ "query": query, "input": documents }))
            .send()
            .await?;
        let status = response.status();
        let body: Value = response.json().await?;
        if !status.is_success() {
            bail!("encounter rerank answered {status}: {body}");
        }
        evidence_scores(&body, documents.len())
    }

    /// The candidates `ids` ranked by [`rank_query`], best first, with their scores. No call when
    /// there are no `ids`.
    async fn ranked(
        &self,
        index: &str,
        field: &str,
        id_field: &str,
        text: &str,
        ids: &[u64],
    ) -> Result<Vec<(u64, f64)>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let found = self
            .reranked(index, |rerank| rank_query(field, id_field, text, ids, rerank))
            .await?;
        Ok(scores(&found, id_field))
    }

    /// Runs `query(true)`, the reranked search; when Elastic answers it with an error, runs
    /// `query(false)`, the same search without the reranker.
    async fn reranked(&self, index: &str, query: impl Fn(bool) -> Value) -> Result<Value> {
        match self.search(index, &query(true)).await {
            Err(e) if !timed_out(&e) => {
                eprintln!("{index} rerank failed, keeping the fused order: {e:#}");
                self.search(index, &query(false)).await
            }
            found => found,
        }
    }
}

/// A call that ran into [`TIMEOUT`]; it is not tried again, so the recap waits at most once.
fn timed_out(e: &anyhow::Error) -> bool {
    e.downcast_ref::<reqwest::Error>()
        .is_some_and(reqwest::Error::is_timeout)
}

/// One document per attendee: who, the places their interests text names, and the order Elastic
/// chose next to the booth that minutes alone put first.
pub fn rankings_mapping() -> Value {
    let keyword = json!({ "type": "keyword" });
    let float = json!({ "type": "float" });
    json!({ "properties": {
        "@timestamp": { "type": "date" },
        "attendee": keyword,
        "top_spots": keyword,
        "people": keyword,
        "booths": keyword,
        "first_person": keyword,
        "first_person_score": float,
        "also_there": keyword,
        "first_also_there": keyword,
        "first_also_there_score": float,
        "first_booth": keyword,
        "first_booth_zone": keyword,
        "first_booth_score": float,
        "first_booth_by_minutes": keyword,
        "reordered": { "type": "boolean" },
    }})
}

/// The attendee's own people document, which holds their interests.
pub fn own_interests_query(attendee_id: &str) -> Value {
    json!({
        "size": 1,
        "_source": ["interests"],
        "query": { "ids": { "values": [attendee_id] } },
    })
}

/// The candidates `ids` (values of `id_field`), ranked against `text` by a keyword match on
/// `<field>.words` and a semantic query on `field`, fused with RRF and, with `rerank`, reordered by
/// the reranker reading `field`. Every candidate fits in the window, so none is cut.
pub fn rank_query(field: &str, id_field: &str, text: &str, ids: &[u64], rerank: bool) -> Value {
    let filter = json!({ "terms": { id_field: ids } });
    let half = |q: Value| json!({ "standard": { "query": { "bool": { "must": q, "filter": filter } } } });
    let window = ids.len().max(1);
    let fused = json!({ "rrf": {
        "retrievers": [
            half(json!({ "match": { format!("{field}.words"): text } })),
            half(json!({ "semantic": { "field": field, "query": text } })),
        ],
        "rank_window_size": window,
    } });
    let retriever = if rerank {
        json!({ "text_similarity_reranker": {
            "retriever": fused,
            "field": field,
            "inference_id": RERANK_ID,
            "inference_text": text,
            "rank_window_size": window,
        } })
    } else {
        fused
    };
    json!({
        "size": ids.len(),
        "_source": [id_field],
        "retriever": retriever,
    })
}

/// The booths `ids` ranked against `text` like [`rank_query`] on their `description`, with their tags.
pub fn closest_query(text: &str, ids: &[u64], rerank: bool) -> Value {
    let mut query = rank_query("description", "booth_id", text, ids, rerank);
    query["_source"] = json!(["booth_id", "tags"]);
    query
}

/// The booth id, score and tags of each hit, in Elastic's order.
pub fn closest_hits(response: &Value) -> Vec<Closest> {
    let hits = response["hits"]["hits"].as_array().cloned().unwrap_or_default();
    hits.iter()
        .filter_map(|h| {
            Some(Closest {
                booth_id: h["_source"]["booth_id"].as_u64()?,
                score: h["_score"].as_f64()?,
                tags: h["_source"]["tags"]
                    .as_array()
                    .map(|t| t.iter().filter_map(|t| t.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
            })
        })
        .collect()
}

/// The id and score of each hit, in Elastic's order.
pub fn scores(response: &Value, id_field: &str) -> Vec<(u64, f64)> {
    let hits = response["hits"]["hits"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    hits.iter()
        .filter_map(|h| Some((h["_source"][id_field].as_u64()?, h["_score"].as_f64()?)))
        .collect()
}

/// Inference providers can encode their positions and scores as JSON numbers or strings.
/// Reject malformed positions instead of letting a provider select another attendee.
fn evidence_scores(response: &Value, count: usize) -> Result<Vec<(usize, f64)>> {
    let Some(ranked) = response["rerank"].as_array() else {
        bail!("encounter rerank omitted its results");
    };
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::with_capacity(ranked.len());
    for item in ranked {
        let index = item["index"]
            .as_u64()
            .or_else(|| item["index"].as_str()?.parse().ok())
            .and_then(|n| usize::try_from(n).ok());
        let score = item["relevance_score"]
            .as_f64()
            .or_else(|| item["relevance_score"].as_str()?.parse().ok());
        match (index, score) {
            (Some(index), Some(score)) if index < count && score.is_finite() && seen.insert(index) => {
                out.push((index, score));
            }
            _ => bail!("encounter rerank returned an invalid or repeated position"),
        }
    }
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn evidence_server() -> (String, tokio::task::JoinHandle<()>) {
        let app = axum::Router::new().route(
            "/_inference/rerank/.jina-reranker-v3",
            axum::routing::post(|axum::Json(body): axum::Json<Value>| async move {
                let documents = body["input"].as_array().unwrap();
                assert!(documents.len() <= 100);
                if documents.first().is_some_and(|value| value == "slow first batch") {
                    tokio::time::sleep(Duration::from_millis(40)).await;
                }
                if documents.iter().any(|value| value == "invalid response") {
                    return axum::Json(json!({"rerank":[{"index":9999,"relevance_score":1.0}]}));
                }
                let ranked: Vec<_> = documents.iter().enumerate().map(|(index, text)| {
                    json!({"index":index,"relevance_score":if text == "remembered connection" { 0.9 } else { 0.1 }})
                }).collect();
                axum::Json(json!({"rerank":ranked}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{address}"), task)
    }

    #[tokio::test]
    async fn semantic_ranking_includes_connections_beyond_first_batch() {
        let (url, server) = evidence_server().await;
        let es = Elastic::new(&url, "test-key", "test-prefix").unwrap();
        let mut documents = vec!["recorded connection".to_string(); 205];
        documents[0] = "slow first batch".into();
        documents[150] = "remembered connection".into();
        let ranked = es.rank_evidence("virtual reality", &documents).await.unwrap();
        server.abort();
        assert_eq!(ranked.len(), 205);
        assert_eq!(ranked[0], (150, 0.9));
        let positions: std::collections::BTreeSet<_> = ranked.iter().map(|(index, _)| *index).collect();
        assert_eq!(positions.len(), 205);
        assert!(positions.contains(&204));
    }

    #[tokio::test]
    async fn one_failed_batch_does_not_claim_partial_semantic_success() {
        let (url, server) = evidence_server().await;
        let es = Elastic::new(&url, "test-key", "test-prefix").unwrap();
        let mut documents = vec!["recorded connection".to_string(); 101];
        documents[100] = "invalid response".into();
        let answer = es.rank_evidence("Meta", &documents).await;
        server.abort();
        assert!(answer.is_err());
    }

    #[test]
    fn encounter_scores_keep_only_supplied_positions() {
        let body = json!({"rerank": [
            {"index": 0, "relevance_score": 0.2},
            {"index": "1", "relevance_score": "0.9"}
        ]});
        assert_eq!(evidence_scores(&body, 2).unwrap(), vec![(1, 0.9), (0, 0.2)]);
        for body in [
            json!({}),
            json!({"rerank":[{"index":2,"relevance_score":1.0}]}),
            json!({"rerank":[{"index":0,"relevance_score":1.0},{"index":0,"relevance_score":0.2}]}),
            json!({"rerank":[{"index":0,"relevance_score":"NaN"}]}),
            json!({"rerank":[{"index":-1,"relevance_score":1.0}]})
        ] {
            assert!(evidence_scores(&body, 2).is_err());
        }
    }

    #[test]
    fn own_interests_by_document_id() {
        let q = own_interests_query("c200ab");
        assert_eq!(q["query"], json!({ "ids": { "values": ["c200ab"] } }));
        assert_eq!(q["_source"], json!(["interests"]));
    }

    #[test]
    fn rank_stays_inside_the_candidates() {
        let text = "drones and robot arms";
        let q = rank_query("interests", "node_id", text, &[4, 9], true);
        assert_eq!(q["size"], 2);
        let rerank = &q["retriever"]["text_similarity_reranker"];
        assert_eq!(rerank["field"], "interests");
        assert_eq!(rerank["inference_id"], RERANK_ID);
        assert_eq!(rerank["inference_text"], text);
        assert_eq!(rerank["rank_window_size"], 2);
        let halves = &rerank["retriever"]["rrf"]["retrievers"];
        assert_eq!(rerank["retriever"]["rrf"]["rank_window_size"], 2);
        for half in halves.as_array().unwrap() {
            assert_eq!(
                half["standard"]["query"]["bool"]["filter"],
                json!({ "terms": { "node_id": [4, 9] } })
            );
        }
        assert_eq!(
            halves[0]["standard"]["query"]["bool"]["must"],
            json!({ "match": { "interests.words": text } })
        );
        assert_eq!(
            halves[1]["standard"]["query"]["bool"]["must"],
            json!({ "semantic": { "field": "interests", "query": text } })
        );
        let booths = rank_query("description", "booth_id", "robots", &[5], false);
        assert!(booths["retriever"].get("text_similarity_reranker").is_none());
        let halves = &booths["retriever"]["rrf"]["retrievers"];
        assert_eq!(
            halves[0]["standard"]["query"]["bool"]["filter"],
            json!({ "terms": { "booth_id": [5] } })
        );
        assert_eq!(
            halves[0]["standard"]["query"]["bool"]["must"]["match"]["description.words"],
            "robots"
        );
        assert_eq!(
            halves[1]["standard"]["query"]["bool"]["must"]["semantic"]["field"],
            "description"
        );
    }

    #[test]
    fn closest_brings_back_the_tags() {
        let q = closest_query("drones", &[3, 4], true);
        assert_eq!(q["_source"], json!(["booth_id", "tags"]));
        let fused = &q["retriever"]["text_similarity_reranker"]["retriever"]["rrf"];
        assert_eq!(fused["retrievers"][1]["standard"]["query"]["bool"]["filter"], json!({ "terms": { "booth_id": [3, 4] } }));
        let response = json!({ "hits": { "hits": [
            { "_score": 0.7, "_source": { "booth_id": 4, "tags": ["drones", "robotics"] } },
            { "_score": 0.2, "_source": { "booth_id": 3 } },
        ] } });
        assert_eq!(
            closest_hits(&response),
            vec![
                Closest { booth_id: 4, score: 0.7, tags: vec!["drones".into(), "robotics".into()] },
                Closest { booth_id: 3, score: 0.2, tags: vec![] },
            ]
        );
    }

    #[test]
    fn scores_keep_elastics_order() {
        let response = json!({ "hits": { "hits": [
            { "_id": "x", "_score": 0.9, "_source": { "booth_id": 5 } },
            { "_id": "y", "_score": 0.4, "_source": { "booth_id": 1 } },
        ] } });
        assert_eq!(scores(&response, "booth_id"), vec![(5, 0.9), (1, 0.4)]);
    }
}
