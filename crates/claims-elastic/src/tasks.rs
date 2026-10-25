//! Bounded text tasks run by Elastic Workflows. Inputs and answers stay in
//! the execution record; no task corpus or shared answer index is created.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use crate::Kibana;

pub const WORKFLOW: &str = "bandit-run-task";
pub const ANSWER_STEP: &str = "answer";
const WORKFLOW_YAML: &str = include_str!("../elastic/workflows/bandit-run-task.yaml");

/// Provider-neutral input to a single structured text step.
pub struct TaskRequest {
    pub task: String,
    pub system: String,
    pub prompt: String,
    pub schema: Value,
}

impl TaskRequest {
    pub fn inputs(&self) -> Value {
        json!({"task": self.task, "system": self.system, "prompt": self.prompt, "schema": self.schema.to_string()})
    }
}

impl Kibana {
    /// Installs the bounded task workflow. It uses the workflow's configured
    /// default connector; it does not select a vendor or invent model usage.
    pub async fn ensure_tasks(&self) -> Result<()> {
        self.ensure_private_workflow(WORKFLOW, WORKFLOW_YAML).await
    }
}

/// The completed AI step's output. `ai.prompt` returns its structured
/// answer in `content`; Agent Builder's `structured_output` is a different API.
pub fn output(execution: &Value) -> Result<&Value> {
    if execution["status"] != "completed" {
        bail!("{}", crate::reader::failure(execution));
    }
    if let Some(step) = execution["stepExecutions"].as_array().into_iter().flatten().rev().find(|s| s["stepId"] == ANSWER_STEP)
        && step["status"] != "completed"
    {
        bail!("workflow answer step did not complete");
    }
    reported_output(execution).context("completed workflow has no answer step output")
}

/// A step can report usage even when its execution fails. Keep that metadata
/// in the audit trail without accepting the failed step as an answer.
pub fn reported_output(execution: &Value) -> Option<&Value> {
    if let Some(step) = execution["stepExecutions"].as_array().into_iter().flatten().rev()
        .find(|s| s["stepId"] == ANSWER_STEP)
        && let Some(output) = step.get("output").filter(|v| !v.is_null())
    {
        return Some(output);
    }
    // Some Kibana versions return the final step's output at execution level.
    execution.get("output").filter(|v| !v.is_null())
}

/// Only structured JSON is accepted; malformed output must never turn into
/// an empty successful result. Domain checks still run in the worker.
pub fn answer(output: &Value) -> Result<Value> {
    let content = output.get("content").context("ai.prompt output has no content")?;
    let parsed = match content {
        Value::String(text) => serde_json::from_str(text).context("ai.prompt content is not JSON")?,
        value => value.clone(),
    };
    if !parsed.is_object() {
        bail!("ai.prompt content is not a structured object");
    }
    Ok(parsed)
}

/// Metadata exactly as the service reported it. An absent field stays absent.
pub fn metadata(output: &Value) -> Value {
    output.get("metadata").cloned().unwrap_or(Value::Null)
}

/// The underlying model when reported, otherwise the explicitly labelled
/// connector ID. Never present a workflow or agent name as an actual model.
pub fn model(metadata: &Value) -> String {
    for path in ["/model", "/modelId", "/usage/model", "/usage/modelId"] {
        if let Some(value) = metadata.pointer(path).and_then(Value::as_str).filter(|s| !s.is_empty()) {
            return value.to_string();
        }
    }
    for path in ["/connectorId", "/usage/connectorId"] {
        if let Some(value) = metadata.pointer(path).and_then(Value::as_str).filter(|s| !s.is_empty()) {
            return format!("elastic-connector:{value}");
        }
    }
    String::new()
}

