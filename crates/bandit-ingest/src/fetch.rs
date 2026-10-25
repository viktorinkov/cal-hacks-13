use crate::brightdata;
use crate::config::Config;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct Sources {
    pages: Vec<Page>,
    datasets: Vec<Dataset>,
}

#[derive(Deserialize)]
struct Page {
    source: String,
    kind: String,
    url: String,
}

#[derive(Deserialize)]
struct Dataset {
    source: String,
    kind: String,
    dataset_id: String,
    urls: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Snapshot {
    pub source: String,
    pub kind: String,
    pub url: String,
    pub product: String,
    pub tool: String,
    pub fetched_at: String,
    pub sha256: String,
    pub body: String,
}

const PEOPLE_FIELDS: [&str; 15] = [
    "employees",
    "top_reviews",
    "reviews_snippets",
    "founders",
    "contacts",
    "current_employees",
    "current_advisors",
    "leadership_hire",
    "people_highlights",
    "alumni",
    "investors",
    "contact_email",
    "email_address",
    "funding_rounds_list",
    "funding_rounds_detailed",
];

fn slug(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    rest.split(|c: char| !c.is_ascii_alphanumeric()).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-").to_ascii_lowercase()
}

fn save(cfg: &Config, source: &str, kind: &str, url: &str, product: &str, tool: &str, body: String) -> Result<()> {
    let snap = Snapshot {
        source: source.into(),
        kind: kind.into(),
        url: url.into(),
        product: product.into(),
        tool: tool.into(),
        fetched_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        sha256: format!("{:x}", Sha256::digest(body.as_bytes())),
        body,
    };
    let dir = cfg.data_dir.join("snapshots").join(source);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.json", slug(url)));
    std::fs::write(&path, serde_json::to_string_pretty(&snap)?)?;
    println!("fetch: {source} {url} ({} bytes) -> {}", snap.body.len(), path.display());
    Ok(())
}

fn without_people(body: &str) -> Result<String> {
    let mut rows: Vec<serde_json::Map<String, serde_json::Value>> = serde_json::from_str(body)?;
    for r in &mut rows {
        for f in PEOPLE_FIELDS {
            r.remove(f);
        }
    }
    Ok(serde_json::to_string(&rows)?)
}

pub fn run(cfg: &Config) -> Result<()> {
    run_with_progress(cfg, &mut |_, _| Ok(()))
}

pub fn run_with_progress(cfg: &Config, progress: &mut impl FnMut(&str, &str) -> Result<()>) -> Result<()> {
    let sources: Sources = serde_json::from_str(&std::fs::read_to_string(cfg.data_dir.join("sources.json"))?)?;
    let bd = brightdata::Client::connect(&cfg.brightdata_token)?;
    for p in &sources.pages {
        progress("Fetching", &format!("Reading {}", p.url))?;
        let body = bd.call("scrape_as_markdown", json!({"url": p.url}))?;
        save(cfg, &p.source, &p.kind, &p.url, "web_unlocker", "scrape_as_markdown", body)?;
    }
    for d in &sources.datasets {
        progress("Enriching", &format!("Fetching {} public records", d.source))?;
        let body = without_people(&bd.run_dataset(&d.dataset_id, &d.urls)?)?;
        save(cfg, &d.source, &d.kind, &format!("dataset:{}", d.dataset_id), "web_scraper_api", "run_scraper", body)?;
    }
    Ok(())
}
