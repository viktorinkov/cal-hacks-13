//! The crowd: up to 2,000 attendees whose ands no radio carries (ids from 100), moving through the
//! venue's real zones and sponsor booths inside the module. Everything about them comes from code and a
//! seeded random generator: names, Instagram handles, the booth tags they care about, who staffs which
//! sponsor's booth and who hacks in which team. Their bands write the same `band`, `zone_visit` and
//! `encounter` rows a radio band does, so the Live tab counts and places them, the social tick turns them
//! into visits and graph links, and a test band standing among them meets them.
//!
//! - Hackers come in teams of 1 to 4 with a home table on the hacking floor. A team leaves its table for a
//!   sponsor booth that matches its members' interests, food, the main stage or the entrance, then returns.
//! - Each sponsor booth has staff who stay at it, with the odd food break.
//! - Teammates at the same spot are close on every tick. Strangers at the same spot sometimes start talking
//!   and stay close until one of them moves on; booth staff talk to visitors more often.
//! - One `crowd_tick` every 2 s moves the teams that are due, recounts every band's neighbours and writes
//!   only the bands that changed, in one transaction.

use super::graph::{relink, PERSON};
use super::logic::*;
use super::tables::*;
use super::tick::{ensure_tick, sync_encounter};
use crate::ingest::{close_stay, open_stay};
use crate::roles::require_role;
use crate::tables::*;
use crate::tables::micros;
use crate::venue::{booth, organization, zone, Booth, Organization, Zone};
use spacetimedb::rand::rngs::StdRng;
use spacetimedb::rand::{Rng, SeedableRng};
use spacetimedb::{AnonymousViewContext, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp};
use std::collections::{HashMap, HashSet};

pub const MAX_CROWD: u16 = 2_000;
const TICK_MILLIS: u64 = 2_000;
/// Each tick credits close time to the pairs of one slice of the crowd, so a pair is written every 30 s.
const SLICES: u64 = 15;
/// The crowd's time together runs this many times faster than the clock, so links appear within half a
/// minute and the graph grows while people watch. A test band counts real time.
const TOGETHER_SPEEDUP: u64 = 6;
/// Bands this close count as close to a test band, in metres.
const NEAR_M: f32 = 3.0;
/// Bands this close count as a band's neighbours for the crowding colours, as a band's radio hears them
/// above the settings' threshold.
const NEIGH_M: f32 = 1.5;
/// Chance per tick that an attendee starts talking to a stranger at the same spot (starting values).
const CHAT_CHANCE: f64 = 0.004;
const STAFF_CHAT_CHANCE: f64 = 0.05;
/// One attendee in ten staffs a sponsor's booth, at most this many per booth.
const STAFF_PER_BOOTH: usize = 2;
/// The crowd's closed stays are deleted after an hour, so the tables stay small; the links they made stay.
const KEEP_STAYS_MICROS: i64 = 3_600_000_000;
const PRUNE_EVERY_TICKS: u64 = 30;
/// Every attendee of the crowd is generated from this seed and their band id.
const SEED: u64 = 0xCA1_4AC5_0013;

const FIRST_NAMES: &[&str] = &[
    "Maya", "Ethan", "Priya", "Lucas", "Sofia", "Noah", "Aisha", "Diego", "Hana", "Marcus", "Elena", "Kenji", "Chloe",
    "Omar", "Zoe", "Ravi", "Isabel", "Tyler", "Mei", "Jonah", "Amara", "Leo", "Nina", "Caleb", "Yara", "Felix",
    "Grace", "Mateo", "Lena", "Sam", "Arjun", "Bianca", "Connor", "Dalia", "Emeka", "Fatima", "Gabriel", "Harper",
    "Ines", "Jamal", "Kira", "Liam", "Malia", "Nikhil", "Olivia", "Pablo", "Quinn", "Rosa", "Sanjay", "Talia", "Umar",
    "Vera", "Wes", "Ximena", "Yusuf", "Zara", "Aditi", "Ben", "Camila", "Daniel", "Esther", "Farah", "Gus", "Hiro",
    "Ivy", "Jae", "Kofi", "Lucia", "Max", "Nadia", "Oscar", "Paloma", "Rahul", "Sienna", "Theo", "Uma", "Victor",
    "Wen", "Yuki", "Zain", "Alana", "Bruno", "Cyrus", "Divya", "Eli", "Freya", "Gianna", "Hugo", "Ishaan", "Jade",
    "Kai", "Leila", "Mika", "Nora", "Owen", "Pia", "Rhea", "Soren", "Tara", "Ulises", "Vik", "Willa", "Xavier",
    "Yasmin", "Zeke", "Ana", "Brandon", "Celine", "Dev", "Emma", "Finn", "Gia", "Hamza", "Iris", "Jules", "Kenzo",
    "Lila", "Milo", "Noor", "Orion", "Petra", "Ren", "Sara", "Tomas", "Wanda",
];
const LAST_NAMES: &[&str] = &[
    "Chen", "Patel", "Garcia", "Kim", "Nguyen", "Okafor", "Silva", "Novak", "Haddad", "Rossi", "Tanaka", "Moreno",
    "Fischer", "Adeyemi", "Larsen", "Kaur", "Dubois", "Ivanova", "Mensah", "Park", "Singh", "Lopez", "Wang", "Ali",
    "Johnson", "Hernandez", "Sato", "Kowalski", "Rahman", "Costa", "Murphy", "Yilmaz", "Petrov", "Mwangi", "Lee",
    "Martinez", "Cohen", "Ito", "Gupta", "Nakamura", "Smith", "Reyes", "Zhang", "Ahmed", "Brown", "Torres", "Liu",
    "Kapoor", "Schmidt", "Ortiz", "Huang", "Diaz", "Wilson", "Choi", "Ramirez", "Yang", "Davis", "Iyer", "Lindqvist",
    "Romero", "Abebe", "Khan", "Nowak", "Gomez", "Taylor", "Wu", "Sanchez", "Kuznetsov", "Anderson", "Bose", "Flores",
    "Jung", "Mendes", "Clarke", "Osei", "Walker", "Shah", "Volkov", "Rivera", "Hoang", "Moore", "Tran", "Castillo",
    "Yamamoto", "Thompson", "Bauer", "Ruiz", "Lin", "Jackson", "Pereira", "Alvarez", "Saito", "Kumar", "Jensen",
    "Ng", "White", "Morales", "Ozturk", "Harris", "Vargas", "Das", "Muller", "Santos", "Hall", "Mehta", "Ross",
    "Barros", "Chowdhury", "Young", "Dang", "Popescu", "Afolabi", "Wright", "Bianchi", "Holm", "Rao", "Green", "Pham",
];
/// Handle endings people use on Instagram.
const HANDLE_ENDINGS: &[&str] = &["builds", ".dev", "codes", "hacks", ".ai", "makes", "ships", ".design"];
/// Booth tags that say who sponsors, not what a booth is about, so nobody is drawn to them.
const NOT_INTERESTS: &[&str] = &["sponsor", "partner", "bronze", "silver", "gold", "golden-bear", "anchor", "other"];

