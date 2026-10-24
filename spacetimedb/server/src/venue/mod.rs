pub mod import;
pub mod setup;
pub mod tables;

pub use tables::*;

use spacetimedb::ReducerContext;

pub fn zone_for_station(ctx: &ReducerContext, station_id: u8) -> Option<Zone> {
    if station_id == 0 {
        return None;
    }
    ctx.db.zone().station_id().filter(station_id).next()
}

pub fn booths_in_zone(ctx: &ReducerContext, zone_id: u64) -> Vec<Booth> {
    ctx.db.booth().zone_id().filter(zone_id).collect()
}

/// The centre of the station's zone on the venue plan, in metres; (0, 0) when no zone has the station.
pub fn station_spot(ctx: &ReducerContext, station_id: u8) -> (f32, f32) {
    zone_for_station(ctx, station_id).map(|z| (z.plan_x_m, z.plan_y_m)).unwrap_or((0.0, 0.0))
}
