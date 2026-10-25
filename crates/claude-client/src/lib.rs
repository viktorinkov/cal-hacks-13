//! Minimal client for the Claude Messages API. This is the only code in BandIt that calls Claude.
//!
//! Non-streaming `POST /v1/messages` with API version `2026-10-21`: a user turn made of
//! text, PDF and image blocks, optional effort and JSON-schema structured output, strict
//! client tools with an append-only tool loop ([`MessageRequest::next_turn`]), retries with
//! backoff, and a stable request hash for audit records. No sampling parameters.

use std::collections::hash_map::RandomState;
use std::fmt;
use std::hash::BuildHasher;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use reqwest::header::HeaderValue;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

/// Value of the `anthropic-version` header.
pub const API_VERSION: &str = "2026-10-21";
/// Model used when neither the request, the client nor `ANTHROPIC_MODEL` names one.
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
/// Production API base URL.
pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
/// Beta header that enables the server-side refusal fallback `fallbacks: "default"`.
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// Default `max_tokens`. Thinking counts toward it, so leave room beyond the answer.
pub const DEFAULT_MAX_TOKENS: u32 = 16_000;
/// Per-attempt HTTP timeout.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(600);

const MAX_TRIES: u32 = 3;
const BACKOFF_START: Duration = Duration::from_secs(1);
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);

/// `output_config.effort`: how much the model thinks (Claude Opus 5.5 defaults to `medium`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effort {
    Low,
    Medium,
    High,
}

impl Effort {
    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
        }
    }
}

/// Image formats accepted by [`MessageRequest::image`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageType {
    Jpeg,
    Png,
}

impl ImageType {
    pub fn media_type(self) -> &'static str {
        match self {
            ImageType::Jpeg => "image/jpeg",
            ImageType::Png => "image/png",
        }
    }
}

/// A single-turn Messages request. Blocks are sent in the order they are added;
/// put documents and images before the text that refers to them.
#[derive(Clone)]
pub struct MessageRequest {
    model: Option<String>,
    system: Option<String>,
    /// Earlier turns of a tool loop, sent before `content`.
    history: Vec<Value>,
    /// The current user turn.
    content: Vec<Value>,
    tools: Vec<Value>,
    tool_choice: Option<Value>,
    max_tokens: u32,
    effort: Option<Effort>,
    schema: Option<Value>,
    fallback: bool,
}

impl Default for MessageRequest {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for MessageRequest {
    // Content is left out on purpose: it can hold whole medical PDFs.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MessageRequest")
            .field("model", &self.model)
            .field("turns", &(self.history.len() + 1))
            .field("blocks", &self.content.len())
            .field("tools", &self.tools.len())
            .field("max_tokens", &self.max_tokens)
            .field("effort", &self.effort)
            .field("json_schema", &self.schema.is_some())
            .field("refusal_fallback", &self.fallback)
            .finish()
    }
}

impl MessageRequest {
    /// Empty request with `max_tokens = DEFAULT_MAX_TOKENS`.
    pub fn new() -> Self {
        Self {
            model: None,
            system: None,
            history: Vec::new(),
            content: Vec::new(),
            tools: Vec::new(),
            tool_choice: None,
            max_tokens: DEFAULT_MAX_TOKENS,
            effort: None,
            schema: None,
            fallback: false,
        }
    }

    /// Override the client's model for this request.
    pub fn model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    /// System prompt text.
    pub fn system(mut self, text: impl Into<String>) -> Self {
        self.system = Some(text.into());
        self
    }

    /// Append a text block to the user turn.
    pub fn text(mut self, text: impl Into<String>) -> Self {
        self.content
            .push(json!({"type": "text", "text": text.into()}));
        self
    }

    /// Append a PDF document block (raw bytes; base64-encoded here).
    pub fn pdf(self, bytes: impl AsRef<[u8]>) -> Self {
        self.base64_block("document", "application/pdf", bytes.as_ref())
    }

    /// Append a JPEG or PNG image block (raw bytes; base64-encoded here).
    pub fn image(self, kind: ImageType, bytes: impl AsRef<[u8]>) -> Self {
        self.base64_block("image", kind.media_type(), bytes.as_ref())
    }

