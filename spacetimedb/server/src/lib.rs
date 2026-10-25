pub mod band_code;
pub mod commands;
pub mod ingest;
pub mod tuning;
pub mod sweep;
pub mod tables;

pub mod roles;
pub mod venue;
pub mod social;
pub mod insurance;
pub mod jobs;
pub mod live;
pub mod safety;
pub mod vision;
pub mod web;
pub mod wallet;
pub mod merch;
pub mod medical;

use spacetimedb::{ReducerContext, Table};
use tables::*;

#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.owner().insert(Owner { identity: ctx.sender() });
    ctx.db.settings().insert(tuning::defaults());
    ctx.db.gateway().insert(Gateway {
        id: 0,
        mac: String::new(),
        fw: String::new(),
        online: false,
        last_line: ctx.timestamp,
    });
    sweep::schedule(ctx);
}

#[spacetimedb::reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    roles::remember_email(ctx);
}

#[spacetimedb::reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    if ctx.db.bridge().identity().find(ctx.sender()).is_some() {
        if let Some(g) = ctx.db.gateway().id().find(0) {
            ctx.db.gateway().id().update(Gateway { online: false, ..g });
        }
    }
}

#[spacetimedb::reducer]
pub fn register_bridge(ctx: &ReducerContext) -> Result<(), String> {
    match ctx.db.bridge().iter().next() {
        None => {
            ctx.db.bridge().insert(Bridge { identity: ctx.sender(), since: ctx.timestamp });
            Ok(())
        }
        Some(b) if b.identity == ctx.sender() => Ok(()),
        Some(_) => Err("another bridge is registered; the module owner can call reset_bridge".into()),
    }
}

#[spacetimedb::reducer]
pub fn reset_bridge(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.owner().identity().find(ctx.sender()).is_none() {
        return Err("only the module owner can reset the bridge".into());
    }
    for b in ctx.db.bridge().iter().collect::<Vec<_>>() {
        ctx.db.bridge().identity().delete(b.identity);
    }
    Ok(())
}

pub(crate) fn require_bridge(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.bridge().identity().find(ctx.sender()).is_some() {
        Ok(())
    } else {
        Err("not the registered bridge".into())
    }
}

pub(crate) fn log_event(ctx: &ReducerContext, band_id: u8, kind: EventKind, detail: impl Into<String>) {
    ctx.db.event().insert(Event { id: 0, at: ctx.timestamp, band_id, kind, detail: detail.into() });
}
