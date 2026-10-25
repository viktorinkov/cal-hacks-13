//! How the crowd walks: a team sets off together, one behind the other, along the floor's shortest way to where
//! it goes next, and each member walks from where they stand to their own spot there at the team's steady
//! speed. A `crowd_walk` row holds each member's way, so the band reports its wearer's place along it on every
//! crowd tick and the 3D view draws the same walk smoothly between ticks. Without a walkable floor loaded the
//! way is a straight line.

use super::tables::*;
use crate::venue::floor::{Floor, P};
use spacetimedb::{ReducerContext, Table, TimeDuration, Timestamp};

/// People walk at 1.1 to 1.5 m/s, each team at its own pace.
const SPEED_MPS: (f32, f32) = (1.1, 1.5);
/// A faster live run plays the walks at most this many times faster, so they stay brisk walks and not runs.
pub const MAX_WALK_PACE: f32 = 1.5;
/// Teammates set off this far apart, so a team walks in a line instead of as one block.
const STAGGER_MICROS: i64 = 600_000;

/// The walking speed of team `group_id` at `pace`, in metres per second.
pub fn team_speed(group_id: u16, pace: f32) -> f32 {
    let mut x = (group_id as u32).wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 15;
    x = x.wrapping_mul(0x2C1B_3C6D);
    x ^= x >> 12;
    let t = (x % 1000) as f32 / 1000.0;
    (SPEED_MPS.0 + (SPEED_MPS.1 - SPEED_MPS.0) * t) * pace.clamp(1.0, MAX_WALK_PACE)
}

fn corners(w: &CrowdWalk) -> impl Iterator<Item = P> + '_ {
    w.path.chunks_exact(2).map(|c| (c[0], c[1]))
}

fn dist(a: P, b: P) -> f32 {
    ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt()
}

/// How long a way is, in metres.
pub fn length(pts: &[P]) -> f32 {
    pts.windows(2).map(|w| dist(w[0], w[1])).sum()
}

/// Where someone on this walk is at `now`, and how far along it they are, from 0 before they set off to 1 once
/// they arrive.
pub fn at(w: &CrowdWalk, now: Timestamp) -> (P, f32) {
    let pts: Vec<P> = corners(w).collect();
    let Some(&first) = pts.first() else { return ((0.0, 0.0), 1.0) };
    let total = length(&pts);
    let secs = (now.to_micros_since_unix_epoch() - w.started_at.to_micros_since_unix_epoch()) as f32 / 1e6;
    if secs <= 0.0 {
        return (first, 0.0);
    }
    let mut left = secs * w.speed_mps;
    if total <= 0.0 || left >= total {
        return (*pts.last().unwrap(), 1.0);
    }
    let walked = left;
    for s in pts.windows(2) {
        let d = dist(s[0], s[1]);
        if left <= d {
            let t = if d > 0.0 { left / d } else { 1.0 };
            return ((s[0].0 + (s[1].0 - s[0].0) * t, s[0].1 + (s[1].1 - s[0].1) * t), walked / total);
        }
        left -= d;
    }
    (*pts.last().unwrap(), 1.0)
}

/// Where the walk ends: where its walker stands once they arrive.
pub fn end(w: &CrowdWalk) -> Option<P> {
    corners(w).last()
}

/// One member's way: from where they stand, through the team's corners, to their own spot at the team's
/// destination. Legs that would cross something go around it.
pub fn member_way(floor: Option<&Floor>, from: P, team: &[P], to: P) -> Vec<P> {
    let Some(f) = floor else { return vec![from, to] };
    let inner = if team.len() > 2 { &team[1..team.len() - 1] } else { &[][..] };
    let mut pts = vec![from];
    for &q in inner.iter().chain(std::iter::once(&to)) {
        let last = *pts.last().unwrap();
        if f.clear(last, q) {
            pts.push(q);
        } else {
            pts.extend(f.path(last, q).into_iter().skip(1));
        }
    }
    f.pull(&pts)
}

/// Starts the walk of band `band_id` along `way` at `at`, replacing its last walk.
pub fn begin(ctx: &ReducerContext, band_id: u32, way: Vec<P>, at: Timestamp, speed_mps: f32) -> CrowdWalk {
    let secs = length(&way) / speed_mps.max(0.1);
    let row = CrowdWalk {
        band_id,
        path: way.iter().flat_map(|p| [p.0, p.1]).collect(),
        started_at: at,
        arrives_at: at + TimeDuration::from_micros((secs * 1e6) as i64),
        speed_mps,
    };
    if ctx.db.crowd_walk().band_id().find(band_id).is_some() {
        ctx.db.crowd_walk().band_id().update(row)
    } else {
        ctx.db.crowd_walk().insert(row)
    }
}

/// When member number `k` of a team setting off at `at` sets off.
pub fn set_off(at: Timestamp, k: usize) -> Timestamp {
    at + TimeDuration::from_micros(k as i64 * STAGGER_MICROS)
}

/// Every walk moves on by `gap`, after a pause: nobody walked while the run stood still.
pub fn shift(ctx: &ReducerContext, gap: TimeDuration) {
    for w in ctx.db.crowd_walk().iter().collect::<Vec<_>>() {
        ctx.db.crowd_walk().band_id().update(CrowdWalk { started_at: w.started_at + gap, arrives_at: w.arrives_at + gap, ..w });
    }
}

pub fn clear(ctx: &ReducerContext) {
    for w in ctx.db.crowd_walk().iter().collect::<Vec<_>>() {
        ctx.db.crowd_walk().band_id().delete(w.band_id);
    }
}
