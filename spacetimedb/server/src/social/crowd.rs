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
//! - Everyone working the event wears a band too, except the medics: organizers walk the floor from the
//!   check-in, photographers go wherever the people are, and the event's speakers keep to the stage.
//! - Teams walk from spot to spot along the venue floor's aisles, one behind the other, at walking speed
//!   (`walks.rs`), and stay a while where they arrive. In a live run they walk in through the doors when the
//!   doors open and out through the nearest door when they close or the venue is evacuated.
//! - Teammates at the same spot are close on every tick. Strangers at the same spot sometimes start talking
//!   and stay close until one of them moves on; everyone working the event talks to people more often.
//! - One `crowd_tick` every 2 s sends the teams that are due on their way, puts every walker at their place
//!   along their walk, recounts every band's neighbours and writes only the bands that changed, in one
//!   transaction. Where everyone goes and how long they stay comes from a generator seeded with the live
//!   run's seed and the tick, so the same seed sends the crowd the same way.

use super::graph::{relink, PERSON};
use super::logic::*;
use super::tables::*;
use super::tick::{ensure_tick, sync_encounter};
use super::walks;
use crate::ingest::{close_stay, open_stay};
use crate::roles::require_role;
use crate::tables::*;
use crate::tables::micros;
use crate::safety::{self, incident, incident_band, S_NEAR_SOS};
use crate::venue::floor::{Floor, P};
use crate::venue::{booth, organization, person, venue_spot, zone, Booth, Organization, Person, VenueSpot, Zone};
use crate::departure::{departure, Departure};
use spacetimedb::rand::rngs::StdRng;
use spacetimedb::rand::{Rng, SeedableRng};
use spacetimedb::{AnonymousViewContext, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, TimeDuration, Timestamp};
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
/// One attendee in this many is an organizer, and one in this many a photographer; at least one of each.
const PER_ORGANIZER: usize = 100;
const PER_PHOTOGRAPHER: usize = 250;
/// The crowd's closed stays are deleted after an hour, so the tables stay small; the links they made stay.
const KEEP_STAYS_MICROS: i64 = 3_600_000_000;
const PRUNE_EVERY_TICKS: u64 = 30;
/// Every attendee of the crowd is generated from this seed and their band id.
const SEED: u64 = 0xCA1_4AC5_0013;
/// The crowd within this many metres of someone who is down lights the circle, and steps back to this distance.
const CIRCLE_M: f32 = 3.0;
const CLEAR_M: f32 = 4.2;
/// At most this many of the crowd are recorded as an incident's light-circle witnesses.
const MAX_WITNESSES: usize = 12;
/// When the doors open the crowd comes in over this many seconds, each team by the door nearest its table
/// seven times in ten.
const WALK_IN_SECS: f32 = 25.0;
/// Teams set off for the doors over this many seconds once they close.
const WALK_OUT_SECS: f32 = 4.0;

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

fn crowd_identity(band_id: u32) -> Identity {
    Identity::from_claims("bandit-crowd", &format!("band-{band_id}"))
}

