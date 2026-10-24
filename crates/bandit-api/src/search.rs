//! bandit-api's Elastic side: it ranks the recap's suggestions by meaning.
//! The indices and their fields are written by bandit-indexer.

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

/// Candidate ids with their scores, best first, as Elastic ranked them.
pub struct Ranking {
    pub people: Vec<(u64, f64)>,
    pub booths: Vec<(u64, f64)>,
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

    async fn search(&self, index: &str, body: &Value) -> Result<Value> {
        let response = self
            .http
            .request(
                Method::POST,
                format!("{}/{}-{index}/_search", self.url, self.prefix),
            )
            .header("Authorization", format!("ApiKey {}", self.api_key))
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
            .unwrap_or(fallback);
        let people_query = rank_query("interests", "node_id", interests, people);
        let booths_query = rank_query("description", "booth_id", interests, booths);
        let (people, booths) = tokio::try_join!(
            self.search("people", &people_query),
            self.search("booths", &booths_query),
        )?;
        Ok(Ranking {
            people: scores(&people, "node_id"),
            booths: scores(&booths, "booth_id"),
        })
    }
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
