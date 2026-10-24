use crate::tables::*;
use spacetimedb::{Identity, ReducerContext, Table, Timestamp, ViewContext};

#[spacetimedb::table(accessor = staff_role)]
pub struct StaffRole {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub identity: Identity,
    pub role: String,
    pub label: String,
    pub granted_by: Identity,
    pub granted_at: Timestamp,
}

pub fn is_owner(ctx: &ReducerContext) -> bool {
    ctx.db.owner().identity().find(ctx.sender()).is_some()
}

pub fn has_role(ctx: &ReducerContext, roles: &[&str]) -> bool {
    is_owner(ctx) || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| roles.contains(&r.role.as_str()))
}

pub fn require_role(ctx: &ReducerContext, roles: &[&str]) -> Result<(), String> {
    if has_role(ctx, roles) {
        Ok(())
    } else {
        Err(format!("needs one of these roles: {}", roles.join(", ")))
    }
}

#[spacetimedb::reducer]
pub fn grant_role(ctx: &ReducerContext, identity: Identity, role: String, label: String) -> Result<(), String> {
    if !is_owner(ctx) {
        return Err("only the module owner can grant roles".into());
    }
    if role.is_empty() || !role.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
        return Err(format!("role {role:?} must be lowercase snake_case"));
    }
    if ctx.db.staff_role().identity().filter(identity).any(|r| r.role == role) {
        return Ok(());
    }
    ctx.db.staff_role().insert(StaffRole {
        id: 0,
        identity,
        role,
        label,
        granted_by: ctx.sender(),
        granted_at: ctx.timestamp,
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn revoke_role(ctx: &ReducerContext, identity: Identity, role: String) -> Result<(), String> {
    if !is_owner(ctx) {
        return Err("only the module owner can revoke roles".into());
    }
    for r in ctx.db.staff_role().identity().filter(identity).filter(|r| r.role == role).collect::<Vec<_>>() {
        ctx.db.staff_role().id().delete(r.id);
    }
    Ok(())
}

#[spacetimedb::view(accessor = my_roles, public)]
pub fn my_roles(ctx: &ViewContext) -> Vec<StaffRole> {
    ctx.db.staff_role().identity().filter(ctx.sender()).collect()
}

/// The owner makes another identity an owner too, for example their own browser sign-in, so the
/// host portal can grant roles from the attendee list.
#[spacetimedb::reducer]
pub fn add_owner(ctx: &ReducerContext, identity: Identity) -> Result<(), String> {
    if !is_owner(ctx) {
        return Err("only the module owner can add an owner".into());
    }
    if ctx.db.owner().identity().find(identity).is_none() {
        ctx.db.owner().insert(Owner { identity });
    }
    Ok(())
}

/// The caller's own owner row, empty for everyone else, so a page knows to show the owner's controls.
#[spacetimedb::view(accessor = my_owner, public)]
pub fn my_owner(ctx: &ViewContext) -> Vec<Owner> {
    ctx.db.owner().identity().find(ctx.sender()).into_iter().collect()
}

/// Every staff role, for the owner's grant and revoke controls; empty for everyone else.
#[spacetimedb::view(accessor = owner_staff_roles, public)]
pub fn owner_staff_roles(ctx: &ViewContext) -> Vec<StaffRole> {
    if ctx.db.owner().identity().find(ctx.sender()).is_none() {
        return Vec::new();
    }
    ctx.db.staff_role().identity().filter(Identity::ZERO..).collect()
}
