//! The Kibana side of reading an insurance document: the Elastic ES|QL tool
//! `bandit.document_pages`, the Elastic Agent Builder agent
//! `bandit-document-reader` and the Elastic Workflow `bandit-read-document`,
//! installed from `elastic/` and run by the worker's `document_read` job.

use std::fmt;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use reqwest::header::{AUTHORIZATION, HeaderValue};
use reqwest::{Client, Method, RequestBuilder, StatusCode};
use serde_json::{Value, json};

use crate::short;

pub const WORKFLOW: &str = "bandit-read-document";
pub const AGENT: &str = "bandit-document-reader";
pub const TOOL: &str = "bandit.document_pages";

const TOOL_JSON: &str = include_str!("../elastic/tools/bandit.document_pages.json");
const AGENT_JSON: &str = include_str!("../elastic/agents/bandit-document-reader.json");
const AGENT_INSTRUCTIONS: &str = include_str!("../elastic/agents/bandit-document-reader.instructions.md");
const WORKFLOW_YAML: &str = include_str!("../elastic/workflows/bandit-read-document.yaml");

/// Statuses after which an execution does not change.
const DONE: [&str; 4] = ["completed", "failed", "cancelled", "timed_out"];

/// Client for the project's Kibana APIs. Debug output never shows the API key.
#[derive(Clone)]
pub struct Kibana {
    http: Client,
    url: String,
    auth: HeaderValue,
}

impl fmt::Debug for Kibana {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Kibana").field("url", &self.url).finish_non_exhaustive()
    }
}

impl Kibana {
    pub fn new(url: &str, api_key: &str) -> Result<Self> {
        let mut auth = HeaderValue::from_str(&format!("ApiKey {}", api_key.trim())).context("KIBANA_API_KEY is not a valid header value")?;
        auth.set_sensitive(true);
        let http = Client::builder().timeout(Duration::from_secs(60)).build()?;
        Ok(Self { http, url: url.trim().trim_end_matches('/').to_string(), auth })
    }

    /// Creates or updates the tool, the agent and the workflow.
    pub async fn ensure_reader(&self) -> Result<()> {
        self.ensure_asset("api/agent_builder/tools", serde_json::from_str(TOOL_JSON)?).await?;
        self.ensure_asset("api/agent_builder/agents", agent()?).await?;
        self.ensure_workflow(WORKFLOW, WORKFLOW_YAML).await
    }

    /// Starts a manual run of workflow `id` and returns its execution id.
    pub async fn run_workflow(&self, id: &str, inputs: Value) -> Result<String> {
        let out = self.call(Method::POST, &format!("api/workflows/workflow/{id}/run"), Some(json!({ "inputs": inputs }))).await?;
        out["workflowExecutionId"].as_str().map(str::to_string).context("the workflow run returned no execution id")
    }

    /// Polls an execution every `every` until it is done, for at most `limit`.
    /// A local timeout or polling failure requests cancellation of this exact
    /// execution before returning, so a job retry does not abandon model work.
    pub async fn wait_for(&self, execution_id: &str, every: Duration, limit: Duration) -> Result<Value> {
        let path = format!("api/workflows/executions/{execution_id}?includeOutput=true");
        let deadline = Instant::now() + limit;
        loop {
            let execution = match self.call(Method::GET, &path, None).await {
                Ok(execution) => execution,
                Err(error) => return Err(self.cancel_after_error(execution_id, error).await),
            };
            if execution["status"].as_str().is_some_and(|s| DONE.contains(&s)) {
                return Ok(execution);
            }
            if Instant::now() > deadline {
                let error = anyhow::anyhow!("workflow execution {execution_id} is still {} after {} s", execution["status"], limit.as_secs());
                return Err(self.cancel_after_error(execution_id, error).await);
            }
            tokio::time::sleep(every).await;
        }
    }

    /// Requests cancellation through the documented workflow execution API.
    /// Acceptance is not a claim that the underlying model stopped immediately.
    pub async fn cancel_workflow(&self, execution_id: &str) -> Result<()> {
        let response = self.req(Method::POST, &format!("api/workflows/executions/{execution_id}/cancel"))
            .timeout(Duration::from_secs(10)).send().await.context("requesting workflow cancellation")?;
        if !response.status().is_success() {
            bail!("cancelling workflow execution {execution_id} returned {}", response.status());
        }
        Ok(())
    }

