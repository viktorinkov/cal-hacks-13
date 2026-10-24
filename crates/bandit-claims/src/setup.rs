//! `setup` and `status`: the actors, the venue, the bands, the policy and the camera.

use crate::app::*;
use crate::sim::{Pose, SIM_BANDS, Sim};
use anyhow::{Context, Result, bail};
use bandit_bindings::*;
use hyphenate_core::time::{civil_from_days, local_date, micros_at, parse_date};
use spacetimedb_sdk::{DbContext, Identity, Table, Timestamp};
use std::collections::HashMap;

pub const POLICY: &str = "GL-2026-04417";

/// Creates every actor and the test world. Safe to run again: every step is an
/// upsert. Never touches the hardware bridge or real bands: only the
/// simulated bands 90-99. Returns the running simulator, so a story run keeps the
/// bands online.
pub fn run(app: &App) -> Result<Sim> {
    let db = app.db()?;
    println!("server     {}  database {}", app.uri, app.database);
    println!("owner      {}", short_id(db.identity()));

    let mut ids: HashMap<&str, Identity> = HashMap::new();
    let names = STAFF.iter().map(|s| s.0).chain(ATTENDEES.iter().map(|a| a.0));
    for name in names {
        ids.insert(name, identity_of(app, name, true)?);
    }
    for (name, role, label) in STAFF {
        call!(db, grant_role_then(ids[name], role.to_string(), label.to_string()))?;
        println!("{name:<10} {}  {role} ({label})", short_id(ids[name]));
    }

    if let Some(v) = db.db.venue().iter().next() {
        println!("venue      {} already imported; keeping it", v.name);
    } else {
        let ops = app.actor("ops")?;
        let mut bundle = venue_bundle()?;
        bundle.bundle_hash = bandit_common::sha256_hex(format!("{bundle:?}").as_bytes());
        call!(ops, import_event_then(bundle))?;
        until(5.0, || (db.db.zone().count() >= 5).then_some(())).context("the venue import left no zones")?;
        println!("venue      Cal Hacks 13.0 imported, live showcases running on Main stage");
    }
    let zones = app.stationed_zones()?;
    let list: Vec<String> = zones.iter().map(|z| format!("{} {}", z.name, z.station_id)).collect();
    println!("zones      {}", list.join(", "));
    let main = app.zone_by_name(MAIN_STAGE)?;
    app.station(MAIN_STAGE)?;
    call!(db, start_safety_watch_then())?;
    call!(db, start_job_reaper_then())?;
    println!("watch      safety watch (500 ms) and job reaper (10 s) started");

    let dana = app.actor("dana")?;
    let (start, end) = this_month(app.tz())?;
    call!(dana, upsert_insurance_policy_then(POLICY.into(), "Northwind Mutual".into(), "claims@northwind.test".into(), start, end))?;
    call!(
        dana,
        upsert_coverage_rule_then(
            POLICY.into(),
            "medical_payments".into(),
            vec!["sos".into(), "fall".into()],
            500_000,
            2_500_000,
            0,
            365,
            true
        )
    )?;
    call!(
        dana,
        upsert_coverage_rule_then(POLICY.into(), "property".into(), vec!["property".into()], 1_000_000, 5_000_000, 50_000, 0, true)
    )?;
    call!(dana, set_authority_limit_then("floor_manager".into(), 1, Some(50_000), Some(ids["sam"]), "Sam Okafor".into()))?;
    call!(dana, set_authority_limit_then("risk_manager".into(), 2, Some(500_000), Some(ids["dana"]), "Dana Ruiz".into()))?;
    call!(dana, set_authority_limit_then("adjuster".into(), 3, None, Some(ids["priya"]), "Priya Nair".into()))?;
    let tz = app.tz();
    println!(
        "policy     {POLICY} Northwind Mutual (claims@northwind.test), {} to {}",
        local_date(micros(start), tz),
        local_date(micros(end) - 1, tz)
    );
    println!("cover      medical_payments (sos, fall): $5,000.00 per claim, $25,000.00 aggregate, $0.00 deductible, 365 days");
    println!("cover      property: $10,000.00 per claim, $50,000.00 aggregate, $500.00 deductible");
    println!("authority  floor_manager $500.00 Sam Okafor, risk_manager $5,000.00 Dana Ruiz, adjuster no limit Priya Nair");

    let vision = app.actor("vision")?;
    call!(vision, upsert_camera_then("overhead pit".into(), main.id, "overhead".into()))?;
    println!("camera     overhead pit on Main stage");

    let sim = Sim::open(app)?;
    let missing: Vec<(u8, Pose)> = SIM_BANDS.filter(|b| sim.pose(*b).is_none()).map(|b| (b, Pose::at(main.station_id))).collect();
    sim.place(&missing);
    sleep_ms(800);
    println!("bands      {}-{} simulated and online (new ones at Main stage)", SIM_BANDS.start(), SIM_BANDS.end());

    for (name, display, band) in ATTENDEES {
        ensure_attendee(app, &sim, name, display, *band)?;
        println!("{name:<10} {}  attendee {display}, band {band}", short_id(ids[name]));
    }
    println!("tokens     {}", app.tokens().dir().display());
    Ok(sim)
}

