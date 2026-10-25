use crate::tables::*;
use spacetimedb::{Identity, RawQuery, ReducerContext, Table, Timestamp, ViewContext};

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

/// The owner makes another identity an owner too, for example their own browser sign-in on the
/// host portal.
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

// --- Staff by email ---------------------------------------------------------------------------

/// The roles the owner hands out by email on the portal's Staff tab.
pub const EMAIL_ROLES: &[&str] = &["ops", "medic", "photographer"];

/// The issuer of the pages' email sign-in; other issuers' email claims are not trusted.
const SIGN_IN_ISSUER: &str = "https://auth.spacetimedb.com";

/// Someone the owner added as staff by email. Whoever signs in with that email gets the role: at
/// once when they signed in before, else the next time they connect.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = staff_member)]
pub struct StaffMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub email: String,
    pub role: String,
    pub name: String,
    /// The account that signed in with this email, once someone has.
    pub account: Option<Identity>,
    pub added_by: Identity,
    pub added_at: Timestamp,
}

/// The email each signed-in account last connected with, from its sign-in token.
#[spacetimedb::table(accessor = account_email)]
pub struct AccountEmail {
    #[primary_key]
    pub identity: Identity,
    #[index(btree)]
    pub email: String,
    pub seen_at: Timestamp,
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

/// The email in the caller's sign-in token, lowercased; None for tokens without one.
pub fn sender_email(ctx: &ReducerContext) -> Option<String> {
    let jwt = ctx.sender_auth().jwt()?;
    if !jwt.issuer().starts_with(SIGN_IN_ISSUER) {
        return None;
    }
    let claims: serde_json::Value = serde_json::from_str(jwt.raw_payload()).ok()?;
    claims.get("email")?.as_str().map(normalize_email).filter(|e| e.contains('@'))
}

/// Gives `identity` the staff member's role and records that this account signed in for it.
fn grant_staff(ctx: &ReducerContext, identity: Identity, member: StaffMember) {
    if !ctx.db.staff_role().identity().filter(identity).any(|r| r.role == member.role) {
        ctx.db.staff_role().insert(StaffRole {
            id: 0,
            identity,
            role: member.role.clone(),
            label: member.name.clone(),
            granted_by: member.added_by,
            granted_at: ctx.timestamp,
        });
    }
    if member.account != Some(identity) {
        ctx.db.staff_member().id().update(StaffMember { account: Some(identity), ..member });
    }
}

/// On connect: remembers the caller's email and gives them every staff role added for it.
pub fn remember_email(ctx: &ReducerContext) {
    let Some(email) = sender_email(ctx) else { return };
    let row = AccountEmail { identity: ctx.sender(), email: email.clone(), seen_at: ctx.timestamp };
    if ctx.db.account_email().identity().find(ctx.sender()).is_some() {
        ctx.db.account_email().identity().update(row);
    } else {
        ctx.db.account_email().insert(row);
    }
    for member in ctx.db.staff_member().email().filter(&email).collect::<Vec<_>>() {
        grant_staff(ctx, ctx.sender(), member);
    }
}

/// The owner adds a medic, organizer (ops) or photographer by email.
#[spacetimedb::reducer]
pub fn add_staff(ctx: &ReducerContext, email: String, role: String, name: String) -> Result<(), String> {
    if !is_owner(ctx) {
        return Err("only the module owner can add staff".into());
    }
    let email = normalize_email(&email);
    if !email.contains('@') {
        return Err(format!("{email:?} is not an email address"));
    }
    if !EMAIL_ROLES.contains(&role.as_str()) {
        return Err(format!("role is one of {}", EMAIL_ROLES.join(", ")));
    }
    let name = if name.trim().is_empty() { email.clone() } else { name.trim().to_string() };
    let member = match ctx.db.staff_member().email().filter(&email).find(|m| m.role == role) {
        Some(m) => ctx.db.staff_member().id().update(StaffMember { name, ..m }),
        None => ctx.db.staff_member().insert(StaffMember {
            id: 0,
            email: email.clone(),
            role,
            name,
            account: None,
            added_by: ctx.sender(),
            added_at: ctx.timestamp,
        }),
    };
    for account in ctx.db.account_email().email().filter(&email).collect::<Vec<_>>() {
        let member = ctx.db.staff_member().id().find(member.id).unwrap();
        grant_staff(ctx, account.identity, member);
    }
    Ok(())
}

/// The owner removes a staff member; their account loses the role.
#[spacetimedb::reducer]
pub fn remove_staff(ctx: &ReducerContext, id: u64) -> Result<(), String> {
    if !is_owner(ctx) {
        return Err("only the module owner can remove staff".into());
    }
    let member = ctx.db.staff_member().id().find(id).ok_or("no such staff member")?;
    for account in ctx.db.account_email().email().filter(&member.email).collect::<Vec<_>>() {
        for r in ctx.db.staff_role().identity().filter(account.identity).filter(|r| r.role == member.role).collect::<Vec<_>>() {
            ctx.db.staff_role().id().delete(r.id);
        }
    }
    ctx.db.staff_member().id().delete(id);
    Ok(())
}

/// Everyone added by email, for the owner's Staff tab; empty for everyone else.
#[spacetimedb::view(accessor = board_staff, public)]
pub fn board_staff(ctx: &ViewContext) -> RawQuery<StaffMember> {
    let owner = ctx.db.owner().identity().find(ctx.sender()).is_some();
    RawQuery::new(format!("SELECT * FROM staff_member{}", if owner { "" } else { " WHERE id = 0" }))
}

#[cfg(test)]
mod tests;
