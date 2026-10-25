//! The post-event summary behind an attendee's special link, assembled from the subscription cache.
//! Other people appear only when they are findable, with their name, photo and socials.
//! The suggestions are the people they hung out with and the booths where they spent time; Elastic
//! orders them by how well they match the attendee's own interests (see `apply_ranking`).

use bandit_bindings::{
    Attendee, Booth, Photo, PhotoTag, SharedVisit, SocialEncounter, SocialHandle, Visit, Zone,
};
use serde::Serialize;
use serde_json::{Value, json};
use spacetimedb_sdk::{Identity, Timestamp};
use std::collections::{BTreeMap, BTreeSet, HashMap};

pub const TOP_ZONES: usize = 5;

/// The rows a summary reads, from the subscription cache.
pub struct Rows {
    pub zones: Vec<Zone>,
    pub booths: Vec<Booth>,
    pub attendees: Vec<Attendee>,
    pub handles: Vec<SocialHandle>,
    pub visits: Vec<Visit>,
    /// Met encounters only; the `social_encounters` view leaves the others out.
    pub encounters: Vec<SocialEncounter>,
    pub shared_visits: Vec<SharedVisit>,
    pub photos: Vec<Photo>,
    pub photo_tags: Vec<PhotoTag>,
}

#[derive(Serialize, Debug)]
pub struct Summary {
    pub node_id: u64,
    pub display_name: String,
    pub photo_url: String,
    /// In time order.
    pub visits: Vec<VisitOut>,
    /// Most minutes first.
    pub top_zones: Vec<ZoneMinutes>,
    /// The people you hung out with, most minutes first.
    pub people: Vec<Companion>,
    /// In time order.
    pub shared_visits: Vec<SharedVisitOut>,
    /// Photos you are tagged in, in time order.
    pub photos: Vec<PhotoOut>,
    /// The people you hung out with, best match for your interests first.
    pub suggested_people: Vec<SuggestedPerson>,
    /// The booths your band stood at, best match for your interests first.
    pub suggested_booths: Vec<SuggestedBooth>,
    /// False when Elastic could not rank the suggestions: they are then ordered by minutes.
    pub suggestions_ranked: bool,
}

#[derive(Serialize, Debug)]
pub struct SuggestedPerson {
    pub node_id: u64,
    pub name: String,
    pub photo_url: String,
    /// Meta socials by platform: instagram, facebook, threads.
    pub handles: BTreeMap<String, String>,
    pub minutes: f32,
    /// Where and when you first met: the zone and start of your earliest encounter.
    pub met_zone_name: String,
    pub met_at: String,
    /// The booths their band stood at: the ones you both stood at first, then theirs, most minutes first.
    pub interests: Vec<Interest>,
    /// How many photos you are both tagged in.
    pub photos_together: u32,
    pub score: Option<f64>,
}

/// A booth someone's band stood at, with their minutes there and yours.
#[derive(Serialize, Debug, PartialEq)]
pub struct Interest {
    pub booth_id: u64,
    pub name: String,
    pub minutes: f32,
    /// 0 when you never stood there.
    pub your_minutes: f32,
    /// True when you both stood at the booth.
    pub shared: bool,
}

#[derive(Serialize, Debug)]
pub struct SuggestedBooth {
    pub booth_id: u64,
    pub name: String,
    pub zone_name: String,
    /// Your minutes at the booth.
    pub minutes: f32,
    pub score: Option<f64>,
}

#[derive(Serialize, Debug)]
pub struct BoothRef {
    pub booth_id: u64,
    pub name: String,
}

#[derive(Serialize, Debug)]
pub struct VisitOut {
    pub zone_visit_id: u64,
    pub zone_id: u64,
    pub zone_name: String,
    pub booths: Vec<BoothRef>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub minutes: f32,
}

#[derive(Serialize, Debug)]
pub struct ZoneMinutes {
    pub zone_id: u64,
    pub zone_name: String,
    pub minutes: f32,
}

/// A findable person: name, photo and socials by platform (instagram, facebook, threads).
#[derive(Serialize, Debug)]
pub struct Person {
    pub node_id: u64,
    pub name: String,
    pub photo_url: String,
    pub handles: BTreeMap<String, String>,
}

