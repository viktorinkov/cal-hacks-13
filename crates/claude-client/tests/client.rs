//! Tests against a mock HTTP server on 127.0.0.1. The real API is never called.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use claude_client::{
    API_VERSION, ClaudeClient, ClaudeError, Effort, FALLBACK_BETA, ImageType, MessageRequest,
    request_hash,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

struct Reply {
    status: u16,
    headers: Vec<(&'static str, &'static str)>,
    body: String,
    delay: Duration,
}

fn reply(status: u16, body: Value) -> Reply {
    Reply {
        status,
        headers: Vec::new(),
        body: body.to_string(),
        delay: Duration::ZERO,
    }
}

struct Seen {
    headers: Vec<(String, String)>,
    body: Value,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

type Log = Arc<Mutex<Vec<Seen>>>;

/// Serves `replies` in order, one connection each, and records every request.
async fn mock(replies: Vec<Reply>) -> (String, Log) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let log = Log::default();
    let seen = log.clone();
    tokio::spawn(async move {
        for reply in replies {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            seen.lock().unwrap().push(request);
            tokio::time::sleep(reply.delay).await;
            let mut head = format!(
                "HTTP/1.1 {} Mock\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n",
                reply.status,
                reply.body.len()
            );
            for (name, value) in reply.headers {
                head.push_str(&format!("{name}: {value}\r\n"));
            }
            head.push_str("\r\n");
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(reply.body.as_bytes()).await;
            let _ = socket.shutdown().await;
        }
    });
    (url, log)
}

