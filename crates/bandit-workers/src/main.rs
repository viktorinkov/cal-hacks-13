//! `bandit-workers`: leases jobs from the BandIt SpacetimeDB module (insurance
//! claims, wallets, merch purchases and venue setup), does the external work (Claude,
//! Elastic, Nessie, Bright Data) and hands each result to the module's reducer for that job. Claude makes the judgment calls and
//! writes the words; code decides money.
//!
//! ```text
//! bandit-workers                            run the job loop
//! bandit-workers --once <kind> <payload>    run one handler on a payload file and print
//!                                           the reducer calls instead of making them
//! ```

mod extract;
mod jobs;
mod letters;
mod medical;
mod merch;
mod model;
mod nessie;
mod payout;
mod photo;
mod prompts;
mod review;
mod runner;
mod shop;
mod sink;
#[cfg(test)]
mod testdata;
mod venue;
mod verify;
mod wallet;

use std::sync::Arc;

use anyhow::{Context, Result, bail};
use bandit_common::Config;
use claims_elastic::ClaimsIndex;
use claude_client::ClaudeClient;

use crate::jobs::{Ctx, JobIn};
use crate::model::Claude;
use crate::nessie::Nessie;
use crate::sink::Sink;

const TOKEN_NAME: &str = "worker";

fn main() -> Result<()> {
    let config = Config::load()?;
    bandit_common::init_logging();
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [] => serve(config),
        [flag, kind, file] if flag == "--once" => once(config, kind, file),
        _ => bail!("usage: bandit-workers [--once <kind> <payload-file>]"),
    }
}

fn runtime() -> Result<tokio::runtime::Runtime> {
    Ok(tokio::runtime::Builder::new_multi_thread().enable_all().build()?)
}

fn context(config: &Config, sink: Sink) -> Result<Ctx> {
    let client = ClaudeClient::from_env().context("setting up the Claude client")?;
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let prefix = env("ELASTIC_INDEX_PREFIX").unwrap_or_else(|| claims_elastic::DEFAULT_PREFIX.into());
    let elastic = match (&config.elasticsearch_url, &config.elasticsearch_api_key) {
        (Some(url), Some(key)) => Some(ClaimsIndex::new(url, key)?.with_prefix(&prefix)),
        _ => None,
    };
    let nessie = match (env("NESSIE_BASE_URL"), env("NESSIE_API_KEY")) {
        (Some(url), Some(key)) => Some(Nessie::new(&url, &key)?),
        _ => None,
    };
    Ok(Ctx {
        claude: Claude { client },
        blobs: config.blob_store(),
        elastic,
        elastic_ready: tokio::sync::OnceCell::new(),
        nessie,
        data_dir: config.data_dir.clone(),
        tz_offset_minutes: bandit_insurance::config::Config::default().tz_offset_minutes,
        sink,
    })
}

/// Connects (outside any Tokio runtime, so the SDK runs on its own), then runs the job loop.
fn serve(config: Config) -> Result<()> {
    let database = config.spacetimedb_database.clone().context("SPACETIMEDB_DATABASE is not set")?;
    let tokens = config.token_store();
    let saved = tokens.load(TOKEN_NAME)?;
    let first_run = saved.is_none();
    let (conn, me, token) = bandit_bindings::connect(&config.spacetimedb_url, &database, saved)?;
    tokens.save(TOKEN_NAME, &token)?;
    tracing::info!(url = %config.spacetimedb_url, %database, identity = %me.to_hex(), "connected");
    if first_run {
        let id = me.to_hex();
        println!("New worker identity: 0x{id}");
        println!("Until the module owner runs grant_role(0x{id}, \"worker\", \"bandit-workers\") this worker sees no jobs, for example:");
        println!("  spacetime call {database} grant_role '\"0x{id}\"' '\"worker\"' '\"bandit-workers\"'");
    }
    bandit_bindings::subscribe(&conn, &["SELECT * FROM worker_jobs"])?;
    let conn = Arc::new(conn);
    let rt = runtime()?;
    let result = rt.block_on(async {
        let ctx = Arc::new(context(&config, Sink::Db(conn.clone()))?);
        if let Some(es) = &ctx.elastic {
            match ctx.elastic_ready.get_or_try_init(|| es.ensure_setup()).await {
                Ok(()) => tracing::info!("Elastic index and pipeline are set up"),
                Err(e) => tracing::warn!(error = %format!("{e:#}"), "Elastic setup failed; verify jobs will retry it"),
            }
        }
        runner::run(conn.clone(), me, ctx).await
    });
    // Running tasks hold the connection; stop them before it drops outside the runtime.
    rt.shutdown_timeout(std::time::Duration::from_secs(5));
    result
}

/// Runs one handler on a payload file, printing the reducer calls it would make.
fn once(config: Config, kind: &str, file: &str) -> Result<()> {
    if !jobs::handles(kind) {
        bail!("unknown job kind {kind}");
    }
    let payload = std::fs::read_to_string(file).with_context(|| format!("reading {file}"))?;
    let job = JobIn { id: 0, kind: kind.to_string(), payload, attempts: 1, max_attempts: 3 };
    runtime()?.block_on(async {
        let ctx = context(&config, Sink::Print)?;
        tracing::info!(kind, "job started");
        match jobs::run(&ctx, &job).await {
            Ok(()) => {
                tracing::info!(kind, "job finished");
                Ok(())
            }
            Err(e) => {
                ctx.sink.fail(job.id, e.error.clone(), e.calls).await?;
                bail!("{kind} failed: {}", e.error)
            }
        }
    })
}