#[derive(Serialize, Debug)]
pub struct Companion {
    pub encounter_id: u64,
    pub person: Person,
    pub zone_id: u64,
    pub zone_name: String,
    pub started_at: String,
    pub last_seen_at: String,
    pub minutes: f32,
}

#[derive(Serialize, Debug)]
pub struct SharedVisitOut {
    pub shared_visit_id: u64,
    pub person: Person,
    pub zone_id: u64,
    pub zone_name: String,
    pub started_at: String,
    pub overlap_minutes: f32,
}

#[derive(Serialize, Debug)]
pub struct PhotoOut {
    pub photo_id: u64,
    pub url: String,
    pub taken_at: String,
    pub zone_id: u64,
    pub zone_name: String,
    pub caption: String,
    /// The other people the bands put in it, minus anyone who removed their tag, by name and socials.
    pub people: Vec<Person>,
}

/// The summary of `who`, or None when they are not an attendee.
pub fn summary(rows: &Rows, who: Identity) -> Option<Summary> {
    let me = rows.attendees.iter().find(|a| a.identity == who)?;
    let zones: HashMap<u64, &str> = rows.zones.iter().map(|z| (z.id, z.name.as_str())).collect();
    let zone_name = |id: u64| zones.get(&id).copied().unwrap_or_default().to_string();

    let mut visits: Vec<&Visit> = rows.visits.iter().filter(|v| v.attendee == who).collect();
    visits.sort_by_key(|v| (v.started_at, v.zone_visit_id));
    let visits: Vec<VisitOut> = visits
        .into_iter()
        .map(|v| {
            let mut booths: Vec<&Booth> = rows.booths.iter().filter(|b| in_visit(b, v)).collect();
            booths.sort_by_key(|b| b.id);
            VisitOut {
                zone_visit_id: v.zone_visit_id,
                zone_id: v.zone_id,
                zone_name: zone_name(v.zone_id),
                booths: booths
                    .into_iter()
                    .map(|b| BoothRef {
                        booth_id: b.id,
                        name: b.name.clone(),
                    })
                    .collect(),
                started_at: time(v.started_at),
                ended_at: v.ended_at.map(time),
                minutes: round(v.minutes),
            }
        })
        .collect();

    let mut minutes: BTreeMap<u64, f32> = BTreeMap::new();
    for v in &visits {
        *minutes.entry(v.zone_id).or_default() += v.minutes;
    }
    let suggested_booths = suggested_booths(rows, &booth_minutes(rows, who), &zone_name);
    let mut top_zones: Vec<ZoneMinutes> = minutes
        .into_iter()
        .map(|(zone_id, m)| ZoneMinutes {
            zone_id,
            zone_name: zone_name(zone_id),
            minutes: round(m),
        })
        .collect();
    top_zones.sort_by(|a, b| {
        b.minutes
            .total_cmp(&a.minutes)
            .then(a.zone_id.cmp(&b.zone_id))
    });
    top_zones.truncate(TOP_ZONES);

    let mut people: Vec<Companion> = rows
        .encounters
        .iter()
        .filter_map(|e| {
            let other = other_of(e.attendee_a, e.attendee_b, who)?;
            Some(Companion {
                encounter_id: e.id,
                person: person(rows, other)?,
                zone_id: e.zone_id,
                zone_name: zone_name(e.zone_id),
                started_at: time(e.started_at),
                last_seen_at: time(e.last_seen_at),
                minutes: round(e.seconds_together as f32 / 60.0),
            })
        })
        .collect();
    people.sort_by(|a, b| {
        b.minutes
            .total_cmp(&a.minutes)
            .then(a.encounter_id.cmp(&b.encounter_id))
    });

    let mut shared: Vec<&SharedVisit> = rows
        .shared_visits
        .iter()
        .filter(|s| s.attendee_a == who || s.attendee_b == who)
        .collect();
    shared.sort_by_key(|s| (s.started_at, s.id));
    let shared_visits: Vec<SharedVisitOut> = shared
        .into_iter()
        .filter_map(|s| {
            Some(SharedVisitOut {
                shared_visit_id: s.id,
                person: person(rows, other_of(s.attendee_a, s.attendee_b, who)?)?,
                zone_id: s.zone_id,
                zone_name: zone_name(s.zone_id),
                started_at: time(s.started_at),
                overlap_minutes: round(s.overlap_minutes),
            })
        })
        .collect();

    let mut photos: Vec<&Photo> = rows
        .photo_tags
        .iter()
        .filter(|t| t.attendee == who)
        .filter_map(|t| rows.photos.iter().find(|p| p.id == t.photo_id))
        .collect();
    photos.sort_by_key(|p| (p.taken_at, p.id));
    let photos: Vec<PhotoOut> = photos
        .into_iter()
        .map(|p| PhotoOut {
            photo_id: p.id,
            url: p.url.clone(),
            taken_at: time(p.taken_at),
            zone_id: p.zone_id,
            zone_name: zone_name(p.zone_id),
            caption: p.caption.clone(),
            people: rows
                .photo_tags
                .iter()
                .filter(|t| t.photo_id == p.id && t.attendee != who)
                .filter_map(|t| person(rows, t.attendee))
                .collect(),
        })
        .collect();

    let suggested_people = suggested_people(rows, who, &zone_name);
    Some(Summary {
        node_id: me.node_id,
        display_name: me.display_name.clone(),
        photo_url: me.photo_url.clone(),
        visits,
        top_zones,
        people,
        shared_visits,
        photos,
        suggested_people,
        suggested_booths,
        suggestions_ranked: false,
    })
}

