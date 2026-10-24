//! Venue setup from the event's name alone. The organizer types the name; a worker searches for the
//! event's pages through Bright Data, Claude picks the event site, the venue and its public 3D map or
//! model among them, and Bright Data's browser exports the model. Every step lands here as it happens,
//! so the portal shows the run live, and the organizer picks which venue the portal shows. Setup 0 is
//! the Cal Hacks 13.0 model at the Palace of Fine Arts that ships with the app, the default.

use super::tables::Fact;
use crate::jobs::{self, Job};
use crate::roles::*;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp};

pub const KIND_VENUE_SETUP: &str = "venue_setup";

pub const RUNNING: &str = "running";
pub const READY: &str = "ready";
pub const NO_MODEL: &str = "no model";
pub const FAILED: &str = "failed";

/// The setup that ships with the app: Cal Hacks 13.0 at the Palace of Fine Arts.
pub const DEFAULT_SETUP: u64 = 0;

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = venue_setup, public)]
pub struct VenueSetup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// What the organizer typed.
    pub event_name: String,
    /// `running`, `ready` (a model was found), `no model` (the venue, but no public 3D model) or `failed`.
    #[index(btree)]
    pub status: String,
    pub event_site: String,
    pub venue_name: String,
    pub address: String,
    /// The page or file the model came from.
    pub map_url: String,
    /// How the worker got the model: `three.js scene`, `babylon scene`, `glTF file in the page`,
    /// `glTF file linked by the page` or `glTF file`.
    pub method: String,
    /// Where the pages load the model (a GLB) and its layout (JSON of named parts with their boxes).
    pub model_url: String,
    pub layout_url: String,
    pub model_bytes: u64,
    pub meshes: u32,
    pub triangles: u32,
    pub places: u32,
    /// The model's extent in its own units (metres for glTF), y up.
    pub size_x: f32,
    pub size_y: f32,
    pub size_z: f32,
    pub floor_plans: Vec<String>,
    /// Every page the run used, labelled.
    pub sources: Vec<Fact>,
    pub error: String,
    pub requested_by: Identity,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// One step of a setup run, in the order the worker reported them.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = venue_setup_step, public)]
pub struct VenueSetupStep {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub setup_id: u64,
    pub step: String,
    pub detail: String,
    pub at: Timestamp,
}

/// The venue the portal shows: one row, id 0. No row means the default.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = chosen_venue, public)]
pub struct ChosenVenue {
    #[primary_key]
    pub id: u8,
    pub setup_id: u64,
    pub chosen_by: Identity,
    pub chosen_at: Timestamp,
}

/// What the worker found. The hashes are blobs it stored and registered; empty when there is no model.
#[derive(SpacetimeType, Clone, Debug, Default)]
pub struct VenueSetupResult {
    pub event_site: String,
    pub venue_name: String,
    pub address: String,
    pub map_url: String,
    pub method: String,
    pub model_hash: String,
    pub layout_hash: String,
    pub model_bytes: u64,
    pub meshes: u32,
    pub triangles: u32,
    pub places: u32,
    pub size_x: f32,
    pub size_y: f32,
    pub size_z: f32,
    pub floor_plans: Vec<String>,
    pub sources: Vec<Fact>,
}

fn step(ctx: &ReducerContext, setup_id: u64, step: &str, detail: String) {
    ctx.db.venue_setup_step().insert(VenueSetupStep { id: 0, setup_id, step: step.into(), detail, at: ctx.timestamp });
}

fn is_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

