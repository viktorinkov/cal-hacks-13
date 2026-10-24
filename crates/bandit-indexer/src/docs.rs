//! The documents the indexer writes, built from rows of the subscription cache.
//! Plain functions, rows in and JSON out, so every rule here is easy to test.

use bandit_bindings::{Attendee, Booth, Organization, ScheduleSlot, SocialEncounter, Visit, Zone};
use serde_json::{Value, json};
use spacetimedb_sdk::{Identity, Timestamp};
use std::collections::{BTreeMap, HashMap};

/// A person's interests come from the booths in the zones where they spent the most minutes.
pub const TOP_ZONES: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Index {
    Booths,
    Memories,
    People,
}

impl Index {
    pub const ALL: [Index; 3] = [Index::Booths, Index::Memories, Index::People];

    pub fn name(self) -> &'static str {
        match self {
            Index::Booths => "booths",
            Index::Memories => "memories",
            Index::People => "people",
        }
    }
}

/// Every document, keyed by index and document id.
pub type Docs = BTreeMap<(Index, String), Value>;

/// Every row the documents depend on, read from the subscription cache at flush time.
pub struct Snapshot {
    pub zones: Vec<Zone>,
    pub organizations: Vec<Organization>,
    pub booths: Vec<Booth>,
    pub slots: Vec<ScheduleSlot>,
    pub attendees: Vec<Attendee>,
    pub visits: Vec<Visit>,
    /// Met encounters only; the `social_encounters` view leaves the others out.
    pub encounters: Vec<SocialEncounter>,
}

/// Builds every document. Only findable attendees appear: their visits, the encounters where both
/// people are findable, and their people document. Anything not built here is deleted from Elastic.
pub fn build(s: &Snapshot) -> Docs {
    let venue = Venue::new(s);
    let findable: HashMap<Identity, &Attendee> = s
        .attendees
        .iter()
        .filter(|a| a.findable)
        .map(|a| (a.identity, a))
        .collect();
    let mut docs = Docs::new();
    for b in &s.booths {
        docs.insert(
            (Index::Booths, b.id.to_string()),
            venue.booth_doc(b, &s.slots),
        );
    }
    for v in s
        .visits
        .iter()
        .filter(|v| findable.contains_key(&v.attendee))
    {
        docs.insert(
            (Index::Memories, format!("visit-{}", v.zone_visit_id)),
            venue.visit_doc(v),
        );
    }
    for e in &s.encounters {
        let (Some(a), Some(b)) = (findable.get(&e.attendee_a), findable.get(&e.attendee_b)) else {
            continue;
        };
        for (me, other) in [(a, b), (b, a)] {
            let id = format!("encounter-{}-{}", e.id, hex(me.identity));
            docs.insert((Index::Memories, id), venue.encounter_doc(e, me, other));
        }
    }
    for a in findable.values() {
        docs.insert(
            (Index::People, hex(a.identity)),
            venue.person_doc(a, &s.visits),
        );
    }
    docs
}

/// Venue rows looked up by id; booths grouped by zone in id order.
struct Venue<'a> {
    zones: HashMap<u64, &'a Zone>,
    organizations: HashMap<u64, &'a Organization>,
    booths_by_zone: HashMap<u64, Vec<&'a Booth>>,
}

impl<'a> Venue<'a> {
    fn new(s: &'a Snapshot) -> Self {
        let mut booths_by_zone: HashMap<u64, Vec<&Booth>> = HashMap::new();
        for b in &s.booths {
            booths_by_zone.entry(b.zone_id).or_default().push(b);
        }
        for booths in booths_by_zone.values_mut() {
            booths.sort_by_key(|b| b.id);
        }
        Venue {
            zones: s.zones.iter().map(|z| (z.id, z)).collect(),
            organizations: s.organizations.iter().map(|o| (o.id, o)).collect(),
            booths_by_zone,
        }
    }

    fn zone_name(&self, zone_id: u64) -> &str {
        self.zones
            .get(&zone_id)
            .map(|z| z.name.as_str())
            .unwrap_or_default()
    }

