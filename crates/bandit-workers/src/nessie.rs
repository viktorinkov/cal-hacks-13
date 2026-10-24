//! A small client for Capital One's Nessie sandbox: customers, checking
//! accounts and deposits. The API key goes in the `key` query parameter, so
//! errors never carry a URL.

use std::fmt;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use hyphenate_core::Cents;
use reqwest::{Client, Method};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone)]
pub struct Nessie {
    http: Client,
    base: String,
    key: String,
}

impl fmt::Debug for Nessie {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Nessie").field("base", &self.base).finish_non_exhaustive()
    }
}

/// One deposit as Nessie lists it.
#[derive(Clone, Debug, Deserialize)]
pub struct Deposit {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(default)]
    pub description: String,
}

/// `18000` -> `180.00`: whole and fractional parts from integer division.
pub fn dollars(cents: Cents) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

/// `Maya Chen` -> (`Maya`, `Chen`); a single name gets the last name `Claimant`.
pub fn split_name(name: &str) -> (String, String) {
    let mut words = name.split_whitespace();
    let first = words.next().unwrap_or("BandIt").to_string();
    let rest: Vec<&str> = words.collect();
    let last = if rest.is_empty() { "Claimant".to_string() } else { rest.join(" ") };
    (first, last)
}

/// The deposit body (this sandbox requires `status`). `amount` is written
/// from the cents string, never through a float.
pub fn deposit_body(cents: Cents, date: &str, memo: &str) -> String {
    format!(
        r#"{{"medium":"balance","transaction_date":{},"status":"completed","amount":{},"description":{}}}"#,
        json!(date),
        dollars(cents),
        json!(memo)
    )
}

impl Nessie {
    pub fn new(base: &str, key: &str) -> Result<Self> {
        let http = Client::builder().timeout(Duration::from_secs(30)).build()?;
        Ok(Self { http, base: base.trim().trim_end_matches('/').to_string(), key: key.trim().to_string() })
    }

    async fn call(&self, method: Method, path: &str, body: Option<String>) -> Result<Value> {
        let mut req = self.http.request(method.clone(), format!("{}/{path}", self.base)).query(&[("key", &self.key)]);
        if let Some(body) = body {
            req = req.header("content-type", "application/json").body(body);
        }
        let resp = req.send().await.map_err(|e| e.without_url()).with_context(|| format!("Nessie {method} /{path}"))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.without_url())?;
        let value: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        if !status.is_success() {
            bail!("Nessie {method} /{path} returned {status}: {}", short(&value));
        }
        Ok(value)
    }

    /// The `_id` of what a POST created.
    async fn create(&self, path: &str, body: String) -> Result<String> {
        let v = self.call(Method::POST, path, Some(body)).await?;
        v["objectCreated"]["_id"]
            .as_str()
            .map(str::to_string)
            .with_context(|| format!("Nessie POST /{path} answered without objectCreated._id: {}", short(&v)))
    }

    /// Creates a customer with a placeholder address.
    pub async fn create_customer(&self, first_name: &str, last_name: &str) -> Result<String> {
        let body = json!({
            "first_name": first_name,
            "last_name": last_name,
            "address": { "street_number": "1", "street_name": "Festival Way", "city": "San Francisco", "state": "CA", "zip": "94123" }
        });
        self.create("customers", body.to_string()).await
    }

    /// Creates the claimant's "BandIt wallet" checking account.
    pub async fn create_wallet(&self, customer_id: &str) -> Result<String> {
        let body = json!({ "type": "Checking", "nickname": "BandIt wallet", "rewards": 0, "balance": 0 });
        self.create(&format!("customers/{}/accounts", path_id(customer_id)?), body.to_string()).await
    }

    pub async fn deposits(&self, account_id: &str) -> Result<Vec<Deposit>> {
        let v = self.call(Method::GET, &format!("accounts/{}/deposits", path_id(account_id)?), None).await?;
        serde_json::from_value(v).context("Nessie deposits are not a list")
    }

    /// Deposits `cents` dated `date` (`YYYY-MM-DD`) with `memo` as its description.
    pub async fn deposit(&self, account_id: &str, cents: Cents, date: &str, memo: &str) -> Result<String> {
        self.create(&format!("accounts/{}/deposits", path_id(account_id)?), deposit_body(cents, date, memo)).await
    }
}

/// Nessie ids (UUIDs here, hex object ids elsewhere); anything else cannot go in a path.
fn path_id(id: &str) -> Result<&str> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(id)
    } else {
        bail!("{id:?} is not a Nessie id")
    }
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.len() > 400 { format!("{}...", &s[..s.floor_char_boundary(400)]) } else { s }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_to_dollars() {
        assert_eq!(dollars(18_000), "180.00");
        assert_eq!(dollars(5), "0.05");
        assert_eq!(dollars(89_550), "895.50");
        assert_eq!(dollars(u64::MAX), "184467440737095516.15");
    }

    #[test]
    fn deposit_body_is_exact() {
        let body = deposit_body(18_000, "2026-10-24", "BandIt claim 7 \"payout\"");
        assert_eq!(body, r#"{"medium":"balance","transaction_date":"2026-10-24","status":"completed","amount":180.00,"description":"BandIt claim 7 \"payout\""}"#);
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["amount"].as_f64(), Some(180.0));
    }

    #[test]
    fn names_split_at_the_first_space() {
        assert_eq!(split_name("Maya Chen"), ("Maya".into(), "Chen".into()));
        assert_eq!(split_name(" Ana  Garcia Lopez "), ("Ana".into(), "Garcia Lopez".into()));
        assert_eq!(split_name("Prince"), ("Prince".into(), "Claimant".into()));
    }

    #[test]
    fn ids_are_checked_and_keys_hidden() {
        assert!(path_id("6720a1b2c3d4e5f6a7b8c9d0").is_ok() && path_id("9d0df4c2-b7eb-4923-8f87-91771203cd1a").is_ok());
        assert!(path_id("../customers").is_err() && path_id("").is_err());
        let n = Nessie::new("https://example.invalid/", "secret-key").unwrap();
        assert!(!format!("{n:?}").contains("secret"));
    }
}
