use spacetimedb::{Identity, ScheduleAt, SpacetimeType, Timestamp};

pub const S_SOS: u8 = 3;
pub const S_OFF: u8 = 9;
pub const S_FOUND_ME: u8 = 11;

pub const F_SOS: u8 = 1;
pub const F_FALL: u8 = 2;
pub const F_PRESS: u8 = 4;
pub const F_LOWBAT: u8 = 8;
pub const F_MPU: u8 = 16;
pub const F_MOTOR: u8 = 32;

pub const BAND_ID_MAX: u8 = 99;

#[spacetimedb::table(accessor = band, public)]
pub struct Band {
    #[primary_key]
    pub id: u8,
    pub state: u8,
    pub flags: u8,
    pub neigh: u8,
    pub zone: u8,
    pub bat: u8,
    pub find: u8,
    pub rssi: i8,
    pub seq: u16,
    pub sos: bool,
    pub fall: bool,
    pub pressed: bool,
    pub low_battery: bool,
    pub has_mpu: bool,
    pub has_motor: bool,
    pub online: bool,
    pub last_seen: Timestamp,
}

#[spacetimedb::table(accessor = station, public)]
pub struct Station {
    #[primary_key]
    pub id: u8,
    pub exit_colour: u8,
    pub rssi: i8,
    pub online: bool,
    pub last_seen: Timestamp,
}

#[spacetimedb::table(accessor = link, public)]
pub struct Link {
    #[primary_key]
    pub key: u16,
    #[index(btree)]
    pub from_id: u8,
    pub to_id: u8,
    pub rssi: i8,
    pub updated: Timestamp,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    Online,
    Offline,
    Sleep,
    SosRaised,
    SosCleared,
    Fall,
    Press,
    FindStarted,
    FindEnded,
    FoundMe,
    PaymentApproved,
    PaymentDeclined,
    PaymentCompleted,
    GatewayUp,
    CommandFailed,
}

#[spacetimedb::table(accessor = event, public)]
pub struct Event {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub at: Timestamp,
    #[index(btree)]
    pub band_id: u8,
    pub kind: EventKind,
    pub detail: String,
}

#[spacetimedb::table(accessor = command, public)]
pub struct Command {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub pending: bool,
    pub target: u8,
    pub name: String,
    pub arg: u8,
    pub arg2: u8,
    pub requested_by: Identity,
    pub created: Timestamp,
    pub sent_at: Option<Timestamp>,
    pub error: Option<String>,
}

#[spacetimedb::table(accessor = settings, public)]
pub struct Settings {
    #[primary_key]
    pub id: u8,
    pub yellow: u8,
    pub red: u8,
    pub neigh_rssi: i8,
    pub circle_rssi: i8,
    pub low_vis: bool,
    pub override_density: bool,
}

#[spacetimedb::table(accessor = gateway, public)]
pub struct Gateway {
    #[primary_key]
    pub id: u8,
    pub mac: String,
    pub fw: String,
    pub online: bool,
    pub last_line: Timestamp,
}

#[spacetimedb::table(accessor = encounter, public)]
pub struct Encounter {
    #[primary_key]
    pub key: u16,
    #[index(btree)]
    pub band_a: u8,
    #[index(btree)]
    pub band_b: u8,
    pub first_seen: Timestamp,
    pub last_seen: Timestamp,
    pub seconds_close: u32,
    pub best_rssi: i8,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = zone_visit, public)]
pub struct ZoneVisit {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub band_id: u8,
    pub zone: u8,
    pub entered: Timestamp,
    pub left: Option<Timestamp>,
}

#[spacetimedb::table(accessor = bridge)]
pub struct Bridge {
    #[primary_key]
    pub identity: Identity,
    pub since: Timestamp,
}

#[spacetimedb::table(accessor = owner)]
pub struct Owner {
    #[primary_key]
    pub identity: Identity,
}

#[spacetimedb::table(accessor = sweep_timer, scheduled(crate::sweep::sweep))]
pub struct SweepTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[derive(SpacetimeType, Clone, Copy, Debug)]
pub struct BandBeacon {
    pub id: u8,
    pub rssi: i8,
    pub flags: u8,
    pub neigh: u8,
    pub zone: u8,
    pub bat: u8,
    pub state: u8,
    pub seq: u16,
    pub find: u8,
}

#[derive(SpacetimeType, Clone, Copy, Debug)]
pub struct HeardEntry {
    pub id: u8,
    pub rssi: i8,
}

pub fn pair_key(a: u8, b: u8) -> u16 {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    ((lo as u16) << 8) | hi as u16
}

pub fn micros(t: Timestamp) -> i64 {
    t.to_micros_since_unix_epoch()
}