async fn read_request(socket: &mut TcpStream) -> Seen {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let header_end = loop {
        let n = socket.read(&mut chunk).await.unwrap();
        assert!(n > 0, "client closed the connection early");
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let headers: Vec<(String, String)> = head
        .lines()
        .skip(1)
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let len: usize = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .map_or(0, |(_, v)| v.parse().unwrap());
    while buf.len() < header_end + len {
        let n = socket.read(&mut chunk).await.unwrap();
        assert!(n > 0, "client closed the connection early");
        buf.extend_from_slice(&chunk[..n]);
    }
    Seen {
        headers,
        body: serde_json::from_slice(&buf[header_end..header_end + len]).unwrap(),
    }
}

fn message(model: &str, content: Value, stop_reason: &str) -> Value {
    json!({
        "id": "msg_test", "type": "message", "role": "assistant", "model": model,
        "content": content, "stop_reason": stop_reason, "stop_details": null,
        "usage": {"input_tokens": 1200, "output_tokens": 340}
    })
}

fn client(url: &str) -> ClaudeClient {
    ClaudeClient::new("test-key")
        .unwrap()
        .with_base_url(url)
        .with_model("claude-opus-5-5")
}

fn claim_schema() -> Value {
    json!({
        "type": "object",
        "properties": {"approved": {"type": "boolean"}, "reason": {"type": "string"}},
        "required": ["approved", "reason"],
        "additionalProperties": false
    })
}

#[derive(Debug, Deserialize, PartialEq)]
struct Claim {
    approved: bool,
    reason: String,
}

#[tokio::test]
async fn structured_json_success() {
    let content = json!([
        {"type": "thinking", "thinking": "", "signature": "sig"},
        {"type": "text", "text": "{\"approved\": true, \"reason\": \"covered\"}"}
    ]);
    let (url, log) = mock(vec![reply(
        200,
        message("claude-opus-5-5", content, "end_turn"),
    )])
    .await;
    let request = MessageRequest::new()
        .system("You review insurance claims.")
        .pdf(b"%PDF-1.7 fake")
        .text("Review this claim.")
        .max_tokens(4000)
        .effort(Effort::High)
        .json_schema(claim_schema());

    let out = client(&url).call(&request).await.unwrap();

    assert_eq!(
        out.typed::<Claim>().unwrap(),
        Claim {
            approved: true,
            reason: "covered".into()
        }
    );
    assert_eq!(
        out.json,
        Some(json!({"approved": true, "reason": "covered"}))
    );
    assert_eq!(out.stop_reason.as_deref(), Some("end_turn"));
    assert_eq!(out.model, "claude-opus-5-5");
    assert_eq!(
        (out.input_tokens, out.output_tokens, out.attempts),
        (1200, 340, 1)
    );

    let seen = log.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let sent = &seen[0];
    assert_eq!(sent.header("x-api-key"), Some("test-key"));
    assert_eq!(sent.header("anthropic-version"), Some(API_VERSION));
    assert_eq!(sent.header("anthropic-beta"), None);
    let body = &sent.body;
    assert_eq!(body["model"], "claude-opus-5-5");
    assert_eq!(body["system"], "You review insurance claims.");
    assert_eq!(body["max_tokens"], 4000);
    assert_eq!(
        body["output_config"],
        json!({"effort": "high", "format": {"type": "json_schema", "schema": claim_schema()}})
    );
    let blocks = body["messages"][0]["content"].as_array().unwrap();
    assert_eq!(body["messages"][0]["role"], "user");
    assert_eq!(blocks[0]["type"], "document");
    assert_eq!(blocks[0]["source"]["media_type"], "application/pdf");
    assert_eq!(
        blocks[1],
        json!({"type": "text", "text": "Review this claim."})
    );
    for key in [
        "temperature",
        "top_p",
        "top_k",
        "thinking",
        "tools",
        "stream",
        "fallbacks",
    ] {
        assert!(body.get(key).is_none(), "unexpected field {key}");
    }
    assert_eq!(out.request_hash, request_hash(body));
}

#[tokio::test]
async fn retries_after_529_then_succeeds() {
    let overloaded = Reply {
        status: 529,
        headers: vec![("retry-after", "0")],
        body:
            json!({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})
                .to_string(),
        delay: Duration::ZERO,
    };
    let ok = reply(
        200,
        message(
            "claude-opus-5-5",
            json!([{"type": "text", "text": "hello"}]),
            "end_turn",
        ),
    );
    let (url, log) = mock(vec![overloaded, ok]).await;

    let out = client(&url)
        .call(&MessageRequest::new().text("hi"))
        .await
        .unwrap();

    assert_eq!(out.text, "hello");
    assert_eq!(out.json, None);
    assert_eq!(out.attempts, 2);
    let seen = log.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_eq!(seen[0].body, seen[1].body);
}

#[tokio::test]
async fn bad_request_is_not_retried() {
    let bad = reply(
        400,
        json!({"type": "error", "error": {"type": "invalid_request_error", "message": "bad"}}),
    );
    let ok = reply(200, message("claude-opus-5-5", json!([]), "end_turn"));
    let (url, log) = mock(vec![bad, ok]).await;

    let err = client(&url)
        .call(&MessageRequest::new().text("hi"))
        .await
        .unwrap_err();

    match err {
        ClaudeError::Http { status, body } => {
            assert_eq!(status, 400);
            assert!(body.contains("invalid_request_error"));
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn refusal_is_a_typed_error_with_usage() {
    let mut refused = message("claude-opus-5-5", json!([]), "refusal");
    refused["stop_details"] =
        json!({"type": "refusal", "category": "bio", "explanation": "declined"});
    let (url, _log) = mock(vec![reply(200, refused)]).await;

    let err = client(&url)
        .call(&MessageRequest::new().text("hi").json_schema(claim_schema()))
        .await
        .unwrap_err();

    let outcome = err
        .outcome()
        .expect("refusal keeps the call record")
        .clone();
    match err {
        ClaudeError::Refused {
            category,
            explanation,
            ..
        } => {
            assert_eq!(category.as_deref(), Some("bio"));
            assert_eq!(explanation.as_deref(), Some("declined"));
        }
        other => panic!("unexpected error: {other:?}"),
    }
    assert_eq!(outcome.model, "claude-opus-5-5");
    assert_eq!((outcome.input_tokens, outcome.output_tokens), (1200, 340));
    assert_eq!(outcome.stop_reason.as_deref(), Some("refusal"));
    assert_eq!(outcome.request_hash.len(), 64);
}

#[tokio::test]
async fn refusal_fallback_flag_sends_beta_and_default_fallbacks() {
    let content = json!([
        {"type": "fallback", "from": {"model": "claude-opus-5-5"}, "to": {"model": "claude-opus-4-8"}},
        {"type": "text", "text": "Dear patient,"}
    ]);
    let (url, log) = mock(vec![reply(
        200,
        message("claude-opus-4-8", content, "end_turn"),
    )])
    .await;

    let out = client(&url)
        .call(
            &MessageRequest::new()
                .text("Draft a letter.")
                .refusal_fallback(true),
        )
        .await
        .unwrap();

    assert_eq!(out.text, "Dear patient,");
    assert_eq!(out.model, "claude-opus-4-8");
    let seen = log.lock().unwrap();
    assert_eq!(seen[0].header("anthropic-beta"), Some(FALLBACK_BETA));
    assert_eq!(seen[0].body["fallbacks"], "default");
}

#[tokio::test]
async fn invalid_json_with_schema_is_an_error() {
    let truncated = message(
        "claude-opus-5-5",
        json!([{"type": "text", "text": "{\"approved\": tr"}]),
        "max_tokens",
    );
    let (url, _log) = mock(vec![reply(200, truncated)]).await;

    let err = client(&url)
        .call(&MessageRequest::new().text("hi").json_schema(claim_schema()))
        .await
        .unwrap_err();

    match err {
        ClaudeError::InvalidJson { outcome, .. } => {
            assert_eq!(outcome.stop_reason.as_deref(), Some("max_tokens"))
        }
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn timeout_is_not_retried() {
    let slow = Reply {
        delay: Duration::from_secs(5),
        ..reply(200, json!({}))
    };
    let (url, log) = mock(vec![slow]).await;

    let err = client(&url)
        .with_timeout(Duration::from_millis(300))
        .call(&MessageRequest::new().text("hi"))
        .await
        .unwrap_err();

    assert!(matches!(err, ClaudeError::Timeout), "{err:?}");
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[test]
fn missing_key_is_a_clear_error() {
    assert!(matches!(
        ClaudeClient::new(""),
        Err(ClaudeError::MissingApiKey)
    ));
    assert!(matches!(
        ClaudeClient::new(" \n"),
        Err(ClaudeError::MissingApiKey)
    ));
    if std::env::var("ANTHROPIC_API_KEY").map_or(true, |k| k.trim().is_empty()) {
        let err = ClaudeClient::from_env().unwrap_err();
        assert!(matches!(err, ClaudeError::MissingApiKey));
        assert!(err.to_string().contains("ANTHROPIC_API_KEY"));
    }
}

#[test]
fn request_hash_is_stable_and_tracks_bytes() {
    let client = ClaudeClient::new("test-key")
        .unwrap()
        .with_model("claude-opus-5-5");
    let build = |pdf: &[u8]| {
        MessageRequest::new()
            .system("s")
            .pdf(pdf)
            .image(ImageType::Png, b"png")
            .text("t")
    };

    let a = client.request_hash(&build(b"same bytes"));
    assert_eq!(a, client.request_hash(&build(b"same bytes")));
    assert_ne!(a, client.request_hash(&build(b"other bytes")));
    assert_ne!(
        a,
        client.request_hash(&build(b"same bytes").effort(Effort::Low))
    );
    assert_eq!(a.len(), 64);
    assert!(
        a.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
}

#[test]
fn request_hash_known_answer() {
    // "YWJj" is base64 for "abc"; keys are sorted at every level.
    let body = json!({"source": {"type": "base64", "data": "YWJj"}, "b": 1});
    let canonical = r#"{"b":1,"source":{"data":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","type":"base64"}}"#;
    assert_eq!(
        request_hash(&body),
        format!("{:x}", Sha256::digest(canonical.as_bytes()))
    );
}

#[test]
fn image_block_shape() {
    let body = MessageRequest::new()
        .image(ImageType::Jpeg, [0xFF, 0xD8, 0xFF])
        .text("What is this?")
        .body("m");
    assert_eq!(
        body["messages"][0]["content"][0],
        json!({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "/9j/"}})
    );
    assert_eq!(body["max_tokens"], claude_client::DEFAULT_MAX_TOKENS);
    assert!(body.get("output_config").is_none());
}

#[tokio::test]
async fn tool_loop_appends_turns_unchanged() {
    let first = json!([
        {"type": "thinking", "thinking": "", "signature": "sig-1"},
        {"type": "tool_use", "id": "toolu_1", "name": "read_evidence", "input": {"source": "light_circle", "reason": "who saw it"}}
    ]);
    let last = json!([{"type": "text", "text": "{\"approved\": true, \"reason\": \"three witnesses\"}"}]);
    let (url, log) = mock(vec![
        reply(200, message("claude-opus-5-5", first.clone(), "tool_use")),
        reply(200, message("claude-opus-5-5", last, "end_turn")),
    ])
    .await;
    let schema = json!({
        "type": "object",
        "properties": {"source": {"type": "string"}, "reason": {"type": "string"}},
        "required": ["source", "reason"],
        "additionalProperties": false
    });
    let request = MessageRequest::new()
        .system("You review insurance claims.")
        .text("Investigate claim 7.")
        .tool("read_evidence", "Read one evidence source.", schema)
        .json_schema(claim_schema());
    let c = client(&url);

    let out = c.call(&request).await.unwrap();
    assert_eq!(out.json, None, "a tool turn is not the answer");
    assert_eq!(out.tool_uses.len(), 1);
    assert_eq!((out.tool_uses[0].id.as_str(), out.tool_uses[0].name.as_str()), ("toolu_1", "read_evidence"));
    assert_eq!(out.tool_uses[0].input["source"], "light_circle");

    let next = request.next_turn(&out.content).tool_result("toolu_1", "3 witnesses in zone 101", false).tool_choice_none();
    let done = c.call(&next).await.unwrap();
    assert_eq!(done.typed::<Claim>().unwrap(), Claim { approved: true, reason: "three witnesses".into() });

    let seen = log.lock().unwrap();
    let body = &seen[0].body;
    assert_eq!(body["tools"][0]["name"], "read_evidence");
    assert_eq!(body["tools"][0]["strict"], true);
    assert!(body.get("tool_choice").is_none());
    let body = &seen[1].body;
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0]["content"][0]["text"], "Investigate claim 7.");
    assert_eq!(messages[1], json!({"role": "assistant", "content": first}), "Claude's turn goes back unchanged");
    assert_eq!(messages[2]["content"][0], json!({"type": "tool_result", "tool_use_id": "toolu_1", "content": "3 witnesses in zone 101"}));
    assert_eq!(body["tool_choice"], json!({"type": "none"}));
}
