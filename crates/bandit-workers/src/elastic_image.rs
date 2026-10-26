//! Bounded visual extraction through Elastic Agent Builder. The temporary
//! upload is deleted after the step, including failed answers and retries.

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use claims_elastic::{Kibana, images, tasks};
use claude_client::{Effort, MessageRequest};
use serde_json::{Value, json};

use crate::model::{Answer, Failed, Model, Turn, new_call, truncate};

pub struct ElasticImage<'a> {
    pub kibana: &'a Kibana,
}

struct ImageTask {
    task: String,
    system: String,
    prompt: String,
    schema: Value,
    image: images::ImageData,
}

impl ImageTask {
    fn inputs(&self, file_id: &str) -> Value {
        json!({"task": self.task, "system": self.system, "prompt": self.prompt,
            "schema": self.schema.to_string(), "file_id": file_id, "mime_type": self.image.mime_type})
    }
}

impl Model for ElasticImage<'_> {
    async fn ask(&self, kind: &str, _effort: Effort, request: MessageRequest) -> Result<Answer, Failed> {
        let started = Instant::now();
        let mut call = new_call(kind);
        call.model_requested = format!("elastic-workflow:{}", images::WORKFLOW);
        let mut execution_id = String::new();
        let mut metadata = Value::Null;
        let mut answer = Value::Null;
        let result: Result<()> = async {
            let task = image_task(kind, &request)?;
            call.request_hash = claude_client::request_hash(&request.body(""));
            let mut upload = self.kibana.upload_image(&task.image).await?;
            let run: Result<()> = async {
                execution_id = self.kibana.run_workflow(images::WORKFLOW, task.inputs(upload.id())).await?;
                tracing::info!(kind, execution = %execution_id, workflow = images::WORKFLOW, "Elastic image task started");
                let execution = self.kibana.wait_for(&execution_id, Duration::from_secs(2), Duration::from_secs(10 * 60)).await?;
                answer = read_execution(&execution, &mut call, &mut metadata)?;
                Ok(())
            }.await;
            // Do not report a successful job if its private upload could not
            // be removed. The guard also attempts deletion on cancellation.
            let cleanup = upload.delete().await;
            match (run, cleanup) {
                (Ok(()), Ok(())) => Ok(()),
                (Err(error), Ok(())) => Err(error),
                (Ok(()), Err(error)) => Err(error.context("image result was received but upload cleanup failed")),
                (Err(error), Err(cleanup)) => Err(error.context(format!("image cleanup also failed: {cleanup:#}"))),
            }
        }.await;
        call.latency_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        call.response = truncate(&json!({
            "execution": {"workflow_id": images::WORKFLOW, "execution_id": execution_id, "step_id": images::ANSWER_STEP, "metadata": metadata},
            "result": answer,
        }).to_string(), 20_000);
        match result {
            Ok(()) => {
                call.status = "ok".into();
                Ok(Answer { json: answer, call })
            }
            Err(error) => {
                call.status = "error".into();
                call.error = format!("Elastic image workflow execution {}: {error:#}", if execution_id.is_empty() { "not started" } else { &execution_id });
                Err(Failed { error: call.error.clone(), call })
            }
        }
    }

    async fn turn(&self, kind: &str, effort: Effort, request: MessageRequest) -> Result<Turn, Failed> {
        let answer = self.ask(kind, effort, request).await?;
        Ok(Turn { content: vec![json!({"type": "text", "text": answer.json.to_string()})], tool_uses: Vec::new(), json: Some(answer.json), call: answer.call })
    }
}

fn read_execution(execution: &Value, call: &mut bandit_bindings::ModelCallIn, metadata: &mut Value) -> Result<Value> {
    call.stop_reason = execution["status"].as_str().unwrap_or_default().to_string();
    // A failed step may still have consumed tokens. Preserve what it reports
    // before rejecting its answer; missing fields remain unknown.
    if let Some(output) = tasks::reported_output(execution) {
        *metadata = tasks::metadata(output);
        call.model_used = tasks::model(metadata);
        (call.input_tokens, call.output_tokens) = tasks::tokens(metadata);
    }
    images::answer(tasks::output(execution)?)
}