/// Starts a setup run for the event the organizer named.
#[spacetimedb::reducer]
pub fn start_venue_setup(ctx: &ReducerContext, event_name: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let event_name = event_name.trim().to_string();
    if event_name.is_empty() || event_name.len() > 200 {
        return Err("type the event's name, up to 200 characters".into());
    }
    if ctx.db.venue_setup().status().filter(RUNNING).any(|s| s.event_name.eq_ignore_ascii_case(&event_name)) {
        return Err(format!("{event_name} is already being set up"));
    }
    let setup = ctx.db.venue_setup().insert(VenueSetup {
        id: 0,
        event_name: event_name.clone(),
        status: RUNNING.into(),
        event_site: String::new(),
        venue_name: String::new(),
        address: String::new(),
        map_url: String::new(),
        method: String::new(),
        model_url: String::new(),
        layout_url: String::new(),
        model_bytes: 0,
        meshes: 0,
        triangles: 0,
        places: 0,
        size_x: 0.0,
        size_y: 0.0,
        size_z: 0.0,
        floor_plans: Vec::new(),
        sources: Vec::new(),
        error: String::new(),
        requested_by: ctx.sender(),
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    step(ctx, setup.id, "Queued", format!("Setting up {event_name}"));
    let payload = serde_json::json!({ "setup_id": setup.id, "event_name": event_name });
    jobs::enqueue(ctx, KIND_VENUE_SETUP, payload.to_string(), "venue_setup", setup.id);
    Ok(())
}

/// The worker reports a step of the run.
#[spacetimedb::reducer]
pub fn report_venue_setup_step(ctx: &ReducerContext, job_id: u64, name: String, detail: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let setup = ctx.db.venue_setup().id().find(job.subject_id).ok_or("no such venue setup")?;
    step(ctx, setup.id, &name, detail);
    ctx.db.venue_setup().id().update(VenueSetup { updated_at: ctx.timestamp, ..setup });
    Ok(())
}

/// The worker found the venue, with or without a model.
#[spacetimedb::reducer]
pub fn finish_venue_setup(ctx: &ReducerContext, job_id: u64, result: VenueSetupResult) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let setup = ctx.db.venue_setup().id().find(job.subject_id).ok_or("no such venue setup")?;
    let has_model = !result.model_hash.is_empty();
    if has_model && !(is_hash(&result.model_hash) && is_hash(&result.layout_hash)) {
        return Err("the model and layout hashes must be hex SHA-256".into());
    }
    let blob = |h: &str| if h.is_empty() { String::new() } else { format!("/blobs/{}", h.to_lowercase()) };
    let status = if has_model { READY } else { NO_MODEL };
    let detail = if has_model {
        format!("{}: {} meshes, {} triangles", result.venue_name, result.meshes, result.triangles)
    } else {
        format!("{}: no public 3D map or model found", result.venue_name)
    };
    step(ctx, setup.id, if has_model { "Ready" } else { "No 3D model" }, detail);
    ctx.db.venue_setup().id().update(VenueSetup {
        status: status.into(),
        model_url: blob(&result.model_hash),
        layout_url: blob(&result.layout_hash),
        event_site: result.event_site,
        venue_name: result.venue_name,
        address: result.address,
        map_url: result.map_url,
        method: result.method,
        model_bytes: result.model_bytes,
        meshes: result.meshes,
        triangles: result.triangles,
        places: result.places,
        size_x: result.size_x,
        size_y: result.size_y,
        size_z: result.size_z,
        floor_plans: result.floor_plans,
        sources: result.sources,
        error: String::new(),
        updated_at: ctx.timestamp,
        ..setup
    });
    jobs::finish(ctx, job, status);
    Ok(())
}

/// The organizer picks the venue the portal shows: the default, or a setup that has a model.
#[spacetimedb::reducer]
pub fn choose_venue(ctx: &ReducerContext, setup_id: u64) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if setup_id != DEFAULT_SETUP {
        let setup = ctx.db.venue_setup().id().find(setup_id).ok_or("no such venue setup")?;
        if setup.status != READY {
            return Err(format!("{} has no 3D model to show", setup.event_name));
        }
    }
    let row = ChosenVenue { id: 0, setup_id, chosen_by: ctx.sender(), chosen_at: ctx.timestamp };
    if ctx.db.chosen_venue().id().find(0).is_some() {
        ctx.db.chosen_venue().id().update(row);
    } else {
        ctx.db.chosen_venue().insert(row);
    }
    Ok(())
}

/// A setup job gave up after its last attempt.
pub fn on_job_dead(ctx: &ReducerContext, job: &Job) {
    if job.kind != KIND_VENUE_SETUP {
        return;
    }
    if let Some(setup) = ctx.db.venue_setup().id().find(job.subject_id).filter(|s| s.status == RUNNING) {
        step(ctx, setup.id, "Failed", job.error.clone());
        ctx.db.venue_setup().id().update(VenueSetup { status: FAILED.into(), error: job.error.clone(), updated_at: ctx.timestamp, ..setup });
    }
}

#[cfg(test)]
mod tests;
