//! Staff by email inside an in-memory module: the owner adds a medic by email, and whoever signs in
//! with that email gets the role, before or after the owner adds them.

use super::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::ConnectionId;

const ISS: &str = "https://auth.spacetimedb.com/oidc";

fn id(iss: &str, sub: &str) -> Identity {
    Identity::from_claims(iss, sub)
}

fn auth(iss: &str, sub: &str, email: &str) -> TestAuth {
    let payload = format!(r#"{{"iss":"{iss}","sub":"{sub}","email":"{email}"}}"#);
    TestAuth::from_jwt_payload(payload, ConnectionId::from_u128(sub.len() as u128 + 1)).unwrap()
}

fn world() -> TestContext {
    let t = TestContext::new().unwrap();
    t.db.owner().insert(Owner { identity: id(ISS, "owner") });
    t
}

fn connect(t: &TestContext, sub: &str, email: &str) {
    t.with_reducer_tx(auth(ISS, sub, email), |ctx| {
        remember_email(ctx);
        Ok::<_, String>(())
    })
    .unwrap();
}

fn add(t: &TestContext, email: &str, role: &str, name: &str) -> Result<(), String> {
    t.with_reducer_tx(auth(ISS, "owner", "owner@band1t.vip"), |ctx| add_staff(ctx, email.into(), role.into(), name.into()))
}

fn roles_of(t: &TestContext, who: Identity) -> Vec<String> {
    t.db.staff_role().iter().filter(|r| r.identity == who).map(|r| r.role).collect()
}

#[test]
fn a_medic_added_by_email_gets_the_role_when_they_sign_in() {
    let t = world();
    add(&t, " Ari@Example.com ", "medic", "Ari Ramos").unwrap();
    assert!(roles_of(&t, id(ISS, "ari")).is_empty());
    connect(&t, "ari", "ari@example.com");
    assert_eq!(roles_of(&t, id(ISS, "ari")), vec!["medic"]);
    let member = t.db.staff_member().iter().next().unwrap();
    assert_eq!((member.email.as_str(), member.account), ("ari@example.com", Some(id(ISS, "ari"))));
    let role = t.db.staff_role().iter().find(|r| r.role == "medic").unwrap();
    assert_eq!(role.label, "Ari Ramos");
}

#[test]
fn someone_who_signed_in_before_gets_the_role_at_once() {
    let t = world();
    connect(&t, "pat", "pat@example.com");
    add(&t, "pat@example.com", "photographer", "Pat").unwrap();
    add(&t, "pat@example.com", "photographer", "Pat Lee").unwrap();
    assert_eq!(roles_of(&t, id(ISS, "pat")), vec!["photographer"]);
    assert_eq!(t.db.staff_member().iter().map(|m| m.name).collect::<Vec<_>>(), vec!["Pat Lee"]);
}

#[test]
fn only_the_owner_adds_staff_and_only_staff_roles() {
    let t = world();
    let not_owner = t.with_reducer_tx(auth(ISS, "eve", "eve@example.com"), |ctx| add_staff(ctx, "eve@example.com".into(), "ops".into(), "Eve".into()));
    assert!(not_owner.is_err());
    assert!(add(&t, "eve@example.com", "worker", "Eve").is_err());
    assert!(add(&t, "not an email", "medic", "Eve").is_err());
    assert_eq!(t.db.staff_member().count(), 0);
}

#[test]
fn another_issuers_token_with_the_same_email_gets_nothing() {
    let t = world();
    add(&t, "ari@example.com", "medic", "Ari Ramos").unwrap();
    t.with_reducer_tx(auth("https://issuer.example", "ari", "ari@example.com"), |ctx| {
        remember_email(ctx);
        Ok::<_, String>(())
    })
    .unwrap();
    assert!(roles_of(&t, id("https://issuer.example", "ari")).is_empty());
}

#[test]
fn removing_a_staff_member_takes_the_role_away() {
    let t = world();
    add(&t, "ari@example.com", "medic", "Ari Ramos").unwrap();
    connect(&t, "ari", "ari@example.com");
    let member = t.db.staff_member().iter().next().unwrap();
    t.with_reducer_tx(auth(ISS, "owner", "owner@band1t.vip"), |ctx| remove_staff(ctx, member.id)).unwrap();
    assert!(roles_of(&t, id(ISS, "ari")).is_empty());
    assert_eq!(t.db.staff_member().count(), 0);
}
