use spacetimedb::{Identity, SpacetimeType, Timestamp};

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Fact {
    pub label: String,
    pub value: String,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct SectionCount {
    pub section: String,
    pub inserted: u32,
    pub updated: u32,
}

#[derive(Clone, PartialEq)]
#[spacetimedb::table(accessor = venue, public)]
pub struct Venue {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    pub name: String,
    pub venue_name: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub website: String,
    pub timezone: String,
    pub starts_at: Option<Timestamp>,
    pub ends_at: Option<Timestamp>,
    pub description: String,
    pub facts: Vec<Fact>,
    pub source_url: String,
    pub fetched_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Clone, PartialEq)]
#[spacetimedb::table(accessor = zone, public)]
pub struct Zone {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    #[index(btree)]
    pub venue_id: u64,
    pub name: String,
    pub kind: String,
    #[index(btree)]
    pub station_id: u8,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub area_sq_m: f32,
    pub capacity: u32,
    pub exit_colour: u8,
    pub description: String,
    pub updated_at: Timestamp,
}

#[derive(Clone, PartialEq)]
#[spacetimedb::table(accessor = organization, public)]
pub struct Organization {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    #[index(btree)]
    pub venue_id: u64,
    pub name: String,
    pub kind: String,
    pub sponsor_tier: String,
    pub website: String,
    pub domain: String,
    pub logo_url: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub industry: String,
    pub headquarters: String,
    pub size_range: String,
    pub founded_year: u32,
    pub linkedin_url: String,
    pub prizes: Vec<String>,
    pub source_url: String,
    pub fetched_at: Timestamp,
    pub updated_at: Timestamp,
    #[default("")]
    pub crunchbase_url: String,
    #[default("")]
    pub funding_summary: String,
}

#[derive(Clone, PartialEq)]
#[spacetimedb::table(accessor = booth, public)]
pub struct Booth {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    #[index(btree)]
    pub venue_id: u64,
    #[index(btree)]
    pub zone_id: u64,
    #[index(btree)]
    pub organization_id: u64,
    pub booth_number: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub tags: Vec<String>,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub placement: String,
    pub source_url: String,
    pub fetched_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Clone, PartialEq)]
#[spacetimedb::table(accessor = schedule_slot, public)]
pub struct ScheduleSlot {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    #[index(btree)]
    pub venue_id: u64,
    pub title: String,
    pub kind: String,
    pub description: String,
    pub location_text: String,
    #[index(btree)]
    pub zone_id: u64,
    #[index(btree)]
    pub booth_id: u64,
    pub host_organization_id: u64,
    pub speaker_person_ids: Vec<u64>,
    pub starts_at: Timestamp,
    pub ends_at: Option<Timestamp>,
    pub source_url: String,
    pub fetched_at: Timestamp,
    pub updated_at: Timestamp,
}

#[derive(Clone, PartialEq)]
#[spacetimedb::table(accessor = person, public)]
pub struct Person {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub source_key: String,
    #[index(btree)]
    pub venue_id: u64,
    pub display_name: String,
    pub kind: String,
    pub role: String,
    pub title: String,
    #[index(btree)]
    pub organization_id: u64,
    pub bio: String,
    pub headshot_url: String,
    pub links: Vec<String>,
    pub source_url: String,
    pub fetched_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = import_run, public)]
pub struct ImportRun {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub run_id: String,
    pub venue_id: u64,
    pub organizer: String,
    pub bundle_hash: String,
    pub imported_by: Identity,
    pub imported_at: Timestamp,
    pub counts: Vec<SectionCount>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct VenueIn {
    pub source_key: String,
    pub name: String,
    pub venue_name: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub website: String,
    pub timezone: String,
    pub starts_at: Option<Timestamp>,
    pub ends_at: Option<Timestamp>,
    pub description: String,
    pub facts: Vec<Fact>,
    pub source_url: String,
    pub fetched_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ZoneIn {
    pub source_key: String,
    pub name: String,
    pub kind: String,
    pub station_id: u8,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub area_sq_m: f32,
    pub capacity: u32,
    pub exit_colour: u8,
    pub description: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct OrganizationIn {
    pub source_key: String,
    pub name: String,
    pub kind: String,
    pub sponsor_tier: String,
    pub website: String,
    pub domain: String,
    pub logo_url: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub industry: String,
    pub headquarters: String,
    pub size_range: String,
    pub founded_year: u32,
    pub linkedin_url: String,
    pub prizes: Vec<String>,
    pub crunchbase_url: String,
    pub funding_summary: String,
    pub source_url: String,
    pub fetched_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct BoothIn {
    pub source_key: String,
    pub zone_key: String,
    pub organization_key: String,
    pub booth_number: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub tags: Vec<String>,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub placement: String,
    pub source_url: String,
    pub fetched_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ScheduleSlotIn {
    pub source_key: String,
    pub title: String,
    pub kind: String,
    pub description: String,
    pub location_text: String,
    pub zone_key: String,
    pub booth_key: String,
    pub host_organization_key: String,
    pub speaker_keys: Vec<String>,
    pub starts_at: Timestamp,
    pub ends_at: Option<Timestamp>,
    pub source_url: String,
    pub fetched_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct PersonIn {
    pub source_key: String,
    pub display_name: String,
    pub kind: String,
    pub role: String,
    pub title: String,
    pub organization_key: String,
    pub bio: String,
    pub headshot_url: String,
    pub links: Vec<String>,
    pub source_url: String,
    pub fetched_at: Timestamp,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct EventBundle {
    pub run_id: String,
    pub organizer: String,
    pub bundle_hash: String,
    pub venue: VenueIn,
    pub zones: Vec<ZoneIn>,
    pub organizations: Vec<OrganizationIn>,
    pub people: Vec<PersonIn>,
    pub booths: Vec<BoothIn>,
    pub schedule: Vec<ScheduleSlotIn>,
}
