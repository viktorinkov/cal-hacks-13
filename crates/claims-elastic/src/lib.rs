//! Elastic side of BandIt's insurance claims flow.
//!
//! SpacetimeDB holds every claim and decides every action. This crate keeps a
//! one-way, de-identified copy of each claim pack in the `bandit-claims` index:
//! the `bandit-claims-validate` ingest pipeline checks each evidence document on
//! the way in, and a semantic query on the narrative ranks similar past claims
//! as precedents. Only codes, amounts, zones, times and a narrative built by
//! [`narrative_for`] go in; never names or medical free text.

use std::fmt;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

mod history;
pub use history::history_claims;

/// Index holding live and historical claim documents.
pub const INDEX: &str = "bandit-claims";
/// Ingest pipeline that validates every claim document without rejecting it.
pub const PIPELINE: &str = "bandit-claims-validate";
/// Inference endpoint behind `narrative`: the project's default for
/// `semantic_text`, pinned so a change of default cannot re-map the field.
pub const INFERENCE_ID: &str = ".jina-embeddings-v5-text-small";
/// Outcomes a decided claim can carry. Open claims have an empty outcome.
pub const OUTCOMES: [&str; 3] = ["auto_settled", "approved", "refused"];

const VALIDATE_SCRIPT: &str = include_str!("validate.painless");

/// One claim pack version as copied into Elastic.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ClaimDoc {
    /// `claim-<claim_id>-v<pack_version>` for live claims ([`ClaimDoc::live_id`]),
    /// `history-NN` for seeded ones.
    pub doc_id: String,
    pub claim_id: i64,
    pub pack_version: i32,
    /// `live` or `history`.
    pub source: String,
    pub venue: String,
    /// `sos`, `fall` or `property`.
    pub incident_kind: String,
    /// `medical_payments` or `property`.
    pub cover_kind: String,
    pub zone_id: i64,
    pub zone_name: String,
    /// Epoch milliseconds.
    pub incident_at: i64,
    /// `corroborated`, `uncorroborated` or `disputed`.
    pub corroboration: String,
    /// Light-circle witnesses in the incident zone.
    pub witness_count: i32,
    /// ICD-10-CM codes.
    pub diagnosis_codes: Vec<String>,
    /// CPT or HCPCS codes.
    pub service_codes: Vec<String>,
    /// SHA-256 of the evidence record, which stays outside Elastic.
    pub record_sha256: String,
    pub billed_cents: i64,
    pub covered_cents: i64,
    pub payout_cents: i64,
    /// Empty while open, then one of [`OUTCOMES`].
    pub outcome: String,
    /// De-identified text built by [`narrative_for`].
    pub narrative: String,
}

impl ClaimDoc {
    /// Document id of a live claim pack version, for example `claim-12-v2`.
    pub fn live_id(claim_id: i64, pack_version: i32) -> String {
        format!("claim-{claim_id}-v{pack_version}")
    }
}

/// What the pipeline concluded about a stored document.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

/// A decided claim ranked by narrative meaning.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SimilarClaim {
    pub doc_id: String,
    pub claim_id: i64,
    pub source: String,
    pub incident_kind: String,
    pub zone_name: String,
    pub narrative: String,
    pub outcome: String,
    pub payout_cents: i64,
    pub score: f64,
}

/// Plain inputs for [`narrative_for`]. Every text is a code-built phrase, never
/// a name or free text typed by a person.
#[derive(Clone, Debug, Default)]
pub struct NarrativeParts<'a> {
    /// `sos`, `fall` or `property`.
    pub incident_kind: &'a str,
    pub zone_name: &'a str,
    /// Local time `HH:MM`.
    pub local_time: &'a str,
    /// Generic schedule context, for example "during a headline set".
    pub setting: Option<&'a str>,
    /// Light-circle witnesses in the same zone (not used for property).
    pub witnesses_in_zone: u32,
    /// Minutes from the incident to the first staff note.
    pub minutes_to_staff_note: Option<u32>,
    /// `(code, short description)`, for example `("S63.501A", "right wrist sprain")`.
    pub diagnoses: &'a [(&'a str, &'a str)],
    /// What was damaged, for property claims.
    pub property: Option<&'a str>,
    /// Cost text, for example "first aid only" or "repair estimate attached".
    pub cost: Option<&'a str>,
    /// A finding from the checks, for example where the witnesses actually were.
    pub finding: Option<&'a str>,
}