    pub fn max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    pub fn effort(mut self, effort: Effort) -> Self {
        self.effort = Some(effort);
        self
    }

    /// Request structured output: `output_config.format = {type: "json_schema", schema}`.
    /// Every object in the schema needs `additionalProperties: false`.
    pub fn json_schema(mut self, schema: Value) -> Self {
        self.schema = Some(schema);
        self
    }

    /// Send `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta, so a
    /// safety-classifier refusal is re-run server-side on Anthropic's recommended model.
    /// Claude API and Claude Platform on AWS only.
    pub fn refusal_fallback(mut self, enabled: bool) -> Self {
        self.fallback = enabled;
        self
    }

    /// Add a strict client tool: Claude's `tool_use` input always validates against `input_schema`
    /// (every object needs `additionalProperties: false` and `required`).
    pub fn tool(mut self, name: &str, description: &str, input_schema: Value) -> Self {
        self.tools.push(json!({
            "name": name,
            "description": description,
            "input_schema": input_schema,
            "strict": true,
        }));
        self
    }

    /// `tool_choice: {type: "none"}`: Claude must answer without calling a tool.
    /// (Claude Opus 5.5 rejects the forced `any` and `tool` choices.)
    pub fn tool_choice_none(mut self) -> Self {
        self.tool_choice = Some(json!({"type": "none"}));
        self
    }

    /// The next request of a tool loop: the current user turn and Claude's answer
    /// (`content`, every block unchanged, thinking included) move into the history,
    /// and a new empty user turn starts for the tool results. History is only ever appended to.
    pub fn next_turn(mut self, assistant_content: &[Value]) -> Self {
        let user = std::mem::take(&mut self.content);
        self.history.push(json!({"role": "user", "content": user}));
        self.history.push(json!({"role": "assistant", "content": assistant_content}));
        self
    }

    /// Append a `tool_result` block to the user turn.
    pub fn tool_result(mut self, tool_use_id: &str, text: impl Into<String>, is_error: bool) -> Self {
        let mut block = json!({"type": "tool_result", "tool_use_id": tool_use_id, "content": text.into()});
        if is_error {
            block["is_error"] = json!(true);
        }
        self.content.push(block);
        self
    }

    /// Whether a JSON schema was requested.
    pub fn wants_json(&self) -> bool {
        self.schema.is_some()
    }

    /// The JSON body sent to the API, using `default_model` unless the request sets one.
    pub fn body(&self, default_model: &str) -> Value {
        let mut body = Map::new();
        let model = self.model.as_deref().unwrap_or(default_model);
        body.insert("model".into(), json!(model));
        body.insert("max_tokens".into(), json!(self.max_tokens));
        if let Some(system) = &self.system {
            body.insert("system".into(), json!(system));
        }
        let mut messages = self.history.clone();
        messages.push(json!({"role": "user", "content": self.content}));
        body.insert("messages".into(), Value::Array(messages));
        if !self.tools.is_empty() {
            body.insert("tools".into(), json!(self.tools));
        }
        if let Some(choice) = &self.tool_choice {
            body.insert("tool_choice".into(), choice.clone());
        }
        let mut output = Map::new();
        if let Some(effort) = self.effort {
            output.insert("effort".into(), json!(effort.as_str()));
        }
        if let Some(schema) = &self.schema {
            output.insert(
                "format".into(),
                json!({"type": "json_schema", "schema": schema}),
            );
        }
        if !output.is_empty() {
            body.insert("output_config".into(), Value::Object(output));
        }
        if self.fallback {
            body.insert("fallbacks".into(), json!("default"));
        }
        Value::Object(body)
    }

    fn base64_block(mut self, kind: &str, media_type: &str, bytes: &[u8]) -> Self {
        let source =
            json!({"type": "base64", "media_type": media_type, "data": BASE64.encode(bytes)});
        self.content.push(json!({"type": kind, "source": source}));
        self
    }
}

