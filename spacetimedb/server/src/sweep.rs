use crate::tables::*;
use crate::{ingest, log_event};
use spacetimedb::{ReducerContext, ScheduleAt, Table};

const OFFLINE_MICROS: i64 = 5_000_000;

pub(crate) fn schedule(ctx: &ReducerContext) {
    ctx.db.sweep_timer().insert(SweepTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(std::time::Duration::from_secs(1).into()),
    });
}

#[spacetimedb::reducer]
pub fn sweep(ctx: &ReducerContext, _timer: SweepTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("sweep is internal".into());
    }
    let now = micros(ctx.timestamp);
    // Only radio and test bands report; the crowd's bands stay online while the crowd moves them.
    for b in ctx.db.band().iter().filter(|b| b.id < FIRST_CROWD_BAND).filter(|b| b.online && now - micros(b.last_seen) > OFFLINE_MICROS).collect::<Vec<_>>() {
        if let Some(id) = radio_id(b.id).filter(|_| b.state != S_OFF) {
            log_event(ctx, id, EventKind::Offline, "");
        }
        ingest::leave_zone(ctx, b.id);
        ctx.db.band().id().update(Band { online: false, ..b });
    }
    for s in ctx.db.station().iter().filter(|s| s.online && now - micros(s.last_seen) > OFFLINE_MICROS).collect::<Vec<_>>() {
        ctx.db.station().id().update(Station { online: false, ..s });
    }
    if let Some(g) = ctx.db.gateway().id().find(0) {
        if g.online && now - micros(g.last_line) > OFFLINE_MICROS {
            ctx.db.gateway().id().update(Gateway { online: false, ..g });
        }
    }
    Ok(())
}
