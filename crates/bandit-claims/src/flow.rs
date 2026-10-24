//! The people and devices on the floor: the simulated bands reporting a fall, the
//! medic, the floor manager, the vision stub and the medical record.

use crate::app::*;
use crate::sim::{Pose, S_CIRCLE, S_FALLEN, Sim, check_bands};
use anyhow::{Context, Result, bail};
use bandit_bindings::*;
use spacetimedb_sdk::{Table, Timestamp};
use std::path::PathBuf;
use std::process::Command;

/// The subject band reports a fall in `station` while the witness bands show
/// the light circle in `witness_station`, held about 2 s so the 500 ms watch
/// sees both, then everything clears. Returns the incident the watch opened.
pub fn fall(app: &App, sim: &Sim, band: u8, station: u8, witnesses: &[u8], witness_station: u8) -> Result<Incident> {
    check_bands(&[band])?;
    check_bands(witnesses)?;
    let db = app.db()?;
    if let Some(open) = db.db.incident().iter().find(|i| i.subject_band == band && !i.resolved && i.kind != IncidentKind::Property) {
        bail!("band {band} already has open incident {}; resolve it first", open.id);
    }
    if witnesses.contains(&band) {
        bail!("band {band} cannot witness its own fall");
    }
    let before = db.db.incident().iter().map(|i| i.id).max().unwrap_or(0);
    sim.place(&[(band, Pose { station, state: S_FALLEN, fall: true, press: false })]);
    sleep_ms(600);
    let circle: Vec<(u8, Pose)> = witnesses.iter().map(|w| (*w, Pose { state: S_CIRCLE, ..Pose::at(witness_station) })).collect();
    sim.place(&circle);
    sleep_ms(1600);
    let incident = until(5.0, || db.db.incident().iter().find(|i| i.id > before && i.subject_band == band))
        .with_context(|| format!("the safety watch opened no incident for band {band}; run setup (it starts the watch)"))?;
    until(3.0, || {
        let n = db.db.incident_band().iter().filter(|r| r.incident_id == incident.id && r.role == "witness").count();
        (n >= witnesses.len()).then_some(())
    });
    let mut calm = vec![(band, Pose::at(station))];
    calm.extend(witnesses.iter().map(|w| (*w, Pose::at(witness_station))));
    sim.place(&calm);
    sleep_ms(500);
    app.incident(incident.id)
}

/// Prints the incident, its snapshot and its bands as the module recorded them.
pub fn print_incident(app: &App, id: u64) -> Result<()> {
    let db = app.db()?;
    let i = app.incident(id)?;
    let who = match db.db.band_owner().band_id().find(&i.subject_band) {
        Some(o) => format!(" ({})", app.person(o.owner)),
        None => String::new(),
    };
    let subject = if i.subject_band == 0 { "no band".to_string() } else { format!("band {}{who}", i.subject_band) };
    println!(
        "incident {}  {}  {subject}  {} (station {})  opened {} by {}",
        i.id,
        kind_name(i.kind),
        app.zone_name(i.zone_id),
        i.station_id,
        app.hms(i.opened_at),
        i.opened_by
    );
    if let Some(s) = db.db.incident_snapshot().incident_id().find(&i.id) {
        let list = |v: &[u8]| if v.is_empty() { "none".to_string() } else { v.iter().map(u8::to_string).collect::<Vec<_>>().join(",") };
        println!(
            "  snapshot  bands present {}, light circle {}, neigh mean {:.1}",
            list(&s.bands_present),
            list(&s.circle_bands),
            s.neigh_mean
        );
    }
    let mut rows: Vec<IncidentBand> = db.db.incident_band().iter().filter(|r| r.incident_id == i.id && r.role == "witness").collect();
    rows.sort_by_key(|r| r.band_id);
    if rows.is_empty() && i.kind != IncidentKind::Property {
        println!("  witnesses none");
    }
    for r in rows {
        let rssi = if r.rssi == 0 { String::new() } else { format!(", heard the subject at {} dBm", r.rssi) };
        println!("  witness   band {} in {}{rssi}, {}", r.band_id, app.zone_name(r.zone_id), app.hms(r.first_seen_at));
    }
    Ok(())
}

/// How long the medic takes to reach someone in the scripted runs.
pub const RESPONSE_SECS: u64 = 20;

