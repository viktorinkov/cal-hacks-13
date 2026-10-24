use crate::config::Config;
use anyhow::{Context, Result, bail};
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::{Method, StatusCode};
use serde_json::{Value, json};
use std::sync::OnceLock;
use std::time::Duration;

pub const PIPELINE_EVENTS: &str = "bandit-pipeline-events";

fn http() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| Client::builder().timeout(Duration::from_secs(300)).build().expect("building the HTTP client"))
}

fn es_request(cfg: &Config, method: Method, path: &str) -> RequestBuilder {
    http()
        .request(method, format!("{}{path}", cfg.elastic_url))
        .header("Authorization", format!("ApiKey {}", cfg.elastic_key))
}

fn kibana_request(cfg: &Config, method: Method, path: &str) -> RequestBuilder {
    http()
        .request(method, format!("{}{path}", cfg.kibana_url))
        .header("Authorization", format!("ApiKey {}", cfg.kibana_key))
        .header("kbn-xsrf", "true")
}

fn send(req: RequestBuilder, body: Option<&Value>, what: &str) -> Result<Value> {
    let req = match body {
        Some(b) => req.json(b),
        None => req,
    };
    let resp = req.send().with_context(|| format!("{what}: request failed"))?;
    let status = resp.status();
    let text = resp.text()?;
    if !status.is_success() {
        bail!("{what} returned {status}: {text}");
    }
    if text.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).with_context(|| format!("{what} returned non-JSON"))
}

fn exists(req: RequestBuilder, what: &str) -> Result<bool> {
    let status = req.send().with_context(|| format!("{what}: request failed"))?.status();
    match status {
        StatusCode::NOT_FOUND => Ok(false),
        s if s.is_success() => Ok(true),
        s => bail!("{what} returned {s}"),
    }
}

pub fn es(cfg: &Config, method: Method, path: &str, body: Option<&Value>) -> Result<Value> {
    let what = format!("Elasticsearch {method} {path}");
    send(es_request(cfg, method, path), body, &what)
}

pub fn kibana(cfg: &Config, method: Method, path: &str, body: Option<&Value>) -> Result<Value> {
    let what = format!("Kibana {method} {path}");
    send(kibana_request(cfg, method, path), body, &what)
}

pub fn es_exists(cfg: &Config, path: &str) -> Result<bool> {
    exists(es_request(cfg, Method::HEAD, path), &format!("Elasticsearch HEAD {path}"))
}

pub fn kibana_exists(cfg: &Config, path: &str) -> Result<bool> {
    exists(kibana_request(cfg, Method::GET, path), &format!("Kibana GET {path}"))
}

pub fn bulk_index(cfg: &Config, docs: &[(String, String, Value)]) -> Result<usize> {
    let mut body = String::new();
    for (index, id, doc) in docs {
        body.push_str(&json!({ "index": { "_index": index, "_id": id } }).to_string());
        body.push('\n');
        body.push_str(&doc.to_string());
        body.push('\n');
    }
    let req = es_request(cfg, Method::POST, "/_bulk?refresh=wait_for")
        .header("Content-Type", "application/x-ndjson")
        .body(body);
    let out = send(req, None, "Elasticsearch bulk")?;
    if out["errors"].as_bool() == Some(true) {
        let items = out["items"].as_array().cloned().unwrap_or_default();
        let failed: Vec<&Value> = items.iter().filter(|i| i["index"]["error"].is_object()).collect();
        bail!("bulk indexing failed for {} documents, first: {}", failed.len(), failed[0]["index"]);
    }
    Ok(docs.len())
}

pub fn delete_run(cfg: &Config, indices: &str, run_id: &str) -> Result<u64> {
    let query = json!({ "query": { "term": { "run_id": run_id } } });
    let out = es(cfg, Method::POST, &format!("/{indices}/_delete_by_query?refresh=true"), Some(&query))?;
    Ok(out["deleted"].as_u64().unwrap_or(0))
}

pub fn search(cfg: &Config, index: &str, body: &Value) -> Result<Value> {
    es(cfg, Method::POST, &format!("/{index}/_search"), Some(body))
}

pub fn esql(cfg: &Config, query: &str, params: Value) -> Result<Value> {
    es(cfg, Method::POST, "/_query", Some(&json!({ "query": query, "params": params })))
}

pub fn log_event(cfg: &Config, run_id: &str, stage: &str, duration_ms: u64, counts: Value, note: &str) -> Result<()> {
    let doc = json!({
        "run_id": run_id,
        "stage": stage,
        "at": chrono::Utc::now().to_rfc3339(),
        "duration_ms": duration_ms,
        "counts": counts,
        "note": note,
    });
    es(cfg, Method::POST, &format!("/{PIPELINE_EVENTS}/_doc"), Some(&doc)).map(|_| ())
}
