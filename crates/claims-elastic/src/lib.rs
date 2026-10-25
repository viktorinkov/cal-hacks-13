//! Elastic side of BandIt's insurance claims flow.
//!
//! SpacetimeDB holds every claim and decides every action. This crate keeps a
//! one-way, de-identified copy of each claim pack in the `bandit-claims` index,
//! which the `bandit-claims-validate` ingest pipeline checks on the way in, and
//! searches the clauses of the venue's and the attendee's policies that bear on
//! a claim ([`ClaimsIndex::search_clauses`], in `clause_search.rs`). Only codes,
//! amounts, zones, times and a narrative built by [`narrative_for`] go into the
//! copy; never names or free text a person typed.

use std::fmt;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

mod clause_search;
mod clauses;
mod documents;
pub mod proposer;
pub mod reader;
pub use clause_search::{CLAUSE_SECTIONS, ClauseHit, sections_for_kind};
pub use clauses::PolicyClause;
pub use documents::StoredPage;
pub use proposer::ClaimCopy;
pub use reader::Kibana;

/// Index prefix used when `ELASTIC_INDEX_PREFIX` is not set (Maincloud).
pub const DEFAULT_PREFIX: &str = "bandit";
/// Index holding the claim copies, under the default prefix.
pub const INDEX: &str = "bandit-claims";
/// Ingest pipeline that validates every claim document without rejecting it, under the default prefix.
pub const PIPELINE: &str = "bandit-claims-validate";
/// Inference endpoint behind `narrative`: the project's default for
/// `semantic_text`, pinned so a change of default cannot re-map the field.
pub const INFERENCE_ID: &str = ".jina-embeddings-v5-text-small";
/// Outcomes a decided claim can carry. Open claims have an empty outcome.
pub const OUTCOMES: [&str; 3] = ["auto_settled", "approved", "refused"];
/// Every incident kind, and the cover that answers it: an injury from the
/// venue's medical payments cover, the venue's own broken equipment from its
/// property cover, and an attendee's own belonging, stolen or broken by
/// someone else, from the attendee's own policy (the venue's policy excludes
/// guests' property).
pub const KIND_COVERS: [(&str, &str); 5] = [
    ("sos", "medical_payments"),
    ("fall", "medical_payments"),
    ("property", "property"),
    ("theft", "personal_property"),
    ("breakage", "personal_property"),
];
/// The kinds that are a loss of property, whose copy must carry the loss staff logged.
pub const LOSS_KINDS: [&str; 3] = ["property", "theft", "breakage"];
/// The kinds that are an attendee's own belonging, whose copy must also carry the kind of item.
pub const BELONGING_KINDS: [&str; 2] = ["theft", "breakage"];
/// The kinds of item a claim copy can name, each with the words that map to it.
/// The copy carries only these generic words, never what staff typed.
pub const ITEM_KINDS: [(&str, &[&str]); 16] = [
    ("laptop", &["laptop", "laptops", "macbook", "chromebook"]),
    ("phone", &["phone", "phones", "iphone", "smartphone", "cellphone"]),
    ("tablet", &["tablet", "ipad"]),
    ("headphones", &["headphones", "earbuds", "airpods", "headset"]),
    ("camera", &["camera", "cameras", "gopro"]),
    ("watch", &["watch", "smartwatch"]),
    ("bag", &["bag", "backpack", "purse", "handbag", "tote"]),
    ("wallet", &["wallet", "cardholder"]),
    ("keys", &["keys", "keyring"]),
    ("glasses", &["glasses", "sunglasses", "eyeglasses"]),
    ("jacket", &["jacket", "coat", "hoodie", "sweater"]),
    ("charger", &["charger", "cable", "powerbank"]),
    ("speaker", &["speaker", "speakers", "subwoofer", "amp", "amplifier"]),
    ("screen", &["screen", "monitor", "display", "tv", "projector"]),
    ("light", &["light", "lights", "lamp", "spotlight"]),
    ("merch", &["merch", "merchandise", "swag"]),
];

/// The kind of item a staff description names, from [`ITEM_KINDS`]: the first
/// word that maps to one wins; `other` when none does; empty when there is no
/// description. Only the generic word leaves this function.
pub fn item_kind_of(description: &str) -> &'static str {
    let words: Vec<String> = description.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect();
    if words.is_empty() {
        return "";
    }
    words
        .iter()
        .find_map(|w| ITEM_KINDS.iter().find(|(_, names)| names.contains(&w.as_str())).map(|(kind, _)| *kind))
        .unwrap_or("other")
}