/// Everyone you hung out with, minutes added up per person, most minutes first, with how you met:
/// where and when you first met, their interests and the photos you are both in.
fn suggested_people(
    rows: &Rows,
    who: Identity,
    zone_name: &dyn Fn(u64) -> String,
) -> Vec<SuggestedPerson> {
    let mine = booth_minutes(rows, who);
    // Earliest first, so each person's card starts from where you first met.
    let mut encounters: Vec<&SocialEncounter> = rows.encounters.iter().collect();
    encounters.sort_by_key(|e| (e.started_at, e.id));
    let mut by_node: BTreeMap<u64, SuggestedPerson> = BTreeMap::new();
    for e in encounters {
        let Some(other) = other_of(e.attendee_a, e.attendee_b, who) else {
            continue;
        };
        let Some(card) = person(rows, other) else {
            continue;
        };
        let p = by_node
            .entry(card.node_id)
            .or_insert_with(|| SuggestedPerson {
                node_id: card.node_id,
                name: card.name,
                photo_url: card.photo_url,
                handles: card.handles,
                minutes: 0.0,
                met_zone_name: zone_name(e.zone_id),
                met_at: time(e.started_at),
                interests: interests(rows, &mine, other),
                photos_together: photos_together(rows, who, other),
                score: None,
            });
        p.minutes = round(p.minutes + round(e.seconds_together as f32 / 60.0));
    }
    let mut out: Vec<SuggestedPerson> = by_node.into_values().collect();
    out.sort_by(|a, b| {
        b.minutes
            .total_cmp(&a.minutes)
            .then(a.node_id.cmp(&b.node_id))
    });
    out
}

/// The minutes `who` stood at each booth, from the visits that name one. A visit that names only its
/// zone says nothing about which of the zone's booths they were into.
fn booth_minutes(rows: &Rows, who: Identity) -> BTreeMap<u64, f32> {
    let mut minutes: BTreeMap<u64, f32> = BTreeMap::new();
    for v in rows.visits.iter().filter(|v| v.attendee == who && v.booth_id != 0) {
        *minutes.entry(v.booth_id).or_default() += v.minutes;
    }
    minutes
}

