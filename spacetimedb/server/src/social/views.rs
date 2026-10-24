//! What each caller may read. Social tables are private; the attendee app reads its own rows through
//! the `my_*` views and the Rust services read through role-checked views, so access is decided here,
//! inside the database, never in an app.

use super::tables::*;
use crate::roles::*;
use crate::tables::*;
use crate::venue::*;
use spacetimedb::{AnonymousViewContext, Identity, SpacetimeType, Timestamp, ViewContext};

/// Services that copy or serve social rows.
const SERVICES: &[&str] = &["indexer", "worker", "api"];

fn allowed(ctx: &ViewContext, roles: &[&str]) -> bool {
    let me = ctx.sender();
    ctx.db.owner().identity().find(me).is_some()
        || ctx.db.staff_role().identity().filter(me).any(|r| roles.contains(&r.role.as_str()))
}

fn zone_name(ctx: &ViewContext, zone_id: u64) -> String {
    ctx.db.zone().id().find(zone_id).map(|z| z.name).unwrap_or_default()
}

fn booth_names(ctx: &ViewContext, zone_id: u64) -> Vec<String> {
    ctx.db.booth().zone_id().filter(zone_id).map(|b| b.name).collect()
}

/// A findable attendee as someone else sees them: name, profile and socials.
fn person_card(ctx: &ViewContext, who: Identity) -> Option<PersonCard> {
    let a = ctx.db.attendee().identity().find(who).filter(|a| a.findable)?;
    let organization = ctx.db.organization().id().find(a.organization_id).map(|o| o.name).unwrap_or_default();
    let title = ctx.db.person().id().find(a.person_id).map(|p| p.title).unwrap_or_default();
    let handles = ctx
        .db
        .social_handle()
        .owner()
        .filter(who)
        .map(|h| HandleOut { platform: h.platform, handle: h.handle })
        .collect();
    Some(PersonCard {
        name: a.display_name,
        photo_url: a.photo_url,
        person_id: a.person_id,
        title,
        organization,
        node_id: a.node_id,
        handles,
    })
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct HandleOut {
    pub platform: String,
    pub handle: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct PersonCard {
    pub name: String,
    pub photo_url: String,
    pub person_id: u64,
    pub title: String,
    pub organization: String,
    pub node_id: u64,
    pub handles: Vec<HandleOut>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct MyBand {
    pub band_id: u8,
    /// claimed, or waiting_for_press during the few seconds after the tap.
    pub status: String,
    pub expires_at: Option<Timestamp>,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct MyVisit {
    pub zone_visit_id: u64,
    pub zone_id: u64,
    pub zone_name: String,
    pub booths: Vec<String>,
    pub started_at: Timestamp,
    pub ended_at: Option<Timestamp>,
    pub minutes: f32,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct MyEncounter {
    pub id: u64,
    pub zone_id: u64,
    pub zone_name: String,
    pub started_at: Timestamp,
    pub last_seen_at: Timestamp,
    pub minutes: f32,
    pub person: PersonCard,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct MySharedVisit {
    pub id: u64,
    pub zone_id: u64,
    pub zone_name: String,
    pub booths: Vec<String>,
    pub started_at: Timestamp,
    pub overlap_minutes: f32,
    pub person: PersonCard,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct StoryPersonOut {
    pub line: String,
    pub person: PersonCard,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct MyStory {
    pub status: String,
    pub title: String,
    pub body: String,
    pub highlights: Vec<String>,
    pub people: Vec<StoryPersonOut>,
    pub source: String,
    pub updated_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct ClaimedPerson {
    pub person_id: u64,
}

#[spacetimedb::view(accessor = my_attendee, public)]
pub fn my_attendee(ctx: &ViewContext) -> Option<Attendee> {
    ctx.db.attendee().identity().find(ctx.sender())
}

#[spacetimedb::view(accessor = my_band, public)]
pub fn my_band(ctx: &ViewContext) -> Option<MyBand> {
    let me = ctx.sender();
    if let Some(o) = ctx.db.band_owner().owner().find(me) {
        return Some(MyBand { band_id: o.band_id, status: "claimed".into(), expires_at: None });
    }
    ctx.db.band_claim().claimant().filter(me).next().map(|c| MyBand {
        band_id: c.band_id,
        status: "waiting_for_press".into(),
        expires_at: Some(c.expires_at),
    })
}

#[spacetimedb::view(accessor = my_handles, public)]
pub fn my_handles(ctx: &ViewContext) -> Vec<SocialHandle> {
    ctx.db.social_handle().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = my_visits, public)]
pub fn my_visits(ctx: &ViewContext) -> Vec<MyVisit> {
    ctx.db
        .visit()
        .attendee()
        .filter(ctx.sender())
        .map(|v| MyVisit {
            zone_visit_id: v.zone_visit_id,
            zone_id: v.zone_id,
            zone_name: zone_name(ctx, v.zone_id),
            booths: booth_names(ctx, v.zone_id),
            started_at: v.started_at,
            ended_at: v.ended_at,
            minutes: v.minutes,
        })
        .collect()
}

/// The people you hung out with, with their socials.
#[spacetimedb::view(accessor = my_encounters, public)]
pub fn my_encounters(ctx: &ViewContext) -> Vec<MyEncounter> {
    let me = ctx.sender();
    let rows = ctx.db.social_encounter().attendee_a().filter(me).chain(ctx.db.social_encounter().attendee_b().filter(me));
    rows.filter(|e| e.met)
        .filter_map(|e| {
            let other = if e.attendee_a == me { e.attendee_b } else { e.attendee_a };
            Some(MyEncounter {
                id: e.id,
                zone_id: e.zone_id,
                zone_name: zone_name(ctx, e.zone_id),
                started_at: e.started_at,
                last_seen_at: e.last_seen_at,
                minutes: e.seconds_together as f32 / 60.0,
                person: person_card(ctx, other)?,
            })
        })
        .collect()
}

#[spacetimedb::view(accessor = my_shared_visits, public)]
pub fn my_shared_visits(ctx: &ViewContext) -> Vec<MySharedVisit> {
    let me = ctx.sender();
    let rows = ctx.db.shared_visit().attendee_a().filter(me).chain(ctx.db.shared_visit().attendee_b().filter(me));
    rows.filter_map(|s| {
        let other = if s.attendee_a == me { s.attendee_b } else { s.attendee_a };
        Some(MySharedVisit {
            id: s.id,
            zone_id: s.zone_id,
            zone_name: zone_name(ctx, s.zone_id),
            booths: booth_names(ctx, s.zone_id),
            started_at: s.started_at,
            overlap_minutes: s.overlap_minutes,
            person: person_card(ctx, other)?,
        })
    })
    .collect()
}

#[spacetimedb::view(accessor = my_story, public)]
pub fn my_story(ctx: &ViewContext) -> Option<MyStory> {
    let s = ctx.db.summary_story().attendee().find(ctx.sender())?;
    let people = s
        .people
        .iter()
        .filter_map(|p| Some(StoryPersonOut { line: p.line.clone(), person: person_card(ctx, p.attendee)? }))
        .collect();
    Some(MyStory {
        status: s.status,
        title: s.title,
        body: s.body,
        highlights: s.highlights,
        people,
        source: s.source,
        updated_at: s.updated_at,
    })
}

/// Profiles already taken, so the "is this you?" list can leave them out.
#[spacetimedb::view(accessor = claimed_people, public)]
pub fn claimed_people(ctx: &AnonymousViewContext) -> Vec<ClaimedPerson> {
    ctx.db.person_claim().person_id().filter(0u64..).map(|c| ClaimedPerson { person_id: c.person_id }).collect()
}

#[spacetimedb::view(accessor = api_sessions, public)]
pub fn api_sessions(ctx: &ViewContext) -> Vec<ApiSession> {
    if !allowed(ctx, &["api"]) {
        return Vec::new();
    }
    ctx.db.api_session().identity().filter(Identity::ZERO..).collect()
}

#[spacetimedb::view(accessor = summary_links, public)]
pub fn summary_links(ctx: &ViewContext) -> Vec<SummaryLink> {
    if !allowed(ctx, &["api"]) {
        return Vec::new();
    }
    ctx.db.summary_link().attendee().filter(Identity::ZERO..).collect()
}

#[spacetimedb::view(accessor = social_attendees, public)]
pub fn social_attendees(ctx: &ViewContext) -> Vec<Attendee> {
    if !allowed(ctx, SERVICES) {
        return Vec::new();
    }
    ctx.db.attendee().person_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = social_handles, public)]
pub fn social_handles(ctx: &ViewContext) -> Vec<SocialHandle> {
    if !allowed(ctx, &["api"]) {
        return Vec::new();
    }
    ctx.db.social_handle().owner().filter(Identity::ZERO..).collect()
}

#[spacetimedb::view(accessor = social_visits, public)]
pub fn social_visits(ctx: &ViewContext) -> Vec<Visit> {
    if !allowed(ctx, SERVICES) {
        return Vec::new();
    }
    ctx.db.visit().zone_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = social_encounters, public)]
pub fn social_encounters(ctx: &ViewContext) -> Vec<SocialEncounter> {
    if !allowed(ctx, SERVICES) {
        return Vec::new();
    }
    ctx.db.social_encounter().attendee_a().filter(Identity::ZERO..).filter(|e| e.met).collect()
}

#[spacetimedb::view(accessor = social_shared_visits, public)]
pub fn social_shared_visits(ctx: &ViewContext) -> Vec<SharedVisit> {
    if !allowed(ctx, SERVICES) {
        return Vec::new();
    }
    ctx.db.shared_visit().zone_id().filter(0u64..).collect()
}

#[spacetimedb::view(accessor = social_stories, public)]
pub fn social_stories(ctx: &ViewContext) -> Vec<SummaryStory> {
    if !allowed(ctx, &["worker", "api"]) {
        return Vec::new();
    }
    ctx.db.summary_story().job_id().filter(0u64..).collect()
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct GraphLink {
    pub id: u64,
    pub kind: String,
    pub from_kind: String,
    pub from_id: u64,
    pub from_label: String,
    pub to_kind: String,
    pub to_id: u64,
    pub to_label: String,
    pub weight: f32,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct EventLink {
    pub id: u64,
    pub kind: String,
    pub from_kind: String,
    pub from_id: u64,
    pub to_kind: String,
    pub to_id: u64,
    pub weight: f32,
}

fn links_at(ctx: &ViewContext, kind: &str, id: u64) -> Vec<PeopleLink> {
    ctx.db
        .people_link()
        .from_id()
        .filter(id)
        .filter(|l| l.from_kind == kind)
        .chain(ctx.db.people_link().to_id().filter(id).filter(|l| l.to_kind == kind))
        .collect()
}

/// Your own neighbourhood of the graph: you, the people you hung out with, the booths you visited,
/// your company, and the other findable people at those booths and that company, who show as "someone".
#[spacetimedb::view(accessor = my_graph, public)]
pub fn my_graph(ctx: &ViewContext) -> Vec<GraphLink> {
    let Some(me) = ctx.db.attendee().identity().find(ctx.sender()).filter(|a| a.findable) else {
        return Vec::new();
    };
    let mine = links_at(ctx, "person", me.node_id);
    let mut named: Vec<u64> = vec![me.node_id];
    let mut links: Vec<PeopleLink> = Vec::new();
    for l in &mine {
        match l.kind.as_str() {
            "met" => named.push(if l.from_id == me.node_id { l.to_id } else { l.from_id }),
            "visited" => links.extend(links_at(ctx, "booth", l.to_id)),
            "works_at" => links.extend(links_at(ctx, "company", l.to_id)),
            _ => {}
        }
    }
    links.extend(mine);
    links.sort_by_key(|l| l.id);
    links.dedup_by_key(|l| l.id);
    let label = |kind: &str, id: u64| -> String {
        match kind {
            "person" if named.contains(&id) => {
                ctx.db.attendee().node_id().find(id).map(|a| a.display_name).unwrap_or_default()
            }
            "person" => "someone".into(),
            "booth" => ctx.db.booth().id().find(id).map(|b| b.name).unwrap_or_default(),
            _ => ctx.db.organization().id().find(id).map(|o| o.name).unwrap_or_default(),
        }
    };
    links
        .into_iter()
        .map(|l| GraphLink {
            from_label: label(&l.from_kind, l.from_id),
            to_label: label(&l.to_kind, l.to_id),
            id: l.id,
            kind: l.kind,
            from_kind: l.from_kind,
            from_id: l.from_id,
            to_kind: l.to_kind,
            to_id: l.to_id,
            weight: l.weight,
        })
        .collect()
}

/// The whole event for the big screen: node ids and link weights only, no names, zones or times.
#[spacetimedb::view(accessor = event_graph, public)]
pub fn event_graph(ctx: &AnonymousViewContext) -> Vec<EventLink> {
    ctx.db
        .people_link()
        .from_id()
        .filter(0u64..)
        .map(|l| EventLink {
            id: l.id,
            kind: l.kind,
            from_kind: l.from_kind,
            from_id: l.from_id,
            to_kind: l.to_kind,
            to_id: l.to_id,
            weight: l.weight,
        })
        .collect()
}
