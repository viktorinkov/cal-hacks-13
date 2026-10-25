//! Shared service plumbing for BandIt: configuration, a local content-addressed blob
//! store, an identity token store and logging setup.

mod blob;
mod config;
mod pdf;
mod tokens;

pub use blob::{BlobInfo, BlobStore, sha256_hex};
pub use config::{Config, DEFAULT_SPACETIMEDB_URL, find_env_file};
pub use pdf::count_pages;
pub use tokens::TokenStore;

/// Install a `tracing` subscriber filtered by `RUST_LOG` (default `info`).
/// Does nothing if a global subscriber is already set.
pub fn init_logging() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).with_writer(std::io::stderr).try_init();
}

#[cfg(test)]
mod tests {
    #[test]
    fn init_logging_is_idempotent() {
        super::init_logging();
        super::init_logging();
    }
}