/// The identity behind a token. `sim` gets a short-lived connection, so the
/// simulator pump stays the only `sim` connection in the process.
fn identity_of(app: &App, name: &str, create: bool) -> Result<Identity> {
    if name != "sim" {
        return Ok(app.actor_with(name, create)?.identity());
    }
    let c = app.connect_as(name, create)?;
    let id = c.identity();
    let _ = c.disconnect();
    Ok(id)
}

/// Claims the band (NFC tap, then a press on the band within a few seconds) and sets the profile.
pub fn ensure_attendee(app: &App, sim: &Sim, name: &str, display: &str, band: u8) -> Result<Identity> {
    let conn = app.actor_with(name, true)?;
    let me = conn.identity();
    let db = app.db()?;
    match db.db.band_owner().band_id().find(&band) {
        Some(o) if o.owner == me => {}
        Some(o) => bail!("band {band} already belongs to {}; republish the local database for a clean run", app.person(o.owner)),
        None => {
            call!(conn, claim_band_then(format!("BANDIT-{band:02}")))?;
            sim.press(band);
            until(8.0, || db.db.band_owner().band_id().find(&band).filter(|o| o.owner == me))
                .with_context(|| format!("band {band} was pressed but the claim did not complete"))?;
        }
    }
    call!(conn, update_profile_then(display.to_string(), true))?;
    call!(conn, connect_wallet_then())?;
    Ok(me)
}

/// Midnight on the first of this month to midnight on the first of the next, venue time.
fn this_month(tz: i32) -> Result<(Timestamp, Timestamp)> {
    let today = local_date(now_micros(), tz);
    let days = parse_date(&today).context("today's date")?;
    let (y, m, _) = civil_from_days(days);
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let at = |y, m| Timestamp::from_micros_since_unix_epoch(micros_at(y, m, 1, 0, 0, 0, tz));
    Ok((at(y, m), at(ny, nm)))
}

/// The venue bundle, imported only when the database has no venue yet: the
/// five CalHacks zones with the pipeline's stations, two booths and one
/// schedule slot running now on Main stage.
fn venue_bundle() -> Result<EventBundle> {
    let tz = hyphenate_core::config::Config::default().tz_offset_minutes;
    let ts = Timestamp::from_micros_since_unix_epoch;
    let today = parse_date(&local_date(now_micros(), tz)).context("today's date")?;
    let (y, m, d) = civil_from_days(today);
    let midnight = micros_at(y, m, d, 0, 0, 0, tz);
    let hour = 3_600_000_000i64;
    let slot_start = now_micros() / hour * hour - hour;
    let zone = |key: &str, name: &str, kind: &str, station: u8, x: f32, area: f32, capacity: u32, exit: u8, description: &str| ZoneIn {
        source_key: key.into(),
        name: name.into(),
        kind: kind.into(),
        station_id: station,
        plan_x_m: x,
        plan_y_m: 0.0,
        area_sq_m: area,
        capacity,
        exit_colour: exit,
        description: description.into(),
    };
    let booth = |key: &str, zone_key: &str, number: &str, name: &str, kind: &str, description: &str| BoothIn {
        source_key: key.into(),
        zone_key: zone_key.into(),
        organization_key: String::new(),
        booth_number: number.into(),
        name: name.into(),
        kind: kind.into(),
        description: description.into(),
        tags: Vec::new(),
        plan_x_m: 0.0,
        plan_y_m: 0.0,
        placement: "import".into(),
        source_url: String::new(),
        fetched_at: ts(midnight),
    };
    Ok(EventBundle {
        run_id: "bandit-claims-setup".into(),
        organizer: "Cal Hacks".into(),
        bundle_hash: String::new(),
        venue: VenueIn {
            source_key: "cal-hacks-13".into(),
            name: "Cal Hacks 13.0".into(),
            venue_name: "Cal Hacks 13.0 venue".into(),
            address: String::new(),
            latitude: 0.0,
            longitude: 0.0,
            website: String::new(),
            timezone: "America/Los_Angeles".into(),
            starts_at: Some(ts(midnight - 12 * hour)),
            ends_at: Some(ts(midnight + 60 * hour)),
            description: "Hackathon venue for BandIt".into(),
            facts: Vec::new(),
            source_url: String::new(),
            fetched_at: ts(midnight),
        },
        zones: vec![
            zone("zone-entrance", "Entrance", "entrance", 101, 0.0, 400.0, 500, 1, "Check-in and the main doors"),
            zone("zone-hacking-floor", "Hacking floor", "hall", 102, 40.0, 2000.0, 1500, 2, "Tables, power and the hardware lab"),
            zone("zone-sponsor-row", "Sponsor row", "hall", 103, 80.0, 1200.0, 800, 3, "Sponsor booths along both walls"),
            zone("zone-main-stage", "Main stage", "stage", 104, 120.0, 900.0, 1200, 4, "The stage and the standing pit in front of it"),
            zone("zone-food", "Food and drinks", "food", 105, 160.0, 600.0, 400, 5, "Food trucks and the drinks bar"),
        ],
        organizations: Vec::new(),
        people: Vec::new(),
        booths: vec![
            booth("booth-medical", "zone-main-stage", "M1", "Event medical station", "medical", "First aid, staffed all night"),
            booth("booth-hardware-lab", "zone-hacking-floor", "H4", "Hardware lab", "lab", "Soldering irons, 3D printers and parts"),
        ],
        schedule: vec![ScheduleSlotIn {
            source_key: "slot-live-showcases".into(),
            title: "Live hardware showcase".into(),
            kind: "show".into(),
            description: "Teams show their hardware on the main stage".into(),
            location_text: "Main stage".into(),
            zone_key: "zone-main-stage".into(),
            booth_key: String::new(),
            host_organization_key: String::new(),
            speaker_keys: Vec::new(),
            starts_at: ts(slot_start),
            ends_at: Some(ts(slot_start + 8 * hour)),
            source_url: String::new(),
            fetched_at: ts(midnight),
        }],
    })
}