/// Lowercase hex SHA-256 of `body` serialized with sorted keys, after every base64
/// `data` field (in a `{"type": "base64", ...}` source) is replaced by the hex SHA-256
/// of its decoded bytes.
pub fn request_hash(body: &Value) -> String {
    let mut body = body.clone();
    hash_base64_data(&mut body);
    let mut canonical = String::new();
    write_canonical(&body, &mut canonical);
    sha256_hex(canonical.as_bytes())
}

fn hash_base64_data(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("base64")
                && let Some(Value::String(data)) = map.get_mut("data")
            {
                let bytes = BASE64
                    .decode(data.as_bytes())
                    .unwrap_or_else(|_| data.as_bytes().to_vec());
                *data = sha256_hex(&bytes);
            }
            map.values_mut().for_each(hash_base64_data);
        }
        Value::Array(items) => items.iter_mut().for_each(hash_base64_data),
        _ => {}
    }
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                write_canonical(&map[key], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// A `tool_use` block from Claude's answer.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// Result of a successful call.
#[derive(Debug, Clone, PartialEq)]
pub struct CallOutcome {
    /// Concatenated text of all `text` blocks.
    pub text: String,
    /// Parsed JSON when a schema was requested and Claude answered rather than called a tool.
    pub json: Option<Value>,
    /// Every content block as returned, for [`MessageRequest::next_turn`].
    pub content: Vec<Value>,
    /// The tools Claude called, in order.
    pub tool_uses: Vec<ToolUse>,
    pub stop_reason: Option<String>,
    /// Model that produced the message (differs from the requested one after a fallback).
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Latency of the HTTP attempt that produced the response.
    pub latency_ms: u64,
    /// HTTP attempts made, including retries.
    pub attempts: u32,
    /// See [`request_hash`].
    pub request_hash: String,
}

impl CallOutcome {
    /// Deserialize the structured output into `T`.
    pub fn typed<T: DeserializeOwned>(&self) -> Result<T, ClaudeError> {
        let json = self.json.as_ref().ok_or_else(|| {
            ClaudeError::UnexpectedResponse(
                "no structured output: the request had no JSON schema".into(),
            )
        })?;
        T::deserialize(json).map_err(|e| ClaudeError::InvalidJson {
            message: e.to_string(),
            outcome: Box::new(self.clone()),
        })
    }
}

/// Errors from [`ClaudeClient`].
#[derive(Debug, thiserror::Error)]
pub enum ClaudeError {
    #[error("ANTHROPIC_API_KEY is missing, empty or not a valid header value")]
    MissingApiKey,
    /// Non-success HTTP status (after retries for retryable ones).
    #[error("Claude API returned HTTP {status}: {body}")]
    Http { status: u16, body: String },
    #[error("Claude API request timed out")]
    Timeout,
    #[error("could not reach the Claude API: {0}")]
    Connection(String),
    /// `stop_reason: "refusal"`. `outcome` keeps model, usage and hash for the call record.
    #[error("Claude refused the request (category: {})", category.as_deref().unwrap_or("none"))]
    Refused {
        category: Option<String>,
        explanation: Option<String>,
        outcome: Box<CallOutcome>,
    },
    /// A schema was requested but the text is not valid JSON (or does not match the type).
    #[error("structured output is not valid: {message}")]
    InvalidJson {
        message: String,
        outcome: Box<CallOutcome>,
    },
    #[error("unexpected response from the Claude API: {0}")]
    UnexpectedResponse(String),
}

impl ClaudeError {
    /// The completed call behind this error, if the API answered (for recording usage).
    pub fn outcome(&self) -> Option<&CallOutcome> {
        match self {
            ClaudeError::Refused { outcome, .. } | ClaudeError::InvalidJson { outcome, .. } => {
                Some(outcome)
            }
            _ => None,
        }
    }
}

/// Claude Messages API client. Cheap to clone.
#[derive(Clone)]
pub struct ClaudeClient {
    http: reqwest::Client,
    api_key: HeaderValue,
    base_url: String,
    model: String,
    timeout: Duration,
}

impl fmt::Debug for ClaudeClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ClaudeClient")
            .field("api_key", &"<redacted>")
            .field("base_url", &self.base_url)
            .field("model", &self.model)
            .field("timeout", &self.timeout)
            .finish()
    }
}

