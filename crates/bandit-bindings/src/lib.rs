//! Rust client bindings generated from the band1t module, plus a connect
//! helper. Regenerate after any schema change with `./regen.sh`.

#[allow(clippy::all, unused)]
pub mod module_bindings;

pub use module_bindings::*;

use anyhow::{Context, Result};
use spacetimedb_sdk::{DbContext, Identity};
use std::sync::mpsc;
use std::time::Duration;

/// Connects with a saved token (or none, for a new identity), waits for the
/// connection, and runs the SDK on its own thread. Returns the connection,
/// the identity and the token to save.
pub fn connect(uri: &str, database: &str, token: Option<String>) -> Result<(DbConnection, Identity, String)> {
    let (tx, rx) = mpsc::channel();
    let err_tx = tx.clone();
    let conn = DbConnection::builder()
        .with_uri(uri)
        .with_database_name(database)
        .with_token(token)
        .on_connect(move |_, identity, token| {
            let _ = tx.send(Ok((identity, token.to_string())));
        })
        .on_connect_error(move |_, e| {
            let _ = err_tx.send(Err(format!("{e:?}")));
        })
        .build()
        .context("connecting to SpacetimeDB")?;
    conn.run_threaded();
    let (identity, token) = rx
        .recv_timeout(Duration::from_secs(20))
        .context("no answer from SpacetimeDB")?
        .map_err(|e| anyhow::anyhow!("connection refused: {e}"))?;
    Ok((conn, identity, token))
}

/// Subscribes to `queries` and blocks until the first rows arrive.
pub fn subscribe(conn: &DbConnection, queries: &[&str]) -> Result<()> {
    let (tx, rx) = mpsc::channel();
    let err_tx = tx.clone();
    let queries: Vec<String> = queries.iter().map(|q| q.to_string()).collect();
    conn.subscription_builder()
        .on_applied(move |_| {
            let _ = tx.send(Ok(()));
        })
        .on_error(move |_, e| {
            let _ = err_tx.send(Err(format!("{e:?}")));
        })
        .subscribe(queries);
    rx.recv_timeout(Duration::from_secs(20))
        .context("subscription timed out")?
        .map_err(|e| anyhow::anyhow!("subscription failed: {e}"))
}
