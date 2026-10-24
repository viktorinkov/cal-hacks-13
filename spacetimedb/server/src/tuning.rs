use crate::commands::enqueue;
use crate::roles::require_role;
use crate::tables::*;
use spacetimedb::{ReducerContext, Table};

pub(crate) fn defaults() -> Settings {
    Settings { id: 0, yellow: 3, red: 5, neigh_rssi: -62, circle_rssi: -58, low_vis: false, override_density: false }
}

fn current(ctx: &ReducerContext) -> Settings {
    ctx.db.settings().id().find(0).unwrap_or_else(defaults)
}

fn store(ctx: &ReducerContext, s: Settings) {
    if ctx.db.settings().id().find(0).is_some() {
        ctx.db.settings().id().update(s);
    } else {
        ctx.db.settings().insert(s);
    }
}

#[spacetimedb::reducer]
pub fn set_thresholds(ctx: &ReducerContext, yellow: u8, red: u8) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if yellow < 1 || red < yellow {
        return Err("need 1 <= yellow <= red".into());
    }
    store(ctx, Settings { yellow, red, ..current(ctx) });
    enqueue(ctx, 0, "thresh", yellow, red);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_rssi(ctx: &ReducerContext, neigh_rssi: i8, circle_rssi: i8) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let (n, c) = (neigh_rssi.unsigned_abs(), circle_rssi.unsigned_abs());
    if !(20..=100).contains(&n) || !(20..=100).contains(&c) {
        return Err("RSSI thresholds are -20..-100 dBm".into());
    }
    store(ctx, Settings { neigh_rssi: -(n as i8), circle_rssi: -(c as i8), ..current(ctx) });
    enqueue(ctx, 0, "rssi", n, c);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_low_vis(ctx: &ReducerContext, on: bool) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    store(ctx, Settings { low_vis: on, ..current(ctx) });
    enqueue(ctx, 0, "lowvis", on as u8, 0);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_override(ctx: &ReducerContext, on: bool) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    store(ctx, Settings { override_density: on, ..current(ctx) });
    enqueue(ctx, 0, "override", on as u8, 0);
    Ok(())
}