/// The medic takes the incident and writes the treatment note.
pub fn treat(app: &App, incident: u64, note: &str) -> Result<()> {
    let medic = app.actor("medic")?;
    call!(medic, assign_medic_then(incident))?;
    call!(medic, add_incident_note_then(incident, note.to_string(), None))?;
    say!(app, "medic      Ari Ramos took incident {incident} and noted: {note}");
    Ok(())
}

/// Resolves the incident as `actor` and returns the claim it opened, if any.
pub fn resolve(app: &App, incident: u64, resolution: &str, actor: &str) -> Result<Option<Claim>> {
    let conn = app.actor(actor)?;
    call!(conn, resolve_incident_then(incident, resolution.to_string()))?;
    let db = app.db()?;
    let claim = until(4.0, || db.db.claim().incident_id().find(&incident).filter(|c| c.pack_version > 0));
    let who = app.person(spacetimedb_sdk::DbContext::identity(&*conn));
    match &claim {
        Some(c) => say!(
            app,
            "resolved   incident {incident} by {who}: claim {} opened for {}, {}{}",
            c.id,
            if c.claimant_name.is_empty() { "the venue" } else { &c.claimant_name },
            status_name(c.status),
            if c.status_note.is_empty() { String::new() } else { format!(" ({})", c.status_note) }
        ),
        None => {
            say!(app, "resolved   incident {incident} by {who}: no claim opened (an injury needs a staff note, property a logged cost)")
        }
    }
    Ok(claim)
}

/// The floor manager logs damaged equipment; with `camera` the vision stub
/// confirms it from a frame first. Resolves the incident and returns the claim.
pub fn property(app: &App, zone_name: &str, note: &str, cost_cents: u64, camera: bool) -> Result<Option<Claim>> {
    let db = app.db()?;
    let zone = app.zone_by_name(zone_name)?;
    let sam = app.actor("sam")?;
    let before = db.db.incident().iter().map(|i| i.id).max().unwrap_or(0);
    call!(sam, open_incident_then("property".into(), zone.id, 0, note.to_string()))?;
    let incident =
        until(4.0, || db.db.incident().iter().find(|i| i.id > before && i.kind == IncidentKind::Property && i.zone_id == zone.id))
            .context("the property incident did not appear")?;
    say!(app, "incident {}  property  {}  opened {} by Sam Okafor: {note}", incident.id, zone.name, app.hms(incident.opened_at));
    if camera {
        vision_stub(app, &incident, &zone, note)?;
    }
    call!(
        sam,
        add_incident_note_then(incident.id, format!("repair estimate from the AV vendor: {}", money(cost_cents)), Some(cost_cents))
    )?;
    say!(app, "note       Sam Okafor logged the repair cost {}", money(cost_cents));
    resolve(app, incident.id, "area cleared, equipment sent for repair", "sam")
}

/// Plays the vision service: a frame in the blob store, the property event and a confirmed assessment.
fn vision_stub(app: &App, incident: &Incident, zone: &Zone, note: &str) -> Result<()> {
    let db = app.db()?;
    let cam = db.db.camera().iter().find(|c| c.zone_id == zone.id).with_context(|| format!("no camera covers {}", zone.name))?;
    let captured = Timestamp::from_micros_since_unix_epoch(now_micros() - 4_000_000);
    let frame = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"360\"><rect width=\"640\" height=\"360\" fill=\"#222\"/>\
         <text x=\"16\" y=\"32\" fill=\"#eee\" font-family=\"monospace\">{} {} incident {} (synthetic frame)</text></svg>\n",
        cam.name,
        hyphenate_core::time::local_datetime(micros(captured), app.tz()),
        incident.id
    );
    let blob = app.blobs().put(frame.as_bytes())?;
    let vision = app.actor("vision")?;
    call!(vision, register_blob_then(blob.sha256.clone(), None, "staff".into(), "frame".into(), "image/svg+xml".into(), blob.size_bytes))?;
    call!(
        vision,
        report_property_event_then(
            incident.id,
            cam.id,
            "fallen_object".into(),
            "a speaker lies on its side below the stage".into(),
            0.9,
            vec![blob.sha256.clone()]
        )
    )?;
    call!(
        vision,
        submit_vision_assessment_then(
            incident.id,
            "staff_button".into(),
            true,
            0.92,
            "a floor speaker on its side in the pit, cabinet cracked, nobody under it".into(),
            "rope off the area and remove the speaker".into(),
            format!("Camera {} on {} confirms what the floor manager reported: {note}", cam.name, zone.name),
            cam.id,
            vec![blob.sha256.clone()],
            vec![captured],
            0
        )
    )?;
    say!(app, "vision     camera {} confirmed it (0.92), frame {} captured {}", cam.name, short_hash(&blob.sha256), app.hms(captured));
    Ok(())
}

