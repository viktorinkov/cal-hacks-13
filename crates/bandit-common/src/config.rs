use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

use anyhow::Context;

use crate::{BlobStore, TokenStore};

pub const DEFAULT_SPACETIMEDB_URL: &str = "https://maincloud.spacetimedb.com";

/// Service configuration. Optional values are `None` when unset or empty.
/// `Debug` redacts the API keys.
#[derive(Clone, PartialEq, Eq)]
pub struct Config {
    pub spacetimedb_url: String,
    pub spacetimedb_database: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub anthropic_model: Option<String>,
    pub elasticsearch_url: Option<String>,
    pub elasticsearch_api_key: Option<String>,
    pub kibana_url: Option<String>,
    pub kibana_api_key: Option<String>,
    /// `BANDIT_DATA_DIR`, relative paths resolved against the `.env` folder (or the start dir).
    pub data_dir: PathBuf,
    /// The `.env` file that was read, if any.
    pub env_file: Option<PathBuf>,
}

impl Config {
    /// Load `.env` from the nearest folder at or above the current directory, then read
    /// the environment (real variables win over `.env`). The `.env` values are also
    /// exported to the process environment without overriding existing variables, so
    /// `RUST_LOG` and `ClaudeClient::from_env()` see them; call this once at startup.
    pub fn load() -> anyhow::Result<Self> {
        let cwd = std::env::current_dir().context("reading the current directory")?;
        if let Some(path) = find_env_file(&cwd) {
            dotenvy::from_path(&path).with_context(|| format!("loading {}", path.display()))?;
        }
        Self::load_from(&cwd, |k| std::env::var(k).ok())
    }

    /// Like [`load`](Self::load) but starting at `start` and reading real variables from
    /// `env`. Does not touch the process environment.
    pub fn load_from(start: &Path, env: impl Fn(&str) -> Option<String>) -> anyhow::Result<Self> {
        let env_file = find_env_file(start);
        let mut file_vars = HashMap::new();
        if let Some(path) = &env_file {
            let entries = dotenvy::from_path_iter(path)
                .with_context(|| format!("reading {}", path.display()))?;
            for entry in entries {
                let (key, value) = entry.with_context(|| format!("parsing {}", path.display()))?;
                file_vars.insert(key, value);
            }
        }
        let base = env_file.as_deref().and_then(Path::parent).unwrap_or(start);
        let mut config = Self::from_vars(base, |k| {
            env(k)
                .filter(|v| !v.trim().is_empty())
                .or_else(|| file_vars.get(k).cloned())
        });
        config.env_file = env_file;
        Ok(config)
    }

    /// Build from a variable lookup, resolving a relative data dir against `base_dir`.
    pub fn from_vars(base_dir: &Path, get: impl Fn(&str) -> Option<String>) -> Self {
        let var = |k: &str| {
            get(k)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let data_dir = var("BANDIT_DATA_DIR").unwrap_or_else(|| "var".into());
        Self {
            spacetimedb_url: var("SPACETIMEDB_URL")
                .unwrap_or_else(|| DEFAULT_SPACETIMEDB_URL.into()),
            spacetimedb_database: var("SPACETIMEDB_DATABASE"),
            anthropic_api_key: var("ANTHROPIC_API_KEY"),
            anthropic_model: var("ANTHROPIC_MODEL"),
            elasticsearch_url: var("ELASTICSEARCH_URL"),
            elasticsearch_api_key: var("ELASTICSEARCH_API_KEY"),
            kibana_url: var("KIBANA_URL"),
            kibana_api_key: var("KIBANA_API_KEY"),
            data_dir: base_dir.join(data_dir),
            env_file: None,
        }
    }

    /// Blob store under `<data_dir>/blobs`.
    pub fn blob_store(&self) -> BlobStore {
        BlobStore::new(&self.data_dir)
    }

    /// Token store under `<data_dir>/identities`.
    pub fn token_store(&self) -> TokenStore {
        TokenStore::new(&self.data_dir)
    }
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let redact = |v: &Option<String>| v.as_ref().map(|_| "<redacted>");
        f.debug_struct("Config")
            .field("spacetimedb_url", &self.spacetimedb_url)
            .field("spacetimedb_database", &self.spacetimedb_database)
            .field("anthropic_api_key", &redact(&self.anthropic_api_key))
            .field("anthropic_model", &self.anthropic_model)
            .field("elasticsearch_url", &self.elasticsearch_url)
            .field(
                "elasticsearch_api_key",
                &redact(&self.elasticsearch_api_key),
            )
            .field("kibana_url", &self.kibana_url)
            .field("kibana_api_key", &redact(&self.kibana_api_key))
            .field("data_dir", &self.data_dir)
            .field("env_file", &self.env_file)
            .finish()
    }
}

