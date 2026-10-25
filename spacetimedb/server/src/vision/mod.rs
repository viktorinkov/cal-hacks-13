//! Vision evidence interface (TBD -- LEO). Leo owns the cameras and models;
//! this file fixes only what insurance reads: cameras mapped to zones, a
//! per-incident assessment, and property events. A stub client (the
//! `bandit-claims vision` command) plays the vision service for the claims story.

use crate::roles::*;
use crate::safety::{self, Incident, IncidentKind, incident};
use crate::venue::zone;
use spacetimedb::{ReducerContext, Table, Timestamp};

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = camera, public)]
pub struct Camera {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub name: String,
    /// The zone the camera covers.
    pub zone_id: u64,
    /// `overhead` or `side`.
    pub mount: String,
    pub live: bool,
    pub last_frame_at: Option<Timestamp>,
}

/// One judgment of an incident from camera frames.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = vision_assessment)]
pub struct VisionAssessment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub incident_id: u64,
    /// `band_sos`, `band_fall`, `ground_alert` or `staff_button`.
    pub trigger: String,
    pub confirmed: bool,
    pub confidence: f32,
    /// What the frames show, for staff.
    pub description: String,
    pub recommended_action: String,
    /// The insurance-ready paragraph.
    pub incident_description: String,
    pub camera_id: u64,
    /// SHA-256 of each frame in the blob store, paired with `frame_times`.
    pub frame_hashes: Vec<String>,
    pub frame_times: Vec<Timestamp>,
    pub model_call_id: u64,
    pub created_at: Timestamp,
}

/// Something other than a person that needs a record, such as a fallen speaker.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = property_event)]
pub struct PropertyEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub camera_id: u64,
    pub zone_id: u64,
    /// `fallen_object`, `spill`, `damage` or `other`.
    pub kind: String,
    pub description: String,
    pub confidence: f32,
    pub observed_at: Timestamp,
    pub frame_hashes: Vec<String>,
    #[index(btree)]
    pub incident_id: u64,
}

#[spacetimedb::reducer]
pub fn upsert_camera(ctx: &ReducerContext, name: String, zone_id: u64, mount: String) -> Result<(), String> {
    require_role(ctx, &["vision", "ops"])?;
    if ctx.db.zone().id().find(zone_id).is_none() {
        return Err(format!("no zone {zone_id}"));
    }
    let row = Camera { id: 0, name: name.clone(), zone_id, mount, live: true, last_frame_at: None };
    match ctx.db.camera().name().find(&name) {
        Some(old) => {
            ctx.db.camera().id().update(Camera { id: old.id, last_frame_at: old.last_frame_at, ..row });
        }
        None => {
            ctx.db.camera().insert(row);
        }
    }
    Ok(())
}

/// The vision service's judgment of an incident, seconds after it opened.
#[spacetimedb::reducer]
pub fn submit_vision_assessment(
    ctx: &ReducerContext,
    incident_id: u64,
    trigger: String,
    confirmed: bool,
    confidence: f32,
    description: String,
    recommended_action: String,
    incident_description: String,
    camera_id: u64,
    frame_hashes: Vec<String>,
    frame_times: Vec<Timestamp>,
    model_call_id: u64,
) -> Result<(), String> {
    require_role(ctx, &["vision"])?;
    let i = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
    let cam = ctx.db.camera().id().find(camera_id).ok_or_else(|| format!("no camera {camera_id}"))?;
    if frame_hashes.len() != frame_times.len() {
        return Err("each frame needs one hash and one capture time".into());
    }
    if !(0.0..=1.0).contains(&confidence) {
        return Err("confidence is 0..1".into());
    }
    ctx.db.vision_assessment().insert(VisionAssessment {
        id: 0,
        incident_id,
        trigger,
        confirmed,
        confidence,
        description,
        recommended_action,
        incident_description,
        camera_id,
        frame_hashes,
        frame_times,
        model_call_id,
        created_at: ctx.timestamp,
    });
    let status = if confirmed { "confirmed" } else { "not_confirmed" };
    ctx.db.incident().id().update(Incident { vision_status: status.into(), ..i });
    ctx.db.camera().id().update(Camera { last_frame_at: Some(ctx.timestamp), ..cam });
    Ok(())
}

/// A property event from a camera. With `incident_id` 0 it opens a
/// `property` incident in the camera's zone; otherwise it attaches to that incident.
#[spacetimedb::reducer]
pub fn report_property_event(
    ctx: &ReducerContext,
    incident_id: u64,
    camera_id: u64,
    kind: String,
    description: String,
    confidence: f32,
    frame_hashes: Vec<String>,
) -> Result<(), String> {
    require_role(ctx, &["vision"])?;
    let cam = ctx.db.camera().id().find(camera_id).ok_or_else(|| format!("no camera {camera_id}"))?;
    let incident_id = if incident_id == 0 {
        let station_id = ctx.db.zone().id().find(cam.zone_id).map(|z| z.station_id).unwrap_or(0);
        safety::open(ctx, IncidentKind::Property, cam.zone_id, station_id, 0, "vision", None).id
    } else {
        let i = ctx.db.incident().id().find(incident_id).ok_or_else(|| format!("no incident {incident_id}"))?;
        if i.kind.is_injury() {
            return Err(format!("incident {incident_id} is an injury, not broken or taken property"));
        }
        i.id
    };
    ctx.db.property_event().insert(PropertyEvent {
        id: 0,
        camera_id,
        zone_id: cam.zone_id,
        kind,
        description,
        confidence,
        observed_at: ctx.timestamp,
        frame_hashes,
        incident_id,
    });
    Ok(())
}
