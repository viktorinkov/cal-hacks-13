//! Where people can walk on the venue's 3D floor (`web/venue/floor.json`, from `pipeline/venue_floor.py`): the
//! model seen from above as a grid of 25 cm cells, open where there is floor and nothing in the way. Walls,
//! tables, the stage and the food line close a cell; chairs do not. The crowd walks between its spots on this
//! grid, so it follows the aisles and the hall's curve instead of crossing tables and walls.

use crate::roles::require_role;
use spacetimedb::{ReducerContext, SpacetimeType, Table, Timestamp};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

/// One row, id 0: the walkable grid.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = venue_floor)]
pub struct VenueFloor {
    #[primary_key]
    pub id: u8,
    /// The grid's corner in the model's metres, x east and y (the model's z) south.
    pub x0_m: f32,
    pub y0_m: f32,
    pub cell_m: f32,
    pub cols: u32,
    pub rows: u32,
    /// One bit per cell, row by row, set where people can walk.
    pub open: Vec<u8>,
    pub loaded_at: Timestamp,
}

/// `floor.json`: the grid's corner, its cell size and size in cells, and the cells row by row as run lengths,
/// starting with a closed run.
#[derive(SpacetimeType, Clone, Debug)]
pub struct VenueFloorIn {
    pub x0: f32,
    pub z0: f32,
    pub cell: f32,
    pub cols: u32,
    pub rows: u32,
    pub runs: Vec<u32>,
}

/// Replaces the walkable grid.
#[spacetimedb::reducer]
pub fn load_venue_floor(ctx: &ReducerContext, floor: VenueFloorIn) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let row = floor_row(&floor, ctx.timestamp)?;
    ctx.db.venue_floor().id().delete(0);
    ctx.db.venue_floor().insert(row);
    Ok(())
}

pub fn floor_row(f: &VenueFloorIn, at: Timestamp) -> Result<VenueFloor, String> {
    let cells = f.cols as usize * f.rows as usize;
    if cells == 0 || !(f.cell > 0.0) {
        return Err("the floor has no cells".into());
    }
    if f.runs.iter().map(|&n| n as usize).sum::<usize>() != cells {
        return Err(format!("the runs cover {} cells, not {cells}", f.runs.iter().map(|&n| n as usize).sum::<usize>()));
    }
    let mut open = vec![0u8; cells.div_ceil(8)];
    let mut i = 0usize;
    for (k, &n) in f.runs.iter().enumerate() {
        if k % 2 == 1 {
            for c in i..i + n as usize {
                open[c / 8] |= 1 << (c % 8);
            }
        }
        i += n as usize;
    }
    Ok(VenueFloor { id: 0, x0_m: f.x0, y0_m: f.z0, cell_m: f.cell, cols: f.cols, rows: f.rows, open, loaded_at: at })
}

/// A point on the floor in metres.
pub type P = (f32, f32);

/// Cells searched around a point that stands where nobody can, for the nearest walkable one: 6 m.
const SNAP_CELLS: i32 = 24;
/// A* takes up to this many cells before giving up on a path; the walker then stays where they are.
const MAX_EXPANDED: usize = 120_000;
/// A clear line keeps this far from closed cells, in metres, so rounding never puts a walker in one.
const HAIR_M: f32 = 0.005;
/// A* leans this much on the distance left, which finds a path faster and the string pulling straightens.
const GREED: f32 = 1.3;

/// The walkable grid, read once per reducer call.
pub struct Floor {
    x0: f32,
    y0: f32,
    cell: f32,
    cols: i32,
    rows: i32,
    open: Vec<u8>,
}

#[derive(PartialEq)]
struct Next {
    f: f32,
    cell: u32,
}

impl Eq for Next {}

impl Ord for Next {
    fn cmp(&self, o: &Self) -> Ordering {
        o.f.total_cmp(&self.f).then(o.cell.cmp(&self.cell))
    }
}

