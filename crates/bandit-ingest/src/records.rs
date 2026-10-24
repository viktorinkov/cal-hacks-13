use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use std::path::Path;

pub const RAW_PAGES: &str = "bandit-raw-pages";
pub const RAW_ORGS: &str = "bandit-raw-orgs";
pub const RAW_PLAN: &str = "bandit-raw-plan";

pub const ORGANIZATION_CANDIDATE: &str = "organization_candidate";
pub const PRIZE: &str = "prize";
pub const PERSON_CANDIDATE: &str = "person_candidate";
pub const SCHEDULE_ITEM: &str = "schedule_item";
pub const VENUE_FACT: &str = "venue_fact";
pub const COMPANY_FACTS: &str = "company_facts";
pub const VENUE_PLACE: &str = "venue_place";
pub const ZONE: &str = "zone";
pub const BOOTH_SPOT: &str = "booth_spot";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Record {
    pub index: String,
    pub record_kind: String,
    pub source_key: String,
    pub source_url: String,
    pub fetched_at: String,
    pub snapshot_sha256: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub domain: String,
    pub org_key: String,
    pub text: String,
    pub tier_text: String,
    pub role_text: String,
    pub location_text: String,
    pub location_norm: String,
    pub start_text: String,
    pub end_text: String,
    pub links: Vec<String>,
    pub fields: serde_json::Value,
}

pub fn norm_key(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase()
}

pub fn domain_of(link: &str) -> String {
    let host = url::Url::parse(link)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| link.trim_start_matches("www.").to_string())
        .to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').filter(|l| !l.is_empty()).collect();
    labels[labels.len().saturating_sub(2)..].join(".")
}

pub fn write_jsonl(path: &Path, records: &[Record]) -> Result<()> {
    std::fs::create_dir_all(path.parent().unwrap())?;
    let mut out = std::io::BufWriter::new(std::fs::File::create(path).with_context(|| format!("creating {}", path.display()))?);
    for r in records {
        serde_json::to_writer(&mut out, r)?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

pub fn read_jsonl(path: &Path) -> Result<Vec<Record>> {
    let file = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
    std::io::BufReader::new(file)
        .lines()
        .map(|line| Ok(serde_json::from_str(&line?)?))
        .collect()
}
