use crate::tables::*;
use crate::roles::require_role;
use crate::{log_event, require_bridge};

/// Who may send commands to the bands from a screen or a tool.
const COMMAND_ROLES: &[&str] = &["ops"];
use spacetimedb::{ReducerContext, Table};

const NAMES: &[&str] = &[
    "state", "exit", "clear", "buzz", "pay", "paid", "thresh", "rssi", "override", "find", "sleep", "haptic", "lowvis",
];

pub(crate) fn enqueue(ctx: &ReducerContext, target: u8, name: &str, arg: u8, arg2: u8) -> u64 {
    ctx.db
        .command()
        .insert(Command {
            id: 0,
            pending: true,
            target,
            name: name.to_string(),
            arg,
            arg2,
            requested_by: ctx.sender(),
            created: ctx.timestamp,
            sent_at: None,
            error: None,
        })
        .id
}

#[spacetimedb::reducer]
pub fn send_command(ctx: &ReducerContext, target: u8, name: String, arg: u8, arg2: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    if !NAMES.contains(&name.as_str()) {
        return Err(format!("unknown command {name}"));
    }
    enqueue(ctx, target, &name, arg, arg2);
    Ok(())
}

#[spacetimedb::reducer]
pub fn force_state(ctx: &ReducerContext, target: u8, state: u8, tenths: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    if state > S_FOUND_ME {
        return Err(format!("state {state} out of range"));
    }
    enqueue(ctx, target, "state", state, tenths);
    Ok(())
}

#[spacetimedb::reducer]
pub fn clear(ctx: &ReducerContext, target: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    enqueue(ctx, target, "clear", 0, 0);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_exit(ctx: &ReducerContext, target: u8, colour: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    if !(1..=6).contains(&colour) {
        return Err("exit colour is 1..6".into());
    }
    enqueue(ctx, target, "exit", colour, 0);
    Ok(())
}

#[spacetimedb::reducer]
pub fn haptic(ctx: &ReducerContext, target: u8, pattern: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    if pattern > 6 {
        return Err("haptic pattern is 0..6".into());
    }
    enqueue(ctx, target, "haptic", pattern, 0);
    Ok(())
}

#[spacetimedb::reducer]
pub fn start_find(ctx: &ReducerContext, seeker: u8, friend: u8, colour: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    if seeker == 0 || friend == 0 || seeker == friend || seeker > BAND_ID_MAX || friend > BAND_ID_MAX {
        return Err("seeker and friend must be two different band ids".into());
    }
    enqueue(ctx, seeker, "find", friend, colour.min(5));
    Ok(())
}

#[spacetimedb::reducer]
pub fn stop_find(ctx: &ReducerContext, seeker: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    enqueue(ctx, seeker, "find", 0, 0);
    Ok(())
}

#[spacetimedb::reducer]
pub fn sleep_bands(ctx: &ReducerContext, target: u8, minutes: u8) -> Result<(), String> {
    require_role(ctx, COMMAND_ROLES)?;
    enqueue(ctx, target, "sleep", minutes, 0);
    Ok(())
}

#[spacetimedb::reducer]
pub fn command_sent(ctx: &ReducerContext, id: u64, error: Option<String>) -> Result<(), String> {
    require_bridge(ctx)?;
    let Some(c) = ctx.db.command().id().find(id) else {
        return Err(format!("no command {id}"));
    };
    if let Some(e) = &error {
        log_event(ctx, c.target, EventKind::CommandFailed, format!("{} {} {} {}: {e}", c.target, c.name, c.arg, c.arg2));
    }
    ctx.db.command().id().update(Command { pending: false, sent_at: Some(ctx.timestamp), error, ..c });
    Ok(())
}