/// Reported usage only. The current audit schema represents unavailable
/// counts as zero; the unmodified metadata in the audit response distinguishes
/// missing counts from reported zeros.
pub fn tokens(metadata: &Value) -> (u32, u32) {
    let sources = [metadata.get("usage"), metadata.get("tokenUsage"), Some(metadata)];
    let first = |keys: &[&str]| sources.iter().flatten().find_map(|usage| keys.iter().find_map(|key| usage[*key].as_u64())).unwrap_or(0).min(u32::MAX as u64) as u32;
    (first(&["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]),
     first(&["output_tokens", "outputTokens", "completion_tokens", "completionTokens"]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_inputs_keep_text_and_schema_separate() {
        let request = TaskRequest { task: "medical_extract".into(), system: "Copy printed facts".into(), prompt: "Page 1: A+".into(), schema: json!({"type": "object"}) };
        let inputs = request.inputs();
        assert_eq!(inputs["prompt"], "Page 1: A+");
        assert_eq!(serde_json::from_str::<Value>(inputs["schema"].as_str().unwrap()).unwrap(), request.schema);
        assert!(WORKFLOW_YAML.contains("type: ai.prompt"));
        assert!(!WORKFLOW_YAML.contains("elasticsearch.index"));
        for key in ["task", "system", "prompt", "schema"] {
            assert!(WORKFLOW_YAML.contains(&format!("- name: {key}")));
            assert!(WORKFLOW_YAML.contains(&format!("inputs.{key}")));
        }
    }

    #[test]
    fn reads_the_completed_prompt_step_and_preserves_reported_usage() {
        let execution = json!({"status": "completed", "stepExecutions": [
            {"stepId": "schema", "status": "completed", "output": {"type": "object"}},
            {"stepId": "answer", "status": "completed", "output": {"content": {"n": 4}, "metadata": {"model": "reported-model", "usage": {"connectorId": "configured-model", "input_tokens": 12, "output_tokens": 8}}}}
        ]});
        let out = output(&execution).unwrap();
        assert_eq!(answer(out).unwrap(), json!({"n": 4}));
        assert_eq!(model(&metadata(out)), "reported-model");
        assert_eq!(tokens(&metadata(out)), (12, 8));
    }

    #[test]
    fn accepts_execution_level_output_and_json_text() {
        let execution = json!({"status": "completed", "output": {"content": "{\"ok\":true}"}});
        let out = output(&execution).unwrap();
        assert_eq!(answer(out).unwrap(), json!({"ok": true}));
        assert_eq!(metadata(out), Value::Null);
        assert_eq!(model(&metadata(out)), "");
        assert_eq!(tokens(&metadata(out)), (0, 0));
    }

    #[test]
    fn rejects_failed_missing_and_malformed_answers() {
        assert!(output(&json!({"status": "failed", "error": "connector down"})).unwrap_err().to_string().contains("connector down"));
        assert!(output(&json!({"status": "completed"})).is_err());
        for out in [json!({}), json!({"content": "plain text"}), json!({"content": null}), json!({"content": []})] {
            assert!(answer(&out).is_err());
        }
    }

    #[test]
    fn connector_identity_is_not_mislabelled_as_a_model() {
        let m = json!({"usage": {"connectorId": "endpoint-a", "inputTokens": 9, "outputTokens": 7}});
        assert_eq!(model(&m), "elastic-connector:endpoint-a");
        assert_eq!(tokens(&m), (9, 7));
        assert_eq!(tokens(&json!({"usage": {"input_tokens": u64::MAX}})), (u32::MAX, 0));
        assert_eq!(tokens(&json!({"usage": {"connectorId": "endpoint-a"}, "tokenUsage": {"promptTokens": 9, "completionTokens": 7}})), (9, 7));
    }

    #[test]
    fn failed_steps_keep_reported_usage_without_becoming_successful_answers() {
        let execution = json!({"status": "failed", "stepExecutions": [{"stepId": "answer", "status": "failed", "output": {"metadata": {"usage": {"inputTokens": 12}}}}]});
        assert!(output(&execution).is_err());
        assert_eq!(tokens(&metadata(reported_output(&execution).unwrap())), (12, 0));
    }
}