fn crowd_identity(band_id: u16) -> Identity {
    Identity::from_claims("bandit-crowd", &format!("band-{band_id}"))
}

fn rng_for(band_id: u16) -> StdRng {
    StdRng::seed_from_u64(SEED ^ (band_id as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

fn later(ctx: &ReducerContext, min_minutes: f32, max_minutes: f32) -> Timestamp {
    let secs = ctx.rng().gen_range(min_minutes * 60.0..max_minutes * 60.0) as i64;
    ctx.timestamp + seconds(secs)
}

// --- The venue as the crowd sees it ------------------------------------------------------------

#[derive(Clone, Copy)]
struct Rect {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
}

impl Rect {
    /// A zone's floor area as a rectangle around its centre on the plan, long side along x.
    fn of(z: &Zone) -> Rect {
        let aspect = match z.kind.as_str() {
            "floor" => 2.0,
            "sponsor" => 4.0,
            _ => 1.25,
        };
        let w = (z.area_sq_m.max(1.0) * aspect).sqrt();
        let h = z.area_sq_m.max(1.0) / w;
        Rect { x0: z.plan_x_m - w / 2.0, y0: z.plan_y_m - h / 2.0, x1: z.plan_x_m + w / 2.0, y1: z.plan_y_m + h / 2.0 }
    }

    /// This rectangle moved the shortest way out of `other`, with a metre between them, when they overlap.
    fn clear_of(self, other: &Rect) -> Rect {
        let gap = 1.0;
        let right = other.x1 + gap - self.x0;
        let left = self.x1 + gap - other.x0;
        let down = other.y1 + gap - self.y0;
        let up = self.y1 + gap - other.y0;
        if right <= 0.0 || left <= 0.0 || down <= 0.0 || up <= 0.0 {
            return self;
        }
        let (dx, dy) = [(right, 0.0), (-left, 0.0), (0.0, down), (0.0, -up)]
            .into_iter()
            .min_by(|a, b| (a.0 + a.1).abs().total_cmp(&(b.0 + b.1).abs()))
            .unwrap();
        Rect { x0: self.x0 + dx, y0: self.y0 + dy, x1: self.x1 + dx, y1: self.y1 + dy }
    }

    fn random_point(&self, rng: &mut impl Rng) -> (f32, f32) {
        let inset = 1.0f32.min((self.x1 - self.x0) / 4.0).min((self.y1 - self.y0) / 4.0);
        (rng.gen_range(self.x0 + inset..self.x1 - inset), rng.gen_range(self.y0 + inset..self.y1 - inset))
    }
}

/// Where a booth stands, and where its visitors and its staff stand.
#[derive(Clone)]
struct BoothSpot {
    id: u64,
    name: String,
    organization_id: u64,
    station: u8,
    visitor: (f32, f32),
    staff: (f32, f32),
    tags: Vec<String>,
    /// How strongly the booth draws a crowd, from the sponsor tier.
    pull: f32,
}

struct Venue {
    zones: Vec<(Zone, Rect)>,
    booths: Vec<BoothSpot>,
}

impl Venue {
    fn load(ctx: &ReducerContext) -> Venue {
        Venue::build(
            ctx.db.zone().iter().filter(|z| z.station_id != 0).collect(),
            |zone_id| ctx.db.booth().zone_id().filter(zone_id).collect(),
            |id| ctx.db.organization().id().find(id),
        )
    }

    /// The zones with a station, their booths and the booths' organisations, as the crowd uses them.
    fn build(stations: Vec<Zone>, booths_in: impl Fn(u64) -> Vec<Booth>, organization: impl Fn(u64) -> Option<Organization>) -> Venue {
        let mut stations = stations;
        stations.sort_by(|a, b| b.area_sq_m.total_cmp(&a.area_sq_m).then(a.id.cmp(&b.id)));
        let mut zones: Vec<(Zone, Rect)> = Vec::new();
        for z in stations {
            let mut r = Rect::of(&z);
            for (_, other) in &zones {
                r = r.clear_of(other);
            }
            zones.push((z, r));
        }
        zones.sort_by_key(|(z, _)| z.station_id);
        let mut booths = Vec::new();
        for (z, r) in &zones {
            let mut here: Vec<Booth> = booths_in(z.id);
            here.sort_by_key(|b| b.id);
            // Two rows of booths facing an aisle along the zone's long side.
            let per_row = here.len().div_ceil(2).max(1);
            let (w, h) = (r.x1 - r.x0, r.y1 - r.y0);
            for (i, b) in here.into_iter().enumerate() {
                let (row, col) = (i / per_row, i % per_row);
                let x = r.x0 + (col as f32 + 0.5) * w / per_row as f32;
                let (stand, aisle) = if row == 0 { (r.y0 + h * 0.2, r.y0 + h * 0.4) } else { (r.y0 + h * 0.8, r.y0 + h * 0.6) };
                let org = organization(b.organization_id);
                let mut tags = b.tags.clone();
                tags.extend(org.iter().flat_map(|o| o.tags.iter().cloned()));
                tags.retain(|t| !NOT_INTERESTS.contains(&t.as_str()));
                tags.sort();
                tags.dedup();
                let pull = match org.map(|o| o.sponsor_tier).unwrap_or_default().as_str() {
                    "Anchor" => 3.0,
                    "Golden Bear" => 2.5,
                    "Silver" => 1.5,
                    _ => 1.0,
                };
                booths.push(BoothSpot {
                    id: b.id,
                    name: b.name.clone(),
                    organization_id: b.organization_id,
                    station: z.station_id,
                    visitor: (x, aisle),
                    staff: (x, stand),
                    tags,
                    pull,
                });
            }
        }
        Venue { zones, booths }
    }

    fn zone_of_kind(&self, kind: &str) -> Option<&(Zone, Rect)> {
        self.zones.iter().find(|(z, _)| z.kind == kind)
    }

    /// The hacking floor, else the biggest zone: where teams have their tables.
    fn floor(&self) -> &(Zone, Rect) {
        self.zone_of_kind("floor")
            .or_else(|| self.zones.iter().max_by(|a, b| a.0.area_sq_m.total_cmp(&b.0.area_sq_m)))
            .expect("the venue has zones with a station")
    }

    /// A booth for people who care about `interests`: matching tags and bigger sponsors draw more.
    fn pick_booth(&self, interests: &[String], rng: &mut impl Rng) -> Option<&BoothSpot> {
        let weights: Vec<f32> = self
            .booths
            .iter()
            .map(|b| b.pull * (1.0 + 4.0 * b.tags.iter().filter(|t| interests.contains(t)).count() as f32))
            .collect();
        let total: f32 = weights.iter().sum();
        if total <= 0.0 {
            return None;
        }
        let mut roll = rng.gen_range(0.0..total);
        for (b, w) in self.booths.iter().zip(weights) {
            if roll < w {
                return Some(b);
            }
            roll -= w;
        }
        self.booths.last()
    }

    /// Booth tags weighted by how many booths carry them: what the crowd's interests are drawn from.
    fn interest_pool(&self) -> Vec<(String, u32)> {
        let mut counts: HashMap<&str, u32> = HashMap::new();
        for b in &self.booths {
            for t in &b.tags {
                *counts.entry(t.as_str()).or_default() += 1;
            }
        }
        let mut pool: Vec<(String, u32)> = counts.into_iter().map(|(t, n)| (t.to_string(), n + 1)).collect();
        pool.sort();
        pool
    }
}

/// Where a team goes next and how long it stays there: (station, booth, x, y, minutes from and to).
type Spot = (u8, u64, f32, f32, (f32, f32));

fn in_zone(venue: &Venue, kind: &str, minutes: (f32, f32), rng: &mut impl Rng) -> Option<Spot> {
    let (z, r) = venue.zone_of_kind(kind)?;
    let (x, y) = r.random_point(rng);
    Some((z.station_id, 0, x, y, minutes))
}

fn at_booth(venue: &Venue, interests: &[String], rng: &mut impl Rng) -> Option<Spot> {
    let b = venue.pick_booth(interests, rng)?;
    Some((b.station, b.id, b.visitor.0, b.visitor.1, (2.0, 5.0)))
}

fn next_spot(g: &CrowdGroup, interests: &[String], venue: &Venue, groups: &[CrowdGroup], rng: &mut impl Rng) -> Spot {
    let home: Spot = (g.home_station, g.staff_booth, g.home_x_m, g.home_y_m, if g.staff_booth != 0 { (15.0, 40.0) } else { (6.0, 15.0) });
    let at_home = g.station == g.home_station && g.booth_id == g.staff_booth && g.x_m == g.home_x_m && g.y_m == g.home_y_m;
    if g.staff_booth != 0 {
        // Staff mind their booth, with a food break now and then.
        return if at_home && rng.gen_bool(0.3) { in_zone(venue, "food", (4.0, 8.0), rng).unwrap_or(home) } else { home };
    }
    if !at_home {
        // From a booth people often try the next one; otherwise back to the table.
        return if g.booth_id != 0 && rng.gen_bool(0.35) { at_booth(venue, interests, rng).unwrap_or(home) } else { home };
    }
    let roll: f32 = rng.r#gen();
    let spot = if roll < 0.45 {
        at_booth(venue, interests, rng)
    } else if roll < 0.65 {
        in_zone(venue, "food", (4.0, 9.0), rng)
    } else if roll < 0.80 {
        in_zone(venue, "stage", (5.0, 12.0), rng)
    } else if roll < 0.90 {
        // Another team's table, to see friends.
        let others: Vec<&CrowdGroup> = groups.iter().filter(|o| o.staff_booth == 0 && o.id != g.id).collect();
        (!others.is_empty()).then(|| {
            let o = others[rng.gen_range(0..others.len())];
            (o.home_station, 0, o.home_x_m + 1.5, o.home_y_m, (3.0, 6.0))
        })
    } else if roll < 0.95 {
        in_zone(venue, "entrance", (1.0, 3.0), rng)
    } else {
        None
    };
    spot.unwrap_or(home)
}

/// One area of the venue plan, in metres: a zone with a station (booth 0) and its rectangle, or a booth with
/// where its staff stand (x0, y0) and where its visitors stand (x1, y1).
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct PlanArea {
    pub station_id: u8,
    pub booth_id: u64,
    pub name: String,
    pub x0_m: f32,
    pub y0_m: f32,
    pub x1_m: f32,
    pub y1_m: f32,
}

/// The plan the Live tab draws the bands on: the same zone rectangles and booth spots the crowd moves between.
#[spacetimedb::view(accessor = venue_plan, public)]
pub fn venue_plan(ctx: &AnonymousViewContext) -> Vec<PlanArea> {
    use crate::venue::{booth__view, organization__view, zone__view};
    let venue = Venue::build(
        ctx.db.zone().station_id().filter(1u8..).collect(),
        |zone_id| ctx.db.booth().zone_id().filter(zone_id).collect(),
        |id| ctx.db.organization().id().find(id),
    );
    let zones = venue.zones.iter().map(|(z, r)| PlanArea {
        station_id: z.station_id,
        booth_id: 0,
        name: z.name.clone(),
        x0_m: r.x0,
        y0_m: r.y0,
        x1_m: r.x1,
        y1_m: r.y1,
    });
    let booths = venue.booths.iter().map(|b| PlanArea {
        station_id: b.station,
        booth_id: b.id,
        name: b.name.clone(),
        x0_m: b.staff.0,
        y0_m: b.staff.1,
        x1_m: b.visitor.0,
        y1_m: b.visitor.1,
    });
    zones.chain(booths).collect()
}

// --- Starting and stopping ---------------------------------------------------------------------

/// Removes every attendee of the crowd, their bands and everything they left behind.
fn clear_crowd(ctx: &ReducerContext) {
    let crowd: Vec<Attendee> = ctx.db.attendee().iter().filter(|a| a.crowd).collect();
    for a in crowd {
        let links: Vec<u64> = ctx
            .db
            .people_link()
            .from_id()
            .filter(a.node_id)
            .filter(|l| l.from_kind == PERSON)
            .chain(ctx.db.people_link().to_id().filter(a.node_id).filter(|l| l.to_kind == PERSON))
            .map(|l| l.id)
            .collect();
        for id in links {
            ctx.db.people_link().id().delete(id);
        }
        for h in ctx.db.social_handle().owner().filter(a.identity).collect::<Vec<_>>() {
            ctx.db.social_handle().id().delete(h.id);
        }
        for v in ctx.db.visit().attendee().filter(a.identity).collect::<Vec<_>>() {
            ctx.db.visit().zone_visit_id().delete(v.zone_visit_id);
        }
        for e in ctx.db.social_encounter().attendee_a().filter(a.identity).chain(ctx.db.social_encounter().attendee_b().filter(a.identity)).collect::<Vec<_>>() {
            ctx.db.social_encounter().id().delete(e.id);
        }
        for s in ctx.db.shared_visit().attendee_a().filter(a.identity).chain(ctx.db.shared_visit().attendee_b().filter(a.identity)).collect::<Vec<_>>() {
            ctx.db.shared_visit().id().delete(s.id);
        }
        for t in ctx.db.photo_tag().attendee().filter(a.identity).collect::<Vec<_>>() {
            ctx.db.photo_tag().id().delete(t.id);
        }
        // The crowd once wore radio band ids.
        ctx.db.band_owner().owner().delete(a.identity);
        ctx.db.attendee().identity().delete(a.identity);
    }
    for b in ctx.db.band().iter().filter(|b| b.id >= FIRST_CROWD_BAND).collect::<Vec<_>>() {
        for v in ctx.db.zone_visit().band_id().filter(b.id).collect::<Vec<_>>() {
            ctx.db.zone_visit().id().delete(v.id);
        }
        for e in ctx.db.encounter().band_a().filter(b.id).chain(ctx.db.encounter().band_b().filter(b.id)).collect::<Vec<_>>() {
            ctx.db.encounter().key().delete(e.key);
        }
        ctx.db.band().id().delete(b.id);
    }
    for m in ctx.db.crowd_member().iter().collect::<Vec<_>>() {
        ctx.db.crowd_member().band_id().delete(m.band_id);
    }
    for g in ctx.db.crowd_group().iter().collect::<Vec<_>>() {
        ctx.db.crowd_group().id().delete(g.id);
    }
}

fn handle(first: &str, last: &str, rng: &mut impl Rng) -> String {
    let (f, l) = (first.to_ascii_lowercase(), last.to_ascii_lowercase());
    let n: u32 = rng.gen_range(1..100);
    match rng.gen_range(0..6) {
        0 => format!("{f}.{l}"),
        1 => format!("{f}{l}{n}"),
        2 => format!("{f}_{l}"),
        3 => format!("{}{l}", &f[..1]),
        4 => format!("{f}.{}{n}", &l[..1]),
        _ => format!("{f}{}", HANDLE_ENDINGS[rng.gen_range(0..HANDLE_ENDINGS.len())]),
    }
}

fn interests(pool: &[(String, u32)], rng: &mut impl Rng) -> Vec<String> {
    let total: u32 = pool.iter().map(|(_, n)| n).sum();
    let mut out: Vec<String> = Vec::new();
    for _ in 0..rng.gen_range(2..=3) {
        if total == 0 {
            break;
        }
        let mut roll = rng.gen_range(0..total);
        for (t, n) in pool {
            if roll < *n {
                if !out.contains(t) {
                    out.push(t.clone());
                }
                break;
            }
            roll -= n;
        }
    }
    out
}

/// One attendee of the crowd and their band, generated from the seed and the band id.
fn add_member(ctx: &ReducerContext, band_id: u16, g: &CrowdGroup, organization_id: u64, pool: &[(String, u32)]) {
    let mut rng = rng_for(band_id);
    let first = FIRST_NAMES[rng.gen_range(0..FIRST_NAMES.len())];
    let last = LAST_NAMES[rng.gen_range(0..LAST_NAMES.len())];
    let who = crowd_identity(band_id);
    let a = ctx.db.attendee().insert(Attendee {
        identity: who,
        node_id: 0,
        display_name: format!("{first} {last}"),
        photo_url: format!("https://i.pravatar.cc/300?img={}", rng.gen_range(1..=70)),
        findable: true,
        person_id: 0,
        organization_id,
        crowd: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    let ig = handle(first, last, &mut rng);
    if rng.gen_bool(0.3) {
        ctx.db.social_handle().insert(SocialHandle { id: 0, owner: who, platform: "threads".into(), handle: ig.clone(), updated_at: ctx.timestamp });
    }
    ctx.db.social_handle().insert(SocialHandle { id: 0, owner: who, platform: "instagram".into(), handle: ig, updated_at: ctx.timestamp });
    let spread = if g.staff_booth != 0 { 0.6 } else { 0.9 };
    ctx.db.crowd_member().insert(CrowdMember {
        band_id,
        identity: who,
        joined_at: ctx.timestamp - seconds(600),
        group_id: g.id,
        dx_m: rng.gen_range(-spread..spread),
        dy_m: rng.gen_range(-spread..spread),
        interests: interests(pool, &mut rng),
        chat: 0,
    });
    relink(ctx, &a);
}

/// Replaces the crowd with `size` new attendees (at most 2,000, ids from 100) and starts moving them;
/// 0 removes the crowd. Run once after the venue is imported.
#[spacetimedb::reducer]
pub fn start_crowd(ctx: &ReducerContext, size: u16) -> Result<(), String> {
    require_role(ctx, &["ops", "tester"])?;
    if size > MAX_CROWD {
        return Err(format!("the crowd is at most {MAX_CROWD} bands"));
    }
    let venue = Venue::load(ctx);
    if venue.zones.is_empty() {
        return Err("import the venue first: the crowd moves between zones that have a station".into());
    }
    clear_crowd(ctx);
    if size == 0 {
        return Ok(());
    }
    let pool = venue.interest_pool();
    let mut rng = StdRng::seed_from_u64(SEED);
    let (floor, floor_rect) = venue.floor().clone();

    // One in ten staffs a booth, two per booth, the biggest sponsors first.
    let mut staffed: Vec<&BoothSpot> = venue.booths.iter().collect();
    staffed.sort_by(|a, b| b.pull.total_cmp(&a.pull).then(a.id.cmp(&b.id)));
    let staff_booths: Vec<&BoothSpot> =
        staffed.iter().flat_map(|b| std::iter::repeat_n(*b, STAFF_PER_BOOTH)).take(size as usize / 10).collect();

    let mut groups: Vec<CrowdGroup> = Vec::new();
    let mut band_id = FIRST_CROWD_BAND;
    let last = FIRST_CROWD_BAND + size;
    let mut add_group = |staff: Option<&BoothSpot>, rng: &mut StdRng| -> CrowdGroup {
        let id = groups.len() as u16 + 1;
        let (home_station, home_booth, (hx, hy)) = match staff {
            Some(b) => (b.station, b.id, b.staff),
            None => (floor.station_id, 0, floor_rect.random_point(rng)),
        };
        let g = CrowdGroup {
            id,
            staff_booth: home_booth,
            home_station,
            home_x_m: hx,
            home_y_m: hy,
            station: home_station,
            booth_id: home_booth,
            x_m: hx,
            y_m: hy,
            next_move_at: ctx.timestamp,
        };
        groups.push(g.clone());
        g
    };
    for b in staff_booths {
        if band_id >= last {
            break;
        }
        let g = add_group(Some(b), &mut rng);
        add_member(ctx, band_id, &g, b.organization_id, &pool);
        band_id += 1;
    }
    while band_id < last {
        let team = [1, 2, 2, 3, 3, 3, 4, 4, 4][rng.gen_range(0..9)].min(last - band_id);
        let g = add_group(None, &mut rng);
        for _ in 0..team {
            add_member(ctx, band_id, &g, 0, &pool);
            band_id += 1;
        }
    }

    // A third of the teams start away from their table, and everyone's next move is spread over the first
    // minutes, so the venue is busy from the start instead of everyone leaving at once.
    let members: Vec<CrowdMember> = ctx.db.crowd_member().iter().collect();
    for g in &mut groups {
        let interests: Vec<String> = members.iter().filter(|m| m.group_id == g.id).flat_map(|m| m.interests.clone()).collect();
        if g.staff_booth == 0 && rng.gen_bool(0.35) {
            let (station, booth_id, x, y, _) = next_spot(g, &interests, &venue, &[], &mut rng);
            (g.station, g.booth_id, g.x_m, g.y_m) = (station, booth_id, x, y);
        }
        g.next_move_at = ctx.timestamp + seconds(rng.gen_range(20..600));
        ctx.db.crowd_group().insert(g.clone());
    }
    ensure_tick(ctx);
    for t in ctx.db.crowd_timer().iter().collect::<Vec<_>>() {
        ctx.db.crowd_timer().scheduled_id().delete(t.scheduled_id);
    }
    ctx.db.crowd_timer().insert(CrowdTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(std::time::Duration::from_millis(TICK_MILLIS).into()),
    });
    Ok(())
}

/// Freeze the crowd: its bands go offline and their stays end; its memories and links stay.
#[spacetimedb::reducer]
pub fn stop_crowd(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops", "tester"])?;
    for t in ctx.db.crowd_timer().iter().collect::<Vec<_>>() {
        ctx.db.crowd_timer().scheduled_id().delete(t.scheduled_id);
    }
    for b in ctx.db.band().iter().filter(|b| b.id >= FIRST_CROWD_BAND).collect::<Vec<_>>() {
        crate::ingest::leave_zone(ctx, b.id);
        ctx.db.band().id().update(Band { online: false, last_seen: ctx.timestamp, ..b });
    }
    Ok(())
}

// --- The tick ----------------------------------------------------------------------------------

/// The firmware's density state from the neighbour count: IDLE, YELLOW or GUIDE, with its one-step hysteresis.
fn density_state(prev: u8, neigh: u8, yellow: u8, red: u8) -> u8 {
    let mut s = prev.min(2);
    if s == 0 && neigh >= yellow {
        s = 1;
    }
    if s == 1 && neigh >= red {
        s = 2;
    }
    if s == 2 && neigh + 1 < red {
        s = 1;
    }
    if s == 1 && neigh + 1 < yellow {
        s = 0;
    }
    s
}

/// Bands within `NEAR_M` of each other, found through a grid of `NEAR_M` cells.
struct Grid {
    cells: HashMap<(i32, i32), Vec<usize>>,
}

impl Grid {
    fn new(points: &[(f32, f32)]) -> Grid {
        let mut cells: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for (i, p) in points.iter().enumerate() {
            cells.entry(Grid::cell(*p)).or_default().push(i);
        }
        Grid { cells }
    }

    fn cell((x, y): (f32, f32)) -> (i32, i32) {
        ((x / NEAR_M).floor() as i32, (y / NEAR_M).floor() as i32)
    }

    fn near(&self, points: &[(f32, f32)], p: (f32, f32)) -> Vec<usize> {
        self.within(points, p, NEAR_M)
    }

    /// Bands within `r` of `p`, for `r` up to `NEAR_M`.
    fn within(&self, points: &[(f32, f32)], p: (f32, f32), r: f32) -> Vec<usize> {
        let (cx, cy) = Grid::cell(p);
        let mut out = Vec::new();
        for dx in -1..=1 {
            for dy in -1..=1 {
                for &i in self.cells.get(&(cx + dx, cy + dy)).map(Vec::as_slice).unwrap_or_default() {
                    let (x, y) = points[i];
                    if (x - p.0).powi(2) + (y - p.1).powi(2) <= r * r {
                        out.push(i);
                    }
                }
            }
        }
        out
    }
}

/// Two bands spent `secs` close together, as band1t's radio encounter would record it.
fn together(ctx: &ReducerContext, a: u16, b: u16, secs: u32) -> Encounter {
    let key = pair_key(a, b);
    match ctx.db.encounter().key().find(key) {
        Some(e) => ctx.db.encounter().key().update(Encounter { last_seen: ctx.timestamp, seconds_close: e.seconds_close + secs, ..e }),
        None => ctx.db.encounter().insert(Encounter {
            key,
            band_a: a.min(b),
            band_b: a.max(b),
            first_seen: ctx.timestamp,
            last_seen: ctx.timestamp,
            seconds_close: secs,
            best_rssi: -50,
        }),
    }
}

/// How many strangers an attendee talks to over the event: 2 to 10 for hackers, four times that for staff.
fn sociability(band_id: u16, staff: bool) -> u32 {
    let n = StdRng::seed_from_u64(SEED ^ 0x50C1A1 ^ band_id as u64).gen_range(2..=10);
    if staff { n * 4 } else { n }
}

/// Everyone the band has been close to so far, teammates included.
fn close_count(ctx: &ReducerContext, counts: &mut HashMap<u16, u32>, band: u16) -> u32 {
    *counts
        .entry(band)
        .or_insert_with(|| ctx.db.encounter().band_a().filter(band).chain(ctx.db.encounter().band_b().filter(band)).count() as u32)
}

#[spacetimedb::reducer]
pub fn crowd_tick(ctx: &ReducerContext, _timer: CrowdTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("crowd_tick is internal".into());
    }
    let venue = Venue::load(ctx);
    if venue.zones.is_empty() {
        return Ok(());
    }
    let now = micros(ctx.timestamp);
    let tick = now as u64 / (TICK_MILLIS * 1_000);
    let settings = ctx.db.settings().id().find(0).unwrap_or_else(crate::tuning::defaults);
    let mut groups: Vec<CrowdGroup> = ctx.db.crowd_group().iter().collect();
    groups.sort_by_key(|g| g.id);
    let mut members: Vec<CrowdMember> = ctx.db.crowd_member().iter().collect();
    members.sort_by_key(|m| m.band_id);
    let mut bands: HashMap<u16, Band> = ctx.db.band().iter().filter(|b| b.id >= FIRST_CROWD_BAND).map(|b| (b.id, b)).collect();
    let mut rng = ctx.rng();

    // Teams whose time is up move on together; whoever was talking to one of them stops.
    let mut moved: Vec<u16> = Vec::new();
    for i in 0..groups.len() {
        if micros(groups[i].next_move_at) > now {
            continue;
        }
        let interests: Vec<String> = members.iter().filter(|m| m.group_id == groups[i].id).flat_map(|m| m.interests.clone()).collect();
        let (station, booth_id, x, y, (lo, hi)) = next_spot(&groups[i], &interests, &venue, &groups, &mut rng);
        let g = CrowdGroup { station, booth_id, x_m: x, y_m: y, next_move_at: later(ctx, lo, hi), ..groups[i].clone() };
        groups[i] = ctx.db.crowd_group().id().update(g);
        moved.push(groups[i].id);
    }
    let group_of: HashMap<u16, &CrowdGroup> = groups.iter().map(|g| (g.id, g)).collect();
    let moved_bands: HashSet<u16> = members.iter().filter(|m| moved.contains(&m.group_id)).map(|m| m.band_id).collect();
    for m in members.iter_mut().filter(|m| m.chat != 0 && (moved_bands.contains(&m.band_id) || moved_bands.contains(&m.chat))) {
        m.chat = 0;
        ctx.db.crowd_member().band_id().update(m.clone());
    }

    // Everyone's spot: their team's spot plus their own offset.
    let spots: Vec<(u8, u64, f32, f32)> = members
        .iter()
        .map(|m| {
            let g = group_of[&m.group_id];
            (g.station, g.booth_id, g.x_m + m.dx_m, g.y_m + m.dy_m)
        })
        .collect();
    // Radio and test bands stand among them too: they count as neighbours, and a test band meets them.
    let others: Vec<Band> = ctx.db.band().iter().filter(|b| b.id < FIRST_CROWD_BAND).filter(|b| b.online && b.zone != 0).collect();
    let mut points: Vec<(f32, f32)> = spots.iter().map(|s| (s.2, s.3)).collect();
    points.extend(others.iter().map(|b| (b.x_m, b.y_m)));
    let grid = Grid::new(&points);

    for (i, m) in members.iter().enumerate() {
        let (station, booth_id, x, y) = spots[i];
        let neigh = (grid.within(&points, (x, y), NEIGH_M).len().saturating_sub(1)).min(255) as u8;
        let prev = bands.get(&m.band_id);
        let state = density_state(prev.map(|b| b.state).unwrap_or(0), neigh, settings.yellow, settings.red);
        let same_spot = prev.is_some_and(|b| b.zone == station && b.booth_id == booth_id);
        if prev.is_some_and(|b| same_spot && b.neigh == neigh && b.state == state && b.x_m == x && b.y_m == y && b.online) {
            continue;
        }
        if !same_spot || !prev.is_some_and(|b| b.online) {
            for v in ctx.db.zone_visit().band_id().filter(m.band_id).filter(|v| v.open).collect::<Vec<_>>() {
                close_stay(ctx, v);
            }
            open_stay(ctx, m.band_id, station, booth_id);
        }
        let row = Band {
            id: m.band_id,
            state,
            flags: F_MPU | F_MOTOR,
            neigh,
            zone: station,
            bat: 255,
            find: 0,
            rssi: -60,
            seq: prev.map(|b| b.seq.wrapping_add(1)).unwrap_or(1),
            sos: false,
            fall: false,
            pressed: false,
            low_battery: false,
            has_mpu: true,
            has_motor: true,
            online: true,
            last_seen: ctx.timestamp,
            x_m: x,
            y_m: y,
            booth_id,
        };
        let row = if prev.is_some() { ctx.db.band().id().update(row) } else { ctx.db.band().insert(row) };
        bands.insert(row.id, row);
    }

    // Strangers at the same spot start talking; booth staff talk to their visitors more often. Everyone
    // talks to only so many strangers.
    let mut counts: HashMap<u16, u32> = HashMap::new();
    let same_spot = |i: usize, j: usize| spots[i].0 == spots[j].0 && spots[i].1 == spots[j].1;
    for i in 0..members.len() {
        let staff = group_of[&members[i].group_id].staff_booth != 0;
        if members[i].chat != 0 || !rng.gen_bool(if staff { STAFF_CHAT_CHANCE } else { CHAT_CHANCE }) {
            continue;
        }
        let candidates: Vec<usize> = grid
            .near(&points, (spots[i].2, spots[i].3))
            .into_iter()
            .filter(|&j| j < members.len() && members[j].chat == 0 && members[j].group_id != members[i].group_id && same_spot(i, j))
            .collect();
        if candidates.is_empty() {
            continue;
        }
        let j = candidates[rng.gen_range(0..candidates.len())];
        let (a, b) = (members[i].band_id, members[j].band_id);
        let other_staff = group_of[&members[j].group_id].staff_booth != 0;
        if close_count(ctx, &mut counts, a) >= sociability(a, staff) + 3 || close_count(ctx, &mut counts, b) >= sociability(b, other_staff) + 3 {
            continue;
        }
        members[i].chat = b;
        members[j].chat = a;
        ctx.db.crowd_member().band_id().update(members[i].clone());
        ctx.db.crowd_member().band_id().update(members[j].clone());
    }

    // Close time for this tick's slice of the crowd: teammates, who always share their team's spot, and the
    // strangers talking. Each pair is credited through its lower band.
    let index: HashMap<u16, usize> = members.iter().enumerate().map(|(i, m)| (m.band_id, i)).collect();
    let slice = tick % SLICES;
    let credit = (SLICES * TICK_MILLIS / 1_000 * TOGETHER_SPEEDUP) as u32;
    let mut teams: HashMap<u16, Vec<u16>> = HashMap::new();
    for m in &members {
        teams.entry(m.group_id).or_default().push(m.band_id);
    }
    for (i, m) in members.iter().enumerate() {
        if m.band_id as u64 % SLICES != slice {
            continue;
        }
        let mut close: Vec<u16> = teams[&m.group_id].iter().copied().filter(|b| *b > m.band_id).collect();
        if m.chat > m.band_id && index.get(&m.chat).is_some_and(|&j| same_spot(i, j)) {
            close.push(m.chat);
        }
        for other in close {
            let enc = together(ctx, m.band_id, other, credit);
            sync_encounter(ctx, &enc, m.identity, members[index[&other]].identity);
        }
    }

    // A claimed test band that is live meets the crowd standing within radio range, in real time, and
    // other test bands in its zone.
    let testers: Vec<&Band> = others
        .iter()
        .filter(|b| radio_id(b.id).is_some_and(|id| crate::safety::TEST_BANDS.contains(&id)))
        .filter(|b| radio_id(b.id).is_some_and(|id| ctx.db.band_owner().band_id().find(id).is_some()))
        .collect();
    let secs = (TICK_MILLIS / 1_000) as u32;
    for t in &testers {
        for j in grid.near(&points, (t.x_m, t.y_m)).into_iter().filter(|&j| j < members.len()) {
            together(ctx, t.id, members[j].band_id, secs);
        }
    }
    for (i, a) in testers.iter().enumerate() {
        for b in testers[i + 1..].iter().filter(|b| b.zone == a.zone) {
            together(ctx, a.id, b.id, secs);
        }
    }

    if tick % PRUNE_EVERY_TICKS == 0 {
        prune(ctx);
    }
    Ok(())
}

/// Deletes the crowd's stays that ended more than an hour ago, and their visits.
fn prune(ctx: &ReducerContext) {
    let before = micros(ctx.timestamp) - KEEP_STAYS_MICROS;
    for m in ctx.db.crowd_member().iter() {
        for v in ctx.db.zone_visit().band_id().filter(m.band_id).filter(|v| v.left.is_some_and(|l| micros(l) < before)).collect::<Vec<_>>() {
            ctx.db.visit().zone_visit_id().delete(v.id);
            ctx.db.zone_visit().id().delete(v.id);
        }
    }
}
