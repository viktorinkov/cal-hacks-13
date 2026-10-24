use crate::bundle::EventBundle;
use crate::config::Config;
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct NewIdentity {
    identity: String,
    token: String,
}

#[derive(Deserialize)]
struct SqlResult {
    rows: Vec<Vec<serde_json::Value>>,
}

fn token_path(cfg: &Config) -> PathBuf {
    let host = cfg.stdb_url.split("://").last().unwrap_or_default().replace([':', '/'], "_");
    cfg.data_dir.join(format!("../.secrets/{host}-{}.token", cfg.stdb_database))
}

fn token(cfg: &Config, http: &reqwest::blocking::Client) -> Result<String> {
    let path = token_path(cfg);
    if let Ok(token) = std::fs::read_to_string(&path) {
        return Ok(token.trim().to_string());
    }
    let id: NewIdentity = http.post(format!("{}/v1/identity", cfg.stdb_url)).send()?.error_for_status()?.json()?;
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, &id.token)?;
    println!("bandit-ingest identity: {}", id.identity);
    println!(
        "grant it once with: spacetime call {} grant_role '\"0x{}\"' '\"ingest\"' '\"bandit-ingest\"'",
        cfg.stdb_database, id.identity
    );
    Ok(id.token)
}

fn read_bundle(path: &Path) -> Result<EventBundle> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    Ok(serde_json::from_str(&text)?)
}

fn sql(cfg: &Config, http: &reqwest::blocking::Client, token: &str, query: &str) -> Result<Vec<Vec<serde_json::Value>>> {
    let res = http
        .post(format!("{}/v1/database/{}/sql", cfg.stdb_url, cfg.stdb_database))
        .bearer_auth(token)
        .body(query.to_string())
        .send()?;
    let status = res.status();
    let body = res.text()?;
    if !status.is_success() {
        bail!("sql {query:?} failed: {status} {body}");
    }
    let results: Vec<SqlResult> = serde_json::from_str(&body)?;
    Ok(results.into_iter().flat_map(|r| r.rows).collect())
}

pub fn run(cfg: &Config, path: &Path) -> Result<()> {
    let bundle = read_bundle(path)?;
    let http = reqwest::blocking::Client::new();
    let token = token(cfg, &http)?;
    let res = http
        .post(format!("{}/v1/database/{}/call/import_event", cfg.stdb_url, cfg.stdb_database))
        .bearer_auth(&token)
        .json(&[&bundle])
        .send()?;
    let status = res.status();
    if !status.is_success() {
        bail!("import_event refused the bundle: {status} {}", res.text()?);
    }
    let rows = sql(cfg, &http, &token, &format!("SELECT * FROM import_run WHERE run_id = '{}'", bundle.run_id))?;
    let last = rows.last().context("import_run row missing after import_event")?;
    let counts = last.last().and_then(|c| c.as_array()).cloned().unwrap_or_default();
    let summary: Vec<String> = counts.iter().map(|c| format!("{} +{} ~{}", c[0].as_str().unwrap_or("?"), c[1], c[2])).collect();
    println!("load: import_event committed run {} in one transaction ({})", bundle.run_id, summary.join(", "));
    Ok(())
}

pub fn verify(cfg: &Config, path: &Path) -> Result<()> {
    let bundle = read_bundle(path)?;
    let http = reqwest::blocking::Client::new();
    let token = token(cfg, &http)?;
    let venue = sql(cfg, &http, &token, &format!("SELECT id FROM venue WHERE source_key = '{}'", bundle.venue.source_key))?;
    let venue_id = venue.first().and_then(|r| r[0].as_u64()).context("the venue row is not in SpacetimeDB")?;
    let expected = [
        ("zone", bundle.zones.len()),
        ("organization", bundle.organizations.len()),
        ("person", bundle.people.len()),
        ("booth", bundle.booths.len()),
        ("schedule_slot", bundle.schedule.len()),
    ];
    let mut ok = true;
    for (table, want) in expected {
        let rows = sql(cfg, &http, &token, &format!("SELECT COUNT(*) AS n FROM {table} WHERE venue_id = {venue_id}"))?;
        let have = rows.first().and_then(|r| r[0].as_u64()).unwrap_or(0) as usize;
        println!("verify: {table:<14} bundle {want:>4}  spacetimedb {have:>4}");
        ok &= have >= want;
    }
    if !ok {
        bail!("SpacetimeDB holds fewer rows than the bundle");
    }
    Ok(())
}
