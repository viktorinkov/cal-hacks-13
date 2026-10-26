//! Event ingestion shared by the server worker and the maintenance CLI.

pub mod brightdata;
pub mod bundle;
pub mod config;
pub mod dashboards;
pub mod elastic;
pub mod fetch;
pub mod load;
pub mod map;
pub mod organize;
pub mod parse;
pub mod records;

use anyhow::{Context, Result};

/// Fetch current source evidence and produce the same checked bundle as the CLI.
/// The worker applies it through its leased result reducer; this function never
/// creates a database identity or writes directly to the event tables.
pub fn prepare_bundle(
    cfg: &config::Config,
    run_id: &str,
    mut progress: impl FnMut(&str, &str) -> Result<()>,
) -> Result<bundle::EventBundle> {
    progress("Preparing", "Preparing event matching and source records")?;
    organize::setup(cfg)?;
    fetch::run_with_progress(cfg, &mut progress)?;
    progress("Reading", "Reading sponsors, people and schedule from the fetched pages")?;
    parse::run(cfg)?;
    progress("Placing", "Applying the configured station and booth plan")?;
    map::run(cfg)?;
    progress("Matching", "Joining exact matches and resolving the remaining records with source evidence")?;
    organize::run(cfg, run_id)?;
    progress("Checking", "Checking every organization, person, booth and schedule link")?;
    let path = bundle::assemble(cfg, run_id)?;
    let bundle = serde_json::from_str(&std::fs::read_to_string(&path)?).context("reading the checked event bundle")?;
    progress("Recording", "Saving the import's source and matching history")?;
    dashboards::setup(cfg, run_id)?;
    Ok(bundle)
}
