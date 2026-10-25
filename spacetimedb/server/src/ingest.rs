use crate::tables::*;
use crate::{log_event, require_bridge};
use spacetimedb::{ReducerContext, Table};

const ENCOUNTER_GAP_MICROS: i64 = 5_000_000;
const ENCOUNTER_STEP_CAP_MICROS: i64 = 2_000_000;
const ZONE_BLIP_MICROS: i64 = 5_000_000;

fn band_row(b: &BandBeacon, ctx: &ReducerContext) -> Band {
    let (x_m, y_m, zone) = crate::live::radio_band_spot(ctx, b.id.into(), b.zone);
    Band {
        id: b.id.into(),
        state: b.state,
        flags: b.flags,
        neigh: b.neigh,
        zone,
        bat: b.bat,
        find: b.find,
        rssi: b.rssi,
        seq: b.seq,
        sos: b.flags & F_SOS != 0,
        fall: b.flags & F_FALL != 0,
        pressed: b.flags & F_PRESS != 0,
        low_battery: b.flags & F_LOWBAT != 0,
        has_mpu: b.flags & F_MPU != 0,
        has_motor: b.flags & F_MOTOR != 0,
        online: true,
        last_seen: ctx.timestamp,
        x_m,
        y_m,
        booth_id: 0,
    }
}

fn touch_gateway(ctx: &ReducerContext) {
    if let Some(g) = ctx.db.gateway().id().find(0) {
        ctx.db.gateway().id().update(Gateway { online: true, last_line: ctx.timestamp, ..g });
    }
}

#[spacetimedb::reducer]
pub fn gateway_up(ctx: &ReducerContext, mac: String, fw: String) -> Result<(), String> {
    require_bridge(ctx)?;
    let row = Gateway { id: 0, mac: mac.clone(), fw: fw.clone(), online: true, last_line: ctx.timestamp };
    if ctx.db.gateway().id().find(0).is_some() {
        ctx.db.gateway().id().update(row);
    } else {
        ctx.db.gateway().insert(row);
    }
    log_event(ctx, 0, EventKind::GatewayUp, format!("{mac} {fw}"));
    Ok(())
}