/// `other`'s interests: the booths they stood at, the ones you stood at too first, by both your minutes,
/// then the rest by theirs.
fn interests(rows: &Rows, mine: &BTreeMap<u64, f32>, other: Identity) -> Vec<Interest> {
    let mut out: Vec<Interest> = booth_minutes(rows, other)
        .into_iter()
        .filter_map(|(id, minutes)| {
            let booth = rows.booths.iter().find(|b| b.id == id)?;
            let yours = mine.get(&id).copied();
            Some(Interest {
                booth_id: id,
                name: booth.name.clone(),
                minutes: round(minutes),
                your_minutes: round(yours.unwrap_or(0.0)),
                shared: yours.is_some(),
            })
        })
        .collect();
    out.sort_by(|a, b| {
        b.shared
            .cmp(&a.shared)
            .then((b.minutes + b.your_minutes).total_cmp(&(a.minutes + a.your_minutes)))
            .then(a.booth_id.cmp(&b.booth_id))
    });
    out
}

/// How many photos `who` and `other` are both tagged in.
fn photos_together(rows: &Rows, who: Identity, other: Identity) -> u32 {
    let tagged = |id: Identity| -> BTreeSet<u64> {
        rows.photo_tags
            .iter()
            .filter(|t| t.attendee == id)
            .map(|t| t.photo_id)
            .collect()
    };
    tagged(who).intersection(&tagged(other)).count() as u32
}

/// The booths you stood at, with your minutes at each, most minutes first.
fn suggested_booths(
    rows: &Rows,
    booth_minutes: &BTreeMap<u64, f32>,
    zone_name: &dyn Fn(u64) -> String,
) -> Vec<SuggestedBooth> {
    let mut out: Vec<SuggestedBooth> = rows
        .booths
        .iter()
        .filter_map(|b| {
            Some(SuggestedBooth {
                booth_id: b.id,
                name: b.name.clone(),
                zone_name: zone_name(b.zone_id),
                minutes: round(*booth_minutes.get(&b.id)?),
                score: None,
            })
        })
        .collect();
    out.sort_by(|a, b| {
        b.minutes
            .total_cmp(&a.minutes)
            .then(a.booth_id.cmp(&b.booth_id))
    });
    out
}

/// What the attendee spent time on, as the indexer writes a person's interests: each visited zone,
/// most minutes first, then the booths they stood at in it, most minutes first. Ranks the suggestions
/// of someone with no people document.
pub fn visited_text(rows: &Rows, who: Identity) -> String {
    let mut minutes: BTreeMap<u64, f32> = BTreeMap::new();
    for v in rows.visits.iter().filter(|v| v.attendee == who) {
        *minutes.entry(v.zone_id).or_default() += v.minutes;
    }
    let mut zones: Vec<(u64, f32)> = minutes.into_iter().collect();
    zones.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let stood = booth_minutes(rows, who);
    let mut lines = Vec::new();
    for (zone_id, _) in zones {
        if let Some(z) = rows.zones.iter().find(|z| z.id == zone_id) {
            lines.push(if z.description.is_empty() {
                z.name.clone()
            } else {
                format!("{}: {}", z.name, z.description)
            });
        }
        let mut booths: Vec<(&Booth, f32)> = rows
            .booths
            .iter()
            .filter(|b| b.zone_id == zone_id)
            .filter_map(|b| Some((b, *stood.get(&b.id)?)))
            .collect();
        booths.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.id.cmp(&b.0.id)));
        lines.extend(
            booths
                .iter()
                .map(|(b, _)| format!("{}: {} ({})", b.name, b.description, b.tags.join(", "))),
        );
    }
    lines.join("\n")
}

/// Puts the suggestions in Elastic's order with its scores. Candidates Elastic did not return
/// (no interests indexed yet) follow without a score, still by minutes.
pub fn apply_ranking(s: &mut Summary, people: &[(u64, f64)], booths: &[(u64, f64)]) {
    order_by(
        &mut s.suggested_people,
        people,
        |p| p.node_id,
        |p, score| p.score = Some(score),
    );
    order_by(
        &mut s.suggested_booths,
        booths,
        |b| b.booth_id,
        |b, score| b.score = Some(score),
    );
    s.suggestions_ranked = true;
}

