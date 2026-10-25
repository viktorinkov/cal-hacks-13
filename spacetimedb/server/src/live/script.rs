//! What happens during the live run, in order: what kind of incident, in which zone, what the medic finds and
//! which clinic record follows. Who it happens to and where they stand comes from the run's seeded generator.
//! The first beats show every path a claim can take: three alike falls the organizer approves one by one, after
//! which Claude proposes a payment rule from them; a camera confirms equipment a guest knocked over and the guest
//! is charged; an SOS with no claim; an attendee's phone taken; a fourth alike fall the approved rule pays on its
//! own; a bill above the rule's ceiling; an attendee's laptop knocked off a table; an injury from home; a bag gone
//! with nobody named. After that the run keeps going with everyday falls. Who broke or took it is drawn from the
//! bands at the spot, and the floor staff name them. Injuries move between zones so no zone has three within five
//! minutes, which would hand the whole occurrence to the organizer. The medic's notes match the clinic records the
//! claims get (a first-aid sprain is always a slip on a spilled drink), so any mismatch the Evidence Engine or
//! Claude flags is a real one.

use super::*;
use crate::insurance::people::wearer;
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
    /// For broken or taken things: what staff write when they name who did it; empty when nobody is named.
    naming: &'static str,
    /// Whether a security camera covers the spot.
    camera: bool,
}

const fn fall(zone: &'static str, record: &'static str, note: &'static str) -> Beat {
    Beat { kind: IncidentKind::Fall, zone, record, note, resolution: "treated on site", cost_cents: 0, naming: "", camera: false }
}

const fn loss(kind: IncidentKind, zone: &'static str, note: &'static str, resolution: &'static str, cost_cents: u64, naming: &'static str, camera: bool) -> Beat {
    Beat { kind, zone, record: "", note, resolution, cost_cents, naming, camera }
}

const BEATS: &[Beat] = &[
    fall("floor", "first-aid-wrist", "on scene at the tables: slipped on a spilled drink, right wrist pain and mild swelling; ice and a wrap at first aid"),
    fall("sponsor", "first-aid-wrist", "at the sponsor tables: slipped on a spilled drink, right wrist sprain; ice and a wrap at first aid"),
    fall("food", "first-aid-wrist", "in the food line: slipped on a spilled drink, right wrist sprain; ice and a wrap at first aid"),
    loss(
        IncidentKind::Property,
        "stage",
        "a floor speaker was knocked off its stand at the stage; cabinet cracked, nobody under it",
        "area cleared, speaker sent for repair",
        240_000,
        "the stage camera shows this guest backing into the speaker stand while dancing",
        true,
    ),
    Beat {
        kind: IncidentKind::Sos,
        zone: "food",
        record: "",
        note: "",
        resolution: "felt dizzy in the food line; water and a seat, no treatment needed",
        cost_cents: 0,
        naming: "",
        camera: false,
    },
    loss(
        IncidentKind::Theft,
        "sponsor",
        "an attendee's phone was taken from the sponsor table while they talked to the sponsor; $899.00 to replace",
        "security reviewed the footage; the owner's own policy answers it",
        89_900,
        "the sponsor-tables camera shows this guest pocketing the phone and walking to the food line",
        true,
    ),
    fall("floor", "first-aid-wrist", "at the tables: slipped on a spilled drink between the rows, right wrist sprain; ice and a wrap at first aid"),
    fall("stage", "urgent-care-wrist", "in the crowd in front of the stage: fell when the crowd surged, left wrist swelling; referring to urgent care"),
    loss(
        IncidentKind::Breakage,
        "floor",
        "an attendee's laptop was knocked off their table by someone squeezing past; the screen is cracked, $1,199.00 to replace",
        "security took both names; the owner's own policy answers it",
        119_900,
        "the guest next to the table says this attendee's bag swept the laptop off; the floor camera agrees",
        true,
    ),
    fall("floor", "urgent-care-ankle-home", "at the tables: right ankle pain and swelling after a stumble; splinting it, referring to urgent care"),
    fall("sponsor", "first-aid-wrist", "at the sponsor tables: slipped on a spilled drink by the stools, right wrist sprain; ice and a wrap at first aid"),
    loss(
        IncidentKind::Theft,
        "food",
        "an attendee's backpack is gone from under their seat in the food line: headphones and a charger inside, $340.00",
        "security walked the area; no camera covers the seats",
        34_000,
        "",
        false,
    ),
];

/// After the scripted beats: everyday falls, mostly treated at first aid, sometimes nothing at all.
const EVERYDAY: &[Beat] = &[
    fall("floor", "first-aid-wrist", "at the tables: slipped on a spilled drink between the rows, right wrist sprain; ice and a wrap at first aid"),
    Beat { kind: IncidentKind::Fall, zone: "stage", record: "", note: "", resolution: "slipped, got straight up; no injury", cost_cents: 0, naming: "", camera: false },
    fall("sponsor", "first-aid-wrist", "at the sponsor tables: slipped on a spilled drink at a booth, right wrist sprain; ice and a wrap at first aid"),
    fall("food", "first-aid-wrist", "in the food line: slipped on spilled soda, right wrist sprain; ice and a wrap at first aid"),
];

/// Stages incident number `step` of the run.
pub fn stage(ctx: &ReducerContext, step: u16, rng: &mut StdRng) {
    let beat = BEATS.get(step as usize).unwrap_or(&EVERYDAY[(step as usize - BEATS.len()) % EVERYDAY.len()]);
    let Some(zone) = ctx.db.zone().iter().filter(|z| z.station_id != 0).find(|z| z.kind == beat.zone) else {
        return;
    };
    match beat.kind {
        IncidentKind::Property => property(ctx, beat, &zone, rng),
        IncidentKind::Theft | IncidentKind::Breakage => belonging(ctx, beat, &zone, rng),
        IncidentKind::Sos | IncidentKind::Fall => person(ctx, beat, &zone, rng),
    }
}