/// Builds the de-identified narrative stored in `narrative`, for example
/// "Fall in zone Main stage left at 22:10 during a headline set; 3 light-circle
/// witnesses in the same zone; medic note within 12 minutes; right wrist sprain
/// S63.501A; first aid only."
pub fn narrative_for(p: &NarrativeParts) -> String {
    let setting = p.setting.map(|s| format!(" {s}")).unwrap_or_default();
    let note = |who: &str| match p.minutes_to_staff_note {
        Some(1) => format!("{who} note within 1 minute"),
        Some(m) => format!("{who} note within {m} minutes"),
        None => format!("no {who} note"),
    };
    let mut parts = Vec::new();
    if p.incident_kind == "property" {
        let what = p.property.unwrap_or("equipment damaged");
        parts.push(format!("Property damage in zone {} at {}{setting}: {what}", p.zone_name, p.local_time));
        parts.push(note("staff"));
    } else {
        let head = match p.incident_kind {
            "sos" => "SOS",
            "fall" => "Fall",
            _ => "Incident",
        };
        parts.push(format!("{head} in zone {} at {}{setting}", p.zone_name, p.local_time));
        parts.push(match p.witnesses_in_zone {
            0 => "no light-circle witnesses in the same zone".to_string(),
            1 => "1 light-circle witness in the same zone".to_string(),
            n => format!("{n} light-circle witnesses in the same zone"),
        });
        parts.push(note("medic"));
        parts.push(if p.diagnoses.is_empty() {
            "no diagnosis recorded".to_string()
        } else {
            p.diagnoses.iter().map(|(code, what)| format!("{what} {code}")).collect::<Vec<_>>().join(", ")
        });
    }
    parts.extend(p.cost.map(str::to_string));
    parts.extend(p.finding.map(str::to_string));
    format!("{}.", parts.join("; "))
}

/// Client for the `bandit-claims` index. Debug output never shows the API key.
#[derive(Clone)]
pub struct ClaimsIndex {
    http: Client,
    url: String,
    auth: HeaderValue,
}

impl fmt::Debug for ClaimsIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClaimsIndex").field("url", &self.url).finish_non_exhaustive()
    }
}

impl ClaimsIndex {
    pub fn new(url: &str, api_key: &str) -> Result<Self> {
        let mut auth = HeaderValue::from_str(&format!("ApiKey {}", api_key.trim()))
            .context("ELASTICSEARCH_API_KEY is not a valid header value")?;
        auth.set_sensitive(true);
        let http = Client::builder().timeout(Duration::from_secs(120)).build()?;
        Ok(Self { http, url: url.trim().trim_end_matches('/').to_string(), auth })
    }