const VALIDATE_SCRIPT: &str = include_str!("validate.painless");

/// One claim pack version as copied into Elastic.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ClaimDoc {
    /// `claim-<claim_id>-v<pack_version>` ([`ClaimDoc::live_id`]).
    pub doc_id: String,
    pub claim_id: i64,
    pub pack_version: i32,
    /// Always `live`: every copy is a claim of this event.
    pub source: String,
    pub venue: String,
    /// One of [`KIND_COVERS`]: `sos`, `fall`, `property`, `theft` or `breakage`.
    pub incident_kind: String,
    /// `medical_payments`, `property` or `personal_property`.
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
    /// The loss staff logged for a property, theft or breakage claim: the
    /// repair cost or the item's value. 0 for an injury.
    pub cost_cents: i64,
    /// The kind of item broken or stolen, one of [`ITEM_KINDS`] or `other`;
    /// empty for an injury.
    pub item_kind: String,
    /// Security named the person who broke or took it, at the spot.
    pub responsible_named: bool,
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

/// Plain inputs for [`narrative_for`]. Every text is a code-built phrase, never
/// a name or free text typed by a person.
#[derive(Clone, Debug, Default)]
pub struct NarrativeParts<'a> {
    /// `sos`, `fall`, `property`, `theft` or `breakage`.
    pub incident_kind: &'a str,
    pub zone_name: &'a str,
    /// Local time `HH:MM`.
    pub local_time: &'a str,
    /// Generic schedule context, for example "during a headline set".
    pub setting: Option<&'a str>,
    /// Light-circle witnesses in the same zone (injuries only).
    pub witnesses_in_zone: u32,
    /// Minutes from the incident to the first staff note.
    pub minutes_to_staff_note: Option<u32>,
    /// `(code, short description)`, for example `("S63.501A", "right wrist sprain")` (injuries only).
    pub diagnoses: &'a [(&'a str, &'a str)],
    /// The kind of item broken or stolen, from [`item_kind_of`]; a generic word when empty or `other`.
    pub item: Option<&'a str>,
    /// The loss staff logged for a property, theft or breakage claim, in cents.
    pub loss_cents: Option<u64>,
    /// Security named the person who broke or took it, at the spot (every kind but an injury).
    pub responsible_named: bool,
    /// Cost text, for example "first aid only" or "repair estimate attached".
    pub cost: Option<&'a str>,
    /// A finding from the checks, for example where the witnesses actually were.
    pub finding: Option<&'a str>,
}

/// Builds the de-identified narrative stored in `narrative`, one template per
/// incident kind, for example:
///
/// - "Fall in zone Main stage left at 22:10 during a headline set; 3
///   light-circle witnesses in the same zone; medic note within 12 minutes;
///   right wrist sprain S63.501A; first aid only."
/// - "Theft in zone Hacking floor at 21:10: an attendee's own laptop stolen;
///   staff note within 4 minutes; value $1,199.00 logged by staff; a person
///   named at the spot."
///
/// The narrative is also the query text of the policy clause search, so each
/// template uses the words a policy uses for that kind of loss.
pub fn narrative_for(p: &NarrativeParts) -> String {
    let setting = p.setting.map(|s| format!(" {s}")).unwrap_or_default();
    let at = format!("in zone {} at {}{setting}", p.zone_name, p.local_time);
    let note = |who: &str| match p.minutes_to_staff_note {
        Some(1) => format!("{who} note within 1 minute"),
        Some(m) => format!("{who} note within {m} minutes"),
        None => format!("no {who} note"),
    };
    let item = |generic: &'static str| match p.item.map(str::trim) {
        Some("") | Some("other") | None => generic,
        Some(kind) => kind,
    };
    let loss = |label: &str| match p.loss_cents {
        Some(c) if c > 0 => format!("{label} {} logged by staff", dollars(c)),
        _ => "no cost logged".to_string(),
    };
    let named = if p.responsible_named { "a person named at the spot" } else { "no one named" }.to_string();
    let mut parts = Vec::new();
    match p.incident_kind {
        "property" => {
            parts.push(format!("Property damage {at}: the venue's {} broken", item("equipment")));
            parts.extend([note("staff"), loss("repair cost"), named]);
        }
        "theft" => {
            parts.push(format!("Theft {at}: an attendee's own {} stolen", item("belonging")));
            parts.extend([note("staff"), loss("value"), named]);
        }
        "breakage" => {
            parts.push(format!("Breakage {at}: an attendee's own {} broken by another person", item("belonging")));
            parts.extend([note("staff"), loss("value"), named]);
        }
        kind => {
            let head = match kind {
                "sos" => "SOS",
                "fall" => "Fall",
                _ => "Incident",
            };
            parts.push(format!("{head} {at}"));
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
    }
    parts.extend(p.cost.map(str::to_string));
    parts.extend(p.finding.map(str::to_string));
    format!("{}.", parts.join("; "))
}

