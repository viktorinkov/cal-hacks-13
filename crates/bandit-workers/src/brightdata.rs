//! Bright Data for the jobs that start from a name: the Web MCP's search and the Web Unlocker's raw
//! answers (a page's HTML, or a file's bytes). Used by `venue_setup`, `venue_policy_lookup` and
//! `plan_lookup` (an attendee's health plan only).

use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::{Value, json};

use crate::jobs::JobError;

const MCP_URL: &str = "https://mcp.brightdata.com/mcp";
const MCP_PROTOCOL: &str = "2025-06-18";
const UNLOCKER_URL: &str = "https://api.brightdata.com/request";

pub struct BrightData {
    http: reqwest::Client,
    token: String,
    zone: String,
    session: String,
}

pub fn env(key: &str) -> Result<String, JobError> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| JobError::msg(format!("{key} is not set")))
}

pub fn err(what: &str, e: impl std::fmt::Display) -> JobError {
    JobError::msg(format!("{what}: {e}"))
}

impl BrightData {
    /// Opens a session on Bright Data's MCP server for the searches.
    pub async fn connect() -> Result<Self, JobError> {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(300)).build().map_err(|e| err("HTTP client", e))?;
        let mut bd = BrightData { http, token: env("BRIGHTDATA_API_TOKEN")?, zone: env("BRIGHTDATA_ZONE")?, session: String::new() };
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": MCP_PROTOCOL, "capabilities": {}, "clientInfo": {"name": "bandit-workers", "version": "0.1.0"}}
        });
        let res = bd.mcp(&init).await?;
        bd.session = res
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| JobError::msg("Bright Data sent no mcp-session-id"))?
            .to_string();
        bd.mcp(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).await?;
        Ok(bd)
    }

    async fn mcp(&self, body: &Value) -> Result<reqwest::Response, JobError> {
        let mut req = self
            .http
            .post(format!("{MCP_URL}?token={}", self.token))
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", MCP_PROTOCOL)
            .json(body);
        if !self.session.is_empty() {
            req = req.header("mcp-session-id", &self.session);
        }
        let res = req.send().await.map_err(|e| err("Bright Data MCP", e))?;
        res.error_for_status().map_err(|e| err("Bright Data MCP", e))
    }

    /// Google results for `query`, from the search tool of Bright Data's MCP server.
    pub async fn search(&self, query: &str) -> Result<String, JobError> {
        let body = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "search_engine", "arguments": {"query": query}}});
        let sse = self.mcp(&body).await?.text().await.map_err(|e| err("Bright Data search", e))?;
        let data = sse.lines().filter_map(|l| l.strip_prefix("data:")).last().ok_or_else(|| JobError::msg("Bright Data search: no data line"))?;
        let msg: Value = serde_json::from_str(data).map_err(|e| err("Bright Data search", e))?;
        if let Some(e) = msg.get("error") {
            return Err(err("Bright Data search", e));
        }
        let text: Vec<&str> = msg["result"]["content"].as_array().into_iter().flatten().filter_map(|c| c["text"].as_str()).collect();
        if msg["result"]["isError"] == true {
            return Err(err("Bright Data search", text.join(" ")));
        }
        Ok(untrusted_body(&text.join("\n")))
    }

    /// The raw answer for `url` through the Web Unlocker: a page's HTML or a file's bytes.
    pub async fn fetch(&self, url: &str) -> Result<Vec<u8>, String> {
        let res = self
            .http
            .post(UNLOCKER_URL)
            .bearer_auth(&self.token)
            .json(&json!({"zone": self.zone, "url": url, "format": "raw"}))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status();
        let site = res.headers().get("x-brd-status-code").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let body = res.bytes().await.map_err(|e| e.to_string())?;
        if !status.is_success() || !(site.is_empty() || site.starts_with('2')) {
            return Err(format!("Bright Data answered {status}, the site {}", if site.is_empty() { "?" } else { &site }));
        }
        Ok(body.to_vec())
    }

    /// A page's HTML through the Web Unlocker.
    pub async fn page(&self, url: &str) -> Result<String, String> {
        self.fetch(url).await.map(|b| String::from_utf8_lossy(&b).into_owned())
    }
}

/// The text between the MCP server's untrusted-content markers, or all of it.
pub fn untrusted_body(text: &str) -> String {
    static BEGIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"=====UNTRUSTED_([0-9a-f]+)_BEGIN=====\n").unwrap());
    let Some(m) = BEGIN.captures(text) else { return text.to_string() };
    let start = m.get(0).unwrap().end();
    let end = text.rfind(&format!("\n=====UNTRUSTED_{}_END=====", &m[1])).unwrap_or(text.len());
    text[start..end].to_string()
}

/// Every web address in `text`.
pub fn urls_in(text: &str) -> HashSet<String> {
    static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"https?://[^\s"'<>()\[\]{}|\\^`]+"#).unwrap());
    URL.find_iter(text).map(|m| m.as_str().trim_end_matches(['.', ',', ';', ':', '*']).to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_text_between_the_untrusted_markers() {
        let text = "note\n=====UNTRUSTED_ab12_BEGIN=====\nresults\n=====UNTRUSTED_ab12_END=====\nmore";
        assert_eq!(untrusted_body(text), "results");
        assert_eq!(untrusted_body("plain"), "plain");
    }
}