impl PartialOrd for Next {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

impl Floor {
    pub fn load(ctx: &ReducerContext) -> Option<Floor> {
        ctx.db.venue_floor().id().find(0).map(|f| Floor::from_row(&f))
    }

    pub fn from_row(f: &VenueFloor) -> Floor {
        Floor { x0: f.x0_m, y0: f.y0_m, cell: f.cell_m, cols: f.cols as i32, rows: f.rows as i32, open: f.open.clone() }
    }

    fn is_open(&self, c: i32, r: i32) -> bool {
        if c < 0 || r < 0 || c >= self.cols || r >= self.rows {
            return false;
        }
        let i = (r * self.cols + c) as usize;
        self.open[i / 8] & (1 << (i % 8)) != 0
    }

    fn cell_of(&self, (x, y): P) -> (i32, i32) {
        (((x - self.x0) / self.cell).floor() as i32, ((y - self.y0) / self.cell).floor() as i32)
    }

    fn centre(&self, c: i32, r: i32) -> P {
        (self.x0 + (c as f32 + 0.5) * self.cell, self.y0 + (r as f32 + 0.5) * self.cell)
    }

    /// True where someone can stand.
    pub fn walkable(&self, p: P) -> bool {
        let (c, r) = self.cell_of(p);
        self.is_open(c, r)
    }

    /// The point itself where someone can stand there, else the nearest point of the nearest walkable cell, so
    /// nobody stands in a wall or outside the venue.
    pub fn snap(&self, p: P) -> P {
        let (c, r) = self.cell_of(p);
        if self.is_open(c, r) {
            return self.clear_of_walls(c, r, p);
        }
        let mut best: Option<(f32, P)> = None;
        for ring in 1..=SNAP_CELLS {
            for dr in -ring..=ring {
                for dc in -ring..=ring {
                    if dr.abs() != ring && dc.abs() != ring {
                        continue;
                    }
                    if !self.is_open(c + dc, r + dr) {
                        continue;
                    }
                    // The nearest point of that cell, a little inside it.
                    let (cx, cy) = self.centre(c + dc, r + dr);
                    let h = self.cell * 0.45;
                    let q = (p.0.clamp(cx - h, cx + h), p.1.clamp(cy - h, cy + h));
                    let d = (q.0 - p.0).powi(2) + (q.1 - p.1).powi(2);
                    if best.is_none_or(|(b, _)| d < b) {
                        best = Some((d, q));
                    }
                }
            }
            // A cell found on this ring can still lose to one on the next ring only by less than a cell.
            if let Some((d, q)) = best {
                if d.sqrt() <= (ring as f32 - 1.0) * self.cell {
                    return q;
                }
            }
        }
        if let Some((_, q)) = best {
            return q;
        }
        // Farther than 6 m from the floor, like a spot outside the building: the nearest cell of the whole floor.
        let mut far: Option<(i32, i32, i32)> = None;
        for rr in 0..self.rows {
            for cc in 0..self.cols {
                let d = (cc - c).pow(2) + (rr - r).pow(2);
                if self.is_open(cc, rr) && far.is_none_or(|(b, _, _)| d < b) {
                    far = Some((d, cc, rr));
                }
            }
        }
        far.map(|(_, cc, rr)| self.centre(cc, rr)).unwrap_or(p)
    }

    /// `p` in its open cell, a little away from the closed cells beside it, as a snapped point is, so a straight
    /// line to it has a hair to spare on either side.
    fn clear_of_walls(&self, c: i32, r: i32, (x, y): P) -> P {
        let (cx, cy) = self.centre(c, r);
        let h = self.cell * 0.45;
        let side_closed = |dc: i32, dr: i32| (-1..=1).any(|k| if dc != 0 { !self.is_open(c + dc, r + k) } else { !self.is_open(c + k, r + dr) });
        let x = if side_closed(-1, 0) { x.max(cx - h) } else { x };
        let x = if side_closed(1, 0) { x.min(cx + h) } else { x };
        let y = if side_closed(0, -1) { y.max(cy - h) } else { y };
        let y = if side_closed(0, 1) { y.min(cy + h) } else { y };
        (x, y)
    }

