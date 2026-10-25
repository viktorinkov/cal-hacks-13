use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::path::{Path, PathBuf};

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
        Self::from_data_dir(&crate_dir, crate_dir.join("events").join(event))
    }

    /// Server jobs only accept a configured event, never a caller-supplied path.
    /// Each attempt has fresh snapshots; checked-in evidence is not a fallback.
    pub fn for_worker(event: &str, import_id: u64, attempt: u8, root: &Path) -> Result<Config> {
        let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let data_dir = prepare_inputs(&crate_dir, event, import_id, attempt, root)?;
        Self::from_data_dir(&crate_dir, data_dir)
    }

    fn from_data_dir(crate_dir: &Path, data_dir: PathBuf) -> Result<Config> {
        let var = |k: &str| std::env::var(k).with_context(|| format!("{k} is not configured"));
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

fn prepare_inputs(crate_dir: &Path, event: &str, import_id: u64, attempt: u8, root: &Path) -> Result<PathBuf> {
    if event != "calhacks-13" {
        bail!("this event has no configured source set");
    }
    let data_dir = root.join("event-import").join(import_id.to_string()).join(attempt.to_string());
    std::fs::create_dir_all(&data_dir)?;
    for name in ["event.json", "sources.json", "zones.json", "booths.json"] {
        let source = crate_dir.join("events").join(event).join(name);
        std::fs::copy(&source, data_dir.join(name)).with_context(|| format!("copying the configured {name}"))?;
    }
    Ok(data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_copy_only_inputs_into_separate_attempts() {
        let root = std::env::temp_dir().join(format!("bandit-ingest-inputs-{}", std::process::id()));
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let first = prepare_inputs(crate_dir, "calhacks-13", 9, 1, &root).unwrap();
        assert!(first.join("sources.json").is_file());
        assert!(!first.join("snapshots").exists());
        assert!(!first.join("bundles").exists());
        let second = prepare_inputs(crate_dir, "calhacks-13", 9, 2, &root).unwrap();
        assert_ne!(first, second);
        assert!(prepare_inputs(crate_dir, "../calhacks-13", 9, 1, &root).is_err());
        assert!(prepare_inputs(crate_dir, "/tmp", 9, 1, &root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