    /// Reads `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` from the
    /// environment, after loading a `.env` file from this or a parent directory.
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();
        let url = std::env::var("ELASTICSEARCH_URL").context("ELASTICSEARCH_URL is not set")?;
        let key = std::env::var("ELASTICSEARCH_API_KEY").context("ELASTICSEARCH_API_KEY is not set")?;
        Self::new(&url, &key)
    }

    /// Creates or updates the pipeline, and creates the index if it is missing
    /// (an existing index gets the current mapping, which only adds fields).
    pub async fn ensure_setup(&self) -> Result<()> {
        self.call(Method::PUT, &format!("_ingest/pipeline/{PIPELINE}"), Some(pipeline_body())).await?;
        let (status, _) = self.send(self.req(Method::HEAD, INDEX)).await?;
        match status {
            StatusCode::OK => {
                self.call(Method::PUT, &format!("{INDEX}/_mapping"), Some(mappings())).await?;
            }
            StatusCode::NOT_FOUND => {
                let body = json!({ "settings": { "index.default_pipeline": PIPELINE }, "mappings": mappings() });
                let (status, v) = self.send(self.req(Method::PUT, INDEX).json(&body)).await?;
                if !status.is_success() && v["error"]["type"] != "resource_already_exists_exception" {
                    bail!("PUT {INDEX} returned {status}: {}", short(&v));
                }
            }
            other => bail!("HEAD {INDEX} returned {other}"),
        }
        Ok(())
    }

    /// Indexes one claim pack version through the pipeline and returns the
    /// validation the pipeline stored on it.
    pub async fn index_claim(&self, doc: &ClaimDoc) -> Result<ValidationResult> {
        check_id(&doc.doc_id)?;
        let path = format!("{INDEX}/_doc/{}?pipeline={PIPELINE}&refresh=wait_for", doc.doc_id);
        self.call(Method::PUT, &path, Some(serde_json::to_value(doc)?)).await?;
        let got = self.call(Method::GET, &format!("{INDEX}/_doc/{}?_source_includes=validation", doc.doc_id), None).await?;
        serde_json::from_value(got["_source"]["validation"].clone()).context("stored document has no validation")
    }

    /// Decided claims whose narrative is closest in meaning to `narrative`, best
    /// first, at most one document per claim. Skips `exclude_claim_id` (pass 0
    /// to skip nothing) and every claim that is still open.
    pub async fn similar_claims(&self, narrative: &str, exclude_claim_id: i64, k: usize) -> Result<Vec<SimilarClaim>> {
        let query = json!({
            // Over-fetch so the exclusions cannot starve the vector candidates.
            "size": (k * 4).max(20),
            "query": { "bool": {
                "must": { "semantic": { "field": "narrative", "query": narrative } },
                "filter": { "exists": { "field": "outcome" } },
                "must_not": [
                    { "term": { "claim_id": exclude_claim_id } },
                    { "term": { "outcome": "" } }
                ]
            }},
            "collapse": { "field": "claim_id" },
            "_source": ["doc_id", "claim_id", "source", "incident_kind", "zone_name", "narrative", "outcome", "payout_cents"]
        });
        let v = self.call(Method::POST, &format!("{INDEX}/_search"), Some(query)).await?;
        hits(&v)
            .take(k)
            .map(|h| {
                let mut c: SimilarClaim = serde_json::from_value(h["_source"].clone())?;
                c.score = h["_score"].as_f64().unwrap_or_default();
                Ok(c)
            })
            .collect()
    }

    /// Records the decision on an indexed live claim pack version.
    pub async fn set_outcome(&self, claim_id: i64, pack_version: i32, outcome: &str, payout_cents: u64) -> Result<()> {
        if !OUTCOMES.contains(&outcome) {
            bail!("outcome {outcome:?} is not one of {OUTCOMES:?}");
        }
        let path = format!("{INDEX}/_update/{}?refresh=wait_for", ClaimDoc::live_id(claim_id, pack_version));
        let body = json!({ "doc": { "outcome": outcome, "payout_cents": payout_cents } });
        self.call(Method::POST, &path, Some(body)).await?;
        Ok(())
    }

    /// Indexes the synthetic past claims from [`history_claims`] through the
    /// pipeline (same ids every time, so re-running overwrites) and checks that
    /// every one of them passed validation. Returns how many were indexed.
    pub async fn seed_history(&self) -> Result<usize> {
        let docs = history_claims();
        let mut body = String::new();
        for d in &docs {
            body.push_str(&json!({ "index": { "_index": INDEX, "_id": d.doc_id } }).to_string());
            body.push('\n');
            body.push_str(&serde_json::to_string(d)?);
            body.push('\n');
        }
        let path = format!("_bulk?pipeline={PIPELINE}&refresh=wait_for");
        let req = self.req(Method::POST, &path).header(CONTENT_TYPE, "application/x-ndjson").body(body);
        let (status, v) = self.send(req).await?;
        if !status.is_success() || v["errors"] == true {
            let first = v["items"].as_array().and_then(|items| items.iter().find(|i| i["index"]["error"].is_object()));
            bail!("bulk seeding returned {status}: {}", short(first.unwrap_or(&v)));
        }
        let query = json!({
            "size": docs.len(),
            "_source": ["doc_id", "validation.errors"],
            "query": { "bool": { "filter": [
                { "term": { "source": "history" } },
                { "term": { "validation.valid": false } }
            ]}}
        });
        let v = self.call(Method::POST, &format!("{INDEX}/_search"), Some(query)).await?;
        let invalid: Vec<String> = hits(&v).map(|h| h["_source"].to_string()).collect();
        if !invalid.is_empty() {
            bail!("seeded history failed validation: {}", invalid.join(", "));
        }
        Ok(docs.len())
    }

    /// Deletes one document by id. Returns false when it did not exist.
    pub async fn delete_doc(&self, doc_id: &str) -> Result<bool> {
        check_id(doc_id)?;
        let (status, v) = self.send(self.req(Method::DELETE, &format!("{INDEX}/_doc/{doc_id}?refresh=wait_for"))).await?;
        match status {
            StatusCode::OK => Ok(true),
            StatusCode::NOT_FOUND => Ok(false),
            _ => bail!("DELETE {doc_id} returned {status}: {}", short(&v)),
        }
    }

    fn req(&self, method: Method, path: &str) -> RequestBuilder {
        self.http.request(method, format!("{}/{path}", self.url)).header(AUTHORIZATION, self.auth.clone())
    }

    async fn send(&self, req: RequestBuilder) -> Result<(StatusCode, Value)> {
        let resp = req.send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        Ok((status, serde_json::from_str(&text).unwrap_or(Value::String(text))))
    }

    async fn call(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        let mut req = self.req(method.clone(), path);
        if let Some(b) = &body {
            req = req.json(b);
        }
        let (status, v) = self.send(req).await.with_context(|| format!("{method} {path}"))?;
        if !status.is_success() {
            bail!("{method} {path} returned {status}: {}", short(&v));
        }
        Ok(v)
    }
}