    async fn cancel_after_error(&self, execution_id: &str, error: anyhow::Error) -> anyhow::Error {
        match self.cancel_workflow(execution_id).await {
            Ok(()) => error.context(format!("cancellation requested for workflow execution {execution_id}")),
            Err(cancel) => error.context(format!("workflow execution {execution_id} cancellation was not confirmed: {cancel:#}")),
        }
    }

    pub(crate) async fn ensure_asset(&self, collection: &str, mut body: Value) -> Result<()> {
        let id = body["id"].as_str().context("asset without an id")?.to_string();
        let path = format!("{collection}/{id}");
        if self.exists(&path).await? {
            let fields = body.as_object_mut().context("asset is not an object")?;
            fields.remove("id");
            fields.remove("type");
            self.call(Method::PUT, &path, Some(body)).await?;
        } else {
            self.call(Method::POST, collection, Some(body)).await?;
        }
        Ok(())
    }

    pub(crate) async fn ensure_workflow(&self, id: &str, yaml: &str) -> Result<()> {
        let path = format!("api/workflows/workflow/{id}");
        let out = if self.exists(&path).await? {
            self.call(Method::PUT, &path, Some(json!({ "yaml": yaml }))).await?
        } else {
            self.call(Method::POST, "api/workflows/workflow", Some(json!({ "id": id, "yaml": yaml }))).await?
        };
        if out["valid"] != json!(true) {
            bail!("workflow {id} is not valid: {}", out["validationErrors"]);
        }
        Ok(())
    }

    /// Installs a workflow containing per-person inputs and restricts its
    /// execution history to the owning API identity. The Files/Workflows
    /// access-control endpoint currently requires Kibana's internal header.
    pub(crate) async fn ensure_private_workflow(&self, id: &str, yaml: &str) -> Result<()> {
        self.ensure_workflow(id, yaml).await?;
        let response = self.req(Method::PUT, &format!("internal/workflows/{id}/access_control"))
            .header("x-elastic-internal-origin", "Kibana")
            .json(&json!({"access_mode": "private", "entries": []}))
            .send().await.context("restricting workflow access")?;
        let status = response.status();
        if !status.is_success() {
            bail!("restricting workflow {id} access returned {status}");
        }
        let value: Value = response.json().await.context("reading workflow access confirmation")?;
        if value["access_control"]["access_mode"] != "private" {
            bail!("workflow {id} did not confirm private access");
        }
        Ok(())
    }

    pub(crate) fn req(&self, method: Method, path: &str) -> RequestBuilder {
        self.http.request(method, format!("{}/{path}", self.url)).header(AUTHORIZATION, self.auth.clone()).header("kbn-xsrf", "true")
    }

    async fn exists(&self, path: &str) -> Result<bool> {
        let status = self.req(Method::GET, path).send().await.with_context(|| format!("GET {path}"))?.status();
        match status {
            StatusCode::NOT_FOUND => Ok(false),
            s if s.is_success() => Ok(true),
            s => bail!("GET {path} returned {s}"),
        }
    }

    pub(crate) async fn call(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
        let mut req = self.req(method.clone(), path);
        if let Some(b) = &body {
            req = req.json(b);
        }
        let resp = req.send().await.with_context(|| format!("Kibana {method} {path}"))?;
        let status = resp.status();
        let text = resp.text().await?;
        let v = serde_json::from_str(&text).unwrap_or(Value::String(text));
        if !status.is_success() {
            bail!("Kibana {method} {path} returned {status}: {}", short(&v));
        }
        Ok(v)
    }
}

