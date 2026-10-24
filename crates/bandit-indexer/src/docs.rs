//! The documents the indexer writes, built from rows of the subscription cache.
//! Plain functions, rows in and JSON out, so every rule here is easy to test.

use bandit_bindings::{Attendee, Booth, Organization, ScheduleSlot, Visit, Zone};
use serde_json::{Value, json};
use spacetimedb_sdk::Identity;
use std::collections::{BTreeMap, HashMap};

/// A person's interests come from the booths, or the whole zones, where they spent the most minutes.
pub const TOP_SPOTS: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Index {
    Booths,
    People,
}

impl Index {
    pub const ALL: [Index; 2] = [Index::Booths, Index::People];

    pub fn name(self) -> &'static str {
        match self {
            Index::Booths => "booths",
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
}

/// Builds every document: one per booth and one per findable attendee.
/// Anything not built here is deleted from Elastic.
pub fn build(s: &Snapshot) -> Docs {
    let venue = Venue::new(s);
    let findable: HashMap<Identity, &Attendee> = s
        .attendees
        .iter()
        .filter(|a| a.findable)
        .map(|a| (a.identity, a))
        .collect();
    let mut visits: HashMap<Identity, Vec<&Visit>> = HashMap::new();
    for v in s.visits.iter().filter(|v| findable.contains_key(&v.attendee)) {
        visits.entry(v.attendee).or_default().push(v);
    }
    let mut docs = Docs::new();
    for b in &s.booths {
        docs.insert(
            (Index::Booths, b.id.to_string()),
            venue.booth_doc(b, &s.slots),
        );
    }
    for a in findable.values() {
        docs.insert(
            (Index::People, hex(a.identity)),
            venue.person_doc(a, visits.get(&a.identity).map(Vec::as_slice).unwrap_or_default()),
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

    fn booth_line(b: &Booth) -> String {
        format!("{}: {} ({})", b.name, b.description, b.tags.join(", "))
    }

    fn booths_in(&self, zone_id: u64) -> &[&'a Booth] {
        self.booths_by_zone
            .get(&zone_id)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    fn zone_line(&self, zone_id: u64) -> String {
        self.zones
            .get(&zone_id)
            .map(|z| {
                if z.description.is_empty() {
                    z.name.clone()
                } else {
                    format!("{}: {}", z.name, z.description)
                }
            })
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

    /// No names and no socials: an attendee id, a graph node id, a company and what they spent time on.
    /// A stay at one booth adds that booth; a stay somewhere in a zone adds every booth of the zone.
    fn person_doc(&self, a: &Attendee, visits: &[&Visit]) -> Value {
        let mut lines: Vec<String> = Vec::new();
        for (zone_id, booth_id) in top_spots(visits) {
            let zone = self.zone_line(zone_id);
            if !lines.contains(&zone) {
                lines.push(zone);
            }
            let booths = self.booths_in(zone_id).iter().filter(|b| booth_id == 0 || b.id == booth_id);
            lines.extend(booths.map(|b| Self::booth_line(b)).filter(|l| !lines.contains(l)).collect::<Vec<_>>());
        }
        json!({
            "attendee_id": hex(a.identity),
            "node_id": a.node_id,
            "organization": self.organizations.get(&a.organization_id).map(|o| o.name.as_str()).unwrap_or_default(),
            "interests": lines.join("\n"),
        })
    }
}

/// The booths (or whole zones, booth 0) where one person spent the most minutes, ties to the lower ids,
/// in zone and booth order: the document only changes when the set changes, not as minutes add up.
pub fn top_spots(visits: &[&Visit]) -> Vec<(u64, u64)> {
    let mut minutes: HashMap<(u64, u64), f64> = HashMap::new();
    for v in visits {
        *minutes.entry((v.zone_id, v.booth_id)).or_default() += v.minutes as f64;
    }
    let mut spots: Vec<((u64, u64), f64)> = minutes.into_iter().collect();
    spots.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut top: Vec<(u64, u64)> = spots.into_iter().take(TOP_SPOTS).map(|(spot, _)| spot).collect();
    top.sort();
    top
}

pub fn hex(id: Identity) -> String {
    id.to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use spacetimedb_sdk::Timestamp;

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
            crunchbase_url: String::new(),
            funding_summary: String::new(),
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
            description: format!("{name} showcases."),
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
            band_id: n.into(),
            started_at: at(60),
            ended_at: Some(at(600)),
            minutes,
            updated_at: at(600),
            booth_id: 0,
            open: false,
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
                Visit { booth_id: 12, ..visit(103, 2, 2, 4.0) },
            ],
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
            "Elastic booth showcases.\nElastic makes things.\nsearch, ai, vectors\nVector search 101"
        );
    }

    #[test]
    fn people_who_are_not_findable_never_reach_elastic() {
        let docs = build(&snapshot());
        let cy = hex(who(3));
        assert!(!docs.contains_key(&(Index::People, cy.clone())));
        assert!(!docs.values().any(|d| d.to_string().contains(&cy)));
    }

    #[test]
    fn interests_follow_the_zones_and_booths_with_most_minutes() {
        let docs = build(&snapshot());
        let d = doc(&docs, Index::People, &hex(who(1)));
        assert_eq!(d["node_id"], 1);
        assert_eq!(d["organization"], "Elastic");
        assert_eq!(
            d["interests"],
            "Expo\nElastic booth: Elastic booth showcases. (search, ai)\nRobot arms: Robot arms showcases. (robotics)\nStage\nDrone show: Drone show showcases. (drones)"
        );
        assert!(d.get("display_name").is_none());
        assert_eq!(doc(&docs, Index::People, &hex(who(2)))["interests"], "Stage\nDrone show: Drone show showcases. (drones)");
    }

    #[test]
    fn top_spots_keeps_five_most_visited_in_a_stable_order() {
        let visits: Vec<Visit> = (1..=7)
            .map(|z| visit(z, 1, z, z as f32))
            .chain([visit(20, 1, 1, 10.0), Visit { booth_id: 9, ..visit(21, 1, 3, 0.5) }])
            .collect();
        let refs: Vec<&Visit> = visits.iter().collect();
        assert_eq!(top_spots(&refs), vec![(1, 0), (4, 0), (5, 0), (6, 0), (7, 0)]);
    }
}