fn rng_for(band_id: u32) -> StdRng {
    StdRng::seed_from_u64(SEED ^ (band_id as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

/// A stay of `min_minutes` to `max_minutes`, divided by the live run's pace.
fn dwell(rng: &mut impl Rng, min_minutes: f32, max_minutes: f32, pace: f32) -> TimeDuration {
    let secs = rng.gen_range(min_minutes * 60.0..max_minutes * 60.0) / pace.max(1.0);
    TimeDuration::from_micros((secs.max(1.0) * 1e6) as i64)
}

/// The generator for one draw of the crowd's moves: the live run's seed, else the crowd's, and `step`.
fn moves_rng(ctx: &ReducerContext, step: u64) -> StdRng {
    let seed = crate::live::run(ctx).map(|r| r.seed).unwrap_or(SEED);
    StdRng::seed_from_u64(seed ^ step.wrapping_add(1).wrapping_mul(0xD6E8_FEB8_6659_FD93))
}

/// How many times faster than the clock the crowd walks: the live run's pace while it goes, at most
/// `walks::MAX_WALK_PACE`.
fn walk_pace(ctx: &ReducerContext) -> f32 {
    use crate::live::LivePhase;
    match crate::live::run(ctx) {
        Some(r) if matches!(r.phase, LivePhase::Running | LivePhase::Closing) => r.pace.max(1) as f32,
        _ => 1.0,
    }
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
    /// The spots of each station on the 3D floor, empty when none are loaded.
    spots: HashMap<u8, Vec<(f32, f32)>>,
    /// The hacker tables, in table-number order: where teams sit.
    tables: Vec<(f32, f32)>,
    /// The doors people leave by, with their station.
    exits: Vec<(f32, f32, u8)>,
    /// The doors people come in by, with their station.
    entrances: Vec<(f32, f32, u8)>,
    /// Where people can walk, when the floor is loaded.
    floor: Option<Floor>,
}

impl Venue {
    fn load(ctx: &ReducerContext) -> Venue {
        let mut v = Venue::build(
            ctx.db.zone().iter().filter(|z| z.station_id != 0).collect(),
            |zone_id| ctx.db.booth().zone_id().filter(zone_id).collect(),
            |id| ctx.db.organization().id().find(id),
            ctx.db.venue_spot().iter().collect(),
        );
        v.floor = Floor::load(ctx);
        v
    }

    /// The nearest spot to `p` where someone can stand.
    fn snap(&self, p: P) -> P {
        self.floor.as_ref().map(|f| f.snap(p)).unwrap_or(p)
    }

    /// Where a member of a team stands at the team's spot: their own place beside it, where nobody stands on
    /// a table or in a wall.
    fn place(&self, g: &CrowdGroup, m: &CrowdMember) -> P {
        self.snap((g.x_m + m.dx_m, g.y_m + m.dy_m))
    }

    /// The way the team walks from `from` to its spot `to`.
    fn team_way(&self, from: P, to: &CrowdGroup) -> Vec<P> {
        let (a, b) = (self.snap(from), self.snap((to.x_m, to.y_m)));
        self.floor.as_ref().map(|f| f.path(a, b)).unwrap_or(vec![a, b])
    }

    /// Sends a team from `from` to its new spot `to`: each member, from where they stand, sets off at `at`
    /// one behind the other. Returns when the last one arrives.
    fn walk_team(&self, ctx: &ReducerContext, from: P, to: &CrowdGroup, team: &[(&CrowdMember, P)], at: Timestamp, pace: f32) -> (Vec<CrowdWalk>, Timestamp) {
        let way = self.team_way(from, to);
        let speed = walks::team_speed(to.id, pace);
        let mut out = Vec::with_capacity(team.len());
        let mut last = at;
        for (k, (m, here)) in team.iter().enumerate() {
            let w = walks::begin(ctx, m.band_id, walks::member_way(self.floor.as_ref(), *here, &way, self.place(to, m)), walks::set_off(at, k), speed);
            last = last.max(w.arrives_at);
            out.push(w);
        }
        (out, last)
    }

    /// The zones with a station, their booths and the booths' organisations, as the crowd uses them. With
    /// spots on the 3D floor, a zone is the box around its spots and a booth stands at its sponsor table.
    fn build(
        stations: Vec<Zone>,
        booths_in: impl Fn(u64) -> Vec<Booth>,
        organization: impl Fn(u64) -> Option<Organization>,
        floor: Vec<VenueSpot>,
    ) -> Venue {
        let mut spots: HashMap<u8, Vec<(f32, f32)>> = HashMap::new();
        for s in floor.iter().filter(|s| s.station_id != 0 && s.kind != "exit") {
            spots.entry(s.station_id).or_default().push((s.x_m, s.y_m));
        }
        let mut table_spots: Vec<&VenueSpot> = floor.iter().filter(|s| s.kind == "table").collect();
        table_spots.sort_by_key(|s| s.number);
        let tables: Vec<(f32, f32)> = table_spots.iter().map(|s| (s.x_m, s.y_m)).collect();
        let exits: Vec<(f32, f32, u8)> = floor.iter().filter(|s| s.kind == "exit").map(|s| (s.x_m, s.y_m, s.station_id)).collect();
        let entrances: Vec<(f32, f32, u8)> = floor.iter().filter(|s| s.kind == "entrance").map(|s| (s.x_m, s.y_m, s.station_id)).collect();
        let mut stations = stations;
        stations.sort_by(|a, b| b.area_sq_m.total_cmp(&a.area_sq_m).then(a.id.cmp(&b.id)));
        let mut zones: Vec<(Zone, Rect)> = Vec::new();
        for z in stations {
            if let Some(pts) = spots.get(&z.station_id) {
                let r = Rect {
                    x0: pts.iter().map(|p| p.0).fold(f32::MAX, f32::min) - 1.0,
                    y0: pts.iter().map(|p| p.1).fold(f32::MAX, f32::min) - 1.0,
                    x1: pts.iter().map(|p| p.0).fold(f32::MIN, f32::max) + 1.0,
                    y1: pts.iter().map(|p| p.1).fold(f32::MIN, f32::max) + 1.0,
                };
                zones.push((z, r));
                continue;
            }
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
                // At its sponsor table: staff behind it, visitors in front.
                let (staff, visitor) = match floor.iter().find(|s| s.kind == "sponsor_table" && s.booth_id == b.id) {
                    Some(t) => {
                        let (nx, ny) = (-t.angle.sin(), t.angle.cos());
                        ((t.x_m - nx * 0.9, t.y_m - ny * 0.9), (t.x_m + nx * 1.4, t.y_m + ny * 1.4))
                    }
                    None => ((x, stand), (x, aisle)),
                };
                booths.push(BoothSpot {
                    id: b.id,
                    name: b.name.clone(),
                    organization_id: b.organization_id,
                    station: z.station_id,
                    visitor,
                    staff,
                    tags,
                    pull,
                });
            }
        }
        Venue { zones, booths, spots, tables, exits, entrances, floor: None }
    }

    /// A random spot of the zone: next to one of its spots on the 3D floor, else anywhere in its rectangle.
    fn point_in(&self, station: u8, r: &Rect, rng: &mut impl Rng) -> (f32, f32) {
        match self.spots.get(&station) {
            Some(pts) if !pts.is_empty() => {
                let (x, y) = pts[rng.gen_range(0..pts.len())];
                (x + rng.gen_range(-0.6..0.6), y + rng.gen_range(-0.6..0.6))
            }
            _ => r.random_point(rng),
        }
    }

    /// Team `n`'s table: the hacker tables in turn, else a spot on the hacking floor.
    fn home(&self, n: usize, rng: &mut impl Rng) -> (u8, (f32, f32)) {
        let (floor, rect) = self.floor();
        if self.tables.is_empty() {
            return (floor.station_id, rect.random_point(rng));
        }
        // Spread teams over the whole floor: every third table first, then the ones between.
        let len = self.tables.len();
        let i = (n * 3 + (n * 3 / len) % 3) % len;
        let (x, y) = self.tables[i];
        (floor.station_id, (x + rng.gen_range(-0.3..0.3), y + rng.gen_range(-0.3..0.3)))
    }

    /// The door nearest to a point, with its station.
    fn nearest_exit(&self, x: f32, y: f32) -> Option<(f32, f32, u8)> {
        self.exits.iter().copied().min_by(|a, b| ((a.0 - x).powi(2) + (a.1 - y).powi(2)).total_cmp(&((b.0 - x).powi(2) + (b.1 - y).powi(2))))
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
    let (x, y) = venue.point_in(z.station_id, r, rng);
    Some((z.station_id, 0, x, y, minutes))
}

fn at_booth(venue: &Venue, interests: &[String], rng: &mut impl Rng) -> Option<Spot> {
    let b = venue.pick_booth(interests, rng)?;
    Some((b.station, b.id, b.visitor.0, b.visitor.1, (2.0, 5.0)))
}

/// The same spot for another stay.
fn staying(spot: Option<Spot>, minutes: (f32, f32)) -> Option<Spot> {
    spot.map(|(station, booth, x, y, _)| (station, booth, x, y, minutes))
}

fn next_spot(g: &CrowdGroup, interests: &[String], venue: &Venue, groups: &[CrowdGroup], rng: &mut impl Rng) -> Spot {
    let role = role_of(g);
    let stay = match role {
        BOOTH_STAFF => (15.0, 40.0),
        ORGANIZER => (3.0, 8.0),
        PHOTOGRAPHER => (1.0, 4.0),
        SPEAKER => (10.0, 20.0),
        _ => (6.0, 15.0),
    };
    let home: Spot = (g.home_station, g.staff_booth, g.home_x_m, g.home_y_m, stay);
    let at_home = g.station == g.home_station && g.booth_id == g.staff_booth && g.x_m == g.home_x_m && g.y_m == g.home_y_m;
    match role {
        // Staff mind their booth, with a food break now and then.
        BOOTH_STAFF => return if at_home && rng.gen_bool(0.3) { in_zone(venue, "food", (4.0, 8.0), rng).unwrap_or(home) } else { home },
        // Organizers leave the check-in to look in on the floor, a booth, the stage or food, then come back.
        ORGANIZER if at_home => {
            let to = ["floor", "booth", "stage", "food"][rng.gen_range(0..4)];
            let spot = if to == "booth" { at_booth(venue, interests, rng) } else { in_zone(venue, to, (2.0, 5.0), rng) };
            return staying(spot, (2.0, 5.0)).unwrap_or(home);
        }
        // Photographers go wherever the people are, never for long.
        PHOTOGRAPHER => {
            let to = ["floor", "floor", "booth", "stage", "food"][rng.gen_range(0..5)];
            let spot = if to == "booth" { at_booth(venue, interests, rng) } else { in_zone(venue, to, stay, rng) };
            return staying(spot, stay).unwrap_or(home);
        }
        // Speakers keep to the stage and visit a booth or food in between.
        SPEAKER if at_home => {
            let spot = if rng.gen_bool(0.5) { at_booth(venue, interests, rng) } else { in_zone(venue, "food", (3.0, 8.0), rng) };
            return staying(spot, (3.0, 8.0)).unwrap_or(home);
        }
        ORGANIZER | SPEAKER => return home,
        _ => {}
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
        let others: Vec<&CrowdGroup> = groups.iter().filter(|o| role_of(o) == HACKER && o.id != g.id).collect();
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
    use crate::venue::{booth__view, organization__view, venue_spot__view, zone__view};
    let venue = Venue::build(
        ctx.db.zone().station_id().filter(1u8..).collect(),
        |zone_id| ctx.db.booth().zone_id().filter(zone_id).collect(),
        |id| ctx.db.organization().id().find(id),
        ctx.db.venue_spot().station_id().filter(0u8..).collect(),
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
        ctx.db.departure().attendee().delete(a.identity);
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
    walks::clear(ctx);
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

/// One attendee of the crowd and their band, generated from the seed and the band id. A speaker is the
/// event's own speaker, by the name and photo of their profile, with no made-up socials.
fn add_member(ctx: &ReducerContext, band_id: u32, g: &CrowdGroup, organization_id: u64, pool: &[(String, u32)], speaker: Option<&Person>) {
    let mut rng = rng_for(band_id);
    let first = FIRST_NAMES[rng.gen_range(0..FIRST_NAMES.len())];
    let last = LAST_NAMES[rng.gen_range(0..LAST_NAMES.len())];
    let who = crowd_identity(band_id);
    let photo = format!("https://i.pravatar.cc/300?img={}", rng.gen_range(1..=70));
    let a = ctx.db.attendee().insert(Attendee {
        identity: who,
        node_id: 0,
        display_name: speaker.map(|p| p.display_name.clone()).unwrap_or(format!("{first} {last}")),
        photo_url: speaker.map(|p| p.headshot_url.clone()).filter(|u| !u.is_empty()).unwrap_or(photo),
        findable: true,
        person_id: speaker.map(|p| p.id).unwrap_or(0),
        organization_id,
        crowd: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    let ig = handle(first, last, &mut rng);
    let threads = rng.gen_bool(0.3);
    if speaker.is_none() {
        if threads {
            ctx.db.social_handle().insert(SocialHandle { id: 0, owner: who, platform: "threads".into(), handle: ig.clone(), updated_at: ctx.timestamp });
        }
        ctx.db.social_handle().insert(SocialHandle { id: 0, owner: who, platform: "instagram".into(), handle: ig, updated_at: ctx.timestamp });
    }
    let spread = if role_of(g) == HACKER { 0.9 } else { 0.6 };
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
    start(ctx, size, 1.0)
}

/// The crowd of `size`, with its first moves spread over the first minutes divided by `pace`.
pub fn start(ctx: &ReducerContext, size: u16, pace: f32) -> Result<(), String> {
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

    // One in ten staffs a booth, two per booth, the biggest sponsors first.
    let mut staffed: Vec<&BoothSpot> = venue.booths.iter().collect();
    staffed.sort_by(|a, b| b.pull.total_cmp(&a.pull).then(a.id.cmp(&b.id)));
    let staff_booths: Vec<&BoothSpot> =
        staffed.iter().flat_map(|b| std::iter::repeat_n(*b, STAFF_PER_BOOTH)).take(size as usize / 10).collect();

    // Everyone working the event wears a band too, except the medics: organizers at the check-in, photographers
    // on the floor and the event's speakers at the stage.
    let organizers = (size as usize).div_ceil(PER_ORGANIZER);
    let photographers = (size as usize).div_ceil(PER_PHOTOGRAPHER);
    let mut speakers: Vec<Person> = ctx.db.person().iter().filter(|p| p.kind == SPEAKER).collect();
    speakers.sort_by_key(|p| p.id);

    let mut groups: Vec<CrowdGroup> = Vec::new();
    let mut band_id = FIRST_CROWD_BAND;
    let last = FIRST_CROWD_BAND + u32::from(size);
    // A group of `role` with its home: a booth's staff spot, a spot in a zone of that kind, else a hacker table.
    let mut add_group = |role: &str, staff: Option<&BoothSpot>, rng: &mut StdRng| -> CrowdGroup {
        let id = groups.len() as u16 + 1;
        let area = match role {
            ORGANIZER => venue.zone_of_kind("entrance"),
            PHOTOGRAPHER => Some(venue.floor()),
            SPEAKER => venue.zone_of_kind("stage"),
            _ => None,
        };
        let (home_station, home_booth, (hx, hy)) = match (staff, area) {
            (Some(b), _) => (b.station, b.id, b.staff),
            (None, Some((z, r))) => (z.station_id, 0, venue.point_in(z.station_id, r, rng)),
            (None, None) => {
                let (station, at) = venue.home(id as usize, rng);
                (station, 0, at)
            }
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
            role: role.into(),
        };
        groups.push(g.clone());
        g
    };
    for b in staff_booths {
        if band_id >= last {
            break;
        }
        let g = add_group(BOOTH_STAFF, Some(b), &mut rng);
        add_member(ctx, band_id, &g, b.organization_id, &pool, None);
        band_id += 1;
    }
    let working: Vec<(&str, Option<&Person>)> = std::iter::repeat_n((ORGANIZER, None), organizers)
        .chain(std::iter::repeat_n((PHOTOGRAPHER, None), photographers))
        .chain(speakers.iter().map(|p| (SPEAKER, Some(p))))
        .collect();
    for (role, speaker) in working {
        if band_id >= last {
            break;
        }
        let g = add_group(role, None, &mut rng);
        add_member(ctx, band_id, &g, speaker.map(|p| p.organization_id).unwrap_or(0), &pool, speaker);
        band_id += 1;
    }
    while band_id < last {
        let team = [1, 2, 2, 3, 3, 3, 4, 4, 4][rng.gen_range(0..9)].min(last - band_id);
        let g = add_group(HACKER, None, &mut rng);
        for _ in 0..team {
            add_member(ctx, band_id, &g, 0, &pool, None);
            band_id += 1;
        }
    }

    // A third of the teams start away from their table, and everyone's next move is spread over the first
    // minutes, so the venue is busy from the start instead of everyone leaving at once.
    let members: Vec<CrowdMember> = ctx.db.crowd_member().iter().collect();
    for g in &mut groups {
        let interests: Vec<String> = members.iter().filter(|m| m.group_id == g.id).flat_map(|m| m.interests.clone()).collect();
        if role_of(g) == HACKER && rng.gen_bool(0.35) {
            let (station, booth_id, x, y, _) = next_spot(g, &interests, &venue, &[], &mut rng);
            (g.station, g.booth_id, g.x_m, g.y_m) = (station, booth_id, x, y);
        }
        g.next_move_at = ctx.timestamp + seconds(((rng.gen_range(20..600) as f32) / pace.max(1.0)) as i64 + 1);
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
    stop(ctx);
    Ok(())
}

/// Where a member of the crowd stands now: along their walk, else at their band's spot.
fn standing(ctx: &ReducerContext, m: &CrowdMember) -> Option<P> {
    if let Some(w) = ctx.db.crowd_walk().band_id().find(m.band_id) {
        return Some(walks::at(&w, ctx.timestamp).0);
    }
    ctx.db.band().id().find(m.band_id).filter(|b| b.x_m != 0.0 || b.y_m != 0.0).map(|b| (b.x_m, b.y_m))
}

fn teams(ctx: &ReducerContext) -> (Vec<CrowdGroup>, HashMap<u16, Vec<CrowdMember>>) {
    let mut groups: Vec<CrowdGroup> = ctx.db.crowd_group().iter().collect();
    groups.sort_by_key(|g| g.id);
    let mut members: HashMap<u16, Vec<CrowdMember>> = HashMap::new();
    for m in ctx.db.crowd_member().iter() {
        members.entry(m.group_id).or_default().push(m);
    }
    for team in members.values_mut() {
        team.sort_by_key(|m| m.band_id);
    }
    (groups, members)
}

/// The doors open: every team comes in through a door over the first seconds and walks to its first spot.
/// Until a member walks in, their band is off and stands at the door.
pub fn walk_in(ctx: &ReducerContext) {
    let venue = Venue::load(ctx);
    let doors = if venue.entrances.is_empty() { venue.exits.clone() } else { venue.entrances.clone() };
    if doors.is_empty() {
        return;
    }
    let pace = walk_pace(ctx);
    let mut rng = moves_rng(ctx, u64::MAX);
    let (groups, members) = teams(ctx);
    for g in groups {
        let Some(team) = members.get(&g.id) else { continue };
        let near = doors
            .iter()
            .copied()
            .min_by(|a, b| ((a.0 - g.x_m).powi(2) + (a.1 - g.y_m).powi(2)).total_cmp(&((b.0 - g.x_m).powi(2) + (b.1 - g.y_m).powi(2))))
            .unwrap();
        let (dx, dy, station) = if rng.gen_bool(0.7) { near } else { doors[rng.gen_range(0..doors.len())] };
        let door = venue.snap((dx, dy));
        let at = ctx.timestamp + TimeDuration::from_micros((rng.gen_range(0.0..WALK_IN_SECS) * 1e6) as i64);
        let mut starts = Vec::with_capacity(team.len());
        for m in team {
            let here = venue.snap((door.0 + rng.gen_range(-0.8..0.8), door.1 + rng.gen_range(-0.8..0.8)));
            let row = Band {
                id: m.band_id,
                state: 0,
                flags: F_MPU | F_MOTOR,
                neigh: 0,
                zone: station,
                bat: 255,
                find: 0,
                rssi: -60,
                seq: 1,
                sos: false,
                fall: false,
                pressed: false,
                low_battery: false,
                has_mpu: true,
                has_motor: true,
                online: false,
                last_seen: ctx.timestamp,
                x_m: here.0,
                y_m: here.1,
                booth_id: 0,
            };
            crate::ingest::leave_zone(ctx, m.band_id);
            if ctx.db.band().id().find(m.band_id).is_some() {
                ctx.db.band().id().update(row);
            } else {
                ctx.db.band().insert(row);
            }
            starts.push((m, here));
        }
        let (_, arrive) = venue.walk_team(ctx, door, &g, &starts, at, pace);
        // Nobody sets off again before they have arrived and looked around.
        let earliest = arrive + dwell(&mut rng, 0.5, 2.0, crate::live::pace(ctx));
        if g.next_move_at < earliest {
            ctx.db.crowd_group().id().update(CrowdGroup { next_move_at: earliest, ..g });
        }
    }
}

/// The doors close: every team walks to the door nearest to it, and each person leaves the venue there.
pub fn head_for_exits(ctx: &ReducerContext) {
    let venue = Venue::load(ctx);
    let pace = walk_pace(ctx);
    let mut rng = moves_rng(ctx, u64::MAX - 1);
    let (groups, members) = teams(ctx);
    let down: Vec<u32> = crate::live::down_bands(ctx).iter().map(|d| d.band_id).collect();
    let gone: HashSet<u32> = ctx.db.departure().iter().map(|d| d.band_id).collect();
    for g in groups {
        let Some((x, y, station)) = venue.nearest_exit(g.x_m, g.y_m) else { continue };
        let to = ctx.db.crowd_group().id().update(CrowdGroup {
            station,
            booth_id: 0,
            x_m: x,
            y_m: y,
            next_move_at: ctx.timestamp + seconds(86_400),
            ..g.clone()
        });
        let Some(team) = members.get(&g.id) else { continue };
        // Whoever is down stays down until the medic is done, then walks out on their own. Whoever left early
        // is already on their way.
        let starts: Vec<(&CrowdMember, P)> = team
            .iter()
            .filter(|m| !down.contains(&m.band_id) && !gone.contains(&m.band_id))
            .map(|m| (m, standing(ctx, m).unwrap_or_else(|| venue.place(&g, m))))
            .collect();
        let at = ctx.timestamp + TimeDuration::from_micros((rng.gen_range(0.0..WALK_OUT_SECS) * 1e6) as i64);
        venue.walk_team(ctx, (g.x_m, g.y_m), &to, &starts, at, pace);
    }
}

/// An evacuation is called off: every team walks back in from where it stands, over the first seconds, to its
/// home spot, and carries on from there. Whoever is down or left early stays as they are.
pub fn walk_back_in(ctx: &ReducerContext) {
    let venue = Venue::load(ctx);
    let pace = walk_pace(ctx);
    let mut rng = moves_rng(ctx, u64::MAX - 2);
    let (groups, members) = teams(ctx);
    let down: Vec<u32> = crate::live::down_bands(ctx).iter().map(|d| d.band_id).collect();
    let gone: HashSet<u32> = ctx.db.departure().iter().map(|d| d.band_id).collect();
    for g in groups {
        let to = CrowdGroup { station: g.home_station, booth_id: g.staff_booth, x_m: g.home_x_m, y_m: g.home_y_m, ..g.clone() };
        let starts: Vec<(&CrowdMember, P)> = members
            .get(&g.id)
            .into_iter()
            .flatten()
            .filter(|m| !down.contains(&m.band_id) && !gone.contains(&m.band_id))
            .map(|m| (m, standing(ctx, m).unwrap_or_else(|| venue.place(&g, m))))
            .collect();
        let at = ctx.timestamp + TimeDuration::from_micros((rng.gen_range(0.0..WALK_IN_SECS) * 1e6) as i64);
        let (_, arrive) = venue.walk_team(ctx, (g.x_m, g.y_m), &to, &starts, at, pace);
        let next_move_at = arrive.max(at) + dwell(&mut rng, 0.5, 2.0, crate::live::pace(ctx));
        ctx.db.crowd_group().id().update(CrowdGroup { next_move_at, ..to });
    }
}

/// Sends one member of the crowd home early: they leave their team and walk alone from where they stand to the
/// door nearest to them. Returns the door and its station, or None when the venue has no exits on its floor.
pub fn send_home(ctx: &ReducerContext, m: &CrowdMember) -> Option<(f32, f32, u8)> {
    let venue = Venue::load(ctx);
    let g = ctx.db.crowd_group().id().find(m.group_id)?;
    let here = standing(ctx, m).unwrap_or_else(|| venue.place(&g, m));
    let (x, y, station) = venue.nearest_exit(here.0, here.1)?;
    let door = venue.snap((x, y));
    let way = walks::member_way(venue.floor.as_ref(), here, &[], door);
    walks::begin(ctx, m.band_id, way, ctx.timestamp, walks::team_speed(g.id, walk_pace(ctx)));
    // Whoever they were talking to stops.
    if let Some(other) = ctx.db.crowd_member().band_id().find(m.chat).filter(|o| o.chat == m.band_id) {
        ctx.db.crowd_member().band_id().update(CrowdMember { chat: 0, ..other });
    }
    ctx.db.crowd_member().band_id().update(CrowdMember { chat: 0, ..m.clone() });
    Some((door.0, door.1, station))
}

/// True while someone of the crowd is still on their way.
pub fn walking(ctx: &ReducerContext) -> bool {
    ctx.db.crowd_walk().iter().any(|w| w.arrives_at > ctx.timestamp)
}

/// After a pause the crowd carries on where it stood: every walk and every team's next move move on by `gap`.
pub fn resume(ctx: &ReducerContext, gap: TimeDuration) {
    for g in ctx.db.crowd_group().iter().collect::<Vec<_>>() {
        ctx.db.crowd_group().id().update(CrowdGroup { next_move_at: g.next_move_at + gap, ..g });
    }
    walks::shift(ctx, gap);
}

pub fn stop(ctx: &ReducerContext) {
    for t in ctx.db.crowd_timer().iter().collect::<Vec<_>>() {
        ctx.db.crowd_timer().scheduled_id().delete(t.scheduled_id);
    }
    for b in ctx.db.band().iter().filter(|b| b.id >= FIRST_CROWD_BAND).collect::<Vec<_>>() {
        crate::ingest::leave_zone(ctx, b.id);
        ctx.db.band().id().update(Band { online: false, last_seen: ctx.timestamp, ..b });
    }
    walks::clear(ctx);
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
fn together(ctx: &ReducerContext, a: u32, b: u32, secs: u32) -> Encounter {
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

/// How many strangers an attendee talks to over the event: 2 to 10 for hackers, four times that for everyone
/// working the event.
fn sociability(band_id: u32, staff: bool) -> u32 {
    let n = StdRng::seed_from_u64(SEED ^ 0x50C1A1 ^ band_id as u64).gen_range(2..=10);
    if staff { n * 4 } else { n }
}

/// Everyone the band has been close to so far, teammates included.
fn close_count(ctx: &ReducerContext, counts: &mut HashMap<u32, u32>, band: u32) -> u32 {
    *counts
        .entry(band)
        .or_insert_with(|| ctx.db.encounter().band_a().filter(band).chain(ctx.db.encounter().band_b().filter(band)).count() as u32)
}

#[spacetimedb::reducer]
pub fn crowd_tick(ctx: &ReducerContext, _timer: CrowdTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("crowd_tick is internal".into());
    }
    // A paused live run holds everyone where they stand.
    if crate::live::paused(ctx) {
        return Ok(());
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
    let mut bands: HashMap<u32, Band> = ctx.db.band().iter().filter(|b| b.id >= FIRST_CROWD_BAND).map(|b| (b.id, b)).collect();
    let mut walking: HashMap<u32, CrowdWalk> = ctx.db.crowd_walk().iter().map(|w| (w.band_id, w)).collect();
    let step = match crate::live::run(ctx) {
        Some(r) => ((now - micros(r.started_at)).max(0) as u64) / (TICK_MILLIS * 1_000),
        None => tick,
    };
    let mut rng = moves_rng(ctx, step);
    let pace = crate::live::pace(ctx);
    let walk_pace = walk_pace(ctx);
    let leaving = crate::live::leaving(ctx);
    let down = crate::live::down_bands(ctx);
    let is_down = |band: u32| down.iter().any(|d| d.band_id == band);
    // Whoever leaves early walks to their door on their own, and is out once they are through it.
    let gone: HashMap<u32, Departure> = ctx.db.departure().iter().filter(|d| d.band_id >= FIRST_CROWD_BAND).map(|d| (d.band_id, d)).collect();
    // Where each member stands as this tick starts: along their walk, else at their band's last spot.
    let here = |m: &CrowdMember, walking: &HashMap<u32, CrowdWalk>, bands: &HashMap<u32, Band>, g: &CrowdGroup| -> P {
        match (walking.get(&m.band_id), bands.get(&m.band_id)) {
            (Some(w), _) => walks::at(w, ctx.timestamp).0,
            (None, Some(b)) if b.x_m != 0.0 || b.y_m != 0.0 => (b.x_m, b.y_m),
            _ => venue.place(g, m),
        }
    };

    // Teams whose time is up walk on together; whoever was talking to one of them stops. A team stays with
    // a member who is down.
    let mut moved: Vec<u16> = Vec::new();
    for i in 0..groups.len() {
        if micros(groups[i].next_move_at) > now {
            continue;
        }
        let team: Vec<&CrowdMember> = members.iter().filter(|m| m.group_id == groups[i].id && !gone.contains_key(&m.band_id)).collect();
        if team.is_empty() || team.iter().any(|m| is_down(m.band_id)) {
            continue;
        }
        let interests: Vec<String> = team.iter().flat_map(|m| m.interests.clone()).collect();
        let (station, booth_id, x, y, (lo, hi)) = next_spot(&groups[i], &interests, &venue, &groups, &mut rng);
        let to = CrowdGroup { station, booth_id, x_m: x, y_m: y, ..groups[i].clone() };
        let starts: Vec<(&CrowdMember, P)> = team.iter().map(|m| (*m, here(m, &walking, &bands, &groups[i]))).collect();
        let (rows, arrive) = venue.walk_team(ctx, (groups[i].x_m, groups[i].y_m), &to, &starts, ctx.timestamp, walk_pace);
        for w in rows {
            walking.insert(w.band_id, w);
        }
        groups[i] = ctx.db.crowd_group().id().update(CrowdGroup { next_move_at: arrive + dwell(&mut rng, lo, hi, pace), ..to });
        moved.push(groups[i].id);
    }
    let group_of: HashMap<u16, &CrowdGroup> = groups.iter().map(|g| (g.id, g)).collect();
    let moved_bands: HashSet<u32> = members.iter().filter(|m| moved.contains(&m.group_id)).map(|m| m.band_id).collect();
    for m in members.iter_mut().filter(|m| m.chat != 0 && (moved_bands.contains(&m.band_id) || moved_bands.contains(&m.chat))) {
        m.chat = 0;
        ctx.db.crowd_member().band_id().update(m.clone());
    }

    // Someone back on their feet after an incident walks from where they fell to their team.
    for m in &members {
        let up = bands.get(&m.band_id).is_some_and(|b| (b.fall || b.sos) && b.online)
            && !is_down(m.band_id)
            && !moved_bands.contains(&m.band_id)
            && !gone.contains_key(&m.band_id);
        if up {
            let b = &bands[&m.band_id];
            let g = group_of[&m.group_id];
            let way = walks::member_way(venue.floor.as_ref(), (b.x_m, b.y_m), &[], venue.place(g, m));
            walking.insert(m.band_id, walks::begin(ctx, m.band_id, way, ctx.timestamp, walks::team_speed(g.id, walk_pace)));
        }
    }

    // Everyone's spot: along their walk, or at their own place at their team's spot. A walker still counts in
    // the zone they left until they are halfway. Before they walk in, and once they walked out of a door after
    // the doors closed, they are not in the venue.
    let mut inside: Vec<bool> = vec![true; members.len()];
    let mut still: Vec<bool> = vec![true; members.len()];
    let mut spots: Vec<(u8, u64, f32, f32)> = members
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let g = group_of[&m.group_id];
            let away = gone.get(&m.band_id);
            let Some(w) = walking.get(&m.band_id) else {
                let (x, y) = venue.place(g, m);
                inside[i] = away.is_none();
                return (g.station, g.booth_id, x, y);
            };
            let ((x, y), along) = walks::at(w, ctx.timestamp);
            let arrived = ctx.timestamp >= w.arrives_at;
            still[i] = arrived;
            let walked_in = ctx.timestamp >= w.started_at || bands.get(&m.band_id).is_some_and(|b| b.online);
            inside[i] = walked_in && !((leaving || away.is_some()) && arrived) && !away.is_some_and(|d| d.left_at.is_some());
            match (bands.get(&m.band_id), away) {
                (Some(b), _) if !arrived && along < 0.5 => (b.zone, b.booth_id, x, y),
                (_, Some(d)) => (d.station_id, 0, x, y),
                _ => (g.station, g.booth_id, x, y),
            }
        })
        .collect();
    for (i, m) in members.iter().enumerate() {
        if let Some(d) = gone.get(&m.band_id).filter(|d| d.left_at.is_none() && !inside[i]) {
            crate::departure::walked_out(ctx, d.clone());
        }
    }
    // Whoever is down stays where they fell. Everyone standing within reach lights the circle and steps back,
    // which is the band's compass pointing them away; someone walking past lights it as they go.
    let mut circle: Vec<Option<usize>> = vec![None; members.len()];
    for (i, m) in members.iter().enumerate() {
        if let Some(d) = down.iter().find(|d| d.band_id == m.band_id) {
            let prev = bands.get(&m.band_id);
            spots[i] = (prev.map(|b| b.zone).unwrap_or(spots[i].0), prev.map(|b| b.booth_id).unwrap_or(0), d.x_m, d.y_m);
            inside[i] = true;
            continue;
        }
        if !inside[i] {
            continue;
        }
        let (x, y) = (spots[i].2, spots[i].3);
        let Some((k, d)) = down.iter().enumerate().find(|(_, d)| (d.x_m - x).powi(2) + (d.y_m - y).powi(2) < CIRCLE_M * CIRCLE_M) else {
            continue;
        };
        circle[i] = Some(k);
        if !still[i] {
            continue;
        }
        let (dx, dy) = (x - d.x_m, y - d.y_m);
        let len = (dx * dx + dy * dy).sqrt();
        let (ux, uy) = if len < 0.01 {
            let a = m.band_id as f32 * 2.399_963;
            (a.cos(), a.sin())
        } else {
            (dx / len, dy / len)
        };
        let (sx, sy) = venue.snap((d.x_m + ux * CLEAR_M, d.y_m + uy * CLEAR_M));
        spots[i].2 = sx;
        spots[i].3 = sy;
    }
    // Radio and test bands stand among them too: they count as neighbours, and a test band meets them.
    // Whoever is not in the venue stands far away from everyone.
    let others: Vec<Band> = ctx.db.band().iter().filter(|b| b.id < FIRST_CROWD_BAND).filter(|b| b.online && b.zone != 0).collect();
    let mut points: Vec<(f32, f32)> = spots.iter().zip(&inside).map(|(s, &on)| if on { (s.2, s.3) } else { (1e6, 1e6) }).collect();
    points.extend(others.iter().map(|b| (b.x_m, b.y_m)));
    let grid = Grid::new(&points);

    let mut witnessed: HashMap<u64, usize> = HashMap::new();
    for (i, m) in members.iter().enumerate() {
        let (station, booth_id, x, y) = spots[i];
        let neigh = (grid.within(&points, (x, y), NEIGH_M).len().saturating_sub(1)).min(255) as u8;
        let prev = bands.get(&m.band_id);
        let downed = down.iter().find(|d| d.band_id == m.band_id);
        let state = match (downed, circle[i]) {
            (Some(_), _) => S_SOS,
            (None, Some(_)) => S_NEAR_SOS,
            _ => density_state(prev.map(|b| b.state).unwrap_or(0), neigh, settings.yellow, settings.red),
        };
        let (fall, sos) = downed.map(|d| (d.fall, !d.fall)).unwrap_or((false, false));
        if let Some(d) = circle[i].map(|k| &down[k]) {
            let n = witnessed.entry(d.incident_id).or_insert_with(|| ctx.db.incident_band().incident_id().filter(d.incident_id).count());
            let known = ctx.db.incident_band().incident_id().filter(d.incident_id).any(|r| r.band_id == m.band_id);
            if let Some(incident) = (known || *n < MAX_WITNESSES).then(|| ctx.db.incident().id().find(d.incident_id)).flatten() {
                safety::witness(ctx, &incident, m.band_id, safety::zone_id_for_station(ctx, station), -58);
                if !known {
                    *n += 1;
                }
            }
        }
        let online = inside[i];
        let same_spot = prev.is_some_and(|b| b.zone == station && b.booth_id == booth_id);
        if prev.is_some_and(|b| same_spot && b.neigh == neigh && b.state == state && b.x_m == x && b.y_m == y && b.online == online && b.fall == fall && b.sos == sos) {
            continue;
        }
        if !online {
            crate::ingest::leave_zone(ctx, m.band_id);
        } else if !same_spot || !prev.is_some_and(|b| b.online) {
            for v in ctx.db.zone_visit().band_id().filter(m.band_id).filter(|v| v.open).collect::<Vec<_>>() {
                close_stay(ctx, v);
            }
            open_stay(ctx, m.band_id, station, booth_id);
        }
        let row = Band {
            id: m.band_id,
            state,
            flags: F_MPU | F_MOTOR | if fall { F_FALL } else { 0 } | if sos { F_SOS } else { 0 },
            neigh,
            zone: station,
            bat: 255,
            find: 0,
            rssi: -60,
            seq: prev.map(|b| b.seq.wrapping_add(1)).unwrap_or(1),
            sos,
            fall,
            pressed: false,
            low_battery: false,
            has_mpu: true,
            has_motor: true,
            online,
            last_seen: ctx.timestamp,
            x_m: x,
            y_m: y,
            booth_id,
        };
        let row = if prev.is_some() { ctx.db.band().id().update(row) } else { ctx.db.band().insert(row) };
        bands.insert(row.id, row);
    }

    // Strangers at the same spot start talking; everyone working the event talks to people more often. Everyone
    // talks to only so many strangers.
    let mut counts: HashMap<u32, u32> = HashMap::new();
    let same_spot = |i: usize, j: usize| spots[i].0 == spots[j].0 && spots[i].1 == spots[j].1;
    for i in 0..members.len() {
        let staff = role_of(group_of[&members[i].group_id]) != HACKER;
        if members[i].chat != 0 || !inside[i] || !rng.gen_bool(if staff { STAFF_CHAT_CHANCE } else { CHAT_CHANCE }) {
            continue;
        }
        let candidates: Vec<usize> = grid
            .near(&points, (spots[i].2, spots[i].3))
            .into_iter()
            .filter(|&j| j < members.len() && inside[j] && members[j].chat == 0 && members[j].group_id != members[i].group_id && same_spot(i, j))
            .collect();
        if candidates.is_empty() {
            continue;
        }
        let j = candidates[rng.gen_range(0..candidates.len())];
        let (a, b) = (members[i].band_id, members[j].band_id);
        let other_staff = role_of(group_of[&members[j].group_id]) != HACKER;
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
    let index: HashMap<u32, usize> = members.iter().enumerate().map(|(i, m)| (m.band_id, i)).collect();
    let slice = tick % SLICES;
    let credit = (SLICES * TICK_MILLIS / 1_000 * TOGETHER_SPEEDUP) as u32;
    let mut teams: HashMap<u16, Vec<u32>> = HashMap::new();
    for m in &members {
        teams.entry(m.group_id).or_default().push(m.band_id);
    }
    for (i, m) in members.iter().enumerate() {
        if m.band_id as u64 % SLICES != slice || !inside[i] {
            continue;
        }
        let mut close: Vec<u32> = teams[&m.group_id].iter().copied().filter(|b| *b > m.band_id && index.get(b).is_some_and(|&j| inside[j])).collect();
        if m.chat > m.band_id && index.get(&m.chat).is_some_and(|&j| same_spot(i, j)) {
            close.push(m.chat);
        }
        for other in close {
            let enc = together(ctx, m.band_id, other, credit);
            sync_encounter(ctx, &enc, m.identity, members[index[&other]].identity);
        }
    }

    // A claimed test band that is live meets the crowd standing within radio range, in real time, and
    // other test bands in its zone. It stands at its zone's centre, which in a zone of booths is the aisle
    // between them, so with nobody in range it joins the team standing closest to it in its zone.
    let testers: Vec<&Band> = others
        .iter()
        .filter(|b| radio_id(b.id).is_some_and(|id| crate::safety::TEST_BANDS.contains(&id)))
        .filter(|b| radio_id(b.id).is_some_and(|id| ctx.db.band_owner().band_id().find(id).is_some()))
        .collect();
    let secs = (TICK_MILLIS / 1_000) as u32;
    for t in &testers {
        let mut near: Vec<usize> = grid.near(&points, (t.x_m, t.y_m)).into_iter().filter(|&j| j < members.len()).collect();
        if near.is_empty() {
            let dist = |j: usize| (spots[j].2 - t.x_m).powi(2) + (spots[j].3 - t.y_m).powi(2);
            if let Some(closest) = (0..members.len()).filter(|&j| spots[j].0 == t.zone).min_by(|&a, &b| dist(a).total_cmp(&dist(b))) {
                let team = members[closest].group_id;
                near = (0..members.len()).filter(|&j| members[j].group_id == team).collect();
            }
        }
        for j in near {
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
