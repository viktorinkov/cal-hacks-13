use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize, Clone, Debug)]
pub struct Event {
    pub slug: String,
    pub name: String,
    pub website: String,
    pub timezone: String,
}

pub struct Config {
    pub event: Event,
    pub data_dir: PathBuf,
    pub elastic_dir: PathBuf,
    pub secrets_dir: PathBuf,
    pub brightdata_token: String,
    pub elastic_url: String,
    pub elastic_key: String,
    pub kibana_url: String,
    pub kibana_key: String,
    pub stdb_url: String,
    pub stdb_database: String,
}

impl Config {
    pub fn load(event: &str) -> Result<Config> {
        let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dotenvy::from_path(crate_dir.join("../../.env")).context("reading the repo .env")?;
        let var = |k: &str| std::env::var(k).with_context(|| format!("{k} is missing from .env"));
        let data_dir = crate_dir.join("events").join(event);
        let settings = data_dir.join("event.json");
        let text = std::fs::read_to_string(&settings).with_context(|| format!("reading {}", settings.display()))?;
        Ok(Config {
            event: serde_json::from_str(&text).with_context(|| format!("parsing {}", settings.display()))?,
            data_dir,
            elastic_dir: crate_dir.join("elastic"),
            secrets_dir: crate_dir.join(".secrets"),
            brightdata_token: var("BRIGHTDATA_API_TOKEN")?,
            elastic_url: var("ELASTICSEARCH_URL")?.trim_end_matches('/').to_string(),
            elastic_key: var("ELASTICSEARCH_API_KEY")?,
            kibana_url: var("KIBANA_URL")?.trim_end_matches('/').to_string(),
            kibana_key: var("KIBANA_API_KEY")?,
            stdb_url: var("SPACETIMEDB_URL")?.trim_end_matches('/').to_string(),
            stdb_database: var("SPACETIMEDB_DATABASE")?,
        })
    }
}
