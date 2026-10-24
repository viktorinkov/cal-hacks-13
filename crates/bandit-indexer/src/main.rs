//! bandit-indexer: a one-way copy of venue and social rows from SpacetimeDB into Elastic.
//!
//! It subscribes to the venue tables and the role-checked social views (it needs the `indexer` role).
//! After the initial sync and after every change it rebuilds the documents from the subscription cache,
//! then writes the documents that changed and deletes the ones no longer built, at most once a second.
//! Nothing flows back into SpacetimeDB.

mod docs;
mod elastic;

use anyhow::{Context, Result};
use bandit_bindings::{
    BoothTableAccess, DbConnection, OrganizationTableAccess, ScheduleSlotTableAccess,
    SocialAttendeesTableAccess, SocialVisitsTableAccess, ZoneTableAccess, connect,
};
use bandit_common::Config;
use docs::{Docs, Index, Snapshot};
use elastic::{Elastic, Op};
use serde_json::Value;
use spacetimedb_sdk::{DbContext, Table, TableWithPrimaryKey};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const SERVICE: &str = "bandit-indexer";
const FLUSH_EVERY: Duration = Duration::from_secs(1);
const BULK_SIZE: usize = 100;
const QUERIES: [&str; 6] = [
    "SELECT * FROM zone",
    "SELECT * FROM organization",
    "SELECT * FROM booth",
    "SELECT * FROM schedule_slot",
    "SELECT * FROM social_attendees",
    "SELECT * FROM social_visits",
];

/// What Elastic holds as far as the indexer knows: the last document written per key,
/// or None for a document found in Elastic at startup.
type Sent = HashMap<(Index, String), Option<Value>>;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::load()?;
    let prefix = std::env::var("ELASTIC_INDEX_PREFIX").unwrap_or_else(|_| "bandit".into());
    let es = Elastic::new(
        config
            .elasticsearch_url
            .as_deref()
            .context("set ELASTICSEARCH_URL")?,
        config
            .elasticsearch_api_key
            .as_deref()
            .context("set ELASTICSEARCH_API_KEY")?,
        &prefix,
    )?;
    let mut sent = Sent::new();
    for index in Index::ALL {
        es.ensure_index(index).await?;
        for id in es.ids(index).await? {
            sent.insert((index, id), None);
        }
    }

    let database = config
        .spacetimedb_database
        .clone()
        .context("set SPACETIMEDB_DATABASE")?;
    let tokens = config.token_store();
    let (conn, identity, token) =
        connect(&config.spacetimedb_url, &database, tokens.load(SERVICE)?)?;
    tokens.save(SERVICE, &token)?;
    eprintln!("{SERVICE} connected as {identity}; it needs the indexer role");
    let dirty = Arc::new(AtomicBool::new(true));
    watch(&conn, &dirty);
    let (synced, initial_sync) = tokio::sync::oneshot::channel();
    conn.subscription_builder()
        .on_applied(move |_| {
            let _ = synced.send(());
        })
        .on_error(|_, e| {
            eprintln!("subscription failed: {e:?}");
            std::process::exit(1);
        })
        .subscribe(QUERIES);
    initial_sync.await?;
    eprintln!("initial sync of {database} done; indexing into {prefix}-*");

    let mut tick = tokio::time::interval(FLUSH_EVERY);
    loop {
        tick.tick().await;
        if dirty.swap(false, Ordering::SeqCst) {
            flush(&es, docs::build(&snapshot(&conn)), &mut sent, &dirty).await;
        }
    }
}

/// Every row change marks the documents dirty; the next flush rebuilds them.
fn watch(conn: &DbConnection, dirty: &Arc<AtomicBool>) {
    venue_table(&conn.db.zone(), dirty);
    venue_table(&conn.db.organization(), dirty);
    venue_table(&conn.db.booth(), dirty);
    venue_table(&conn.db.schedule_slot(), dirty);
    inserts_and_deletes(&conn.db.social_attendees(), dirty);
    inserts_and_deletes(&conn.db.social_visits(), dirty);
}

fn inserts_and_deletes<T: Table>(table: &T, dirty: &Arc<AtomicBool>) {
    let d = dirty.clone();
    table.on_insert(move |_, _| d.store(true, Ordering::SeqCst));
    let d = dirty.clone();
    table.on_delete(move |_, _| d.store(true, Ordering::SeqCst));
}

/// Tables with a primary key report an update instead of a delete and an insert.
fn venue_table<T: TableWithPrimaryKey>(table: &T, dirty: &Arc<AtomicBool>) {
    inserts_and_deletes(table, dirty);
    let d = dirty.clone();
    table.on_update(move |_, _, _| d.store(true, Ordering::SeqCst));
}

fn snapshot(conn: &DbConnection) -> Snapshot {
    Snapshot {
        zones: conn.db.zone().iter().collect(),
        organizations: conn.db.organization().iter().collect(),
        booths: conn.db.booth().iter().collect(),
        slots: conn.db.schedule_slot().iter().collect(),
        attendees: conn.db.social_attendees().iter().collect(),
        visits: conn.db.social_visits().iter().collect(),
    }
}

/// Writes the documents that changed since they were last written and deletes the ones no longer built.
/// An operation Elastic did not apply leaves `dirty` set, so the next flush tries it again.
async fn flush(es: &Elastic, docs: Docs, sent: &mut Sent, dirty: &AtomicBool) {
    let mut ops: Vec<Op> = sent
        .keys()
        .filter(|key| !docs.contains_key(*key))
        .map(|(index, id)| Op::Delete {
            index: *index,
            id: id.clone(),
        })
        .collect();
    for ((index, id), doc) in docs {
        let unchanged = matches!(sent.get(&(index, id.clone())), Some(Some(last)) if *last == doc);
        if !unchanged {
            ops.push(Op::Index { index, id, doc });
        }
    }
    if ops.is_empty() {
        return;
    }
    let (mut written, mut deleted) = (0, 0);
    let mut ops = ops.into_iter().peekable();
    while ops.peek().is_some() {
        let batch: Vec<Op> = ops.by_ref().take(BULK_SIZE).collect();
        let applied = match es.bulk(&batch).await {
            Ok(applied) => applied,
            Err(e) => {
                eprintln!("bulk request failed: {e:#}");
                vec![false; batch.len()]
            }
        };
        for (op, applied) in batch.into_iter().zip(applied) {
            if !applied {
                dirty.store(true, Ordering::SeqCst);
                continue;
            }
            match op {
                Op::Index { index, id, doc } => {
                    sent.insert((index, id), Some(doc));
                    written += 1;
                }
                Op::Delete { index, id } => {
                    sent.remove(&(index, id));
                    deleted += 1;
                }
            }
        }
    }
    eprintln!("flushed: {written} written, {deleted} deleted");
}
