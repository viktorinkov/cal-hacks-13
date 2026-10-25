#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::booth_in_type::BoothIn;
use super::organization_in_type::OrganizationIn;
use super::person_in_type::PersonIn;
use super::schedule_slot_in_type::ScheduleSlotIn;
use super::venue_in_type::VenueIn;
use super::zone_in_type::ZoneIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
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

impl __sdk::InModule for EventBundle {
    type Module = super::RemoteModule;
}