    /// True when the straight line from `a` to `b` crosses only walkable cells, with a hair to spare on either
    /// side, so every point along it, as rounded, stands where someone can.
    pub fn clear(&self, a: P, b: P) -> bool {
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let len = (dx * dx + dy * dy).sqrt();
        if len < 1e-6 {
            return self.walkable(a);
        }
        let (nx, ny) = (-dy / len * HAIR_M, dx / len * HAIR_M);
        self.line(a, b) && self.line((a.0 + nx, a.1 + ny), (b.0 + nx, b.1 + ny)) && self.line((a.0 - nx, a.1 - ny), (b.0 - nx, b.1 - ny))
    }

    /// True when every cell the segment from `a` to `b` touches is open; through a corner, both cells beside
    /// it count.
    fn line(&self, a: P, b: P) -> bool {
        let ((mut c, mut r), end) = (self.cell_of(a), self.cell_of(b));
        if !self.is_open(c, r) || !self.is_open(end.0, end.1) {
            return false;
        }
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let (sc, sr) = (if dx > 0.0 { 1 } else { -1 }, if dy > 0.0 { 1 } else { -1 });
        // How far along the segment, from 0 to 1, the next column and the next row begin, and the step between.
        let edge = |o: f32, i: i32, s: i32| o + (i + if s > 0 { 1 } else { 0 }) as f32 * self.cell;
        let (mut tx, dtx) = if dx != 0.0 { ((edge(self.x0, c, sc) - a.0) / dx, self.cell / dx.abs()) } else { (f32::INFINITY, f32::INFINITY) };
        let (mut ty, dty) = if dy != 0.0 { ((edge(self.y0, r, sr) - a.1) / dy, self.cell / dy.abs()) } else { (f32::INFINITY, f32::INFINITY) };
        for _ in 0..(end.0 - c).abs() + (end.1 - r).abs() + 2 {
            if (c, r) == end || tx.min(ty) > 1.0 {
                break;
            }
            if (tx - ty).abs() < 1e-6 {
                if !self.is_open(c + sc, r) || !self.is_open(c, r + sr) {
                    return false;
                }
                (c, r, tx, ty) = (c + sc, r + sr, tx + dtx, ty + dty);
            } else if tx < ty {
                (c, tx) = (c + sc, tx + dtx);
            } else {
                (r, ty) = (r + sr, ty + dty);
            }
            if !self.is_open(c, r) {
                return false;
            }
        }
        true
    }

    /// The way someone walks from `a` to `b`: the corners of the shortest walkable path, from `a` to `b`. Where
    /// either end stands where nobody can, or no path joins them, they stay at `a`.
    pub fn path(&self, a: P, b: P) -> Vec<P> {
        if self.clear(a, b) {
            return vec![a, b];
        }
        let (start, goal) = (self.cell_of(a), self.cell_of(b));
        if !self.is_open(start.0, start.1) || !self.is_open(goal.0, goal.1) {
            return vec![a];
        }
        let index = |(c, r): (i32, i32)| (r * self.cols + c) as u32;
        let unindex = |i: u32| ((i % self.cols as u32) as i32, (i / self.cols as u32) as i32);
        let h = |(c, r): (i32, i32)| {
            let (dx, dy) = ((c - goal.0).abs() as f32, (r - goal.1).abs() as f32);
            GREED * (dx.max(dy) + (std::f32::consts::SQRT_2 - 1.0) * dx.min(dy))
        };
        let mut best: HashMap<u32, (f32, u32)> = HashMap::new();
        let mut heap = BinaryHeap::new();
        let s = index(start);
        best.insert(s, (0.0, s));
        heap.push(Next { f: h(start), cell: s });
        let g_end = index(goal);
        let mut found = false;
        let mut expanded = 0usize;
        while let Some(Next { f, cell }) = heap.pop() {
            if cell == g_end {
                found = true;
                break;
            }
            let (c, r) = unindex(cell);
            let g = best[&cell].0;
            // A cell queued again with a shorter way since: this entry is stale.
            if f > g + h((c, r)) + 1e-3 {
                continue;
            }
            expanded += 1;
            if expanded > MAX_EXPANDED {
                break;
            }
            for (dc, dr) in [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
                let (nc, nr) = (c + dc, r + dr);
                if !self.is_open(nc, nr) {
                    continue;
                }
                // No cutting a corner: a diagonal step needs both cells beside it open.
                if dc != 0 && dr != 0 && !(self.is_open(c + dc, r) && self.is_open(c, r + dr)) {
                    continue;
                }
                let step = if dc != 0 && dr != 0 { std::f32::consts::SQRT_2 } else { 1.0 };
                let n = index((nc, nr));
                let ng = g + step;
                if best.get(&n).is_none_or(|&(old, _)| ng < old - 1e-4) {
                    best.insert(n, (ng, cell));
                    heap.push(Next { f: ng + h((nc, nr)), cell: n });
                }
            }
        }
        if !found {
            return vec![a];
        }
        let mut cells = vec![g_end];
        while *cells.last().unwrap() != s {
            cells.push(best[cells.last().unwrap()].1);
        }
        cells.reverse();
        let mut pts: Vec<P> = Vec::with_capacity(cells.len());
        pts.push(a);
        pts.extend(cells[1..cells.len().saturating_sub(1)].iter().map(|&i| {
            let (c, r) = unindex(i);
            self.centre(c, r)
        }));
        pts.push(b);
        self.pull(&pts)
    }