/// A rendered record in the blob store.
pub struct Record {
    pub sha256: String,
    pub size_bytes: u64,
    pub pages: u32,
    pub path: PathBuf,
}

/// The patient name each template is written for.
fn template_patient(template: &str) -> Option<&'static str> {
    match template {
        "first-aid-wrist" => Some("Maya Chen"),
        "urgent-care-wrist" => Some("Jordan Alvarez"),
        "urgent-care-ankle-home" => Some("Sam Patel"),
        _ => None,
    }
}

/// Renders `fixtures/medical-records/templates/<template>.html` for the claim's
/// incident date and zone (optionally for another patient), stores the PDF and
/// files it as the medic.
pub fn attach_record(app: &App, claim_id: u64, template: &str, suffix: Option<&str>, patient: Option<&str>) -> Result<Record> {
    let claim = app.claim(claim_id)?;
    let incident = app.incident(claim.incident_id)?;
    let date = hyphenate_core::time::local_date(micros(incident.opened_at), app.tz());
    let dir = app.root.join("fixtures/medical-records");
    let source = dir.join("templates").join(format!("{template}.html"));
    if !source.is_file() {
        bail!("no template {}", source.display());
    }
    let out_dir = app.cfg.data_dir.join("records");
    std::fs::create_dir_all(&out_dir)?;
    let mut html = std::fs::read_to_string(&source)?;
    if let (Some(name), Some(original)) = (patient, template_patient(template)) {
        html = html.replace(original, name);
    }
    let minute = |t: i64| {
        let hms = hyphenate_core::time::local_hms(t, app.tz());
        hms[..2].parse::<i32>().unwrap_or(0) * 60 + hms[3..5].parse::<i32>().unwrap_or(0)
    };
    let html = align_times(&html, template, minute(micros(incident.opened_at)), minute(now_micros()));
    let template_arg = out_dir.join(format!("claim-{claim_id}-{template}.html"));
    std::fs::write(&template_arg, html)?;
    let out = out_dir.join(format!("claim-{claim_id}-{template}.pdf"));
    let venue = app.db()?.db.insurance_settings().id().find(&0).map(|s| s.venue_name).unwrap_or_else(|| "Cal Hacks 13.0".into());
    let mut cmd = Command::new(dir.join("render.sh"));
    cmd.arg(&template_arg).arg(&date).arg(&out).env("ZONE_NAME", &claim.zone_name).env("EVENT_NAME", &venue);
    if let Some(s) = suffix {
        cmd.arg(s);
    }
    let run = cmd.output().context("running render.sh")?;
    if !run.status.success() {
        bail!("render.sh failed: {}", String::from_utf8_lossy(&run.stderr).trim());
    }
    let bytes = std::fs::read(&out)?;
    let pages = count_pages(&bytes);
    let blob = app.blobs().put(&bytes)?;
    let record = Record { sha256: blob.sha256, size_bytes: blob.size_bytes, pages, path: out };
    say!(
        app,
        "record     {template} for {} on {date}, {}: {} pages, sha {} ({})",
        patient.unwrap_or(&claim.claimant_name),
        claim.zone_name,
        record.pages,
        short_hash(&record.sha256),
        record.path.display()
    );
    file_record(app, claim_id, &record.sha256, record.size_bytes, record.pages)?;
    Ok(record)
}

/// Registers a PDF already in the blob store and files it on the claim as the medic.
pub fn file_record(app: &App, claim_id: u64, sha256: &str, size_bytes: u64, pages: u32) -> Result<()> {
    let claim = app.claim(claim_id)?;
    let medic = app.actor("medic")?;
    call!(
        medic,
        register_blob_then(sha256.to_string(), claim.claimant, "owner_only".into(), "medical".into(), "application/pdf".into(), size_bytes)
    )?;
    call!(medic, submit_medical_record_then(claim_id, sha256.to_string(), pages))?;
    let c = until(4.0, || app.claim(claim_id).ok().filter(|c| c.status != ClaimStatus::AwaitingRecord)).unwrap_or(claim);
    say!(app, "filed      on claim {claim_id} by Ari Ramos: {} ({})", status_name(c.status), c.status_note);
    Ok(())
}