impl ClaudeClient {
    /// Client with an explicit key. The model comes from `ANTHROPIC_MODEL`, else [`DEFAULT_MODEL`].
    pub fn new(api_key: impl Into<String>) -> Result<Self, ClaudeError> {
        Self::build(api_key.into(), |k| std::env::var(k).ok())
    }

    /// Client from `ANTHROPIC_API_KEY` (required) and `ANTHROPIC_MODEL` (optional).
    pub fn from_env() -> Result<Self, ClaudeError> {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ClaudeError> {
        Self::build(get("ANTHROPIC_API_KEY").unwrap_or_default(), get)
    }

    fn build(api_key: String, get: impl Fn(&str) -> Option<String>) -> Result<Self, ClaudeError> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(ClaudeError::MissingApiKey);
        }
        let mut api_key = HeaderValue::from_str(api_key).map_err(|_| ClaudeError::MissingApiKey)?;
        api_key.set_sensitive(true);
        let model = get("ANTHROPIC_MODEL")
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| DEFAULT_MODEL.to_string());
        let http = reqwest::Client::builder()
            .build()
            .map_err(|e| ClaudeError::Connection(format!("could not build HTTP client: {e}")))?;
        Ok(Self {
            http,
            api_key,
            base_url: DEFAULT_BASE_URL.into(),
            model,
            timeout: DEFAULT_TIMEOUT,
        })
    }

    /// Point the client at another server (tests, proxies).
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    /// Default model for requests that do not set one.
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Per-attempt timeout (default 10 minutes).
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// The hash [`call`](Self::call) would record for `request`.
    pub fn request_hash(&self, request: &MessageRequest) -> String {
        request_hash(&request.body(&self.model))
    }

    /// Send the request. Retries 408, 409, 429, 5xx and connection errors (3 tries in total),
    /// honouring `retry-after` up to 60 s, else backing off from 1 s with jitter.
    /// Timeouts are not retried.
    pub async fn call(&self, request: &MessageRequest) -> Result<CallOutcome, ClaudeError> {
        let body = request.body(&self.model);
        let hash = request_hash(&body);
        let payload = serde_json::to_vec(&body).expect("a JSON value always serializes");
        let url = format!("{}/v1/messages", self.base_url);
        let mut attempt = 0;
        loop {
            attempt += 1;
            let started = Instant::now();
            let (status, retry_after, text) = match self
                .send(&url, &payload, request.fallback)
                .await
            {
                Ok(response) => response,
                Err(e) if e.is_timeout() => return Err(ClaudeError::Timeout),
                Err(e) if attempt < MAX_TRIES => {
                    let delay = backoff(attempt);
                    tracing::warn!(attempt, delay_ms = delay.as_millis() as u64, error = %e, "Claude connection error, retrying");
                    tokio::time::sleep(delay).await;
                    continue;
                }
                Err(e) => return Err(ClaudeError::Connection(e.to_string())),
            };
            let latency_ms = started.elapsed().as_millis() as u64;
            if (200..300).contains(&status) {
                tracing::debug!(attempt, latency_ms, request_hash = %hash, "Claude call finished");
                return parse_response(&text, request.wants_json(), latency_ms, attempt, hash);
            }
            if retryable(status) && attempt < MAX_TRIES {
                let delay = retry_after.unwrap_or_else(|| backoff(attempt));
                tracing::warn!(
                    status,
                    attempt,
                    delay_ms = delay.as_millis() as u64,
                    "Claude API error, retrying"
                );
                tokio::time::sleep(delay).await;
                continue;
            }
            return Err(ClaudeError::Http { status, body: text });
        }
    }

    async fn send(
        &self,
        url: &str,
        payload: &[u8],
        fallback: bool,
    ) -> Result<(u16, Option<Duration>, String), reqwest::Error> {
        let mut request = self
            .http
            .post(url)
            .timeout(self.timeout)
            .header("x-api-key", self.api_key.clone())
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .body(payload.to_vec());
        if fallback {
            request = request.header("anthropic-beta", FALLBACK_BETA);
        }
        let response = request.send().await?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|secs| secs.is_finite() && *secs >= 0.0)
            .map(Duration::from_secs_f64)
            .filter(|delay| *delay <= MAX_RETRY_AFTER);
        Ok((status, retry_after, response.text().await?))
    }
}