fn pipeline_body() -> Value {
    json!({
        "description": "BandIt claims: validates each claim document and records problems in validation.*; never rejects",
        "processors": [{ "script": {
            "lang": "painless",
            "source": VALIDATE_SCRIPT,
            "params": {
                "required": ["claim_id", "pack_version", "incident_kind", "cover_kind", "incident_at", "narrative"],
                "kinds": ["sos", "fall", "property"],
                "cents": ["billed_cents", "covered_cents", "payout_cents"],
                "skew_ms": 60000
            }
        }}],
        "on_failure": [
            { "remove": { "field": "validation", "ignore_missing": true } },
            { "set": { "field": "validation.valid", "value": false } },
            { "set": { "field": "validation.errors", "value": ["pipeline_error"] } },
            { "set": { "field": "indexed_at", "value": "{{{_ingest.timestamp}}}" } }
        ]
    })
}

fn mappings() -> Value {
    let kw = json!({ "type": "keyword" });
    let long = json!({ "type": "long" });
    let int = json!({ "type": "integer" });
    let date = json!({ "type": "date" });
    json!({
        "dynamic": false,
        "properties": {
            "doc_id": kw, "claim_id": long, "pack_version": int, "source": kw, "venue": kw,
            "incident_kind": kw, "cover_kind": kw, "zone_id": long, "zone_name": kw,
            "incident_at": date, "corroboration": kw, "witness_count": int,
            "diagnosis_codes": kw, "service_codes": kw, "record_sha256": kw,
            "billed_cents": long, "covered_cents": long, "payout_cents": long, "outcome": kw,
            "narrative": { "type": "semantic_text", "inference_id": INFERENCE_ID },
            "validation": { "properties": { "valid": { "type": "boolean" }, "errors": kw } },
            "indexed_at": date
        }
    })
}

fn hits(v: &Value) -> impl Iterator<Item = &Value> {
    v["hits"]["hits"].as_array().into_iter().flatten()
}

