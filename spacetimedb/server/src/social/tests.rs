//! A photo in an in-memory module: the bands in its zone are tagged, Claude's count cuts the tags to the
//! people who stood together when it was taken, and its caption fills in for the photographer's.

use super::photos::*;
use super::tables::*;
use crate::jobs::*;
use crate::roles::*;
use crate::tables::*;
use crate::venue::*;
use spacetimedb::test_utils::{TestAuth, TestContext};
use spacetimedb::{ConnectionId, Identity, ReducerContext, Table, TimeDuration, Timestamp};

const STATION: u8 = 103;
const HASH: &str = "4f8b0c8e1a2d3c4b5a69788766554433221100ffeeddccbbaa99887766554433";

fn id(name: &str) -> Identity {
    Identity::from_claims("bandit-test", name)
}

fn auth(name: &str) -> TestAuth {
    let payload = format!(r#"{{"iss":"bandit-test","sub":"{name}"}}"#);
    TestAuth::from_jwt_payload(payload, ConnectionId::from_u128(name.len() as u128 + 1)).unwrap()
}

fn band(id: u8) -> Band {
    Band {
        id: id.into(),
        state: 0,
        flags: 0,
        neigh: 4,
        zone: STATION,
        bat: 90,
        find: 0,
        rssi: -60,
        seq: 1,
        sos: false,
        fall: false,
        pressed: false,
        low_battery: false,
        has_mpu: false,
        has_motor: false,
        online: true,
        last_seen: Timestamp::from_micros_since_unix_epoch(0),
        x_m: 0.0,
        y_m: 0.0,
        booth_id: 0,
    }
}

struct World {
    t: TestContext,
    zone: u64,
}

impl World {
    /// Four attendees on bands 1 to 4 in the sponsor row: Ana arrived first, then Ben, Cleo and Dev.
    fn new() -> Self {
        let t = TestContext::new().unwrap();
        t.clock.set(Timestamp::from_micros_since_unix_epoch(1_792_900_000_000_000));
        t.db.owner().insert(Owner { identity: id("owner") });
        for role in ["worker", "ops"] {
            t.db.staff_role().insert(StaffRole { id: 0, identity: id(role), role: role.into(), label: role.into(), granted_by: id("owner"), granted_at: t.clock.now() });
        }
        let zone = t
            .db
            .zone()
            .insert(Zone {
                id: 0,
                source_key: "zone:sponsor-row".into(),
                venue_id: 1,
                name: "Sponsor row".into(),
                kind: "floor".into(),
                station_id: STATION,
                plan_x_m: 0.0,
                plan_y_m: 0.0,
                area_sq_m: 100.0,
                capacity: 100,
                exit_colour: 0,
                description: String::new(),
                updated_at: t.clock.now(),
            })
            .id;
        for (n, name) in ["Ana", "Ben", "Cleo", "Dev"].into_iter().enumerate() {
            let band_id = n as u8 + 1;
            t.db.band().insert(band(band_id));
            t.db.band_owner().insert(BandOwner { band_id, owner: id(name), claimed_at: t.clock.now() });
            t.db.attendee().insert(Attendee {
                identity: id(name),
                node_id: 0,
                display_name: name.into(),
                photo_url: String::new(),
                findable: true,
                person_id: 0,
                organization_id: 0,
                crowd: false,
                created_at: t.clock.now(),
                updated_at: t.clock.now(),
            });
            t.db.zone_visit().insert(ZoneVisit { id: 0, band_id: band_id.into(), zone: STATION, entered: t.clock.now(), left: None, booth_id: 0, open: true });
            t.clock.advance(TimeDuration::from_micros(60_000_000));
        }
        t.db.blob_ref().insert(BlobRef {
            id: 0,
            hash: HASH.into(),
            owner: None,
            access: "shared".into(),
            purpose: "photo".into(),
            content_type: "image/jpeg".into(),
            size_bytes: 1000,
            created_by: id("ops"),
            created_at: t.clock.now(),
        });
        World { t, zone }
    }

    fn as_<T>(&self, who: &str, f: impl FnOnce(&ReducerContext) -> Result<T, String>) -> T {
        self.t.with_reducer_tx(auth(who), f).unwrap()
    }

    /// Bands `a` and `b` heard each other up close until `ago_secs` seconds ago.
    fn close(&self, a: u32, b: u32, ago_secs: i64) {
        let now = self.t.clock.now().to_micros_since_unix_epoch();
        self.t.db.encounter().insert(Encounter {
            key: pair_key(a, b),
            band_a: a.min(b),
            band_b: a.max(b),
            first_seen: Timestamp::from_micros_since_unix_epoch(now - 600_000_000),
            last_seen: Timestamp::from_micros_since_unix_epoch(now - ago_secs * 1_000_000),
            seconds_close: 300,
            best_rssi: -50,
        });
    }

    fn tagged(&self, photo_id: u64) -> Vec<String> {
        let mut tags: Vec<PhotoTag> = self.t.db.photo_tag().photo_id().filter(photo_id).collect();
        tags.sort_by_key(|t| t.id);
        tags.into_iter().map(|t| self.t.db.attendee().identity().find(t.attendee).unwrap().display_name).collect()
    }
}

#[test]
fn claude_counts_the_people_and_the_tags_keep_the_ones_standing_together() {
    let w = World::new();
    // Ben stood with Cleo and Dev when the photo was taken; Ana and Ben talked an hour ago.
    w.close(2, 3, 5);
    w.close(2, 4, 10);
    w.close(1, 2, 3600);
    let at = w.t.clock.now();
    w.as_("ops", |ctx| register_photo(ctx, format!("/blobs/{HASH}"), at, w.zone, String::new()));
    let photo = w.t.db.photo().iter().next().unwrap();
    assert_eq!(w.tagged(photo.id), ["Ben", "Cleo", "Dev", "Ana"], "the group first, then who arrived first");

    let job = w.t.db.job().kind().filter(KIND_PHOTO_FEATURES).next().expect("the photo goes to Claude");
    let payload: serde_json::Value = serde_json::from_str(&job.payload).unwrap();
    assert_eq!((payload["photo_id"].as_u64(), payload["blob_hash"].as_str(), payload["zone"].as_str()), (Some(photo.id), Some(HASH), Some("Sponsor row")));

    w.as_("worker", |ctx| claim_job(ctx, job.id));
    let call = ModelCallIn { kind: KIND_PHOTO_FEATURES.into(), status: "ok".into(), ..Default::default() };
    assert!(w.t.with_reducer_tx(auth("Ana"), |ctx| submit_photo_features(ctx, job.id, 3, "x".into(), call.clone())).is_err());
    w.as_("worker", |ctx| submit_photo_features(ctx, job.id, 3, "  Three hackers trading stickers at the sponsor row ".into(), call));

    let photo = w.t.db.photo().id().find(photo.id).unwrap();
    assert_eq!(w.tagged(photo.id), ["Ben", "Cleo", "Dev"]);
    assert_eq!((photo.people_count, photo.caption.as_str()), (3, "Three hackers trading stickers at the sponsor row"));
    assert_ne!(photo.features_call_id, 0);
    assert_eq!(w.t.db.job().id().find(job.id).unwrap().status, JobStatus::Done);
}

#[test]
fn the_photographers_caption_stays_and_a_photo_without_people_has_no_tags() {
    let w = World::new();
    let at = w.t.clock.now();
    w.as_("ops", |ctx| register_photo(ctx, format!("/blobs/{HASH}"), at, w.zone, "At the Elastic booth".into()));
    w.as_("ops", |ctx| register_photo(ctx, "/photos/not-in-the-blob-store.jpg".into(), at, w.zone, String::new()));
    assert_eq!(w.t.db.job().kind().filter(KIND_PHOTO_FEATURES).count(), 1, "only photos in the blob store go to Claude");
    let job = w.t.db.job().kind().filter(KIND_PHOTO_FEATURES).next().unwrap();
    w.as_("worker", |ctx| claim_job(ctx, job.id));
    w.as_("worker", |ctx| submit_photo_features(ctx, job.id, 0, "An empty booth".into(), ModelCallIn::default()));
    let photo = w.t.db.photo().id().find(job.subject_id).unwrap();
    assert_eq!(photo.caption, "At the Elastic booth");
    assert!(w.tagged(photo.id).is_empty());
}
