//! The spots people use on the venue's 3D floor (`web/venue/spots.json`): hacker tables, sponsor tables, the
//! crowd in front of the stage, the food line, the doors, and the named places and areas. Coordinates are the
//! 3D model's metres, x east and z south, stored as the plan's x and y, so a band's `x_m`/`y_m` is where it
//! stands in the model. With spots loaded, the crowd sits teams at the tables and sends people between them.

use super::tables::*;
use crate::roles::require_role;
use spacetimedb::rand::rngs::StdRng;
use spacetimedb::rand::{Rng, SeedableRng};
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};

#[derive(Clone, Debug, PartialEq)]
#[spacetimedb::table(accessor = venue_spot, public)]
pub struct VenueSpot {
    #[primary_key]
    pub id: u32,
    /// `table`, `sponsor_table`, `stage`, `food`, `entrance`, `exit`, `place` or `area`.
    #[index(btree)]
    pub kind: String,
    pub name: String,
    /// The printed table number, 0 for everything else.
    pub number: u32,
    pub x_m: f32,
    pub y_m: f32,
    /// The direction a sponsor table faces, in radians.
    pub angle: f32,
    /// The zone's station the spot belongs to, 0 for labels.
    #[index(btree)]
    pub station_id: u8,
    /// The booth at a sponsor table, 0 for everything else.
    pub booth_id: u64,
}

/// One row of `spots.json`.
#[derive(SpacetimeType, Clone, Debug)]
pub struct VenueSpotIn {
    pub kind: String,
    pub name: String,
    pub number: u32,
    pub x: f32,
    pub z: f32,
    pub angle: f32,
}

/// The zone kind each spot kind belongs to.
fn zone_kind(spot_kind: &str) -> Option<&'static str> {
    match spot_kind {
        "table" => Some("floor"),
        "sponsor_table" => Some("sponsor"),
        "stage" => Some("stage"),
        "food" => Some("food"),
        "entrance" | "exit" => Some("entrance"),
        _ => None,
    }
}

/// Lowercase letters and digits only, so "After Query" finds the booth "AfterQuery".
fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// Whether a sponsor table's name is this booth's or its organisation's name.
fn names_match(table: &str, booth: &str) -> bool {
    let (t, b) = (squash(table), squash(booth));
    !t.is_empty() && !b.is_empty() && (t == b || (t.len() >= 3 && b.starts_with(&t)) || (b.len() >= 3 && t.starts_with(&b)))
}

/// Replaces the venue's spots. Sponsor tables go to the booth of the same name first; the booths left over
/// take the tables left over, so every booth has a table while there are tables.
#[spacetimedb::reducer]
pub fn load_venue_spots(ctx: &ReducerContext, spots: Vec<VenueSpotIn>) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    for s in ctx.db.venue_spot().iter().collect::<Vec<_>>() {
        ctx.db.venue_spot().id().delete(s.id);
    }
    let station_of = |kind: &str| -> u8 {
        zone_kind(kind)
            .and_then(|k| ctx.db.zone().iter().filter(|z| z.station_id != 0).find(|z| z.kind == k))
            .map(|z| z.station_id)
            .unwrap_or(0)
    };
    let sponsor_station = station_of("sponsor_table");
    let mut booths: Vec<(Booth, String)> = ctx
        .db
        .booth()
        .iter()
        .map(|b| {
            let org = ctx.db.organization().id().find(b.organization_id).map(|o| o.name).unwrap_or_default();
            (b, org)
        })
        .collect();
    booths.sort_by_key(|(b, _)| b.id);
    let mut taken: Vec<u64> = Vec::new();
    let mut rows: Vec<VenueSpot> = spots
        .iter()
        .enumerate()
        .map(|(i, s)| VenueSpot {
            id: i as u32 + 1,
            kind: s.kind.clone(),
            name: s.name.clone(),
            number: s.number,
            x_m: s.x,
            y_m: s.z,
            angle: s.angle,
            station_id: station_of(&s.kind),
            booth_id: 0,
        })
        .collect();
    for r in rows.iter_mut().filter(|r| r.kind == "sponsor_table") {
        if let Some((b, _)) = booths.iter().find(|(b, org)| !taken.contains(&b.id) && (names_match(&r.name, &b.name) || names_match(&r.name, org))) {
            r.booth_id = b.id;
            taken.push(b.id);
        }
    }
    let mut left = booths.iter().filter(|(b, _)| !taken.contains(&b.id) && sponsor_station != 0);
    for r in rows.iter_mut().filter(|r| r.kind == "sponsor_table" && r.booth_id == 0) {
        match left.next() {
            Some((b, _)) => r.booth_id = b.id,
            None => break,
        }
    }
    for r in rows {
        ctx.db.venue_spot().insert(r);
    }
    Ok(())
}

