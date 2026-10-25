pub mod import;
pub mod setup;
pub mod spots;
pub mod tables;

pub use spots::*;
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

/// Where a band the radio places only by its zone stands, in metres: the zone's middle spot on the 3D floor
/// when spots are loaded, else the centre of the station's zone on the plan; (0, 0) when no zone has the station.
pub fn station_spot(ctx: &ReducerContext, station_id: u8) -> (f32, f32) {
    let spots: Vec<VenueSpot> = ctx.db.venue_spot().station_id().filter(station_id).collect();
    if let Some(p) = station_centre(&spots, station_id) {
        return p;
    }
    zone_for_station(ctx, station_id).map(|z| (z.plan_x_m, z.plan_y_m)).unwrap_or((0.0, 0.0))
}
