//! Model execution records: every call, success or failure, becomes a `ModelCallIn` for
//! the module's audit table, and answers code rejects get one more try. A
//! tool loop calls [`Model::turn`] once per turn.

use std::future::Future;

use bandit_bindings::ModelCallIn;
use claude_client::{Effort, MessageRequest, ToolUse};
use serde_json::Value;

use crate::jobs::JobError;
use crate::prompts;

/// A structured answer and the record of the call that produced it.
pub struct Answer {
    pub json: Value,
    pub call: ModelCallIn,
}

/// One turn of a tool loop: response blocks, the tools it called, its
/// structured answer once it stops calling tools, and the call record.
pub struct Turn {
    pub content: Vec<Value>,
    pub tool_uses: Vec<ToolUse>,
    pub json: Option<Value>,
    pub call: ModelCallIn,
}

/// A failed call and its record.
pub struct Failed {
    pub error: String,
    pub call: ModelCallIn,
}

/// An executor that answers a structured request. Tests use a fake.
pub trait Model: Sync {
    /// Sends a structured request; `kind` labels the call record. Each executor records the settings it actually supports.
    fn ask(&self, kind: &str, effort: Effort, request: MessageRequest) -> impl Future<Output = Result<Answer, Failed>> + Send;

    /// Sends one turn of a tool loop; a turn that only calls tools is not a failure.
    fn turn(&self, kind: &str, effort: Effort, request: MessageRequest) -> impl Future<Output = Result<Turn, Failed>> + Send;
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
    /// For [`Model::turn`], an answer `{"_tools": [{"id", "name", "input"}]}` is a turn that calls those tools.
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

        /// The request body of call `i`.
        pub fn body(&self, i: usize) -> Value {
            self.seen.lock().unwrap()[i].1.clone()
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

        async fn turn(&self, kind: &str, effort: Effort, request: MessageRequest) -> Result<Turn, Failed> {
            let answer = self.ask(kind, effort, request).await?;
            let Some(tools) = answer.json.get("_tools").and_then(Value::as_array) else {
                let content = vec![serde_json::json!({"type": "text", "text": answer.json.to_string()})];
                return Ok(Turn { content, tool_uses: Vec::new(), json: Some(answer.json), call: answer.call });
            };
            let tool_uses: Vec<ToolUse> = tools
                .iter()
                .map(|t| ToolUse { id: t["id"].as_str().unwrap().into(), name: t["name"].as_str().unwrap().into(), input: t["input"].clone() })
                .collect();
            let content = tool_uses
                .iter()
                .map(|t| serde_json::json!({"type": "tool_use", "id": t.id, "name": t.name, "input": t.input}))
                .collect();
            Ok(Turn { content, tool_uses, json: None, call: answer.call })
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