/// The Kibana record of a ranked recap: the zones and booths the interests text names (each line
/// starts with one), the order Elastic chose, and the booth that minutes alone put first
/// (`first_by_minutes`, taken before `apply_ranking`).
pub fn ranking_doc(s: &Summary, interests: &str, first_by_minutes: Option<&str>, at_ms: u64) -> Value {
    let person = s.suggested_people.first();
    let booth = s.suggested_booths.first();
    let spots: Vec<&str> = interests.lines().filter_map(|l| l.split(':').next()).map(str::trim).filter(|l| !l.is_empty()).collect();
    json!({
        "@timestamp": at_ms,
        "attendee": s.display_name,
        "top_spots": spots,
        "people": s.suggested_people.iter().map(|p| &p.name).collect::<Vec<_>>(),
        "booths": s.suggested_booths.iter().map(|b| &b.name).collect::<Vec<_>>(),
        "first_person": person.map(|p| &p.name),
        "first_person_score": person.and_then(|p| p.score),
        "first_booth": booth.map(|b| &b.name),
        "first_booth_zone": booth.map(|b| &b.zone_name),
        "first_booth_score": booth.and_then(|b| b.score),
        "first_booth_by_minutes": first_by_minutes,
        "reordered": booth.map(|b| b.name.as_str()) != first_by_minutes,
    })
}

fn order_by<T>(
    items: &mut [T],
    scores: &[(u64, f64)],
    id: impl Fn(&T) -> u64,
    set_score: impl Fn(&mut T, f64),
) {
    for item in items.iter_mut() {
        if let Some(&(_, score)) = scores.iter().find(|(i, _)| *i == id(item)) {
            set_score(item, score);
        }
    }
    items.sort_by_key(|item| {
        scores
            .iter()
            .position(|(i, _)| *i == id(item))
            .unwrap_or(scores.len())
    });
}

/// A findable attendee with their socials; None for anyone else.
fn person(rows: &Rows, id: Identity) -> Option<Person> {
    let a = rows
        .attendees
        .iter()
        .find(|a| a.identity == id && a.findable)?;
    Some(Person {
        node_id: a.node_id,
        name: a.display_name.clone(),
        photo_url: a.photo_url.clone(),
        handles: rows
            .handles
            .iter()
            .filter(|h| h.owner == id)
            .map(|h| (h.platform.clone(), h.handle.clone()))
            .collect(),
    })
}

/// The booth of a visit, the one the band stood at; a visit known only by its zone has none.
fn in_visit(b: &Booth, v: &Visit) -> bool {
    b.id == v.booth_id
}

fn other_of(a: Identity, b: Identity, who: Identity) -> Option<Identity> {
    if a == who {
        Some(b)
    } else if b == who {
        Some(a)
    } else {
        None
    }
}

fn time(t: Timestamp) -> String {
    t.to_string()
}