/// Identities, roles, and whether a worker is leasing jobs.
pub fn status(app: &App) -> Result<()> {
    let db = app.db()?;
    println!("server     {}  database {}", app.uri, app.database);
    println!("owner      {}", short_id(db.identity()));
    let store = app.tokens();
    let names = STAFF.iter().map(|s| s.0).chain(ATTENDEES.iter().map(|a| a.0));
    for name in names {
        if store.load(name)?.is_none() {
            println!("{name:<10} (no identity yet)");
            continue;
        }
        let id = identity_of(app, name, false)?;
        let mut what: Vec<String> =
            db.db.staff_role().iter().filter(|r| r.identity == id).map(|r| format!("{} ({})", r.role, r.label)).collect();
        if let Some(a) = db.db.attendee().identity().find(&id) {
            let band = db.db.band_owner().owner().find(&id).map(|o| format!(", band {}", o.band_id)).unwrap_or_default();
            what.push(format!("attendee {}{band}", a.display_name));
        }
        if what.is_empty() {
            what.push("no role yet; run setup".into());
        }
        println!("{name:<10} {}  {}", short_id(id), what.join("; "));
    }
    let jobs: Vec<Job> = db.db.job().iter().collect();
    let count = |s: JobStatus| jobs.iter().filter(|j| j.status == s).count();
    let now = now_micros();
    let recent =
        jobs.iter().filter(|j| j.status == JobStatus::Leased || (j.attempts > 0 && now - micros(j.updated_at) < 60_000_000)).count();
    if recent > 0 {
        println!("worker     running: {recent} jobs leased in the last minute");
    } else {
        println!("worker     not seen: no job leased in the last minute");
    }
    let mut queued: Vec<String> = Vec::new();
    for j in jobs.iter().filter(|j| j.status == JobStatus::Queued) {
        queued.push(format!("{} #{} ({})", j.kind, j.id, if j.attempts > 0 { format!("retry {}", j.attempts) } else { "new".into() }));
    }
    println!(
        "jobs       {} queued, {} leased, {} done, {} dead{}",
        count(JobStatus::Queued),
        count(JobStatus::Leased),
        count(JobStatus::Done),
        count(JobStatus::Dead),
        if queued.is_empty() { String::new() } else { format!(": {}", queued.join(", ")) }
    );
    let claims: Vec<Claim> = db.db.claim().iter().collect();
    let mut by: Vec<(&str, usize)> = Vec::new();
    for c in &claims {
        let s = status_name(c.status);
        match by.iter_mut().find(|(n, _)| *n == s) {
            Some(e) => e.1 += 1,
            None => by.push((s, 1)),
        }
    }
    let by: Vec<String> = by.iter().map(|(s, n)| format!("{n} {s}")).collect();
    println!("claims     {}{}", claims.len(), if by.is_empty() { String::new() } else { format!(" ({})", by.join(", ")) });
    let on = |n: u64| if n > 0 { "on" } else { "off" };
    println!("timers     safety watch {}, job reaper {}", on(db.db.incident_watch_timer().count()), on(db.db.job_reaper_timer().count()));
    let online = db.db.band().iter().filter(|b| b.online).count();
    println!("bands      {} known, {online} online", db.db.band().count());
    Ok(())
}
