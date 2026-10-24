use spacetimedb::{Identity, ScheduleAt, SpacetimeType, Timestamp};

/// One person using the attendee app, keyed by the identity of their app connection.
#[spacetimedb::table(accessor = attendee)]
#[derive(Clone, Debug, PartialEq)]
pub struct Attendee {
    #[primary_key]
    pub identity: Identity,
    /// This attendee's node id in the people graph; the graph never shows identities.
    #[unique]
    #[auto_inc]
    pub node_id: u64,
    pub display_name: String,
    pub photo_url: String,
    /// The one social consent switch: people you hung out with see your name and socials,
    /// and you appear in the people graph and in their search results.
    pub findable: bool,
    /// Pre-populated profile this attendee claimed, 0 when none.
    #[index(btree)]
    pub person_id: u64,
    /// Organisation of the claimed profile, 0 when none.
    #[index(btree)]
    pub organization_id: u64,
    /// A fake attendee wearing a simulated band, so the graph shows a crowd.
    pub simulated: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Which attendee wears which band. Separate from band1t's hardware `band` row.
#[spacetimedb::table(accessor = band_owner)]
#[derive(Clone, Debug, PartialEq)]
pub struct BandOwner {
    #[primary_key]
    pub band_id: u8,
    #[unique]
    pub owner: Identity,
    pub claimed_at: Timestamp,
}

/// A claim waiting for the press on the band, open for a few seconds after the NFC tap.
#[spacetimedb::table(accessor = band_claim)]
#[derive(Clone, Debug, PartialEq)]
pub struct BandClaim {
    #[primary_key]
    pub band_id: u8,
    #[index(btree)]
    pub claimant: Identity,
    pub started_at: Timestamp,
    pub expires_at: Timestamp,
}

/// An attendee claimed a pre-populated `person` profile (speaker, sponsor, exhibitor) after tapping their band.
#[spacetimedb::table(accessor = person_claim)]
#[derive(Clone, Debug, PartialEq)]
pub struct PersonClaim {
    #[primary_key]
    pub attendee: Identity,
    /// One claim per profile; claim_person checks before inserting.
    #[index(btree)]
    pub person_id: u64,
    pub claimed_at: Timestamp,
}

/// A social account the attendee typed in at onboarding.
#[spacetimedb::table(accessor = social_handle)]
#[derive(Clone, Debug, PartialEq)]
pub struct SocialHandle {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub owner: Identity,
    pub platform: String,
    pub handle: String,
    pub updated_at: Timestamp,
}

/// How bandit-api knows who calls it: the app registers the hash of a random token, then sends the token over HTTPS.
#[spacetimedb::table(accessor = api_session)]
#[derive(Clone, Debug, PartialEq)]
pub struct ApiSession {
    #[primary_key]
    pub token_hash: String,
    #[index(btree)]
    pub identity: Identity,
    pub created_at: Timestamp,
    pub expires_at: Timestamp,
}

/// The special link to an attendee's post-event summary. Only the hash of the token in the URL is stored.
#[spacetimedb::table(accessor = summary_link)]
#[derive(Clone, Debug, PartialEq)]
pub struct SummaryLink {
    #[primary_key]
    pub token_hash: String,
    #[index(btree)]
    pub attendee: Identity,
    pub created_at: Timestamp,
}

/// An attendee stayed in one zone long enough to count. Mirrors one band1t `zone_visit` row.
#[spacetimedb::table(accessor = visit)]
#[derive(Clone, Debug, PartialEq)]
pub struct Visit {
    #[primary_key]
    pub zone_visit_id: u64,
    #[index(btree)]
    pub attendee: Identity,
    #[index(btree)]
    pub zone_id: u64,
    pub band_id: u8,
    pub started_at: Timestamp,
    pub ended_at: Option<Timestamp>,
    pub minutes: f32,
    pub updated_at: Timestamp,
}

/// Two findable attendees whose bands heard each other up close: people who hung out together.
/// Built on band1t's `encounter` row for the band pair.
#[spacetimedb::table(accessor = social_encounter)]
#[derive(Clone, Debug, PartialEq)]
pub struct SocialEncounter {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// band1t `encounter.key` of the two bands.
    #[unique]
    pub band_pair: u16,
    /// The pair, lower identity first.
    #[index(btree)]
    pub attendee_a: Identity,
    #[index(btree)]
    pub attendee_b: Identity,
    /// Zone of attendee_a's band when tracking began, 0 when unknown.
    pub zone_id: u64,
    /// band1t seconds_close when both bands had findable owners; time before that does not count.
    pub baseline_seconds: u32,
    pub seconds_together: u32,
    pub started_at: Timestamp,
    pub last_seen_at: Timestamp,
    /// True once seconds_together passed the encounter threshold. Only met encounters are shown.
    pub met: bool,
    pub updated_at: Timestamp,
}

/// Two findable attendees stayed in the same zone at the same time.
#[spacetimedb::table(accessor = shared_visit)]
#[derive(Clone, Debug, PartialEq)]
pub struct SharedVisit {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee_a: Identity,
    #[index(btree)]
    pub attendee_b: Identity,
    #[index(btree)]
    pub zone_id: u64,
    /// Visit (zone_visit) ids, in the same order as the attendees.
    pub visit_a: u64,
    pub visit_b: u64,
    pub started_at: Timestamp,
    pub overlap_minutes: f32,
    pub updated_at: Timestamp,
}

/// One link of the people graph. Endpoints are person (attendee node id), booth (booth id) or company (organization id).
/// Only findable attendees are linked. Shared booth visits and colleagues are not stored as pairs of people:
/// they are two people linked to the same booth or company.
#[spacetimedb::table(accessor = people_link)]
#[derive(Clone, Debug, PartialEq)]
pub struct PeopleLink {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// kind:from_id:to_id, so each link is written once and then updated.
    #[unique]
    pub key: String,
    /// met, visited, works_at or exhibits.
    pub kind: String,
    pub from_kind: String,
    #[index(btree)]
    pub from_id: u64,
    pub to_kind: String,
    #[index(btree)]
    pub to_id: u64,
    /// Minutes for met and visited, 1 otherwise.
    pub weight: f32,
    /// How the link was measured: radio for met, zone for visited, profile for works_at, import for exhibits.
    pub evidence: String,
    pub updated_at: Timestamp,
}

/// One person the summary job picked as someone the attendee hung out with.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct StoryPerson {
    pub attendee: Identity,
    pub line: String,
}

/// The attendee's story of the night, written by the summary_story Claude job or by its template fallback.
#[spacetimedb::table(accessor = summary_story)]
#[derive(Clone, Debug, PartialEq)]
pub struct SummaryStory {
    #[primary_key]
    pub attendee: Identity,
    /// pending or ready.
    pub status: String,
    pub title: String,
    pub body: String,
    pub highlights: Vec<String>,
    pub people: Vec<StoryPerson>,
    /// claude or template.
    pub source: String,
    #[index(btree)]
    pub job_id: u64,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = social_tick_timer, scheduled(crate::social::tick::social_tick))]
pub struct SocialTickTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// State of one fake attendee in the simulated crowd.
#[spacetimedb::table(accessor = crowd_member)]
#[derive(Clone, Debug, PartialEq)]
pub struct CrowdMember {
    #[primary_key]
    pub band_id: u8,
    #[index(btree)]
    pub group_id: u8,
    pub station: u8,
    pub next_move_at: Timestamp,
}

#[spacetimedb::table(accessor = crowd_timer, scheduled(crate::social::crowd::crowd_tick))]
pub struct CrowdTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}
