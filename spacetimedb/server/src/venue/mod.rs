pub mod import;
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