fn check_id(id: &str) -> Result<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
        bail!("document id {id:?} must be non-empty ASCII letters, digits, '-', '_' or '.'");
    }
    Ok(())
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.len() > 600 { format!("{}...", &s[..s.floor_char_boundary(600)]) } else { s }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fall_narrative() {
        let n = narrative_for(&NarrativeParts {
            incident_kind: "fall",
            zone_name: "Main stage left",
            local_time: "22:10",
            setting: Some("during a headline set"),
            witnesses_in_zone: 3,
            minutes_to_staff_note: Some(12),
            diagnoses: &[("S63.501A", "right wrist sprain")],
            cost: Some("first aid only"),
            ..Default::default()
        });
        assert_eq!(
            n,
            "Fall in zone Main stage left at 22:10 during a headline set; 3 light-circle witnesses in the same zone; \
             medic note within 12 minutes; right wrist sprain S63.501A; first aid only."
        );
    }

    #[test]
    fn sos_and_property_narratives() {
        let sos = narrative_for(&NarrativeParts {
            incident_kind: "sos",
            zone_name: "Food court",
            local_time: "21:40",
            witnesses_in_zone: 1,
            diagnoses: &[("T67.5XXA", "heat exhaustion"), ("E86.0", "dehydration")],
            finding: Some("no second source"),
            ..Default::default()
        });
        assert_eq!(
            sos,
            "SOS in zone Food court at 21:40; 1 light-circle witness in the same zone; no medic note; \
             heat exhaustion T67.5XXA, dehydration E86.0; no second source."
        );
        let property = narrative_for(&NarrativeParts {
            incident_kind: "property",
            zone_name: "Stage B",
            local_time: "23:40",
            witnesses_in_zone: 4,
            minutes_to_staff_note: Some(1),
            property: Some("speaker knocked off its stand during load-out"),
            cost: Some("repair estimate attached"),
            ..Default::default()
        });
        assert_eq!(
            property,
            "Property damage in zone Stage B at 23:40: speaker knocked off its stand during load-out; \
             staff note within 1 minute; repair estimate attached."
        );
    }

    #[test]
    fn claim_doc_serializes_with_mapping_names() {
        let doc = ClaimDoc {
            doc_id: ClaimDoc::live_id(12, 2),
            claim_id: 12,
            pack_version: 2,
            source: "live".into(),
            incident_kind: "fall".into(),
            diagnosis_codes: vec!["S63.501A".into()],
            billed_cents: 18000,
            ..Default::default()
        };
        let v = serde_json::to_value(&doc).unwrap();
        assert_eq!(v["doc_id"], "claim-12-v2");
        assert_eq!(v["diagnosis_codes"], json!(["S63.501A"]));
        assert_eq!(v["outcome"], "");
        let mapped = mappings();
        for key in v.as_object().unwrap().keys() {
            assert!(mapped["properties"].get(key).is_some(), "{key} is not mapped");
        }
        assert_eq!(serde_json::from_value::<ClaimDoc>(v).unwrap(), doc);
        let partial: ClaimDoc = serde_json::from_value(json!({ "claim_id": 7 })).unwrap();
        assert_eq!(partial.claim_id, 7);
    }

    #[test]
    fn validation_and_similar_claim_deserialize() {
        let r: ValidationResult = serde_json::from_value(json!({ "valid": false, "errors": ["missing:narrative"] })).unwrap();
        assert_eq!(r.errors, vec!["missing:narrative"]);
        let c: SimilarClaim = serde_json::from_value(json!({ "claim_id": 3, "outcome": "approved" })).unwrap();
        assert_eq!((c.claim_id, c.score), (3, 0.0));
    }

    #[test]
    fn ids_are_checked() {
        assert!(check_id("claim-12-v2").is_ok());
        assert!(check_id("").is_err());
        assert!(check_id("a/b").is_err());
    }

    #[test]
    fn debug_hides_key() {
        let c = ClaimsIndex::new("https://example.invalid/", "secret-key").unwrap();
        assert!(!format!("{c:?}").contains("secret"));
    }
}
