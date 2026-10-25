//! Friend search reads the caller's recorded meetings and overlapping visits. Place evidence is
//! assembled in code before ranking, so a related interest can never stand in for being there.

use crate::summary::Rows;
use bandit_bindings::{SocialEncounter, Visit};
use serde::Serialize;
use spacetimedb_sdk::{Identity, Timestamp};
use std::collections::{BTreeMap, BTreeSet};

const RESULTS: usize = 20;
const EVIDENCE_CHARS: usize = 2_000;

#[derive(Debug, Serialize)]
pub struct FriendSearch {
    pub query: String,
    pub semantic_ranked: bool,
    pub candidate_count: usize,
    pub searched_count: usize,
    pub people: Vec<FriendPerson>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FriendPerson {
    pub node_id: u64,
    pub name: String,
    pub photo_url: String,
    pub handles: BTreeMap<String, String>,
    /// All recorded close time, not the duration at any single place.
    pub minutes: f32,
    pub reason: String,
    pub places: Vec<FriendPlace>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FriendPlace {
    pub name: String,
    pub started_at: String,
    /// Zero for an encounter's starting zone: its cumulative duration is not a zone duration.
    pub minutes: f32,
    pub kind: String,
}

pub struct Candidate {
    pub person: FriendPerson,
    pub text: String,
    recorded_words: BTreeSet<String>,
    lexical_hits: usize,
}

pub struct PreparedSearch {
    pub candidates: Vec<Candidate>,
    /// Count of eligible people after all evidence constraints.
    pub candidate_count: usize,
    query_words: BTreeSet<String>,
}

struct Evidence {
    place: FriendPlace,
    zone_id: u64,
    booth_id: u64,
    description: String,
}

/// Missing profiles have no recap. Only the caller's actual, findable met connections qualify.
pub fn prepare(rows: &Rows, who: Identity, query: &str) -> Option<PreparedSearch> {
    rows.attendees.iter().find(|a| a.identity == who)?;
    let query_tokens = words(query);
    let query_words = significant_words(query);
    let mentioned_places = longest_place_names(
        &query_tokens,
        rows.booths
            .iter()
            .map(|b| b.name.as_str())
            .chain(rows.zones.iter().map(|z| z.name.as_str())),
    );
    let required_booths = named_places(
        &mentioned_places,
        rows.booths.iter().map(|b| (b.id, b.name.as_str())),
    );
    let required_zones = named_places(
        &mentioned_places,
        rows.zones.iter().map(|z| (z.id, z.name.as_str())),
    );
    let named_people: BTreeSet<u64> = rows
        .attendees
        .iter()
        .filter(|a| {
            let name = words(&a.display_name);
            name.len() >= 2
                && name.iter().all(|w| w.chars().count() >= 2)
                && contains_phrase(&query_tokens, &name)
        })
        .map(|a| a.node_id)
        .collect();
    let mut meetings: BTreeMap<Identity, Vec<&SocialEncounter>> = BTreeMap::new();
    for encounter in rows
        .encounters
        .iter()
        .filter(|e| e.met && e.seconds_together > 0)
    {
        let other = if encounter.attendee_a == who {
            encounter.attendee_b
        } else if encounter.attendee_b == who {
            encounter.attendee_a
        } else {
            continue;
        };
        if other != who {
            meetings.entry(other).or_default().push(encounter);
        }
    }
    let mut visits: BTreeMap<Identity, Vec<&Visit>> = BTreeMap::new();
    for visit in &rows.visits {
        if visit.zone_id != 0 && visit_end(visit) > visit.started_at {
            visits.entry(visit.attendee).or_default().push(visit);
        }
    }
    let mine = visits.get(&who).map(Vec::as_slice).unwrap_or_default();
    let mut candidates = Vec::new();
    for (other, mut encounters) in meetings {
        let Some(person) = rows
            .attendees
            .iter()
            .find(|a| a.identity == other && a.findable)
        else {
            continue;
        };
        if !named_people.is_empty() && !named_people.contains(&person.node_id) {
            continue;
        }
        encounters.sort_by_key(|e| (e.started_at, e.id));
        let minutes = rounded(
            encounters
                .iter()
                .map(|e| e.seconds_together as f64)
                .sum::<f64>()
                / 60.0,
        );
        let mut evidence = Vec::new();
        for encounter in &encounters {
            if let Some(zone) = rows
                .zones
                .iter()
                .find(|z| z.id == encounter.zone_id && !z.name.trim().is_empty())
            {
                evidence.push(Evidence {
                    place: FriendPlace {
                        name: zone.name.clone(),
                        started_at: encounter.started_at.to_string(),
                        minutes: 0.0,
                        kind: "encounter_zone".into(),
                    },
                    zone_id: zone.id,
                    booth_id: 0,
                    description: zone.description.clone(),
                });
            }
        }
        // SharedVisit is not written for the crowd. The underlying timestamped visits support
        // the same overlap calculation for every eligible attendee, without inventing episodes.
        let theirs = visits.get(&other).map(Vec::as_slice).unwrap_or_default();
        let mut pairs = BTreeSet::new();
        for a in mine {
            for b in theirs.iter().filter(|b| b.zone_id == a.zone_id) {
                if !pairs.insert((a.zone_visit_id, b.zone_visit_id)) {
                    continue;
                }
                let start = a.started_at.max(b.started_at);
                let end = visit_end(a).min(visit_end(b));
                if end <= start {
                    continue;
                }
                let Some(zone) = rows.zones.iter().find(|z| z.id == a.zone_id) else {
                    continue;
                };
                let booth = (a.booth_id != 0 && a.booth_id == b.booth_id)
                    .then(|| {
                        rows.booths
                            .iter()
                            .find(|booth| booth.id == a.booth_id && booth.zone_id == zone.id)
                    })
                    .flatten();
                let (name, booth_id, kind, description) = match booth {
                    Some(booth) => (
                        booth.name.clone(),
                        booth.id,
                        "shared_booth",
                        format!("{} {}", booth.description, booth.tags.join(", ")),
                    ),
                    None => (
                        zone.name.clone(),
                        0,
                        "shared_zone",
                        zone.description.clone(),
                    ),
                };
                if name.trim().is_empty() {
                    continue;
                }
                evidence.push(Evidence {
                    place: FriendPlace {
                        name,
                        started_at: start.to_string(),
                        minutes: rounded(
                            (end.to_micros_since_unix_epoch() - start.to_micros_since_unix_epoch())
                                as f64
                                / 60_000_000.0,
                        ),
                        kind: kind.into(),
                    },
                    zone_id: zone.id,
                    booth_id,
                    description,
                });
            }
        }
        if !required_booths
            .values()
            .all(|ids| evidence.iter().any(|e| ids.contains(&e.booth_id)))
            || !required_zones
                .values()
                .all(|ids| evidence.iter().any(|e| ids.contains(&e.zone_id)))
        {
            continue;
        }
        evidence.sort_by(|a, b| {
            let priority = |e: &Evidence| {
                if required_booths
                    .values()
                    .any(|ids| ids.contains(&e.booth_id))
                {
                    0
                } else if required_zones.values().any(|ids| ids.contains(&e.zone_id)) {
                    1
                } else if e.place.kind == "shared_booth" {
                    2
                } else if e.place.kind == "encounter_zone" {
                    3
                } else {
                    4
                }
            };
            priority(a)
                .cmp(&priority(b))
                .then_with(|| {
                    let hits = |e: &Evidence| {
                        query_words
                            .intersection(&significant_words(&format!(
                                "{} {}",
                                e.place.name, e.description
                            )))
                            .count()
                    };
                    hits(b).cmp(&hits(a))
                })
                .then(a.place.started_at.cmp(&b.place.started_at))
                .then(a.place.name.cmp(&b.place.name))
        });
        let mut recorded_words: BTreeSet<String> =
            words(&person.display_name).into_iter().collect();
        for item in &evidence {
            recorded_words.extend(words(&item.place.name));
        }
        let close = format!("Your bands recorded {minutes:.1} minutes close together.");
        let detail = evidence
            .first()
            .map(|e| match e.place.kind.as_str() {
                "shared_booth" => format!(
                    " Your visits at {} overlap for {:.1} minutes.",
                    e.place.name, e.place.minutes
                ),
                "shared_zone" => format!(
                    " Your visits to the {} zone overlap for {:.1} minutes.",
                    e.place.name, e.place.minutes
                ),
                _ => format!(" A recorded encounter started in {}.", e.place.name),
            })
            .unwrap_or_default();
        let reason = format!("{close}{detail}");
        let details = evidence
            .iter()
            .map(|e| {
                let fact = match e.place.kind.as_str() {
                    "shared_booth" => "Simultaneous visits to the same booth",
                    "shared_zone" => "Simultaneous visits to the same zone; booth unknown",
                    _ => "Recorded encounter starting zone; duration at this location unknown",
                };
                format!(
                    "{fact}: {} at {}. {}",
                    e.place.name, e.place.started_at, e.description
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let text: String = format!("Person: {}. {reason}\n{details}", person.display_name)
            .chars()
            .take(EVIDENCE_CHARS)
            .collect();
        let lexical_hits = query_words.intersection(&significant_words(&text)).count();
        candidates.push(Candidate {
            person: FriendPerson {
                node_id: person.node_id,
                name: person.display_name.clone(),
                photo_url: person.photo_url.clone(),
                handles: rows
                    .handles
                    .iter()
                    .filter(|h| h.owner == other)
                    .map(|h| (h.platform.clone(), h.handle.clone()))
                    .collect(),
                minutes,
                reason,
                places: evidence.into_iter().map(|e| e.place).collect(),
            },
            text,
            recorded_words,
            lexical_hits,
        });
    }
    candidates.sort_by(|a, b| {
        b.lexical_hits
            .cmp(&a.lexical_hits)
            .then(b.person.minutes.total_cmp(&a.person.minutes))
            .then(a.person.node_id.cmp(&b.person.node_id))
    });
    Some(PreparedSearch {
        candidate_count: candidates.len(),
        candidates,
        query_words,
    })
}

/// Scores refer only to positions in the prepared candidate list. They cannot introduce a person.
pub fn finish(
    query: String,
    prepared: PreparedSearch,
    scores: Option<&[(usize, f64)]>,
) -> FriendSearch {
    let searched_count = prepared.candidates.len();
    let semantic_ranked = scores.is_some() || searched_count == 0;
    let people = if let Some(scores) = scores {
        let mut scores: Vec<_> = scores
            .iter()
            .copied()
            .filter(|(_, score)| score.is_finite())
            .collect();
        scores.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let mut seen = BTreeSet::new();
        scores
            .into_iter()
            .filter_map(|(index, _)| {
                if !seen.insert(index) {
                    return None;
                }
                prepared.candidates.get(index).map(|c| c.person.clone())
            })
            .take(RESULTS)
            .collect()
    } else {
        prepared
            .candidates
            .iter()
            .filter(|c| {
                !prepared.query_words.is_empty()
                    && prepared.query_words.is_subset(&c.recorded_words)
            })
            .take(RESULTS)
            .map(|c| c.person.clone())
            .collect()
    };
    FriendSearch {
        query,
        semantic_ranked,
        candidate_count: prepared.candidate_count,
        searched_count,
        people,
    }
}

fn visit_end(visit: &Visit) -> Timestamp {
    visit.ended_at.unwrap_or(visit.updated_at)
}

fn rounded(minutes: f64) -> f32 {
    ((minutes * 10.0).round() / 10.0) as f32
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn contains_phrase(haystack: &[String], needle: &[String]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

fn place_words(name: &str) -> Vec<String> {
    let mut name = words(name);
    while name
        .last()
        .is_some_and(|word| matches!(word.as_str(), "booth" | "stand"))
    {
        name.pop();
    }
    name
}

#[cfg(test)]
fn mentions_place(query: &[String], name: &str) -> bool {
    contains_phrase(query, &place_words(name))
}

/// Multiple physical places with one name are alternatives, not multiple required visits.
fn named_places<'a>(
    mentioned: &BTreeSet<Vec<String>>,
    places: impl Iterator<Item = (u64, &'a str)>,
) -> BTreeMap<Vec<String>, BTreeSet<u64>> {
    let mut named: BTreeMap<Vec<String>, BTreeSet<u64>> = BTreeMap::new();
    for (id, name) in places {
        let name = place_words(name);
        if mentioned.contains(&name) {
            named.entry(name).or_default().insert(id);
        }
    }
    named
}

/// A longer name owns an overlapping phrase; a separate mention of the shorter name still counts.
fn longest_place_names<'a>(
    query: &[String],
    names: impl Iterator<Item = &'a str>,
) -> BTreeSet<Vec<String>> {
    let names: BTreeSet<_> = names
        .map(place_words)
        .filter(|name| !name.is_empty())
        .collect();
    let mut matches = Vec::new();
    for name in &names {
        for (start, window) in query.windows(name.len()).enumerate() {
            if window == name {
                matches.push((start, name));
            }
        }
    }
    matches.sort_by(|(a_start, a), (b_start, b)| b.len().cmp(&a.len()).then(a_start.cmp(b_start)));
    let mut spans = Vec::new();
    let mut mentioned = BTreeSet::new();
    for (start, name) in matches {
        let end = start + name.len();
        if spans.iter().any(|&(a, b)| start < b && a < end) {
            continue;
        }
        spans.push((start, end));
        mentioned.insert(name.clone());
    }
    mentioned
}

fn significant_words(text: &str) -> BTreeSet<String> {
    words(text)
        .into_iter()
        .filter(|word| {
            !matches!(
                word.as_str(),
                "a" | "an"
                    | "and"
                    | "at"
                    | "around"
                    | "by"
                    | "can"
                    | "could"
                    | "did"
                    | "do"
                    | "find"
                    | "for"
                    | "friend"
                    | "friends"
                    | "from"
                    | "guy"
                    | "girl"
                    | "had"
                    | "hang"
                    | "hung"
                    | "i"
                    | "in"
                    | "it"
                    | "me"
                    | "met"
                    | "my"
                    | "of"
                    | "on"
                    | "out"
                    | "person"
                    | "people"
                    | "please"
                    | "s"
                    | "someone"
                    | "spent"
                    | "that"
                    | "the"
                    | "there"
                    | "time"
                    | "to"
                    | "together"
                    | "was"
                    | "we"
                    | "were"
                    | "who"
                    | "with"
                    | "you"
                    | "your"
                    | "booth"
                    | "stand"
                    | "zone"
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bandit_bindings::{Attendee, Booth, Zone};

    fn at(seconds: i64) -> Timestamp {
        Timestamp::from_micros_since_unix_epoch(seconds * 1_000_000)
    }
    fn who(n: u64) -> Identity {
        let mut bytes = [0; 32];
        bytes[..8].copy_from_slice(&n.to_le_bytes());
        Identity::from_byte_array(bytes)
    }
    fn attendee(n: u64, name: &str) -> Attendee {
        Attendee {
            identity: who(n),
            node_id: n,
            display_name: name.into(),
            photo_url: String::new(),
            findable: true,
            person_id: 0,
            organization_id: 0,
            crowd: false,
            created_at: at(0),
            updated_at: at(0),
        }
    }
    fn zone(id: u64, name: &str) -> Zone {
        Zone {
            id,
            source_key: String::new(),
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
    fn booth(id: u64, name: &str) -> Booth {
        Booth {
            id,
            source_key: String::new(),
            venue_id: 1,
            zone_id: 1,
            organization_id: 0,
            booth_number: String::new(),
            name: name.into(),
            kind: "sponsor".into(),
            description: "Augmented reality headsets".into(),
            tags: vec!["wearable displays".into()],
            plan_x_m: 0.0,
            plan_y_m: 0.0,
            placement: String::new(),
            source_url: String::new(),
            fetched_at: at(0),
            updated_at: at(0),
        }
    }
    fn encounter(id: u64, a: u64, b: u64, seconds: u32) -> SocialEncounter {
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
            updated_at: at(100 + seconds as i64),
        }
    }
    fn visit(id: u64, owner: u64, booth_id: u64, start: i64, end: i64) -> Visit {
        Visit {
            zone_visit_id: id,
            attendee: who(owner),
            zone_id: 1,
            band_id: owner as u32,
            started_at: at(start),
            ended_at: Some(at(end)),
            minutes: (end - start) as f32 / 60.0,
            updated_at: at(end),
            booth_id,
            open: false,
        }
    }
    fn rows() -> Rows {
        Rows {
            zones: vec![zone(1, "Expo"), zone(2, "Stage")],
            booths: vec![booth(11, "Meta booth"), booth(12, "Metal lab")],
            attendees: vec![
                attendee(1, "Jordan Alvarez"),
                attendee(2, "Maya Chen"),
                attendee(3, "Sam Patel"),
            ],
            handles: Vec::new(),
            visits: vec![visit(1, 1, 11, 100, 700), visit(2, 2, 11, 220, 820)],
            encounters: vec![encounter(1, 1, 2, 600), encounter(2, 1, 3, 900)],
            shared_visits: Vec::new(),
            photos: Vec::new(),
            photo_tags: Vec::new(),
        }
    }
    fn result(rows: &Rows, query: &str) -> FriendSearch {
        finish(query.into(), prepare(rows, who(1), query).unwrap(), None)
    }

    #[test]
    fn only_requesters_findable_met_connections_qualify() {
        let mut rows = rows();
        rows.attendees.push(attendee(4, "Ari Ramos"));
        rows.encounters.push(encounter(3, 2, 4, 300));
        rows.attendees
            .iter_mut()
            .find(|a| a.node_id == 2)
            .unwrap()
            .findable = false;
        rows.encounters[1].met = false;
        assert!(
            prepare(&rows, who(1), "friends")
                .unwrap()
                .candidates
                .is_empty()
        );
        assert!(prepare(&rows, who(99), "friends").is_none());
        assert_eq!(
            prepare(&rows, who(2), "friends").unwrap().candidates.len(),
            2
        );
    }

    #[test]
    fn booth_query_requires_actual_same_time_same_booth_visits_even_for_crowd() {
        let mut rows = rows();
        rows.attendees[1].crowd = true;
        let search = result(&rows, "the guy I hung out with at the Meta booth");
        assert_eq!(search.people.len(), 1);
        assert_eq!(search.people[0].node_id, 2);
        assert_eq!(search.people[0].places[0].kind, "shared_booth");
        assert_eq!(search.people[0].places[0].minutes, 8.0);
        assert!(
            search.people[0]
                .reason
                .contains("visits at Meta booth overlap")
        );
        assert!(!search.people[0].reason.contains("met at Meta"));
        assert!(rows.shared_visits.is_empty());
        rows.visits[1] = visit(2, 2, 11, 800, 1_400);
        assert!(result(&rows, "Meta").people.is_empty());
    }

    #[test]
    fn zone_overlap_and_separate_interest_do_not_prove_a_booth() {
        let mut rows = rows();
        rows.visits[1].booth_id = 0;
        assert!(result(&rows, "Meta").people.is_empty());
        let search = result(&rows, "Expo");
        assert!(
            search
                .people
                .iter()
                .find(|p| p.node_id == 2)
                .unwrap()
                .places
                .iter()
                .any(|p| p.kind == "shared_zone")
        );
        rows.visits[1].booth_id = 12;
        assert!(result(&rows, "Meta").people.is_empty());
        assert!(result(&rows, "Metal lab").people.is_empty());
    }

    #[test]
    fn open_visits_stop_at_last_observation_and_unknown_zones_stay_unknown() {
        let mut rows = rows();
        rows.visits[1].ended_at = None;
        rows.visits[1].open = true;
        rows.visits[1].updated_at = at(280);
        assert_eq!(result(&rows, "Meta").people[0].places[0].minutes, 1.0);
        rows.encounters[0].zone_id = 0;
        rows.visits.clear();
        let search = result(&rows, "Maya Chen");
        assert_eq!(search.people.len(), 1);
        assert!(search.people[0].places.is_empty());
        assert_eq!(
            search.people[0].reason,
            "Your bands recorded 10.0 minutes close together."
        );
    }

    #[test]
    fn initial_encounter_zone_does_not_claim_all_minutes_there() {
        let search = result(&rows(), "Sam Patel");
        let person = &search.people[0];
        assert_eq!(person.minutes, 15.0);
        assert_eq!(person.places[0].minutes, 0.0);
        assert!(
            person
                .reason
                .contains("A recorded encounter started in Expo")
        );
    }

    #[test]
    fn scores_cannot_add_people_or_duplicate_results() {
        let prepared = prepare(&rows(), who(1), "friends").unwrap();
        let search = finish(
            "friends".into(),
            prepared,
            Some(&[(99, 9.0), (0, 1.0), (0, 3.0), (1, f64::NAN)]),
        );
        assert_eq!(search.people.len(), 1);
        assert_eq!(search.people[0].node_id, 3);
        assert!(search.semantic_ranked);
    }

    #[test]
    fn outage_fallback_uses_names_and_places_without_guessing_from_descriptions() {
        let search = result(&rows(), "Maya");
        assert_eq!(search.people[0].node_id, 2);
        assert!(!search.semantic_ranked);
        assert!(result(&rows(), "augmented reality").people.is_empty());
        assert!(result(&rows(), "the guy I met").people.is_empty());
        let prepared = prepare(&rows(), who(1), "augmented reality").unwrap();
        assert!(
            prepared
                .candidates
                .iter()
                .any(|c| c.text.contains("Augmented reality headsets"))
        );
    }

    #[test]
    fn exact_meta_and_full_name_constraints_precede_a_retrieval_window() {
        let mut rows = rows();
        for n in 10..160 {
            rows.attendees
                .push(attendee(n, &format!("Person Number{n}")));
            rows.encounters.push(encounter(n, 1, n, 50_000));
        }
        let prepared = prepare(&rows, who(1), "the person at Meta").unwrap();
        assert_eq!(prepared.candidate_count, 1);
        assert_eq!(prepared.candidates[0].person.node_id, 2);
        let mut prepared = prepare(&rows, who(1), "Maya Chen").unwrap();
        assert_eq!(prepared.candidate_count, 1);
        prepared.candidates.truncate(100);
        let search = finish("Maya Chen".into(), prepared, Some(&[(0, 0.5)]));
        assert_eq!(search.candidate_count, 1);
        assert_eq!(search.searched_count, 1);
    }

    #[test]
    fn meta_does_not_match_metal_and_duplicate_visit_pairs_are_not_repeated() {
        assert!(!mentions_place(&words("at Metal lab"), "Meta"));
        let mut rows = rows();
        rows.visits.push(rows.visits[1].clone());
        let search = result(&rows, "Meta");
        assert_eq!(
            search.people[0]
                .places
                .iter()
                .filter(|p| p.kind == "shared_booth")
                .count(),
            1
        );
    }

    #[test]
    fn duplicate_place_names_are_alternatives_but_distinct_names_are_constraints() {
        let mut rows = rows();
        rows.booths.push(booth(13, "META"));
        rows.zones.push(zone(3, "Expo"));
        assert_eq!(result(&rows, "Meta booth at Expo").people.len(), 1);
        assert!(result(&rows, "Meta and Metal lab").people.is_empty());
    }

    #[test]
    fn longest_place_phrase_wins_but_separate_shorter_mentions_still_constrain() {
        let mut rows = rows();
        rows.booths.push(booth(13, "Meta AI booth"));
        rows.visits = vec![visit(1, 1, 13, 100, 700), visit(2, 2, 13, 220, 820)];
        assert_eq!(result(&rows, "at Meta AI booth").people.len(), 1);
        assert!(result(&rows, "Meta and Meta AI").people.is_empty());
        rows.visits
            .extend([visit(3, 1, 11, 1_000, 1_400), visit(4, 2, 11, 1_100, 1_500)]);
        assert_eq!(result(&rows, "Meta and Meta AI").people.len(), 1);
        // A shorter zone name cannot override the explicitly named booth either.
        rows.zones.push(zone(3, "Meta"));
        assert_eq!(result(&rows, "at Meta AI booth").people.len(), 1);
    }
}
