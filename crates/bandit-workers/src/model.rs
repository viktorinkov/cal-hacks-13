//! Claude calls: every call, success or failure, becomes a `ModelCallIn` for
//! the module's audit table, and answers code rejects get one more try.

use std::future::Future;
use std::time::Instant;

use bandit_bindings::ModelCallIn;
use claude_client::{CallOutcome, ClaudeClient, ClaudeError, Effort, MessageRequest};
use serde_json::Value;

use crate::jobs::JobError;
use crate::prompts;

/// Longest response text kept in a call record.
const MAX_RESPONSE_CHARS: usize = 20_000;

/// A structured answer and the record of the call that produced it.
pub struct Answer {
    pub json: Value,
    pub call: ModelCallIn,
}

/// A failed call and its record.
pub struct Failed {
    pub error: String,
    pub call: ModelCallIn,
}

/// Something that answers a Claude request with JSON. Tests use a fake.
pub trait Model: Sync {
    /// Sends `request` with `effort` and the refusal fallback; `kind` labels the call record.
    fn ask(&self, kind: &str, effort: Effort, request: MessageRequest) -> impl Future<Output = Result<Answer, Failed>> + Send;
}

/// The real model behind `claude-client`.
#[derive(Clone, Debug)]
pub struct Claude {
    pub client: ClaudeClient,
}

impl Model for Claude {
    async fn ask(&self, kind: &str, effort: Effort, request: MessageRequest) -> Result<Answer, Failed> {
        let request = request.effort(effort).refusal_fallback(true);
        let started = Instant::now();
        let mut call = new_call(kind);
        call.model_requested = self.client.model().to_string();
        call.effort = effort.as_str().to_string();
        call.request_hash = self.client.request_hash(&request);
        match self.client.call(&request).await {
            Ok(outcome) => {
                fill(&mut call, &outcome);
                call.status = "ok".into();
                match outcome.json {
                    Some(json) => Ok(Answer { json, call }),
                    None => {
                        call.status = "error".into();
                        call.error = "no structured output".into();
                        Err(Failed { error: call.error.clone(), call })
                    }
                }
            }
            Err(e) => {
                call.status = if matches!(e, ClaudeError::Refused { .. }) { "refusal" } else { "error" }.into();
                call.error = e.to_string();
                match e.outcome() {
                    Some(outcome) => fill(&mut call, outcome),
                    None => call.latency_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32,
                }
                Err(Failed { error: e.to_string(), call })
            }
        }
    }
}

/// An empty call record of `kind`.
pub fn new_call(kind: &str) -> ModelCallIn {
    ModelCallIn {
        kind: kind.to_string(),
        model_requested: String::new(),
        model_used: String::new(),
        effort: String::new(),
        request_hash: String::new(),
        status: String::new(),
        stop_reason: String::new(),
        input_tokens: 0,
        output_tokens: 0,
        latency_ms: 0,
        response: String::new(),
        error: String::new(),
    }
}

fn fill(call: &mut ModelCallIn, o: &CallOutcome) {
    call.model_used = o.model.clone();
    call.stop_reason = o.stop_reason.clone().unwrap_or_default();
    call.input_tokens = o.input_tokens.min(u32::MAX as u64) as u32;
    call.output_tokens = o.output_tokens.min(u32::MAX as u64) as u32;
    call.latency_ms = o.latency_ms.min(u32::MAX as u64) as u32;
    call.response = truncate(&o.text, MAX_RESPONSE_CHARS);
}

