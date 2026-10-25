//! Structured text generation through Elastic Workflows. The existing
//! domain validators and correction retries work with either execution client.

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use claims_elastic::{Kibana, tasks};
use claude_client::{Effort, MessageRequest};
use serde_json::{Value, json};

use crate::model::{Answer, Failed, Model, Turn, new_call, truncate};

const POLL_EVERY: Duration = Duration::from_secs(2);
const WORKFLOW_LIMIT: Duration = Duration::from_secs(10 * 60);
const MAX_RESPONSE_CHARS: usize = 20_000;

/// A bounded text executor backed by Kibana's configured model connector.
/// Binary perception and tool loops require their own execution paths.
pub struct Elastic<'a> {
    pub kibana: &'a Kibana,
}

impl Model for Elastic<'_> {
    async fn ask(&self, kind: &str, _effort: Effort, request: MessageRequest) -> Result<Answer, Failed> {
        let started = Instant::now();
        let mut call = new_call(kind);
        call.model_requested = format!("elastic-workflow:{}", tasks::WORKFLOW);
        // ai.prompt has no reasoning-effort option. Do not claim an ignored
        // Claude-specific effort was used by the configured connector.
        let mut execution_id = String::new();
        let mut metadata = Value::Null;
        let mut answer = Value::Null;
        let result: Result<()> = async {
            let task = task_request(kind, &request)?;
            let inputs = task.inputs();
            call.request_hash = claude_client::request_hash(&inputs);
            execution_id = self.kibana.run_workflow(tasks::WORKFLOW, inputs).await?;
            tracing::info!(kind, execution = %execution_id, workflow = tasks::WORKFLOW, "Elastic text task started");
            let execution = self.kibana.wait_for(&execution_id, POLL_EVERY, WORKFLOW_LIMIT).await?;
            call.stop_reason = execution["status"].as_str().unwrap_or_default().to_string();
            if let Some(output) = tasks::reported_output(&execution) {
                metadata = tasks::metadata(output);
                call.model_used = tasks::model(&metadata);
                (call.input_tokens, call.output_tokens) = tasks::tokens(&metadata);
            }
            answer = tasks::answer(tasks::output(&execution)?)?;
            Ok(())
        }.await;
        call.latency_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        call.response = audit_response(&execution_id, &metadata, &answer);
        match result {
            Ok(()) => {
                call.status = "ok".into();
                Ok(Answer { json: answer, call })
            }
            Err(error) => {
                call.status = "error".into();
                call.error = format!("Elastic workflow {} execution {}: {error:#}", tasks::WORKFLOW, if execution_id.is_empty() { "not started" } else { &execution_id });
                Err(Failed { error: call.error.clone(), call })
            }
        }
    }

    async fn turn(&self, kind: &str, effort: Effort, request: MessageRequest) -> Result<Turn, Failed> {
        let answer = self.ask(kind, effort, request).await?;
        Ok(Turn {
            content: vec![json!({"type": "text", "text": answer.json.to_string()})],
            tool_uses: Vec::new(),
            json: Some(answer.json),
            call: answer.call,
        })
    }
}

/// The request builder remains a compatibility seam for the handlers. Only
/// its system text, user text and schema go into the workflow, never a model
/// name, a fabricated effort, binary inputs or a silently dropped tool loop.
fn task_request(kind: &str, request: &MessageRequest) -> Result<tasks::TaskRequest> {
    let body = request.body("");
    if body["model"].as_str().is_some_and(|model| !model.is_empty()) {
        bail!("bounded Elastic text tasks use the configured connector, not a per-request model override");
    }
    if body.get("tools").is_some() || body.get("tool_choice").is_some() {
        bail!("bounded Elastic text tasks do not accept tools; use an Agent Builder workflow");
    }
    let messages = body["messages"].as_array().context("request has no messages")?;
    if messages.len() != 1 || messages[0]["role"] != "user" {
        bail!("bounded Elastic text tasks do not accept conversation history");
    }
    let blocks = messages[0]["content"].as_array().context("request has no content blocks")?;
    let mut text = Vec::new();
    for block in blocks {
        if block["type"] != "text" {
            bail!("bounded Elastic text tasks require extracted text, not {} blocks", block["type"]);
        }
        text.push(block["text"].as_str().context("text block has no text")?);
    }
    let prompt = text.join("\n\n");
    if prompt.trim().is_empty() {
        bail!("bounded Elastic text task has no prompt");
    }
    let schema = body.pointer("/output_config/format/schema").filter(|v| v.is_object()).context("bounded Elastic text tasks require a JSON schema")?.clone();
    Ok(tasks::TaskRequest {
        task: kind.to_string(),
        system: body["system"].as_str().unwrap_or_default().to_string(),
        prompt,
        schema,
    })
}

