//! Organizer-started event imports. The server worker fetches and organizes the configured public
//! sources, then applies the checked bundle and completes its job in the same transaction.

use super::tables::{EventBundle, SectionCount};
use crate::jobs::{self, Job};
use crate::roles::require_role;
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

pub const KIND_EVENT_IMPORT: &str = "event_import";
pub const RUNNING: &str = "running";
pub const READY: &str = "ready";
pub const FAILED: &str = "failed";
const EVENT_SLUG: &str = "calhacks-13";
const EVENT_NAME: &str = "Cal Hacks 13.0";

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = event_import, public)]
pub struct EventImport {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub event_slug: String,
    pub event_name: String,
    pub run_id: String,
    #[index(btree)]
    pub status: String,
    pub error: String,
    pub venue_id: u64,
    pub counts: Vec<SectionCount>,
    pub requested_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = event_import_step, public)]
pub struct EventImportStep {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub import_id: u64,
    pub step: String,
    pub detail: String,
    pub at: Timestamp,
}

fn step(ctx: &ReducerContext, import_id: u64, name: &str, detail: String) {
    ctx.db.event_import_step().insert(EventImportStep { id: 0, import_id, step: name.into(), detail, at: ctx.timestamp });
}

/// Imports the configured event's sources. Arbitrary paths and commands are never accepted.
#[spacetimedb::reducer]
pub fn start_event_import(ctx: &ReducerContext, event_slug: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if event_slug != EVENT_SLUG {
        return Err("this event has no configured import sources".into());
    }
    if ctx.db.event_import().status().filter(RUNNING).any(|run| run.event_slug == event_slug) {
        return Err("this event is already being imported".into());
    }
    let run = ctx.db.event_import().insert(EventImport {
        id: 0,
        event_slug: event_slug.clone(),
        event_name: EVENT_NAME.into(),
        run_id: String::new(),
        status: RUNNING.into(),
        error: String::new(),
        venue_id: 0,
        counts: Vec::new(),
        requested_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    let run_id = format!("{event_slug}-import-{}", run.id);
    let payload = serde_json::json!({ "import_id": run.id, "event_slug": event_slug, "run_id": run_id });
    jobs::enqueue(ctx, KIND_EVENT_IMPORT, payload.to_string(), KIND_EVENT_IMPORT, run.id);
    step(ctx, run.id, "Queued", format!("Importing {EVENT_NAME}"));
    ctx.db.event_import().id().update(EventImport { run_id, ..run });
    Ok(())
}

fn leased_import(ctx: &ReducerContext, job_id: u64) -> Result<(Job, EventImport), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    if job.kind != KIND_EVENT_IMPORT || job.subject_table != KIND_EVENT_IMPORT {
        return Err("job is not an event import".into());
    }
    let run = ctx.db.event_import().id().find(job.subject_id).ok_or("no such event import")?;
    if run.status != RUNNING {
        return Err("event import is no longer running".into());
    }
    Ok((job, run))
}

#[spacetimedb::reducer]
pub fn report_event_import_step(ctx: &ReducerContext, job_id: u64, name: String, detail: String) -> Result<(), String> {
    let (_, run) = leased_import(ctx, job_id)?;
    step(ctx, run.id, &name, detail);
    ctx.db.event_import().id().update(EventImport { updated_at: ctx.timestamp, ..run });
    Ok(())
}

/// The current worker alone can commit this run's bundle. Any failed reference rolls back both the
/// imported records and the completion, so the existing queue can safely retry the whole job.
#[spacetimedb::reducer]
pub fn finish_event_import(ctx: &ReducerContext, job_id: u64, bundle: EventBundle) -> Result<(), String> {
    let (job, run) = leased_import(ctx, job_id)?;
    if bundle.run_id != run.run_id || bundle.venue.source_key != format!("event:{}", run.event_slug) {
        return Err("bundle does not belong to this event import".into());
    }
    let imported = super::import::apply_event(ctx, bundle)?;
    let detail = imported
        .counts
        .iter()
        .map(|count| format!("{}: {} added, {} updated", count.section, count.inserted, count.updated))
        .collect::<Vec<_>>()
        .join("; ");
    step(ctx, run.id, "Ready", detail);
    ctx.db.event_import().id().update(EventImport {
        status: READY.into(),
        error: String::new(),
        venue_id: imported.venue_id,
        counts: imported.counts,
        updated_at: ctx.timestamp,
        ..run
    });
    jobs::finish(ctx, job, imported.run_id);
    Ok(())
}

pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_EVENT_IMPORT || job.subject_table != KIND_EVENT_IMPORT {
        return;
    }
    if let Some(run) = ctx.db.event_import().id().find(job.subject_id).filter(|run| run.status == RUNNING) {
        step(ctx, run.id, "Failed", job.error.clone());
        ctx.db.event_import().id().update(EventImport {
            status: FAILED.into(),
            error: job.error.clone(),
            updated_at: ctx.timestamp,
            ..run
        });
    }
}

#[cfg(test)]
mod tests;
