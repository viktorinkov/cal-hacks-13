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
    pub async fn wait_for(&self, execution_id: &str, every: Duration, limit: Duration) -> Result<Value> {
        let path = format!("api/workflows/executions/{execution_id}?includeOutput=true");
        let deadline = Instant::now() + limit;
        loop {
            let execution = self.call(Method::GET, &path, None).await?;
            if execution["status"].as_str().is_some_and(|s| DONE.contains(&s)) {
                return Ok(execution);
            }
            if Instant::now() > deadline {
                bail!("workflow execution {execution_id} is still {} after {} s", execution["status"], limit.as_secs());
            }
            tokio::time::sleep(every).await;
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

    fn req(&self, method: Method, path: &str) -> RequestBuilder {
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

    async fn call(&self, method: Method, path: &str, body: Option<Value>) -> Result<Value> {
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
    }

    #[test]
    fn failure_names_the_failed_steps() {
        let e = json!({"status": "failed", "error": null, "stepExecutions": [
            {"stepId": "pages", "error": null},
            {"stepId": "read", "error": "agent timed out"}
        ]});
        assert_eq!(failure(&e), "ended failed: read: \"agent timed out\"");
    }

    #[test]
    fn debug_hides_key() {
        let k = Kibana::new("https://example.invalid/", "secret-key").unwrap();
        assert!(!format!("{k:?}").contains("secret"));
    }
}