/// The first `max` characters of `s`.
pub fn truncate(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

/// The last answer and what code made of it, after at most two calls.
pub struct Tries<T> {
    pub json: Value,
    pub checked: Result<T, Vec<String>>,
    /// Every call made, in order.
    pub calls: Vec<ModelCallIn>,
}

/// Asks once; when `check` rejects the answer, asks once more with the
/// previous answer and the problems appended. A failed call is a `JobError`
/// carrying every call made so far.
pub async fn ask_twice<M: Model, T>(
    model: &M,
    kind: &str,
    effort: Effort,
    request: impl Fn() -> MessageRequest,
    check: impl Fn(&Value) -> Result<T, Vec<String>>,
) -> Result<Tries<T>, JobError> {
    let mut calls = Vec::new();
    let first = model.ask(kind, effort, request()).await.map_err(|f| JobError::from_call(f, &mut calls))?;
    calls.push(first.call);
    let checked = check(&first.json);
    let Err(problems) = checked else {
        return Ok(Tries { json: first.json, checked, calls });
    };
    tracing::info!(kind, problems = %problems.join("; "), "answer rejected, asking again");
    let retry = request().text(prompts::retry_note(&first.json, &problems));
    let second = model
        .ask(&format!("{kind}_retry"), effort, retry)
        .await
        .map_err(|f| JobError::from_call(f, &mut calls))?;
    calls.push(second.call);
    let checked = check(&second.json);
    Ok(Tries { json: second.json, checked, calls })
}

#[cfg(test)]
pub mod fake {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Serves canned answers in order (`Err` strings are failed calls) and keeps every request body.
    #[derive(Default)]
    pub struct FakeModel {
        pub answers: Mutex<VecDeque<Result<Value, String>>>,
        pub seen: Mutex<Vec<(String, Value)>>,
    }

    impl FakeModel {
        pub fn new(answers: Vec<Result<Value, String>>) -> Self {
            Self { answers: Mutex::new(answers.into()), seen: Mutex::default() }
        }

        /// The text blocks of request `i`, joined.
        pub fn text_of(&self, i: usize) -> String {
            let seen = self.seen.lock().unwrap();
            seen[i].1["messages"][0]["content"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        }

        pub fn calls(&self) -> usize {
            self.seen.lock().unwrap().len()
        }
    }

    impl Model for FakeModel {
        async fn ask(&self, kind: &str, effort: Effort, request: MessageRequest) -> Result<Answer, Failed> {
            let body = request.effort(effort).body("fake-model");
            self.seen.lock().unwrap().push((kind.to_string(), body));
            let call = ModelCallIn { model_used: "fake-model".into(), status: "ok".into(), ..new_call(kind) };
            match self.answers.lock().unwrap().pop_front().expect("no fake answer left") {
                Ok(json) => Ok(Answer { json, call }),
                Err(error) => Err(Failed { error: error.clone(), call: ModelCallIn { status: "error".into(), error, ..call } }),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeModel;
    use super::*;
    use serde_json::json;

    fn positive(v: &Value) -> Result<i64, Vec<String>> {
        let n = v["n"].as_i64().unwrap_or(0);
        if n > 0 { Ok(n) } else { Err(vec![format!("n is {n}, expected more than 0")]) }
    }

    #[tokio::test]
    async fn retries_once_with_the_problems() {
        let model = FakeModel::new(vec![Ok(json!({"n": 0})), Ok(json!({"n": 3}))]);
        let tries = ask_twice(&model, "t", Effort::Low, || MessageRequest::new().text("go"), positive).await.ok().unwrap();
        assert_eq!(tries.checked, Ok(3));
        assert_eq!(tries.calls.len(), 2);
        assert_eq!(tries.calls[1].kind, "t_retry");
        let retry = model.text_of(1);
        assert!(retry.contains("n is 0, expected more than 0") && retry.contains("{\"n\":0}"), "{retry}");
    }

    #[tokio::test]
    async fn keeps_the_last_answer_and_every_call() {
        let model = FakeModel::new(vec![Ok(json!({"n": 0})), Ok(json!({"n": -1}))]);
        let tries = ask_twice(&model, "t", Effort::Low, MessageRequest::new, positive).await.ok().unwrap();
        assert_eq!(tries.json, json!({"n": -1}));
        assert!(tries.checked.is_err());

        let model = FakeModel::new(vec![Ok(json!({"n": 0})), Err("HTTP 529".into())]);
        let err = ask_twice(&model, "t", Effort::Low, MessageRequest::new, positive).await.err().unwrap();
        assert_eq!(err.calls.len(), 2);
        assert_eq!(err.calls[1].status, "error");
        assert!(err.error.contains("HTTP 529"));
    }

    #[test]
    fn truncates_by_characters() {
        assert_eq!(truncate("héllo", 2), "hé");
        assert_eq!(truncate("abc", 20), "abc");
    }
}