/// The hackers' bands that are up and about: who things happen to, and who breaks or takes them.
fn hackers(ctx: &ReducerContext, station: Option<u8>) -> Vec<Band> {
    let down: Vec<u32> = down_bands(ctx).iter().map(|d| d.band_id).collect();
    ctx.db
        .crowd_member()
        .iter()
        .filter(|m| !down.contains(&m.band_id))
        .filter(|m| ctx.db.crowd_group().id().find(m.group_id).is_some_and(|g| g.staff_booth == 0))
        .filter_map(|m| ctx.db.band().id().find(m.band_id))
        .filter(|b| b.online && station.is_none_or(|s| b.zone == s))
        .collect()
}

/// Bands this close to the spot count as at it, as the incident snapshot counts them, in metres.
const AT_SPOT_M: f32 = 8.0;

/// Who broke or took it: a crowd band at the spot, drawn by the run's generator; none when the beat names nobody.
fn culprit(ctx: &ReducerContext, beat: &Beat, station: u8, x: f32, y: f32, not: u32, rng: &mut StdRng) -> u32 {
    if beat.naming.is_empty() {
        return 0;
    }
    let near: Vec<u32> = hackers(ctx, Some(station))
        .into_iter()
        .filter(|b| b.id != not && (b.x_m - x).powi(2) + (b.y_m - y).powi(2) <= AT_SPOT_M * AT_SPOT_M)
        .map(|b| b.id)
        .collect();
    if near.is_empty() { 0 } else { near[rng.gen_range(0..near.len())] }
}

/// An attendee's own belonging is stolen or broken: they tell staff where they stand, and staff report it
/// for them. Whoever did it is drawn from the bands around them.
fn belonging(ctx: &ReducerContext, beat: &Beat, zone: &crate::venue::Zone, rng: &mut StdRng) {
    let mut pool = hackers(ctx, Some(zone.station_id));
    if pool.is_empty() {
        pool = hackers(ctx, None);
    }
    if pool.is_empty() {
        return;
    }
    let owner = &pool[rng.gen_range(0..pool.len())];
    let by = culprit(ctx, beat, owner.zone, owner.x_m, owner.y_m, owner.id, rng);
    let incident = safety::open(ctx, beat.kind, zone.id, owner.zone, owner.id, "ops", Some((owner.x_m, owner.y_m)));
    plan(ctx, &incident, beat, by);
    let who = wearer(ctx, owner.id).map(|(_, n)| n).unwrap_or_else(|| "an attendee".into());
    let place = place_name(ctx, owner.x_m, owner.y_m);
    let what = if beat.kind == IncidentKind::Theft { "something of theirs stolen" } else { "something of theirs broken" };
    record(ctx, incident.id, 0, "organizer", "Security", format!("{who} reports {what} at {place}"), beat.note.into());
}

/// Someone in the zone falls or presses SOS: their band goes down where they stand and raises it. The crowd
/// tick lights the circle around them from the next tick.
fn person(ctx: &ReducerContext, beat: &Beat, zone: &crate::venue::Zone, rng: &mut StdRng) {
    let mut pool = hackers(ctx, Some(zone.station_id));
    if pool.is_empty() {
        pool = hackers(ctx, None);
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
    plan(ctx, &incident, beat, 0);
    let who = wearer(ctx, b.id).map(|(_, n)| n).unwrap_or_else(|| "someone".into());
    let place = place_name(ctx, b.x_m, b.y_m);
    let (what, why) = if fall {
        (format!("Fall detected: {who} at {place}"), "the band's motion sensor saw a fall; the bands around them light the circle and point people away")
    } else {
        (format!("SOS: {who} pressed the button at {place}"), "the wearer held the band's button; the bands around them light the circle and point people away")
    };
    record(ctx, incident.id, 0, "band", &crate::band_code::band_code(b.id), what, why.into());
}

/// Equipment breaks where a camera sees it. Whoever did it is drawn from the bands at the spot.
fn property(ctx: &ReducerContext, beat: &Beat, zone: &crate::venue::Zone, rng: &mut StdRng) {
    let spots: Vec<(f32, f32)> = ctx
        .db
        .venue_spot()
        .iter()
        .filter(|s| s.station_id == zone.station_id && s.kind != "entrance" && s.kind != "exit")
        .map(|s| (s.x_m, s.y_m))
        .collect();
    let at = if spots.is_empty() { None } else { Some(spots[rng.gen_range(0..spots.len())]) };
    let (x, y) = at.unwrap_or_else(|| crate::venue::station_spot(ctx, zone.station_id));
    let by = culprit(ctx, beat, zone.station_id, x, y, 0, rng);
    let incident = safety::open(ctx, IncidentKind::Property, zone.id, zone.station_id, 0, "vision", Some((x, y)));
    plan(ctx, &incident, beat, by);
    let place = place_name(ctx, x, y);
    record(ctx, incident.id, 0, "camera", "Overhead camera", format!("Equipment down at {place}"), beat.note.into());
}

fn plan(ctx: &ReducerContext, incident: &safety::Incident, beat: &Beat, culprit_band: u32) {
    ctx.db.live_plan().insert(LivePlan {
        incident_id: incident.id,
        record: beat.record.into(),
        note: beat.note.into(),
        resolution: beat.resolution.into(),
        cost_cents: beat.cost_cents,
        camera: beat.camera,
        culprit_band,
        naming: if culprit_band == 0 { String::new() } else { beat.naming.into() },
    });
}