fn round(minutes: f32) -> f32 {
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
            station_id: 0,
            plan_x_m: 0.0,
            plan_y_m: 0.0,
            area_sq_m: 0.0,
            capacity: 0,
            exit_colour: 0,
            description: String::new(),
            updated_at: at(0),
        }
    }

    fn booth(id: u64, zone_id: u64, name: &str) -> Booth {
        Booth {
            id,
            source_key: format!("booth-{id}"),
            venue_id: 1,
            zone_id,
            organization_id: 0,
            booth_number: String::new(),
            name: name.into(),
            kind: "sponsor".into(),
            description: format!("{name} showcases."),
            tags: vec!["showcase".into()],
            plan_x_m: 0.0,
            plan_y_m: 0.0,
            placement: String::new(),
            source_url: String::new(),
            fetched_at: at(0),
            updated_at: at(0),
        }
    }

    fn attendee(n: u8, name: &str, findable: bool) -> Attendee {
        Attendee {
            identity: who(n),
            node_id: n as u64,
            display_name: name.into(),
            photo_url: format!("https://example.test/{n}.jpg"),
            findable,
            person_id: 0,
            organization_id: 0,
            crowd: false,
            created_at: at(0),
            updated_at: at(0),
        }
    }

    fn handle(id: u64, n: u8, platform: &str, handle: &str) -> SocialHandle {
        SocialHandle {
            id,
            owner: who(n),
            platform: platform.into(),
            handle: handle.into(),
            updated_at: at(0),
        }
    }

    fn visit(id: u64, n: u8, zone_id: u64, start: i64, minutes: f32) -> Visit {
        Visit {
            zone_visit_id: id,
            attendee: who(n),
            zone_id,
            band_id: n.into(),
            started_at: at(start),
            ended_at: None,
            minutes,
            updated_at: at(start),
            booth_id: 0,
            open: true,
        }
    }

    fn encounter(id: u64, a: u8, b: u8, seconds: u32) -> SocialEncounter {
        SocialEncounter {
            id,
            band_pair: id,
            attendee_a: who(a),
            attendee_b: who(b),
            zone_id: 1,
            baseline_seconds: 0,
            seconds_together: seconds,
            started_at: at(100),
            last_seen_at: at(100 + seconds as i64),
            met: true,
            updated_at: at(0),
        }
    }

    fn tag(id: u64, photo_id: u64, n: u8) -> PhotoTag {
        PhotoTag {
            id,
            photo_id,
            attendee: who(n),
            status: String::new(),
            updated_at: at(0),
        }
    }

    fn rows() -> Rows {
        Rows {
            zones: vec![zone(1, "Expo"), zone(2, "Stage")],
            booths: vec![
                booth(11, 1, "Robot arms"),
                booth(10, 1, "Elastic booth"),
                booth(12, 2, "Drone show"),
            ],
            attendees: vec![
                attendee(1, "Ada", true),
                attendee(2, "Bo", true),
                attendee(3, "Cy", false),
                attendee(4, "Di", true),
                attendee(5, "Ed", true),
            ],
            handles: vec![
                handle(1, 2, "instagram", "bo.builds"),
                handle(2, 2, "threads", "bo"),
                handle(3, 1, "instagram", "ada"),
            ],
            visits: vec![
                visit(21, 1, 2, 900, 20.0),
                visit(20, 1, 1, 100, 12.34),
                visit(22, 1, 1, 2000, 10.0),
                visit(23, 2, 1, 100, 99.0),
            ],
            encounters: vec![
                encounter(7, 1, 2, 600),
                encounter(8, 3, 1, 900),
                encounter(9, 4, 1, 1200),
                encounter(10, 2, 4, 60),
            ],
            shared_visits: vec![SharedVisit {
                id: 5,
                attendee_a: who(2),
                attendee_b: who(1),
                zone_id: 1,
                visit_a: 23,
                visit_b: 20,
                started_at: at(100),
                overlap_minutes: 6.0,
                updated_at: at(0),
            }],
            photos: vec![
                Photo {
                    id: 1,
                    url: "https://example.test/p1.jpg".into(),
                    taken_at: at(500),
                    zone_id: 1,
                    caption: "Robots!".into(),
                    added_by: who(9),
                    created_at: at(500),
                    people_count: 0,
                    features_call_id: 0,
                },
                Photo {
                    id: 2,
                    url: "https://example.test/p2.jpg".into(),
                    taken_at: at(300),
                    zone_id: 2,
                    caption: "Stage".into(),
                    added_by: who(9),
                    created_at: at(300),
                    people_count: 0,
                    features_call_id: 0,
                },
            ],
            photo_tags: vec![
                tag(1, 1, 1),
                tag(2, 1, 2),
                tag(3, 1, 3),
                tag(4, 1, 4),
                tag(7, 1, 5),
                tag(5, 2, 1),
            ],
        }
    }

    /// The rows with Ada at the Elastic booth for her first expo stay and at the drone show on the
    /// stage; her second expo stay names only the zone.
    fn rows_at_booths() -> Rows {
        let mut rows = rows();
        for v in &mut rows.visits {
            v.booth_id = match v.zone_visit_id {
                20 => 10,
                21 => 12,
                _ => v.booth_id,
            };
        }
        rows
    }

    #[test]
    fn visits_in_time_order_with_their_booths() {
        let s = summary(&rows_at_booths(), who(1)).unwrap();
        assert_eq!(s.display_name, "Ada");
        let ids: Vec<u64> = s.visits.iter().map(|v| v.zone_visit_id).collect();
        assert_eq!(ids, vec![20, 21, 22]);
        let booths: Vec<&str> = s.visits[0].booths.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(booths, vec!["Elastic booth"]);
        assert_eq!(s.visits[0].zone_name, "Expo");
        assert_eq!(s.visits[0].minutes, 12.3);
        // A stay known only by its zone names none of the zone's booths.
        assert!(s.visits[2].booths.is_empty());
    }

    #[test]
    fn top_zones_add_up_minutes() {
        let s = summary(&rows(), who(1)).unwrap();
        let top: Vec<(u64, f32)> = s.top_zones.iter().map(|z| (z.zone_id, z.minutes)).collect();
        assert_eq!(top, vec![(1, 22.3), (2, 20.0)]);
    }

    #[test]
    fn people_are_findable_companions_with_socials() {
        let s = summary(&rows(), who(1)).unwrap();
        let names: Vec<&str> = s.people.iter().map(|p| p.person.name.as_str()).collect();
        assert_eq!(names, vec!["Di", "Bo"]);
        let bo = &s.people[1];
        assert_eq!(bo.minutes, 10.0);
        assert_eq!(
            bo.person.handles.get("instagram").map(String::as_str),
            Some("bo.builds")
        );
        assert_eq!(
            bo.person.handles.get("threads").map(String::as_str),
            Some("bo")
        );
        assert_eq!(s.shared_visits.len(), 1);
        assert_eq!(s.shared_visits[0].person.name, "Bo");
    }

    #[test]
    fn photos_show_everyone_the_bands_put_in_them() {
        let s = summary(&rows(), who(1)).unwrap();
        let ids: Vec<u64> = s.photos.iter().map(|p| p.photo_id).collect();
        assert_eq!(ids, vec![2, 1]);
        let robots = &s.photos[1];
        assert_eq!(robots.zone_name, "Expo");
        assert_eq!(robots.caption, "Robots!");
        let names: Vec<&str> = robots.people.iter().map(|p| p.name.as_str()).collect();
        // Cy is in it too but not findable.
        assert_eq!(names, vec!["Bo", "Di", "Ed"]);
    }

    #[test]
    fn suggestions_start_in_minutes_order() {
        let s = summary(&rows_at_booths(), who(1)).unwrap();
        assert!(!s.suggestions_ranked);
        let people: Vec<(u64, f32)> = s
            .suggested_people
            .iter()
            .map(|p| (p.node_id, p.minutes))
            .collect();
        assert_eq!(people, vec![(4, 20.0), (2, 10.0)]);
        assert_eq!(
            s.suggested_people[1]
                .handles
                .get("threads")
                .map(String::as_str),
            Some("bo")
        );
        let booths: Vec<(u64, f32)> = s
            .suggested_booths
            .iter()
            .map(|b| (b.booth_id, b.minutes))
            .collect();
        // Only the booths Ada stood at, with her minutes at each, not every booth of the expo.
        assert_eq!(booths, vec![(12, 20.0), (10, 12.3)]);
        assert_eq!(s.suggested_booths[0].zone_name, "Stage");
    }

    #[test]
    fn suggested_people_say_how_you_met() {
        let mut rows = rows();
        // Ada and Bo first met on the stage, before the expo.
        let mut stage = encounter(11, 2, 1, 300);
        stage.zone_id = 2;
        stage.started_at = at(50);
        rows.encounters.push(stage);
        rows.photo_tags.push(tag(8, 2, 2));
        let s = summary(&rows, who(1)).unwrap();
        let names: Vec<&str> = s.suggested_people.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Di", "Bo"]);

        let bo = &s.suggested_people[1];
        assert_eq!(bo.minutes, 15.0);
        assert_eq!(bo.met_zone_name, "Stage");
        assert_eq!(bo.met_at, time(at(50)));
        assert_eq!(bo.photos_together, 2);

        let di = &s.suggested_people[0];
        assert_eq!(di.met_zone_name, "Expo");
        assert_eq!(di.met_at, time(at(100)));
        assert_eq!(di.photos_together, 1);
    }

    fn interest(booth_id: u64, name: &str, minutes: f32, your_minutes: f32) -> Interest {
        Interest {
            booth_id,
            name: name.into(),
            minutes,
            your_minutes,
            shared: your_minutes > 0.0,
        }
    }

    #[test]
    fn suggested_people_show_their_booths_shared_ones_first() {
        let mut rows = rows();
        let at_booth = |id, n, booth_id, minutes| Visit {
            booth_id,
            ..visit(id, n, 1, 3000, minutes)
        };
        // Ada stood at the robot arms and the drone show.
        rows.visits.push(at_booth(30, 1, 11, 5.0));
        rows.visits.push(at_booth(31, 1, 12, 2.0));
        // Bo spent longer at the Elastic booth than at the robot arms, twice.
        rows.visits.push(at_booth(32, 2, 10, 9.0));
        rows.visits.push(at_booth(33, 2, 11, 3.0));
        rows.visits.push(at_booth(34, 2, 11, 4.0));
        // Di stood at the drone show and the Elastic booth.
        rows.visits.push(at_booth(35, 4, 12, 4.0));
        rows.visits.push(at_booth(36, 4, 10, 6.0));
        let s = summary(&rows, who(1)).unwrap();
        let of = |name: &str| &s.suggested_people.iter().find(|p| p.name == name).unwrap().interests;

        // Bo's 99 minutes in the expo name no booth, so they add no interest.
        assert_eq!(
            of("Bo"),
            &vec![interest(11, "Robot arms", 7.0, 5.0), interest(10, "Elastic booth", 9.0, 0.0)]
        );
        assert_eq!(
            of("Di"),
            &vec![interest(12, "Drone show", 4.0, 2.0), interest(10, "Elastic booth", 6.0, 0.0)]
        );
    }

    #[test]
    fn ranking_follows_elastic_then_minutes() {
        let mut s = summary(&rows_at_booths(), who(1)).unwrap();
        apply_ranking(&mut s, &[(2, 0.9)], &[(10, 0.5)]);
        assert!(s.suggestions_ranked);
        let people: Vec<(u64, Option<f64>)> = s
            .suggested_people
            .iter()
            .map(|p| (p.node_id, p.score))
            .collect();
        assert_eq!(people, vec![(2, Some(0.9)), (4, None)]);
        let booths: Vec<(u64, Option<f64>)> = s
            .suggested_booths
            .iter()
            .map(|b| (b.booth_id, b.score))
            .collect();
        assert_eq!(booths, vec![(10, Some(0.5)), (12, None)]);
    }

    #[test]
    fn ranking_doc_shows_the_order_next_to_minutes() {
        let mut s = summary(&rows_at_booths(), who(1)).unwrap();
        let by_minutes = s.suggested_booths[0].name.clone();
        apply_ranking(&mut s, &[(2, 0.9)], &[(12, 0.8), (10, 0.5)]);
        let doc = ranking_doc(&s, "Stage\nDrone show: Drone show showcases. (drones)", Some(&by_minutes), 7);
        assert_eq!(doc["top_spots"], json!(["Stage", "Drone show"]));
        assert_eq!(doc["first_booth"], s.suggested_booths[0].name.as_str());
        assert_eq!(doc["first_booth_score"], 0.8);
        assert_eq!(doc["first_booth_by_minutes"], by_minutes.as_str());
        assert_eq!(doc["reordered"], s.suggested_booths[0].name != by_minutes);
        assert_eq!(doc["booths"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn visited_text_reads_like_interests() {
        assert_eq!(
            visited_text(&rows_at_booths(), who(1)),
            "Expo\nElastic booth: Elastic booth showcases. (showcase)\nStage\nDrone show: Drone show showcases. (showcase)"
        );
        // Zone-only stays name the zones and no booths.
        assert_eq!(visited_text(&rows(), who(1)), "Expo\nStage");
        assert_eq!(visited_text(&rows(), who(42)), "");
    }

    #[test]
    fn no_summary_for_a_stranger() {
        assert!(summary(&rows(), who(42)).is_none());
    }
}