#[spacetimedb::reducer]
pub fn ingest_band(ctx: &ReducerContext, beacon: BandBeacon) -> Result<(), String> {
    require_bridge(ctx)?;
    if beacon.id == 0 || beacon.id > BAND_ID_MAX {
        return Err(format!("band id {} out of range", beacon.id));
    }
    touch_gateway(ctx);
    let row = band_row(&beacon, ctx);
    let id = beacon.id;
    let Some(prev) = ctx.db.band().id().find(row.id) else {
        if row.zone != 0 {
            open_stay(ctx, row.id, row.zone, 0);
        }
        ctx.db.band().insert(row);
        log_event(ctx, id, EventKind::Online, "");
        return Ok(());
    };
    if !prev.online {
        log_event(ctx, id, EventKind::Online, "");
    }
    if row.sos && !prev.sos {
        log_event(ctx, id, EventKind::SosRaised, "");
    }
    if !row.sos && prev.sos {
        log_event(ctx, id, EventKind::SosCleared, "");
    }
    if row.fall && !prev.fall {
        log_event(ctx, id, EventKind::Fall, "");
    }
    if row.pressed && !prev.pressed {
        log_event(ctx, id, EventKind::Press, "");
    }
    if row.find != prev.find {
        if row.find != 0 {
            log_event(ctx, id, EventKind::FindStarted, format!("looking for {}", row.find));
        } else {
            log_event(ctx, id, EventKind::FindEnded, format!("was looking for {}", prev.find));
        }
    }
    if row.state == S_FOUND_ME && prev.state != S_FOUND_ME {
        log_event(ctx, id, EventKind::FoundMe, "");
    }
    if row.state == S_OFF && prev.state != S_OFF {
        log_event(ctx, id, EventKind::Sleep, "");
    }
    if row.zone != prev.zone {
        change_zone(ctx, row.id, row.zone);
    }
    ctx.db.band().id().update(row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn ingest_station(ctx: &ReducerContext, id: u8, exit_colour: u8, rssi: i8) -> Result<(), String> {
    require_bridge(ctx)?;
    touch_gateway(ctx);
    let row = Station { id, exit_colour, rssi, online: true, last_seen: ctx.timestamp };
    if ctx.db.station().id().find(id).is_some() {
        ctx.db.station().id().update(row);
    } else {
        ctx.db.station().insert(row);
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn ingest_heard(ctx: &ReducerContext, id: u8, heard: Vec<HeardEntry>) -> Result<(), String> {
    require_bridge(ctx)?;
    touch_gateway(ctx);
    let keep: Vec<u16> = heard.iter().map(|h| ((id as u16) << 8) | h.id as u16).collect();
    for old in ctx.db.link().from_id().filter(id).collect::<Vec<_>>() {
        if !keep.contains(&old.key) {
            ctx.db.link().key().delete(old.key);
        }
    }
    for h in &heard {
        let row = Link { key: ((id as u16) << 8) | h.id as u16, from_id: id, to_id: h.id, rssi: h.rssi, updated: ctx.timestamp };
        if ctx.db.link().key().find(row.key).is_some() {
            ctx.db.link().key().update(row);
        } else {
            ctx.db.link().insert(row);
        }
    }
    let threshold = ctx.db.settings().id().find(0).map(|s| s.neigh_rssi).unwrap_or(-62);
    for h in heard.iter().filter(|h| h.id != 0 && h.id <= BAND_ID_MAX && h.id > id && h.rssi >= threshold) {
        record_encounter(ctx, id.into(), h.id.into(), h.rssi);
    }
    Ok(())
}

fn record_encounter(ctx: &ReducerContext, a: u32, b: u32, rssi: i8) {
    let key = pair_key(a, b);
    let now = ctx.timestamp;
    match ctx.db.encounter().key().find(key) {
        None => {
            ctx.db.encounter().insert(Encounter {
                key,
                band_a: a.min(b),
                band_b: a.max(b),
                first_seen: now,
                last_seen: now,
                seconds_close: 0,
                best_rssi: rssi,
            });
        }
        Some(e) => {
            let gap = micros(now) - micros(e.last_seen);
            let add = if gap > 0 && gap < ENCOUNTER_GAP_MICROS { gap.min(ENCOUNTER_STEP_CAP_MICROS) } else { 0 };
            let seconds_close = e.seconds_close + ((add + 500_000) / 1_000_000) as u32;
            ctx.db.encounter().key().update(Encounter {
                last_seen: now,
                seconds_close,
                best_rssi: e.best_rssi.max(rssi),
                ..e
            });
        }
    }
}

/// A band starts a stay in a station's zone, at a booth when its spot is known.
pub(crate) fn open_stay(ctx: &ReducerContext, band_id: u32, zone: u8, booth_id: u64) {
    ctx.db.zone_visit().insert(ZoneVisit { id: 0, band_id, zone, entered: ctx.timestamp, left: None, booth_id, open: true });
}

pub(crate) fn close_stay(ctx: &ReducerContext, v: ZoneVisit) {
    ctx.db.zone_visit().id().update(ZoneVisit { left: Some(ctx.timestamp), open: false, ..v });
}

fn change_zone(ctx: &ReducerContext, band_id: u32, zone: u8) {
    let now = micros(ctx.timestamp);
    let visits: Vec<ZoneVisit> = ctx.db.zone_visit().band_id().filter(band_id).collect();
    if let Some(open) = visits.iter().find(|v| v.open) {
        if now - micros(open.entered) < ZONE_BLIP_MICROS {
            ctx.db.zone_visit().id().delete(open.id);
        } else {
            close_stay(ctx, open.clone());
        }
    }
    if zone == 0 {
        return;
    }
    let recent = visits
        .iter()
        .filter(|v| v.zone == zone && v.left.is_some_and(|l| now - micros(l) < ZONE_BLIP_MICROS))
        .max_by_key(|v| v.id);
    match recent {
        Some(v) => {
            ctx.db.zone_visit().id().update(ZoneVisit { left: None, open: true, ..v.clone() });
        }
        None => open_stay(ctx, band_id, zone, 0),
    }
}

pub(crate) fn leave_zone(ctx: &ReducerContext, band_id: u32) {
    for v in ctx.db.zone_visit().band_id().filter(band_id).filter(|v| v.open).collect::<Vec<_>>() {
        close_stay(ctx, v);
    }
}