    /// The fewest corners of a polyline: from each corner, straight to the farthest later point in plain view.
    pub fn pull(&self, pts: &[P]) -> Vec<P> {
        if pts.len() <= 2 {
            return pts.to_vec();
        }
        let mut out = vec![pts[0]];
        let mut i = 0;
        while i < pts.len() - 1 {
            let mut j = i + 1;
            while j + 1 < pts.len() && self.clear(pts[i], pts[j + 1]) {
                j += 1;
            }
            out.push(pts[j]);
            i = j;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floor() -> Floor {
        let f: VenueFloorIn = {
            let v: serde_json::Value = serde_json::from_str(include_str!("../../../../web/venue/floor.json")).unwrap();
            VenueFloorIn {
                x0: v["x0"].as_f64().unwrap() as f32,
                z0: v["z0"].as_f64().unwrap() as f32,
                cell: v["cell"].as_f64().unwrap() as f32,
                cols: v["cols"].as_u64().unwrap() as u32,
                rows: v["rows"].as_u64().unwrap() as u32,
                runs: v["runs"].as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u32).collect(),
            }
        };
        Floor::from_row(&floor_row(&f, Timestamp::from_micros_since_unix_epoch(0)).unwrap())
    }

    fn length(p: &[P]) -> f32 {
        p.windows(2).map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt()).sum()
    }

    #[test]
    fn a_walk_across_the_hall_follows_its_curve() {
        let f = floor();
        // From table 1 at the west end to the food line at the east end, through the doors' side of the hall.
        let (a, b) = (f.snap((-77.72, 1.62)), f.snap((61.46, -0.8)));
        assert!(f.walkable(a) && f.walkable(b));
        assert!(!f.clear(a, b), "the straight line leaves the curved hall");
        let p = f.path(a, b);
        assert!(p.len() > 2, "{p:?}");
        assert!(p.windows(2).all(|w| f.clear(w[0], w[1])), "every leg stays on the floor: {p:?}");
        let straight = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        assert!(length(&p) < straight * 1.35, "{} m for {} m", length(&p), straight);
    }

    #[test]
    fn a_table_spot_snaps_beside_the_table() {
        let f = floor();
        let t = (-79.59, -10.3);
        assert!(!f.walkable(t), "a table spot is on the table");
        let s = f.snap(t);
        assert!(f.walkable(s));
        assert!(((s.0 - t.0).powi(2) + (s.1 - t.1).powi(2)).sqrt() < 1.2, "{s:?}");
    }
}
