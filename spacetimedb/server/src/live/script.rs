//! What happens during the live run, in order: what kind of incident, in which zone, what the medic finds and
//! which clinic record follows. Who it happens to and where they stand comes from the run's seeded generator.
//! The first beats show every path a claim can take (the organizer teaches a rule, the rule settles the next
//! one on its own, a camera confirms broken equipment, an SOS with no claim, a bill above the learned ceiling,
//! an injury from home); after that the run keeps going with everyday falls. Injuries move between zones so no
//! zone has three within five minutes, which would hand the whole occurrence to the organizer. The medic's notes
//! match the clinic records the claims get (a first-aid sprain is always a slip on a spilled drink), so any
//! mismatch the Evidence Engine or Claude flags is a real one.

use super::*;
use crate::insurance::people::wearer;
use crate::departure::departure;
use crate::social::tables::{crowd_group, crowd_member};
use crate::venue::zone;
use spacetimedb::rand::rngs::StdRng;

struct Beat {
    kind: IncidentKind,
    /// The zone kind it happens in.
    zone: &'static str,
    record: &'static str,
    note: &'static str,
    resolution: &'static str,
    cost_cents: u64,
}

const fn fall(zone: &'static str, record: &'static str, note: &'static str) -> Beat {
    Beat { kind: IncidentKind::Fall, zone, record, note, resolution: "treated on site", cost_cents: 0 }
}

const BEATS: &[Beat] = &[
    fall("floor", "first-aid-wrist", "on scene at the tables: slipped on a spilled drink, right wrist pain and mild swelling; ice and a wrap at first aid"),
    fall("sponsor", "first-aid-wrist", "at the sponsor tables: slipped on a spilled drink, right wrist sprain; ice and a wrap at first aid"),
    Beat {
        kind: IncidentKind::Property,
        zone: "stage",
        record: "",
        note: "a floor speaker was knocked off its stand at the stage; cabinet cracked, nobody under it",
        resolution: "area cleared, speaker sent for repair",
        cost_cents: 240_000,
    },
    Beat {
        kind: IncidentKind::Sos,
        zone: "food",
        record: "",
        note: "",
        resolution: "felt dizzy in the food line; water and a seat, no treatment needed",
        cost_cents: 0,
    },
    fall("stage", "urgent-care-wrist", "in the crowd in front of the stage: fell when the crowd surged, left wrist swelling; referring to urgent care"),
    fall("floor", "urgent-care-ankle-home", "at the tables: right ankle pain and swelling after a stumble; splinting it, referring to urgent care"),
    fall("food", "first-aid-wrist", "in the food line: slipped on a spilled drink, right wrist sprain; ice and a wrap at first aid"),
    fall("sponsor", "first-aid-wrist", "at the sponsor tables: slipped on a spilled drink by the stools, right wrist sprain; ice and a wrap at first aid"),
];

/// After the scripted beats: everyday falls, mostly treated at first aid, sometimes nothing at all.
const EVERYDAY: &[Beat] = &[
    fall("floor", "first-aid-wrist", "at the tables: slipped on a spilled drink between the rows, right wrist sprain; ice and a wrap at first aid"),
    Beat { kind: IncidentKind::Fall, zone: "stage", record: "", note: "", resolution: "slipped, got straight up; no injury", cost_cents: 0 },
    fall("sponsor", "first-aid-wrist", "at the sponsor tables: slipped on a spilled drink at a booth, right wrist sprain; ice and a wrap at first aid"),
    fall("food", "first-aid-wrist", "in the food line: slipped on spilled soda, right wrist sprain; ice and a wrap at first aid"),
];

/// Stages incident number `step` of the run.
pub fn stage(ctx: &ReducerContext, step: u16, rng: &mut StdRng) {
    let beat = BEATS.get(step as usize).unwrap_or(&EVERYDAY[(step as usize - BEATS.len()) % EVERYDAY.len()]);
    let Some(zone) = ctx.db.zone().iter().filter(|z| z.station_id != 0).find(|z| z.kind == beat.zone) else {
        return;
    };
    if beat.kind == IncidentKind::Property {
        property(ctx, beat, &zone, rng);
    } else {
        person(ctx, beat, &zone, rng);
    }
}