/// The templates are written for an injury at a fixed evening time; this
/// moves the record's clock times to the real story: the injury at the
/// minute the band reported it. First aid: the visit starts the minute the
/// record is filed and every later time keeps its distance from it. Urgent
/// care (the next morning): only the injury time moves, and "last night"
/// becomes "yesterday" unless the fall was in the evening.
fn align_times(html: &str, template: &str, injury: i32, seen: i32) -> String {
    let hm = |m: i32| format!("{:02}:{:02}", m.rem_euclid(1440) / 60, m.rem_euclid(60));
    match template {
        "first-aid-wrist" => {
            let held = html.replace("approx. 22:05", "approx. @INJURY@").replace("approximately 22:05", "approximately @INJURY@");
            shift_clock(&held, seen - (22 * 60 + 20)).replace("@INJURY@", &hm(injury))
        }
        "urgent-care-wrist" => {
            let html = html.replace("approximately 21:45", &format!("approximately {}", hm(injury)));
            if injury >= 18 * 60 {
                html
            } else {
                html.replace("Last night,", "Yesterday,").replace("a fall last night", "a fall yesterday")
            }
        }
        _ => html.to_string(),
    }
}

/// Adds `delta` minutes to every `HH:MM` in the text.
fn shift_clock(text: &str, delta: i32) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let digit = |i: usize| b.get(i).is_some_and(u8::is_ascii_digit);
    for i in 0..b.len().saturating_sub(4) {
        if digit(i) && digit(i + 1) && b[i + 2] == b':' && digit(i + 3) && digit(i + 4) && !(i > 0 && digit(i - 1)) && !digit(i + 5) {
            let (h, m): (i32, i32) = (text[i..i + 2].parse().unwrap(), text[i + 3..i + 5].parse().unwrap());
            if h < 24 && m < 60 && i >= last {
                let t = (h * 60 + m + delta).rem_euclid(1440);
                out.push_str(&text[last..i]);
                out.push_str(&format!("{:02}:{:02}", t / 60, t % 60));
                last = i + 5;
            }
        }
    }
    out.push_str(&text[last..]);
    out
}

/// Page objects in a PDF: `/Type /Page`, not `/Pages`.
pub fn count_pages(pdf: &[u8]) -> u32 {
    let mut n = 0;
    let mut i = 0;
    while let Some(at) = find(&pdf[i..], b"/Type") {
        let mut j = i + at + 5;
        while j < pdf.len() && pdf[j].is_ascii_whitespace() {
            j += 1;
        }
        if pdf[j..].starts_with(b"/Page") && !pdf.get(j + 5).is_some_and(|c| c.is_ascii_alphanumeric()) {
            n += 1;
        }
        i = j;
    }
    n.max(1)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shifts_every_clock_time() {
        assert_eq!(shift_clock("seen 22:20, signed 23:10, BP 122/78, 2026-10-24", 160), "seen 01:00, signed 01:50, BP 122/78, 2026-10-24");
        assert_eq!(shift_clock("at 22:05.", -(22 * 60 + 5)), "at 00:00.");
        assert_eq!(shift_clock("1234:567 and 9:15", 10), "1234:567 and 9:15");
    }

    #[test]
    fn aligns_record_times_with_the_incident() {
        let t = "a fall last night. Last night, X, at approximately 21:45, arrived 10:40";
        let day = "a fall yesterday. Yesterday, X, at approximately 14:03, arrived 10:40";
        assert_eq!(align_times(t, "urgent-care-wrist", 14 * 60 + 3, 14 * 60 + 4), day);
        let night = "a fall last night. Last night, X, at approximately 22:00, arrived 10:40";
        assert_eq!(align_times(t, "urgent-care-wrist", 22 * 60, 22 * 60), night);
        let fa = "seen 22:20, incident approx. 22:05, at 22:20. At approximately 22:05, released 22:50";
        let moved = "seen 01:08, incident approx. 01:07, at 01:08. At approximately 01:07, released 01:38";
        assert_eq!(align_times(fa, "first-aid-wrist", 60 + 7, 60 + 8), moved);
    }

    #[test]
    fn counts_pdf_pages() {
        assert_eq!(count_pages(b"<</Type /Pages /Count 2>> <</Type /Page>> <</Type/Page /Parent 1>>"), 2);
        for (name, pages) in [("first-aid-wrist", 1), ("urgent-care-wrist", 2), ("urgent-care-ankle-home", 2)] {
            let path = format!("{}/../../fixtures/medical-records/rendered/{name}.pdf", env!("CARGO_MANIFEST_DIR"));
            assert_eq!(count_pages(&std::fs::read(path).unwrap()), pages, "{name}");
        }
    }
}