/// A station's spot nearest the middle of its spots: where a band the radio places only by zone stands.
pub fn station_centre(spots: &[VenueSpot], station_id: u8) -> Option<(f32, f32)> {
    let mine: Vec<&VenueSpot> = spots.iter().filter(|s| s.station_id == station_id && s.station_id != 0).collect();
    if mine.is_empty() {
        return None;
    }
    let n = mine.len() as f32;
    let (cx, cy) = (mine.iter().map(|s| s.x_m).sum::<f32>() / n, mine.iter().map(|s| s.y_m).sum::<f32>() / n);
    mine.iter()
        .min_by(|a, b| ((a.x_m - cx).powi(2) + (a.y_m - cy).powi(2)).total_cmp(&((b.x_m - cx).powi(2) + (b.y_m - cy).powi(2))))
        .map(|s| (s.x_m, s.y_m))
}

/// The zone spot nearest to a point: a table, a sponsor table, the stage, the food line or a door.
fn nearest_zone_spot(ctx: &ReducerContext, x: f32, y: f32) -> Option<VenueSpot> {
    ctx.db
        .venue_spot()
        .iter()
        .filter(|s| s.station_id != 0)
        .min_by(|a, b| ((a.x_m - x).powi(2) + (a.y_m - y).powi(2)).total_cmp(&((b.x_m - x).powi(2) + (b.y_m - y).powi(2))))
}

/// The station of the zone spot nearest to a point, 0 when there are no spots.
pub fn nearest_station(ctx: &ReducerContext, x: f32, y: f32) -> u8 {
    nearest_zone_spot(ctx, x, y).map(|s| s.station_id).unwrap_or(0)
}

/// The booth at a point: the booth of its sponsor table when the zone spot nearest to it is one, else 0.
pub fn nearest_booth(ctx: &ReducerContext, x: f32, y: f32) -> u64 {
    nearest_zone_spot(ctx, x, y).filter(|s| s.kind == "sponsor_table").map(|s| s.booth_id).unwrap_or(0)
}

/// The booth a band the radio places only by zone stands at for one stay: one of the zone's sponsor tables, picked
/// by a generator seeded with the band and the stay's start, so one stay always names one booth. 0 when the zone has
/// no sponsor table with a booth.
pub fn zone_booth(ctx: &ReducerContext, band_id: u32, station_id: u8, entered: Timestamp) -> u64 {
    let mut booths: Vec<u64> = ctx
        .db
        .venue_spot()
        .station_id()
        .filter(station_id)
        .filter(|s| s.kind == "sponsor_table" && s.booth_id != 0)
        .map(|s| s.booth_id)
        .collect();
    booths.sort_unstable();
    booths.dedup();
    if booths.is_empty() {
        return 0;
    }
    let seed = (band_id as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ entered.to_micros_since_unix_epoch() as u64;
    booths[StdRng::seed_from_u64(seed).gen_range(0..booths.len())]
}

/// Where a visitor stands at a booth: in front of its sponsor table, where the crowd's visitors stand.
pub fn booth_spot(ctx: &ReducerContext, booth_id: u64) -> Option<(f32, f32)> {
    if booth_id == 0 {
        return None;
    }
    let t = ctx.db.venue_spot().kind().filter("sponsor_table").filter(|s| s.booth_id == booth_id).min_by_key(|s| s.id)?;
    let (nx, ny) = (-t.angle.sin(), t.angle.cos());
    Some((t.x_m + nx * 1.4, t.y_m + ny * 1.4))
}

/// The labelled spot nearest to a point, for saying where something happened: "table 112", "the Anthropic
/// table", "the stage", "the food line", "Public Entrance".
pub fn place_name(ctx: &ReducerContext, x: f32, y: f32) -> String {
    let near = ctx
        .db
        .venue_spot()
        .iter()
        .filter(|s| s.kind != "area")
        .min_by(|a, b| ((a.x_m - x).powi(2) + (a.y_m - y).powi(2)).total_cmp(&((b.x_m - x).powi(2) + (b.y_m - y).powi(2))));
    match near {
        Some(s) if s.kind == "table" => format!("table {}", s.number),
        Some(s) if s.kind == "sponsor_table" => format!("the {} table", s.name),
        Some(s) if s.kind == "stage" => "the stage".into(),
        Some(s) if s.kind == "food" => "the food line".into(),
        Some(s) => s.name,
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_sponsor_names() {
        assert!(names_match("After Query", "AfterQuery"));
        assert!(names_match("SpacetimeDB", "SpacetimeDB"));
        assert!(names_match("Scale", "Scale AI"));
        assert!(names_match("Bright Data", "Bright Data"));
        assert!(!names_match("YC", "Y Combinator"));
        assert!(!names_match("Moss", "Moonpay"));
    }
}
