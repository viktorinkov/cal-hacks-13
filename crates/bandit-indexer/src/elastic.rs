//! The indexer's Elastic calls: create each index and its alias, list the ids already there, bulk writes.

use crate::docs::Index;
use anyhow::{Context, Result, bail};
use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde_json::{Value, json};
use std::time::Duration;

/// Text embedding endpoint of every semantic_text field. Indices searched together must share one model.
pub const INFERENCE_ID: &str = ".jina-embeddings-v5-text-small";
/// Each logical index is an alias over one generation: `<prefix>-memories` -> `<prefix>-memories-001`.
const GENERATION: &str = "001";
/// Writes with embeddings take a while; one bulk request may run this long.
const TIMEOUT: Duration = Duration::from_secs(60);

pub enum Op {
    Index {
        index: Index,
        id: String,
        doc: Value,
    },
    Delete {
        index: Index,
        id: String,
    },
}

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

    pub fn alias(&self, index: Index) -> String {
        format!("{}-{}", self.prefix, index.name())
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.http
            .request(method, format!("{}/{path}", self.url))
            .header("Authorization", format!("ApiKey {}", self.api_key))
    }

    /// Creates the first generation with its mapping and the alias pointing at it, when the alias is missing.
    pub async fn ensure_index(&self, index: Index) -> Result<()> {
        let alias = self.alias(index);
        let found = self
            .request(Method::HEAD, &format!("_alias/{alias}"))
            .send()
            .await?;
        if found.status() == StatusCode::OK {
            return Ok(());
        }
        let body = json!({ "mappings": mapping(index), "aliases": { alias.clone(): {} } });
        let created = self
            .request(Method::PUT, &format!("{alias}-{GENERATION}"))
            .json(&body)
            .send()
            .await?;
        ok_json(created)
            .await
            .with_context(|| format!("creating {alias}-{GENERATION}"))?;
        eprintln!("created {alias}-{GENERATION} with alias {alias}");
        Ok(())
    }

    /// Ids of the documents already in an index.
    pub async fn ids(&self, index: Index) -> Result<Vec<String>> {
        let body = json!({ "size": 10000, "_source": false, "query": { "match_all": {} } });
        let found = self
            .request(Method::POST, &format!("{}/_search", self.alias(index)))
            .json(&body)
            .send()
            .await?;
        let found = ok_json(found).await?;
        let hits = found["hits"]["hits"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        Ok(hits
            .iter()
            .filter_map(|h| h["_id"].as_str().map(String::from))
            .collect())
    }

    /// Sends the operations in one bulk request and says, per operation, whether Elastic applied it.
    /// Deleting a document that is already gone counts as applied.
    pub async fn bulk(&self, ops: &[Op]) -> Result<Vec<bool>> {
        let mut body = String::new();
        for op in ops {
            match op {
                Op::Index { index, id, doc } => {
                    body.push_str(
                        &json!({ "index": { "_index": self.alias(*index), "_id": id } })
                            .to_string(),
                    );
                    body.push('\n');
                    body.push_str(&doc.to_string());
                }
                Op::Delete { index, id } => {
                    body.push_str(
                        &json!({ "delete": { "_index": self.alias(*index), "_id": id } })
                            .to_string(),
                    );
                }
            }
            body.push('\n');
        }
        let sent = self
            .request(Method::POST, "_bulk")
            .header("Content-Type", "application/x-ndjson")
            .body(body)
            .send()
            .await?;
        let result = ok_json(sent).await?;
        let items = result["items"].as_array().cloned().unwrap_or_default();
        Ok(items
            .iter()
            .map(|item| {
                let (action, outcome) = item
                    .as_object()
                    .and_then(|o| o.iter().next())
                    .expect("bulk item has one action");
                let status = outcome["status"].as_u64().unwrap_or(500);
                let applied = status < 300 || (action == "delete" && status == 404);
                if !applied {
                    eprintln!(
                        "bulk {action} {} failed: {}",
                        outcome["_id"], outcome["error"]
                    );
                }
                applied
            })
            .collect())
    }
}

async fn ok_json(response: reqwest::Response) -> Result<Value> {
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        bail!("Elastic answered {status}: {body}");
    }
    Ok(body)
}

pub fn mapping(index: Index) -> Value {
    let keyword = json!({ "type": "keyword" });
    let long = json!({ "type": "long" });
    let date = json!({ "type": "date" });
    let text = json!({ "type": "text", "fields": { "keyword": { "type": "keyword" } } });
    let semantic = json!({ "type": "semantic_text", "inference_id": INFERENCE_ID });
    match index {
        Index::Booths => json!({ "properties": {
            "booth_id": long,
            "name": text,
            "booth_number": keyword,
            "kind": keyword,
            "tags": text,
            "zone_id": long,
            "zone_name": keyword,
            "organization_id": long,
            "org_name": text,
            "org_kind": keyword,
            "sponsor_tier": keyword,
            "description": semantic,
        }}),
        Index::Memories => json!({ "properties": {
            "kind": keyword,
            "row_id": long,
            "attendee_id": keyword,
            "other_attendee_id": keyword,
            "other_name": keyword,
            "zone_id": long,
            "zone_name": keyword,
            "booth_names": text,
            "booth_text": semantic,
            "started_at": date,
            "ended_at": date,
            "minutes": { "type": "double" },
        }}),
        Index::People => json!({ "properties": {
            "attendee_id": keyword,
            "node_id": long,
            "organization": keyword,
            "interests": semantic,
        }}),
    }
}