/// `$1,199.00` from 119900.
fn dollars(cents: u64) -> String {
    let whole = (cents / 100).to_string();
    let mut grouped = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(c);
    }
    format!("${grouped}.{:02}", cents % 100)
}

/// Client for the `<prefix>-claims` index and the insurance document indices.
/// Debug output never shows the API key.
#[derive(Clone)]
pub struct ClaimsIndex {
    http: Client,
    url: String,
    auth: HeaderValue,
    prefix: String,
    index: String,
    pipeline: String,
}

impl fmt::Debug for ClaimsIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClaimsIndex").field("url", &self.url).field("index", &self.index).finish_non_exhaustive()
    }
}

impl ClaimsIndex {
    pub fn new(url: &str, api_key: &str) -> Result<Self> {
        let mut auth = HeaderValue::from_str(&format!("ApiKey {}", api_key.trim()))
            .context("ELASTICSEARCH_API_KEY is not a valid header value")?;
        auth.set_sensitive(true);
        let http = Client::builder().timeout(Duration::from_secs(120)).build()?;
        let url = url.trim().trim_end_matches('/').to_string();
        Ok(Self { http, url, auth, prefix: DEFAULT_PREFIX.into(), index: INDEX.into(), pipeline: PIPELINE.into() }.with_prefix(DEFAULT_PREFIX))
    }

    /// Uses `<prefix>-claims`, `<prefix>-claims-validate` and
    /// `<prefix>-policy-clauses`, so a local run (`bandit-e2e`) never mixes its
    /// claims or clauses into the live indices. The document indices take the same prefix.
    pub fn with_prefix(mut self, prefix: &str) -> Self {
        let prefix = prefix.trim().trim_end_matches('-');
        self.prefix = prefix.to_string();
        self.index = format!("{prefix}-claims");
        self.pipeline = format!("{prefix}-claims-validate");
        self
    }

    pub fn index(&self) -> &str {
        &self.index
    }

