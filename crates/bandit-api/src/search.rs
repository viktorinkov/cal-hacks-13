//! bandit-api's Elastic side: it ranks the recap's suggestions by meaning, and keeps each attendee's
//! latest ranking in `<prefix>-recap-rankings` for the Kibana recap dashboard.
//! The people and booths indices and their fields are written by bandit-indexer.

use anyhow::{Result, bail};
use reqwest::{Client, Method};
use serde_json::{Value, json};
use std::time::Duration;

/// An Elastic call that takes longer fails, and the recap falls back to minutes.
const TIMEOUT: Duration = Duration::from_secs(10);

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
    pub interests: String,
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
            return Ok(());
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
    /// attendee's own interests: their people document, or `fallback` when they have none.
    pub async fn rank(
        &self,
        attendee_id: &str,
        fallback: &str,
        people: &[u64],
        booths: &[u64],
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
        let people_query = rank_query("interests", "node_id", interests, people);
        let booths_query = rank_query("description", "booth_id", interests, booths);
        let (people, booths) = tokio::try_join!(
            self.search("people", &people_query),
            self.search("booths", &booths_query),
        )?;
        Ok(Ranking {
            people: scores(&people, "node_id"),
            booths: scores(&booths, "booth_id"),
            interests: interests.to_string(),
        })
    }
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

/// The candidates `ids` (values of `id_field`), ranked by the meaning of `semantic_field` against `text`.
pub fn rank_query(semantic_field: &str, id_field: &str, text: &str, ids: &[u64]) -> Value {
    json!({
        "size": ids.len(),
        "_source": [id_field],
        "query": { "bool": {
            "must": { "semantic": { "field": semantic_field, "query": text } },
            "filter": { "terms": { id_field: ids } },
        } },
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_interests_by_document_id() {
        let q = own_interests_query("c200ab");
        assert_eq!(q["query"], json!({ "ids": { "values": ["c200ab"] } }));
        assert_eq!(q["_source"], json!(["interests"]));
    }

    #[test]
    fn rank_stays_inside_the_candidates() {
        let q = rank_query("interests", "node_id", "drones and robot arms", &[4, 9]);
        assert_eq!(q["size"], 2);
        assert_eq!(
            q["query"]["bool"]["filter"],
            json!({ "terms": { "node_id": [4, 9] } })
        );
        assert_eq!(
            q["query"]["bool"]["must"],
            json!({ "semantic": { "field": "interests", "query": "drones and robot arms" } })
        );
        let booths = rank_query("description", "booth_id", "robots", &[5]);
        assert_eq!(
            booths["query"]["bool"]["filter"],
            json!({ "terms": { "booth_id": [5] } })
        );
        assert_eq!(
            booths["query"]["bool"]["must"]["semantic"]["field"],
            "description"
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