    fn booths_in(&self, zone_id: u64) -> &[&'a Booth] {
        self.booths_by_zone
            .get(&zone_id)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    fn booth_names(&self, zone_id: u64) -> Vec<&str> {
        self.booths_in(zone_id)
            .iter()
            .map(|b| b.name.as_str())
            .collect()
    }

    /// The zone's own name and description, then one line per booth: `description (tag, tag)`.
    /// The zone line keeps zones without booths (a lounge, a stage) searchable.
    fn booth_text(&self, zone_id: u64) -> String {
        let mut lines = vec![self.zone_line(zone_id)];
        lines.extend(
            self.booths_in(zone_id)
                .iter()
                .map(|b| format!("{} ({})", b.description, b.tags.join(", "))),
        );
        lines.join("\n")
    }

    fn zone_line(&self, zone_id: u64) -> String {
        self.zones
            .get(&zone_id)
            .map(|z| if z.description.is_empty() { z.name.clone() } else { format!("{}: {}", z.name, z.description) })
            .unwrap_or_default()
    }

    fn booth_doc(&self, b: &Booth, slots: &[ScheduleSlot]) -> Value {
        let org = self.organizations.get(&b.organization_id);
        let mut tags = b.tags.clone();
        for t in org.map(|o| o.tags.as_slice()).unwrap_or_default() {
            if !tags.contains(t) {
                tags.push(t.clone());
            }
        }
        let mut booth_slots: Vec<&ScheduleSlot> =
            slots.iter().filter(|s| s.booth_id == b.id).collect();
        booth_slots.sort_by_key(|s| s.id);
        let titles: Vec<&str> = booth_slots.iter().map(|s| s.title.as_str()).collect();
        let parts = [
            b.description.clone(),
            org.map(|o| o.description.clone()).unwrap_or_default(),
            tags.join(", "),
            titles.join(". "),
        ];
        let description: Vec<String> = parts.into_iter().filter(|p| !p.is_empty()).collect();
        json!({
            "booth_id": b.id,
            "name": b.name,
            "booth_number": b.booth_number,
            "kind": b.kind,
            "tags": tags,
            "zone_id": b.zone_id,
            "zone_name": self.zone_name(b.zone_id),
            "organization_id": b.organization_id,
            "org_name": org.map(|o| o.name.as_str()).unwrap_or_default(),
            "org_kind": org.map(|o| o.kind.as_str()).unwrap_or_default(),
            "sponsor_tier": org.map(|o| o.sponsor_tier.as_str()).unwrap_or_default(),
            "description": description.join("\n"),
        })
    }

    fn visit_doc(&self, v: &Visit) -> Value {
        json!({
            "kind": "visit",
            "row_id": v.zone_visit_id,
            "attendee_id": hex(v.attendee),
            "zone_id": v.zone_id,
            "zone_name": self.zone_name(v.zone_id),
            "booth_names": self.booth_names(v.zone_id),
            "booth_text": self.booth_text(v.zone_id),
            "started_at": time(v.started_at),
            "ended_at": v.ended_at.map(time),
            "minutes": round(v.minutes as f64),
        })
    }

    /// The encounter as `me` remembers it: who the other person was, where and for how long.
    fn encounter_doc(&self, e: &SocialEncounter, me: &Attendee, other: &Attendee) -> Value {
        json!({
            "kind": "encounter",
            "row_id": e.id,
            "attendee_id": hex(me.identity),
            "other_attendee_id": hex(other.identity),
            "other_name": other.display_name,
            "zone_id": e.zone_id,
            "zone_name": self.zone_name(e.zone_id),
            "booth_names": self.booth_names(e.zone_id),
            "booth_text": self.booth_text(e.zone_id),
            "started_at": time(e.started_at),
            "ended_at": time(e.last_seen_at),
            "minutes": round(e.seconds_together as f64 / 60.0),
        })
    }

    /// No names and no socials: an attendee id, a graph node id, a company and what they spent time on.
    fn person_doc(&self, a: &Attendee, visits: &[Visit]) -> Value {
        let lines: Vec<String> = top_zones(a.identity, visits)
            .into_iter()
            .flat_map(|zone_id| {
                std::iter::once(self.zone_line(zone_id)).chain(
                    self.booths_in(zone_id)
                        .iter()
                        .map(|b| format!("{}: {} ({})", b.name, b.description, b.tags.join(", "))),
                )
            })
            .collect();
        json!({
            "attendee_id": hex(a.identity),
            "node_id": a.node_id,
            "organization": self.organizations.get(&a.organization_id).map(|o| o.name.as_str()).unwrap_or_default(),
            "interests": lines.join("\n"),
        })
    }
}

/// The zones where `who` spent the most minutes, most first; ties go to the lower zone id.
pub fn top_zones(who: Identity, visits: &[Visit]) -> Vec<u64> {
    let mut minutes: HashMap<u64, f64> = HashMap::new();
    for v in visits.iter().filter(|v| v.attendee == who) {
        *minutes.entry(v.zone_id).or_default() += v.minutes as f64;
    }
    let mut zones: Vec<(u64, f64)> = minutes.into_iter().collect();
    zones.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    zones
        .into_iter()
        .take(TOP_ZONES)
        .map(|(zone_id, _)| zone_id)
        .collect()
}

pub fn hex(id: Identity) -> String {
    id.to_hex().to_string()
}

/// RFC 3339, which Elastic maps as a date.
fn time(t: Timestamp) -> String {
    t.to_string()
}

/// Minutes to one decimal, so a growing visit is rewritten only when the number visibly changes.
fn round(minutes: f64) -> f64 {
    (minutes * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: i64) -> Timestamp {
        Timestamp::from_micros_since_unix_epoch(s * 1_000_000)
    }

    fn who(n: u8) -> Identity {
        Identity::from_byte_array([n; 32])
    }

    fn zone(id: u64, name: &str) -> Zone {
        Zone {
            id,
            source_key: format!("zone-{id}"),
            venue_id: 1,
            name: name.into(),
            kind: "floor".into(),
            station_id: 100 + id as u8,
            plan_x_m: 0.0,
            plan_y_m: 0.0,
            area_sq_m: 100.0,
            capacity: 100,
            exit_colour: 1,
            description: String::new(),
            updated_at: at(0),
        }
    }

    fn org(id: u64, name: &str, tags: &[&str]) -> Organization {
        Organization {
            id,
            source_key: format!("org-{id}"),
            venue_id: 1,
            name: name.into(),
            kind: "sponsor".into(),
            sponsor_tier: "gold".into(),
            website: String::new(),
            domain: String::new(),
            logo_url: String::new(),
            description: format!("{name} makes things."),
            category: String::new(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            industry: String::new(),
            headquarters: String::new(),
            size_range: String::new(),
            founded_year: 0,
            linkedin_url: String::new(),
            prizes: Vec::new(),
            source_url: String::new(),
            fetched_at: at(0),
            updated_at: at(0),
        }
    }

    fn booth(id: u64, zone_id: u64, organization_id: u64, name: &str, tags: &[&str]) -> Booth {
        Booth {
            id,
            source_key: format!("booth-{id}"),
            venue_id: 1,
            zone_id,
            organization_id,
            booth_number: format!("B{id}"),
            name: name.into(),
            kind: "sponsor".into(),
            description: format!("{name} demos."),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            plan_x_m: 0.0,
            plan_y_m: 0.0,
            placement: String::new(),
            source_url: String::new(),
            fetched_at: at(0),
            updated_at: at(0),
        }
    }

    fn slot(id: u64, booth_id: u64, title: &str) -> ScheduleSlot {
        ScheduleSlot {
            id,
            source_key: format!("slot-{id}"),
            venue_id: 1,
            title: title.into(),
            kind: "talk".into(),
            description: String::new(),
            location_text: String::new(),
            zone_id: 0,
            booth_id,
            host_organization_id: 0,
            speaker_person_ids: Vec::new(),
            starts_at: at(0),
            ends_at: None,
            source_url: String::new(),
            fetched_at: at(0),
            updated_at: at(0),
        }
    }

    fn attendee(n: u8, name: &str, findable: bool, organization_id: u64) -> Attendee {
        Attendee {
            identity: who(n),
            node_id: n as u64,
            display_name: name.into(),
            photo_url: String::new(),
            findable,
            person_id: 0,
            organization_id,
            simulated: true,
            created_at: at(0),
            updated_at: at(0),
        }
    }

    fn visit(id: u64, n: u8, zone_id: u64, minutes: f32) -> Visit {
        Visit {
            zone_visit_id: id,
            attendee: who(n),
            zone_id,
            band_id: n,
            started_at: at(60),
            ended_at: Some(at(600)),
            minutes,
            updated_at: at(600),
        }
    }

    fn encounter(id: u64, a: u8, b: u8, zone_id: u64) -> SocialEncounter {
        SocialEncounter {
            id,
            band_pair: id as u16,
            attendee_a: who(a),
            attendee_b: who(b),
            zone_id,
            baseline_seconds: 0,
            seconds_together: 300,
            started_at: at(100),
            last_seen_at: at(400),
            met: true,
            updated_at: at(400),
        }
    }

    fn snapshot() -> Snapshot {
        Snapshot {
            zones: vec![zone(1, "Expo"), zone(2, "Stage")],
            organizations: vec![
                org(1, "Elastic", &["search", "vectors"]),
                org(2, "Bay Robotics", &["robotics"]),
            ],
            booths: vec![
                booth(10, 1, 1, "Elastic booth", &["search", "ai"]),
                booth(11, 1, 2, "Robot arms", &["robotics"]),
                booth(12, 2, 2, "Drone show", &["drones"]),
            ],
            slots: vec![slot(1, 10, "Vector search 101")],
            attendees: vec![
                attendee(1, "Ada", true, 1),
                attendee(2, "Bo", true, 0),
                attendee(3, "Cy", false, 0),
            ],
            visits: vec![
                visit(100, 1, 1, 12.34),
                visit(101, 1, 2, 30.0),
                visit(102, 3, 1, 5.0),
            ],
            encounters: vec![encounter(7, 1, 2, 1), encounter(8, 1, 3, 1)],
        }
    }

    fn doc<'a>(docs: &'a Docs, index: Index, id: &str) -> &'a Value {
        docs.get(&(index, id.to_string()))
            .unwrap_or_else(|| panic!("no {index:?} document {id}"))
    }