    /// Reads `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` from the
    /// environment, after loading a `.env` file from this or a parent directory.
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok();
        let url = std::env::var("ELASTICSEARCH_URL").context("ELASTICSEARCH_URL is not set")?;
        let key = std::env::var("ELASTICSEARCH_API_KEY").context("ELASTICSEARCH_API_KEY is not set")?;
        let prefix = std::env::var("ELASTIC_INDEX_PREFIX").ok().filter(|p| !p.trim().is_empty());
        Ok(Self::new(&url, &key)?.with_prefix(prefix.as_deref().unwrap_or(DEFAULT_PREFIX)))
    }

    /// Creates or updates the pipeline, and creates the index if it is missing.
    /// An existing index gets the current mapping, which only adds fields, and
    /// loses the past claims an earlier build seeded into it.
    pub async fn ensure_setup(&self) -> Result<()> {
        self.call(Method::PUT, &format!("_ingest/pipeline/{}", self.pipeline), Some(pipeline_body())).await?;
        let body = json!({ "settings": { "index.default_pipeline": self.pipeline }, "mappings": mappings() });
        if !self.ensure_index(&self.index, body).await? {
            self.delete_past_claims().await?;
        }
        Ok(())
    }

    /// Creates `index` from `body` if it is missing, else puts `body`'s mappings
    /// on it (which only adds fields). True when it was created.
    async fn ensure_index(&self, index: &str, body: Value) -> Result<bool> {
        let (status, _) = self.send(self.req(Method::HEAD, index)).await?;
        match status {
            StatusCode::OK => {
                self.call(Method::PUT, &format!("{index}/_mapping"), Some(body["mappings"].clone())).await?;
                Ok(false)
            }
            StatusCode::NOT_FOUND => {
                let (status, v) = self.send(self.req(Method::PUT, index).json(&body)).await?;
                if !status.is_success() && v["error"]["type"] != "resource_already_exists_exception" {
                    bail!("PUT {index} returned {status}: {}", short(&v));
                }
                Ok(true)
            }
            other => bail!("HEAD {index} returned {other}"),
        }
    }

    /// Sends `_bulk` index actions, one `(index, id, document)` each, and fails on the first rejected item.
    async fn bulk(&self, query: &str, docs: impl IntoIterator<Item = (String, String, Value)>) -> Result<()> {
        let mut body = String::new();
        for (index, id, doc) in docs {
            body.push_str(&json!({ "index": { "_index": index, "_id": id } }).to_string());
            body.push('\n');
            body.push_str(&doc.to_string());
            body.push('\n');
        }
        let req = self.req(Method::POST, &format!("_bulk?{query}")).header(CONTENT_TYPE, "application/x-ndjson").body(body);
        let (status, v) = self.send(req).await?;
        if !status.is_success() || v["errors"] == true {
            let first = v["items"].as_array().and_then(|items| items.iter().find(|i| i["index"]["error"].is_object()));
            bail!("bulk indexing returned {status}: {}", short(first.unwrap_or(&v)));
        }
        Ok(())
    }

    /// Indexes one claim pack version through the pipeline and returns the
    /// validation the pipeline stored on it.
    pub async fn index_claim(&self, doc: &ClaimDoc) -> Result<ValidationResult> {
        check_id(&doc.doc_id)?;
        let path = format!("{}/_doc/{}?pipeline={}&refresh=wait_for", self.index, doc.doc_id, self.pipeline);
        self.call(Method::PUT, &path, Some(serde_json::to_value(doc)?)).await?;
        let got = self.call(Method::GET, &format!("{}/_doc/{}?_source_includes=validation", self.index, doc.doc_id), None).await?;
        serde_json::from_value(got["_source"]["validation"].clone()).context("stored document has no validation")
    }

    /// Records the decision on an indexed live claim pack version.
    pub async fn set_outcome(&self, claim_id: i64, pack_version: i32, outcome: &str, payout_cents: u64) -> Result<()> {
        if !OUTCOMES.contains(&outcome) {
            bail!("outcome {outcome:?} is not one of {OUTCOMES:?}");
        }
        let path = format!("{}/_update/{}?refresh=wait_for", self.index, ClaimDoc::live_id(claim_id, pack_version));
        let body = json!({ "doc": { "outcome": outcome, "payout_cents": payout_cents } });
        self.call(Method::POST, &path, Some(body)).await?;
        Ok(())
    }

    /// Deletes the synthetic past claims (`source` `history`) an earlier build
    /// seeded: claims are matched to the policy clauses now, never to past
    /// claims. Returns how many were deleted; 0 once they are gone.
    pub async fn delete_past_claims(&self) -> Result<u64> {
        let path = format!("{}/_delete_by_query?refresh=true&conflicts=proceed", self.index);
        let v = self.call(Method::POST, &path, Some(json!({ "query": { "term": { "source": "history" } } }))).await?;
        Ok(v["deleted"].as_u64().unwrap_or(0))
    }

    /// Deletes one document by id. Returns false when it did not exist.
    pub async fn delete_doc(&self, doc_id: &str) -> Result<bool> {
        check_id(doc_id)?;
        let (status, v) = self.send(self.req(Method::DELETE, &format!("{}/_doc/{doc_id}?refresh=wait_for", self.index))).await?;
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
    let covers: serde_json::Map<String, Value> = KIND_COVERS.iter().map(|(k, c)| (k.to_string(), json!(c))).collect();
    json!({
        "description": "BandIt claims: validates each claim document and records problems in validation.*; never rejects",
        "processors": [{ "script": {
            "lang": "painless",
            "source": VALIDATE_SCRIPT,
            "params": {
                "required": ["claim_id", "pack_version", "incident_kind", "cover_kind", "incident_at", "narrative"],
                "covers": covers,
                "losses": LOSS_KINDS,
                "needs_item": BELONGING_KINDS,
                "cents": ["billed_cents", "covered_cents", "payout_cents", "cost_cents"],
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
            "billed_cents": long, "covered_cents": long, "payout_cents": long,
            "cost_cents": long, "item_kind": kw, "responsible_named": { "type": "boolean" }, "outcome": kw,
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
            item: Some("speaker"),
            loss_cents: Some(240_000),
            ..Default::default()
        });
        assert_eq!(
            property,
            "Property damage in zone Stage B at 23:40: the venue's speaker broken; \
             staff note within 1 minute; repair cost $2,400.00 logged by staff; no one named."
        );
    }

    #[test]
    fn theft_and_breakage_narratives() {
        let theft = narrative_for(&NarrativeParts {
            incident_kind: "theft",
            zone_name: "Hacking floor",
            local_time: "21:10",
            minutes_to_staff_note: Some(4),
            item: Some("laptop"),
            loss_cents: Some(119_900),
            responsible_named: true,
            ..Default::default()
        });
        assert_eq!(
            theft,
            "Theft in zone Hacking floor at 21:10: an attendee's own laptop stolen; staff note within 4 minutes; \
             value $1,199.00 logged by staff; a person named at the spot."
        );
        let breakage = narrative_for(&NarrativeParts {
            incident_kind: "breakage",
            zone_name: "Food court",
            local_time: "02:30",
            item: Some("other"),
            loss_cents: Some(85_000),
            finding: Some("no second source"),
            ..Default::default()
        });
        assert_eq!(
            breakage,
            "Breakage in zone Food court at 02:30: an attendee's own belonging broken by another person; \
             no staff note; value $850.00 logged by staff; no one named; no second source."
        );
        let unpriced = narrative_for(&NarrativeParts { incident_kind: "theft", zone_name: "Gate", local_time: "20:00", ..Default::default() });
        assert!(unpriced.contains("own belonging stolen; no staff note; no cost logged; "), "{unpriced}");
    }

    #[test]
    fn item_kinds_are_generic_words() {
        assert_eq!(item_kind_of("Dana's MacBook Pro taken from table 4"), "laptop");
        assert_eq!(item_kind_of("cracked iPhone screen, dropped by another guest"), "phone");
        assert_eq!(item_kind_of("speaker knocked off its stand"), "speaker");
        assert_eq!(item_kind_of("a blue thing with stickers"), "other");
        assert_eq!(item_kind_of("  "), "");
        for (kind, words) in ITEM_KINDS {
            assert!(words.iter().all(|w| w.chars().all(|c| c.is_ascii_lowercase())), "{kind}");
        }
    }

    #[test]
    fn dollars_group_thousands() {
        assert_eq!(dollars(0), "$0.00");
        assert_eq!(dollars(9_905), "$99.05");
        assert_eq!(dollars(119_900), "$1,199.00");
        assert_eq!(dollars(123_456_789), "$1,234,567.89");
    }

    #[test]
    fn every_kind_has_its_cover_and_the_pipeline_knows_them() {
        let params = &pipeline_body()["processors"][0]["script"]["params"];
        for (kind, cover) in KIND_COVERS {
            assert_eq!(params["covers"][kind], cover);
        }
        assert_eq!(params["losses"], json!(["property", "theft", "breakage"]));
        assert_eq!(params["needs_item"], json!(["theft", "breakage"]));
        assert_eq!((params["covers"]["theft"].clone(), params["covers"]["breakage"].clone()), (json!("personal_property"), json!("personal_property")));
        assert!(params["cents"].as_array().unwrap().contains(&json!("cost_cents")));
    }

    #[test]
    fn claim_doc_serializes_with_mapping_names() {
        let doc = ClaimDoc {
            doc_id: ClaimDoc::live_id(12, 2),
            claim_id: 12,
            pack_version: 2,
            source: "live".into(),
            incident_kind: "theft".into(),
            diagnosis_codes: vec!["S63.501A".into()],
            billed_cents: 18000,
            cost_cents: 119_900,
            item_kind: "laptop".into(),
            responsible_named: true,
            ..Default::default()
        };
        let v = serde_json::to_value(&doc).unwrap();
        assert_eq!(v["doc_id"], "claim-12-v2");
        assert_eq!(v["diagnosis_codes"], json!(["S63.501A"]));
        assert_eq!((v["cost_cents"].clone(), v["responsible_named"].clone()), (json!(119_900), json!(true)));
        assert_eq!(v["outcome"], "");
        let mapped = mappings();
        for key in v.as_object().unwrap().keys() {
            assert!(mapped["properties"].get(key).is_some(), "{key} is not mapped");
        }
        assert_eq!(serde_json::from_value::<ClaimDoc>(v).unwrap(), doc);
        let partial: ClaimDoc = serde_json::from_value(json!({ "claim_id": 7 })).unwrap();
        assert_eq!((partial.claim_id, partial.cost_cents, partial.responsible_named), (7, 0, false));
    }

    #[test]
    fn validation_deserializes() {
        let r: ValidationResult = serde_json::from_value(json!({ "valid": false, "errors": ["missing:narrative"] })).unwrap();
        assert_eq!(r.errors, vec!["missing:narrative"]);
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