fn image_task(kind: &str, request: &MessageRequest) -> Result<ImageTask> {
    let body = request.body("");
    if body.get("tools").is_some() || body.get("tool_choice").is_some() {
        bail!("bounded Elastic image tasks do not accept caller tools");
    }
    let messages = body["messages"].as_array().context("image request has no messages")?;
    if messages.len() != 1 || messages[0]["role"] != "user" {
        bail!("bounded Elastic image tasks do not accept conversation history");
    }
    let blocks = messages[0]["content"].as_array().context("image request has no content")?;
    let mut text = Vec::new();
    let mut image = None;
    for block in blocks {
        match block["type"].as_str() {
            Some("text") => text.push(block["text"].as_str().context("image task text block has no text")?),
            Some("image") if image.is_none() && block["source"]["type"] == "base64" => {
                image = Some(images::ImageData::from_base64(
                    block["source"]["media_type"].as_str().context("image has no media type")?,
                    block["source"]["data"].as_str().context("image has no data")?,
                )?);
            }
            _ => bail!("Elastic image task requires exactly one image and text blocks"),
        }
    }
    let prompt = text.join("\n\n");
    if prompt.trim().is_empty() { bail!("Elastic image task has no prompt"); }
    Ok(ImageTask {
        task: kind.to_string(),
        system: body["system"].as_str().unwrap_or_default().to_string(),
        prompt,
        schema: body.pointer("/output_config/format/schema").filter(|v| v.is_object()).context("Elastic image task requires a JSON schema")?.clone(),
        image: image.context("Elastic image task has no image")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use claude_client::ImageType;

    fn request() -> MessageRequest {
        MessageRequest::new().system("Never identify people").image(ImageType::Jpeg, b"image bytes").text("Count people").json_schema(json!({"type": "object"}))
    }

    #[test]
    fn preserves_pixels_context_and_retry_without_putting_bytes_in_workflow_inputs() {
        let task = image_task("photo_features_retry", &request().text("Previous caption contained a hashtag")).unwrap();
        assert_eq!(task.image.bytes, b"image bytes");
        assert_eq!(task.system, "Never identify people");
        assert!(task.prompt.contains("Previous caption contained a hashtag"));
        let inputs = task.inputs("owned-file-id");
        assert_eq!(inputs["file_id"], "owned-file-id");
        assert_eq!(inputs["mime_type"], "image/jpeg");
        assert!(!inputs.to_string().contains("image bytes"));
        assert!(inputs.get("model").is_none());
    }

    #[test]
    fn rejects_missing_duplicate_document_and_tool_inputs() {
        assert!(image_task("photo_features", &MessageRequest::new().text("No image")).is_err());
        assert!(image_task("photo_features", &request().image(ImageType::Png, b"another")).is_err());
        assert!(image_task("photo_features", &request().pdf(b"pdf")).is_err());
        assert!(image_task("photo_features", &request().tool("search", "search", json!({"type": "object"}))).is_err());
    }

    #[tokio::test]
    async fn rejects_invalid_input_before_upload_and_keeps_usage_unknown() {
        let kibana = Kibana::new("https://example.invalid", "test-key").unwrap();
        let model = ElasticImage { kibana: &kibana };
        let failed = model.ask("photo_features", Effort::Low, MessageRequest::new().text("no image")).await.err().unwrap();
        assert!(failed.error.contains("not started"));
        assert_eq!(failed.call.model_used, "");
        assert_eq!((failed.call.input_tokens, failed.call.output_tokens), (0, 0));
    }

    #[test]
    fn failed_steps_keep_reported_usage_without_accepting_an_answer() {
        let metadata = json!({"usage": {"connectorId": "image-endpoint", "inputTokens": 75, "outputTokens": 2}});
        let execution = json!({"status": "failed", "error": "agent failed", "stepExecutions": [
            {"stepId": "answer", "status": "failed", "output": {"metadata": metadata, "structured_output": {"people_count": 0}}}
        ]});
        let mut call = new_call("photo_features");
        let mut reported = Value::Null;
        assert!(read_execution(&execution, &mut call, &mut reported).is_err());
        assert_eq!(reported, metadata);
        assert_eq!(call.stop_reason, "failed");
        assert_eq!(call.model_used, "elastic-connector:image-endpoint");
        assert_eq!((call.input_tokens, call.output_tokens), (75, 2));
    }

}