/// The `.env` file in `start` or its nearest ancestor that has one.
pub fn find_env_file(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .map(|dir| dir.join(".env"))
        .find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn finds_nearest_env_file_walking_up() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("a/b/c");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.path().join(".env"), "X=1\n").unwrap();
        assert_eq!(find_env_file(&nested), Some(root.path().join(".env")));
        fs::write(root.path().join("a/.env"), "X=2\n").unwrap();
        assert_eq!(find_env_file(&nested), Some(root.path().join("a/.env")));
    }

    #[test]
    fn real_env_wins_and_empty_counts_as_missing() {
        let root = tempfile::tempdir().unwrap();
        let start = root.path().join("crates/worker");
        fs::create_dir_all(&start).unwrap();
        fs::write(
            root.path().join(".env"),
            "SPACETIMEDB_DATABASE=bandit\nANTHROPIC_MODEL=from-file\nKIBANA_URL=\nANTHROPIC_API_KEY=file-key\n",
        )
        .unwrap();
        let env = |k: &str| match k {
            "ANTHROPIC_MODEL" => Some("from-env".to_string()),
            "ANTHROPIC_API_KEY" => Some(String::new()),
            _ => None,
        };
        let config = Config::load_from(&start, env).unwrap();
        assert_eq!(config.anthropic_model.as_deref(), Some("from-env"));
        assert_eq!(config.anthropic_api_key.as_deref(), Some("file-key"));
        assert_eq!(config.spacetimedb_database.as_deref(), Some("bandit"));
        assert_eq!(config.kibana_url, None);
        assert_eq!(config.spacetimedb_url, DEFAULT_SPACETIMEDB_URL);
        assert_eq!(config.data_dir, root.path().join("var"));
        assert_eq!(config.env_file, Some(root.path().join(".env")));
    }

    #[test]
    fn defaults_and_data_dir_resolution() {
        let base = tempfile::tempdir().unwrap();
        let config = Config::from_vars(base.path(), no_env);
        assert_eq!(config.spacetimedb_url, DEFAULT_SPACETIMEDB_URL);
        assert_eq!(config.data_dir, base.path().join("var"));
        assert!(config.anthropic_api_key.is_none() && config.elasticsearch_url.is_none());

        let relative = Config::from_vars(base.path(), |k| {
            (k == "BANDIT_DATA_DIR").then(|| "data".into())
        });
        assert_eq!(relative.data_dir, base.path().join("data"));
        let absolute = std::env::temp_dir().join("bandit-abs");
        let abs = absolute.to_string_lossy().to_string();
        let config = Config::from_vars(base.path(), |k| {
            (k == "BANDIT_DATA_DIR").then(|| abs.clone())
        });
        assert_eq!(config.data_dir, absolute);
        assert_eq!(config.blob_store().dir(), absolute.join("blobs"));
    }

    #[test]
    fn debug_redacts_secrets() {
        let config = Config::from_vars(Path::new("/srv"), |k| Some(format!("secret-{k}")));
        let shown = format!("{config:?}");
        assert!(!shown.contains("secret-ANTHROPIC_API_KEY"));
        assert!(!shown.contains("secret-ELASTICSEARCH_API_KEY"));
        assert!(!shown.contains("secret-KIBANA_API_KEY"));
        assert!(shown.contains("secret-KIBANA_URL"));
    }
}
