//! Organizer-selected actions for a named attendee of the running crowd.

use super::*;
use crate::departure::departure;
use crate::social::tables::{attendee, crowd_member};
use crate::venue::zone;

/// Stages an injury or theft for a chosen crowd attendee through the run's normal incident plan.
#[spacetimedb::reducer]
pub fn stage_crowd_action(ctx: &ReducerContext, band_id: u32, action: String) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if action != "injury" && action != "theft" {
        return Err("choose injury or theft".into());
    }
    let member = ctx.db.crowd_member().band_id().find(band_id).ok_or("this band is not worn by a crowd attendee")?;
    if !ctx.db.attendee().identity().find(member.identity).is_some_and(|person| person.crowd) {
        return Err("this band is not worn by a crowd attendee".into());
    }
    if ctx.db.departure().attendee().find(member.identity).is_some() {
        return Err("this attendee is leaving or has left".into());
    }
    let band = ctx.db.band().id().find(band_id).ok_or("this crowd band is missing")?;
    if band.zone == 0 || !band.x_m.is_finite() || !band.y_m.is_finite() {
        return Err("this attendee needs a recorded place".into());
    }
    let zone = ctx.db.zone().iter().find(|zone| zone.station_id == band.zone)
        .or_else(|| ctx.db.zone().iter().next())
        .ok_or("this attendee's zone is unknown")?;
    let busy = ctx.db.incident().resolved().filter(false).any(|incident| {
        incident.subject_band == band_id
            || ctx.db.live_plan().incident_id().find(incident.id).is_some_and(|plan| plan.culprit_band == band_id)
    });
    if busy {
        return Err("finish this attendee's open incident first".into());
    }
    script::stage_selected(ctx, &band, &zone, &action);
    Ok(())
}

#[cfg(test)]
mod tests;