fn retryable(status: u16) -> bool {
    matches!(status, 408 | 409 | 429 | 500..=599)
}

/// 1 s, 2 s, ... plus up to 25% jitter.
fn backoff(attempt: u32) -> Duration {
    let base = BACKOFF_START * 2u32.pow(attempt.saturating_sub(1));
    let random = (RandomState::new().hash_one(Instant::now()) >> 11) as f64 / (1u64 << 53) as f64;
    base + base.mul_f64(0.25 * random)
}

#[derive(Deserialize)]
struct ApiMessage {
    model: String,
    #[serde(default)]
    content: Vec<Value>,
    stop_reason: Option<String>,
    stop_details: Option<Value>,
    #[serde(default)]
    usage: ApiUsage,
}

#[derive(Deserialize, Default)]
struct ApiUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

fn parse_response(
    raw: &str,
    wants_json: bool,
    latency_ms: u64,
    attempts: u32,
    request_hash: String,
) -> Result<CallOutcome, ClaudeError> {
    let message: ApiMessage =
        serde_json::from_str(raw).map_err(|e| ClaudeError::UnexpectedResponse(e.to_string()))?;
    // Read by block type: thinking (and fallback) blocks can come first.
    let text = message
        .content
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect();
    let tool_uses = message
        .content
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
        .map(|block| ToolUse {
            id: block.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
            name: block.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
            input: block.get("input").cloned().unwrap_or(Value::Null),
        })
        .collect();
    let mut outcome = CallOutcome {
        text,
        json: None,
        content: message.content,
        tool_uses,
        stop_reason: message.stop_reason,
        model: message.model,
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        latency_ms,
        attempts,
        request_hash,
    };
    if outcome.stop_reason.as_deref() == Some("refusal") {
        let details = message.stop_details.unwrap_or(Value::Null);
        let field = |name: &str| details.get(name).and_then(Value::as_str).map(String::from);
        return Err(ClaudeError::Refused {
            category: field("category"),
            explanation: field("explanation"),
            outcome: Box::new(outcome),
        });
    }
    // A turn that calls tools is not the answer yet.
    if wants_json && outcome.tool_uses.is_empty() {
        match serde_json::from_str(outcome.text.trim()) {
            Ok(json) => outcome.json = Some(json),
            Err(e) => {
                return Err(ClaudeError::InvalidJson {
                    message: e.to_string(),
                    outcome: Box::new(outcome),
                });
            }
        }
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_lookup_requires_a_key() {
        let missing = ClaudeClient::from_lookup(|_| None);
        assert!(matches!(missing, Err(ClaudeError::MissingApiKey)));
        let empty =
            ClaudeClient::from_lookup(|k| (k == "ANTHROPIC_API_KEY").then(|| "  ".to_string()));
        assert!(matches!(empty, Err(ClaudeError::MissingApiKey)));
    }

    #[test]
    fn from_lookup_reads_model_with_fallback() {
        let client = ClaudeClient::from_lookup(|k| match k {
            "ANTHROPIC_API_KEY" => Some("sk-test".into()),
            "ANTHROPIC_MODEL" => Some("".into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(client.model(), DEFAULT_MODEL);
        let client = ClaudeClient::from_lookup(|k| Some(format!("value-of-{k}"))).unwrap();
        assert_eq!(client.model(), "value-of-ANTHROPIC_MODEL");
        assert!(!format!("{client:?}").contains("value-of-ANTHROPIC_API_KEY"));
    }

    #[test]
    fn retry_policy() {
        for status in [408, 409, 429, 500, 503, 529] {
            assert!(retryable(status), "{status}");
        }
        for status in [400, 401, 403, 404, 413] {
            assert!(!retryable(status), "{status}");
        }
        let first = backoff(1);
        assert!(first >= Duration::from_secs(1) && first <= Duration::from_millis(1250));
        assert!(backoff(2) >= Duration::from_secs(2));
    }
}