    #[test]
    fn booth_carries_its_organisation_and_schedule() {
        let docs = build(&snapshot());
        let d = doc(&docs, Index::Booths, "10");
        assert_eq!(d["zone_name"], "Expo");
        assert_eq!(d["org_name"], "Elastic");
        assert_eq!(d["tags"], json!(["search", "ai", "vectors"]));
        assert_eq!(
            d["description"],
            "Elastic booth demos.\nElastic makes things.\nsearch, ai, vectors\nVector search 101"
        );
    }

    #[test]
    fn visit_carries_the_booths_of_its_zone() {
        let docs = build(&snapshot());
        let d = doc(&docs, Index::Memories, "visit-100");
        assert_eq!(d["kind"], "visit");
        assert_eq!(d["attendee_id"], hex(who(1)));
        assert_eq!(d["booth_names"], json!(["Elastic booth", "Robot arms"]));
        assert_eq!(
            d["booth_text"],
            "Expo\nElastic booth demos. (search, ai)\nRobot arms demos. (robotics)"
        );
        assert_eq!(d["minutes"], 12.3);
        assert_eq!(d["started_at"], "1970-01-01T00:01:00+00:00");
    }

    #[test]
    fn encounter_makes_one_document_per_participant() {
        let docs = build(&snapshot());
        let ada = doc(
            &docs,
            Index::Memories,
            &format!("encounter-7-{}", hex(who(1))),
        );
        assert_eq!(ada["other_attendee_id"], hex(who(2)));
        assert_eq!(ada["other_name"], "Bo");
        assert_eq!(ada["minutes"], 5.0);
        let bo = doc(
            &docs,
            Index::Memories,
            &format!("encounter-7-{}", hex(who(2))),
        );
        assert_eq!(bo["other_name"], "Ada");
    }

