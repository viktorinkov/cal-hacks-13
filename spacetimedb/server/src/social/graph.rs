//! The people graph: links between people, booths and companies, written in the same transaction as the
//! visit, encounter or profile claim behind them, so a subscribed screen sees each link appear the moment it exists.

use super::logic::*;
use super::tables::*;
use crate::venue::{booth, booths_in_zone};
use spacetimedb::{Identity, ReducerContext, Table};

pub const PERSON: &str = "person";
pub const BOOTH: &str = "booth";
pub const COMPANY: &str = "company";

/// Graph node of a findable attendee.
pub fn person_node(ctx: &ReducerContext, who: Identity) -> Option<u64> {
    ctx.db.attendee().identity().find(who).filter(|a| a.findable).map(|a| a.node_id)
}

fn link(ctx: &ReducerContext, kind: &str, from: (&str, u64), to: (&str, u64), weight: f32, evidence: &str) {
    let key = format!("{kind}:{}:{}", from.1, to.1);
    let row = PeopleLink {
        id: 0,
        key: key.clone(),
        kind: kind.to_string(),
        from_kind: from.0.to_string(),
        from_id: from.1,
        to_kind: to.0.to_string(),
        to_id: to.1,
        weight,
        evidence: evidence.to_string(),
        updated_at: ctx.timestamp,
    };
    match ctx.db.people_link().key().find(&key) {
        Some(old) if old.weight == weight => {}
        Some(old) => {
            ctx.db.people_link().id().update(PeopleLink { id: old.id, ..row });
        }
        None => {
            ctx.db.people_link().insert(row);
        }
    }
}

/// Two people who hung out, weighted by minutes together.
pub fn link_met(ctx: &ReducerContext, a: Identity, b: Identity, minutes: f32) {
    let (Some(na), Some(nb)) = (person_node(ctx, a), person_node(ctx, b)) else {
        return;
    };
    let (na, nb) = ordered(na, nb);
    link(ctx, LINK_MET, (PERSON, na), (PERSON, nb), minutes.floor(), "radio");
}

/// A person to every booth of a zone they stayed in, weighted by their minutes in that zone,
/// plus each of those booths to the company exhibiting there.
pub fn link_visited(ctx: &ReducerContext, who: Identity, zone_id: u64) {
    let Some(node) = person_node(ctx, who) else {
        return;
    };
    let minutes: f32 = ctx.db.visit().attendee().filter(who).filter(|v| v.zone_id == zone_id).map(|v| v.minutes).sum();
    for b in booths_in_zone(ctx, zone_id) {
        link(ctx, LINK_VISITED, (PERSON, node), (BOOTH, b.id), minutes.floor(), "zone");
        if b.organization_id != 0 {
            link(ctx, LINK_EXHIBITS, (BOOTH, b.id), (COMPANY, b.organization_id), 1.0, "import");
        }
    }
}

/// A person to the company of the profile they claimed.
pub fn link_works_at(ctx: &ReducerContext, a: &Attendee) {
    if a.findable && a.organization_id != 0 {
        link(ctx, LINK_WORKS_AT, (PERSON, a.node_id), (COMPANY, a.organization_id), 1.0, "profile");
    }
}

/// Rebuild every link of one attendee after their consent or profile changed.
pub fn relink(ctx: &ReducerContext, a: &Attendee) {
    let mine: Vec<u64> = ctx
        .db
        .people_link()
        .from_id()
        .filter(a.node_id)
        .filter(|l| l.from_kind == PERSON)
        .chain(ctx.db.people_link().to_id().filter(a.node_id).filter(|l| l.to_kind == PERSON))
        .map(|l| l.id)
        .collect();
    for id in mine {
        ctx.db.people_link().id().delete(id);
    }
    if !a.findable {
        return;
    }
    link_works_at(ctx, a);
    let mut zones: Vec<u64> = ctx.db.visit().attendee().filter(a.identity).map(|v| v.zone_id).collect();
    zones.sort_unstable();
    zones.dedup();
    for zone_id in zones {
        link_visited(ctx, a.identity, zone_id);
    }
    let met: Vec<SocialEncounter> = ctx
        .db
        .social_encounter()
        .attendee_a()
        .filter(a.identity)
        .chain(ctx.db.social_encounter().attendee_b().filter(a.identity))
        .filter(|e| e.met)
        .collect();
    for e in met {
        link_met(ctx, e.attendee_a, e.attendee_b, e.seconds_together as f32 / 60.0);
    }
}

/// Booth names, for views and prompts.
pub fn booth_name(ctx: &ReducerContext, booth_id: u64) -> String {
    ctx.db.booth().id().find(booth_id).map(|b| b.name).unwrap_or_default()
}
