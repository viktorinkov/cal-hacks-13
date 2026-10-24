use anyhow::{Context, Result, bail};
use reqwest::blocking::Response;
use serde_json::{Value, json};
use std::time::Duration;

const MCP_URL: &str = "https://mcp.brightdata.com/mcp";
const PROTOCOL: &str = "2025-06-18";

pub struct Client {
    http: reqwest::blocking::Client,
    url: String,
    session: String,
}

impl Client {
    pub fn connect(token: &str) -> Result<Client> {
        let http = reqwest::blocking::Client::builder().timeout(Duration::from_secs(600)).build()?;
        let url = format!("{MCP_URL}?token={token}&groups=advanced_scraping,browser,scrapers");
        let mut client = Client { http, url, session: String::new() };
        let init = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "bandit-ingest", "version": "0.1.0"}}
        });
        let res = client.post(&init)?;
        client.session = res.headers().get("mcp-session-id").context("Bright Data sent no mcp-session-id")?.to_str()?.to_string();
        client.post(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))?;
        Ok(client)
    }

    fn post(&self, body: &Value) -> Result<Response> {
        let mut req = self
            .http
            .post(&self.url)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL)
            .json(body);
        if !self.session.is_empty() {
            req = req.header("mcp-session-id", &self.session);
        }
        Ok(req.send()?.error_for_status()?)
    }

    pub fn call(&self, tool: &str, args: Value) -> Result<String> {
        let body = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": args}});
        let sse = self.post(&body)?.text()?;
        let data = sse.lines().filter_map(|l| l.strip_prefix("data:")).last().with_context(|| format!("{tool}: no data line"))?;
        let msg: Value = serde_json::from_str(data)?;
        if let Some(err) = msg.get("error") {
            bail!("{tool}: {err}");
        }
        let text: Vec<&str> = msg["result"]["content"].as_array().into_iter().flatten().filter_map(|c| c["text"].as_str()).collect();
        let text = text.join("\n");
        if msg["result"]["isError"] == true {
            bail!("{tool}: {text}");
        }
        Ok(untrusted_body(&text))
    }

    pub fn run_dataset(&self, dataset_id: &str, urls: &[String]) -> Result<String> {
        let input: Vec<Value> = urls.iter().map(|u| json!({"url": u})).collect();
        let mut res = self.call_json("run_scraper", json!({"dataset_id": dataset_id, "method": "collect_by_url", "input": input}))?;
        let snapshot = res["snapshot_id"].as_str().with_context(|| format!("run_scraper gave no snapshot_id: {res}"))?.to_string();
        while res["status"] != "ready" {
            std::thread::sleep(Duration::from_secs(30));
            let progress = self.call_json("get_scraper_progress", json!({"snapshot_id": snapshot}))?;
            match progress["status"].as_str() {
                Some("ready") => res = self.call_json("get_scraper_results", json!({"snapshot_id": snapshot}))?,
                Some("starting" | "running") => println!("fetch: dataset {dataset_id} snapshot {snapshot} still running"),
                _ => bail!("dataset {dataset_id} snapshot {snapshot}: {progress}"),
            }
        }
        Ok(res["data"].to_string())
    }

    fn call_json(&self, tool: &str, args: Value) -> Result<Value> {
        let text = self.call(tool, args)?;
        serde_json::from_str(&text).with_context(|| format!("{tool} returned no JSON: {text}"))
    }
}

fn untrusted_body(text: &str) -> String {
    let begin = regex::Regex::new(r"=====UNTRUSTED_([0-9a-f]+)_BEGIN=====\n").unwrap();
    let Some(m) = begin.captures(text) else { return text.to_string() };
    let start = m.get(0).unwrap().end();
    let end = text.rfind(&format!("\n=====UNTRUSTED_{}_END=====", &m[1])).unwrap_or(text.len());
    text[start..end].to_string()
}