fn audit_response(execution_id: &str, metadata: &Value, answer: &Value) -> String {
    // Keep provenance before the potentially long answer when truncating.
    let audit = json!({
        "execution": {"workflow_id": tasks::WORKFLOW, "execution_id": execution_id, "step_id": tasks::ANSWER_STEP, "metadata": metadata},
        "result": answer,
    });
    truncate(&audit.to_string(), MAX_RESPONSE_CHARS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use claude_client::ImageType;

    #[test]
    fn translates_only_text_and_schema_and_keeps_retry_context() {
        let request = MessageRequest::new().system("Use supplied facts").text("Page 1: facts").text("Previous answer was invalid").json_schema(json!({"type": "object"}));
        let task = task_request("medical_extract_retry", &request).unwrap();
        assert_eq!(task.task, "medical_extract_retry");
        assert_eq!(task.system, "Use supplied facts");
        assert_eq!(task.prompt, "Page 1: facts\n\nPrevious answer was invalid");
        assert!(task.inputs().get("effort").is_none());
        assert!(task.inputs().get("model").is_none());
    }

    #[test]
    fn rejects_binary_tool_and_conversation_requests() {
        let base = || MessageRequest::new().text("Read").json_schema(json!({"type": "object"}));
        let requests = [
            base().pdf(b"pdf"), base().image(ImageType::Png, b"image"), base().model("explicit-model"),
            base().tool("lookup", "lookup", json!({"type": "object"})),
            base().next_turn(&[json!({"type": "text", "text": "Earlier reply"})]).text("Next"),
        ];
        for request in requests {
            assert!(task_request("task", &request).is_err());
        }
        assert!(task_request("task", &MessageRequest::new().text("no schema")).is_err());
    }

    #[test]
    fn audit_keeps_execution_identity_and_unmodified_usage() {
        let metadata = json!({"usage": {"connectorId": "endpoint-7", "inputTokens": 12}});
        let audit: Value = serde_json::from_str(&audit_response("execution-3", &metadata, &json!({"ok": true}))).unwrap();
        assert_eq!(audit["execution"]["execution_id"], "execution-3");
        assert_eq!(audit["execution"]["metadata"], metadata);
        assert!(audit["execution"]["metadata"]["usage"].get("outputTokens").is_none());
        assert_eq!(audit["result"], json!({"ok": true}));
    }

    #[tokio::test]
    async fn unsupported_input_fails_before_network_and_does_not_invent_usage() {
        let kibana = Kibana::new("https://example.invalid", "test-key").unwrap();
        let model = Elastic { kibana: &kibana };
        let failed = model.ask("medical_extract", Effort::High, MessageRequest::new().pdf(b"pdf").json_schema(json!({"type": "object"}))).await.err().unwrap();
        assert_eq!(failed.call.status, "error");
        assert_eq!(failed.call.model_requested, "elastic-workflow:bandit-run-task");
        assert_eq!(failed.call.model_used, "");
        assert_eq!(failed.call.effort, "");
        assert_eq!((failed.call.input_tokens, failed.call.output_tokens), (0, 0));
        assert!(failed.error.contains("not started"));
    }
}