    #[test]
    fn people_who_are_not_findable_never_reach_elastic() {
        let docs = build(&snapshot());
        let cy = hex(who(3));
        assert!(!docs.contains_key(&(Index::Memories, "visit-102".into())));
        assert!(!docs.contains_key(&(Index::People, cy.clone())));
        assert!(!docs.keys().any(|(_, id)| id.starts_with("encounter-8-")));
        assert!(!docs.values().any(|d| d.to_string().contains(&cy)));
    }

    #[test]
    fn interests_follow_the_zones_with_most_minutes() {
        let docs = build(&snapshot());
        let d = doc(&docs, Index::People, &hex(who(1)));
        assert_eq!(d["node_id"], 1);
        assert_eq!(d["organization"], "Elastic");
        assert_eq!(
            d["interests"],
            "Stage\nDrone show: Drone show demos. (drones)\nExpo\nElastic booth: Elastic booth demos. (search, ai)\nRobot arms: Robot arms demos. (robotics)"
        );
        assert!(d.get("display_name").is_none());
        assert_eq!(doc(&docs, Index::People, &hex(who(2)))["interests"], "");
    }

    #[test]
    fn top_zones_keeps_five_most_visited() {
        let visits: Vec<Visit> = (1..=7)
            .map(|z| visit(z, 1, z, z as f32))
            .chain([visit(20, 1, 1, 10.0)])
            .collect();
        assert_eq!(top_zones(who(1), &visits), vec![1, 7, 6, 5, 4]);
    }
}