/// Someone in the zone falls or presses SOS: their band goes down where they stand and raises it. The crowd
/// tick lights the circle around them from the next tick.
fn person(ctx: &ReducerContext, beat: &Beat, zone: &crate::venue::Zone, rng: &mut StdRng) {
    let down: Vec<u32> = down_bands(ctx).iter().map(|d| d.band_id).collect();
    let hackers = |station: Option<u8>| -> Vec<Band> {
        ctx.db
            .crowd_member()
            .iter()
            .filter(|m| !down.contains(&m.band_id) && ctx.db.departure().attendee().find(m.identity).is_none())
            .filter(|m| ctx.db.crowd_group().id().find(m.group_id).is_some_and(|g| g.staff_booth == 0))
            .filter_map(|m| ctx.db.band().id().find(m.band_id))
            .filter(|b| b.online && station.is_none_or(|s| b.zone == s))
            .collect()
    };
    let mut pool = hackers(Some(zone.station_id));
    if pool.is_empty() {
        pool = hackers(None);
    }
    if pool.is_empty() {
        return;
    }
    // A crowded spot is where people fall: the busiest bands are three times as likely.
    let weights: Vec<u32> = pool.iter().map(|b| 1 + 2 * b.state.min(2) as u32).collect();
    let total: u32 = weights.iter().sum();
    let mut roll = rng.gen_range(0..total);
    let mut pick = &pool[0];
    for (b, w) in pool.iter().zip(&weights) {
        if roll < *w {
            pick = b;
            break;
        }
        roll -= w;
    }
    let fall = beat.kind == IncidentKind::Fall;
    let b = ctx.db.band().id().update(Band {
        state: S_SOS,
        flags: if fall { F_FALL | F_MPU | F_MOTOR } else { F_SOS | F_MPU | F_MOTOR },
        fall,
        sos: !fall,
        last_seen: ctx.timestamp,
        ..ctx.db.band().id().find(pick.id).unwrap()
    });
    let incident = safety::open(ctx, beat.kind, zone.id, b.zone, b.id, "band", Some((b.x_m, b.y_m)));
    plan(ctx, &incident, beat);
    let who = wearer(ctx, b.id).map(|(_, n)| n).unwrap_or_else(|| "someone".into());
    let place = place_name(ctx, b.x_m, b.y_m);
    let (what, why) = if fall {
        (format!("Fall detected: {who} at {place}"), "the band's motion sensor saw a fall; the bands around them light the circle and point people away")
    } else {
        (format!("SOS: {who} pressed the button at {place}"), "the wearer held the band's button; the bands around them light the circle and point people away")
    };
    record(ctx, incident.id, 0, "band", &crate::band_code::band_code(b.id), what, why.into());
}

/// Someone of the crowd goes home early: a hacker who has walked in, is not down and has not left yet. They
/// walk to the nearest door, and their night ends as they walk out.
pub fn send_someone_home(ctx: &ReducerContext, rng: &mut StdRng) {
    let down: Vec<u32> = down_bands(ctx).iter().map(|d| d.band_id).collect();
    let mut pool: Vec<(u32, Identity)> = ctx
        .db
        .crowd_member()
        .iter()
        .filter(|m| !down.contains(&m.band_id) && ctx.db.departure().attendee().find(m.identity).is_none())
        .filter(|m| ctx.db.crowd_group().id().find(m.group_id).is_some_and(|g| g.staff_booth == 0))
        .filter(|m| ctx.db.band().id().find(m.band_id).is_some_and(|b| b.online))
        .map(|m| (m.band_id, m.identity))
        .collect();
    if pool.is_empty() {
        return;
    }
    pool.sort_by_key(|p| p.0);
    let (_, who) = pool[rng.gen_range(0..pool.len())];
    let _ = crate::departure::depart(ctx, who, "live run");
}

/// Equipment breaks where a camera sees it.
fn property(ctx: &ReducerContext, beat: &Beat, zone: &crate::venue::Zone, rng: &mut StdRng) {
    let spots: Vec<(f32, f32)> = ctx
        .db
        .venue_spot()
        .iter()
        .filter(|s| s.station_id == zone.station_id && s.kind != "entrance" && s.kind != "exit")
        .map(|s| (s.x_m, s.y_m))
        .collect();
    let at = if spots.is_empty() { None } else { Some(spots[rng.gen_range(0..spots.len())]) };
    let incident = safety::open(ctx, IncidentKind::Property, zone.id, zone.station_id, 0, "vision", at);
    plan(ctx, &incident, beat);
    let place = at.map(|(x, y)| place_name(ctx, x, y)).unwrap_or_else(|| zone.name.clone());
    record(ctx, incident.id, 0, "camera", "Overhead camera", format!("Equipment down at {place}"), beat.note.into());
}

fn plan(ctx: &ReducerContext, incident: &safety::Incident, beat: &Beat) {
    ctx.db.live_plan().insert(LivePlan {
        incident_id: incident.id,
        record: beat.record.into(),
        note: beat.note.into(),
        resolution: beat.resolution.into(),
        cost_cents: beat.cost_cents,
        camera: beat.kind == IncidentKind::Property,
    });
}