/// The reader's version for a kind's `schema`: a hash of the tool, the agent,
/// its instructions, the workflow and the schema. An answer saved with the same
/// version came from the same reader, so the same PDF need not be read again.
pub fn version(schema: &str) -> String {
    // FNV-1a over 64 bits: the same on every build, unlike std's hasher.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for part in [TOOL_JSON, AGENT_JSON, AGENT_INSTRUCTIONS, WORKFLOW_YAML, schema] {
        for b in part.bytes().chain([0]) {
            h = (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

/// The agent with its instructions.
fn agent() -> Result<Value> {
    let mut body: Value = serde_json::from_str(AGENT_JSON)?;
    body["configuration"]["instructions"] = json!(AGENT_INSTRUCTIONS);
    Ok(body)
}

/// Why an execution did not complete: its own error and each failed step's.
pub fn failure(execution: &Value) -> String {
    let steps = execution["stepExecutions"].as_array().into_iter().flatten();
    let mut parts: Vec<String> = steps.filter(|s| !s["error"].is_null()).map(|s| format!("{}: {}", s["stepId"].as_str().unwrap_or("?"), s["error"])).collect();
    if !execution["error"].is_null() {
        parts.insert(0, execution["error"].to_string());
    }
    format!("ended {}: {}", execution["status"].as_str().unwrap_or("?"), parts.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_parse_and_agree() {
        let tool: Value = serde_json::from_str(TOOL_JSON).unwrap();
        assert_eq!(tool["id"], TOOL);
        let query = tool["configuration"]["query"].as_str().unwrap();
        assert!(query.starts_with("FROM bandit*-documents") && query.contains("KEEP page, text"), "{query}");
        let a = agent().unwrap();
        assert_eq!((a["id"].as_str(), a["configuration"]["tools"][0]["tool_ids"][0].as_str()), (Some(AGENT), Some(TOOL)));
        assert_eq!(a["configuration"]["enable_elastic_capabilities"], false);
        assert!(a["configuration"]["instructions"].as_str().unwrap().contains("never infer"));
        assert!(WORKFLOW_YAML.contains(&format!("name: {WORKFLOW}")) && WORKFLOW_YAML.contains(&format!("agent-id: {AGENT}")));
        assert!(WORKFLOW_YAML.contains("reader: \"{{ inputs.reader }}\""), "save_terms keeps the reader's version");
    }

    #[test]
    fn the_version_follows_the_schema() {
        let v = version("{\"required\":[\"clauses\"]}");
        assert_eq!((v.len(), v.clone()), (16, version("{\"required\":[\"clauses\"]}")));
        assert_ne!(v, version("{\"required\":[\"printed\",\"clauses\"]}"));
    }

    #[test]
    fn failure_names_the_failed_steps() {
        let e = json!({"status": "failed", "error": null, "stepExecutions": [
            {"stepId": "pages", "error": null},
            {"stepId": "read", "error": "agent timed out"}
        ]});
        assert_eq!(failure(&e), "ended failed: read: \"agent timed out\"");
    }

    fn polling_server(responses: Vec<(u16, Value)>) -> (Kibana, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                        Err(error) => panic!("expected workflow request: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                while !bytes.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let mut chunk = [0_u8; 4096];
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                }
                requests.push(String::from_utf8(bytes).unwrap().lines().next().unwrap().to_string());
                let body = body.to_string();
                write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (Kibana::new(&url, "test-key").unwrap(), server)
    }

    #[tokio::test]
    async fn timeout_cancels_only_the_execution_being_polled() {
        let (kibana, server) = polling_server(vec![(200, json!({"status": "running"})), (200, json!({}))]);
        let error = kibana.wait_for("owned-execution", Duration::ZERO, Duration::ZERO).await.unwrap_err();
        assert!(format!("{error:#}").contains("cancellation requested"));
        assert_eq!(server.join().unwrap(), [
            "GET /api/workflows/executions/owned-execution?includeOutput=true HTTP/1.1",
            "POST /api/workflows/executions/owned-execution/cancel HTTP/1.1",
        ]);
    }

    #[tokio::test]
    async fn polling_failure_preserves_error_and_reports_rejected_cancellation() {
        let (kibana, server) = polling_server(vec![(500, json!({"message": "poll failed"})), (403, json!({}))]);
        let error = kibana.wait_for("owned-execution", Duration::ZERO, Duration::from_secs(5)).await.unwrap_err();
        let message = format!("{error:#}");
        assert!(message.contains("500") && message.contains("403") && message.contains("not confirmed"), "{message}");
        assert_eq!(server.join().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn finished_execution_does_not_request_cancellation() {
        let (kibana, server) = polling_server(vec![(200, json!({"status": "completed"}))]);
        assert_eq!(kibana.wait_for("owned-execution", Duration::ZERO, Duration::from_secs(5)).await.unwrap()["status"], "completed");
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[test]
    fn debug_hides_key() {
        let k = Kibana::new("https://example.invalid/", "secret-key").unwrap();
        assert!(!format!("{k:?}").contains("secret"));
    }
}
