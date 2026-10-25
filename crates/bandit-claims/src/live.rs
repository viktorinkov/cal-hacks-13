//! `bandit-claims live`: the floor staff while the live run is on. The module decides who falls, where and
//! when; this plays the people who answer it. The medic reaches each person, notes what they found and
//! resolves the incident; the person who fell files their claim (staff file it for them) and the hospital
//! report follows on its own; the camera confirms broken equipment and the organizer logs the repair cost.
//! A claim left waiting for the organizer, in this run or an earlier one, is decided after `--approve-after`
//! seconds so the run keeps moving: approved with a learned rule, or refused when Claude recommended refusing
//! it. While the run is paused, the floor staff wait too.
//!
//! Each incident's plan comes from `live_plan`. An incident with no plan, such as a fall on a presenter's own
//! band, is treated as a sprain at first aid.

use crate::app::*;
use crate::{decide, flow};
use anyhow::Result;
use bandit_bindings::*;
use spacetimedb_sdk::Table;
use std::collections::HashSet;
use std::process::{Command, Stdio};

/// What the owner connection mirrors for the run: everything the flow commands read, but not the crowd's bands.
const LIVE_TABLES: &[&str] = &[
    "staff_role",
    "attendee",
    "zone",
    "venue",
    "camera",
    "incident",
    "incident_note",
    "claim",
    "claim_check",
    "approval",
    "settlement_rule",
    "insurance_policy",
    "coverage_rule",
    "insurance_settings",
    "live_run",
    "live_plan",
    "live_pause",
    "incident_marker",
];

/// The plan for an incident nobody scripted: a sprain treated at first aid.
fn default_plan(m: &IncidentMarker) -> LivePlan {
    let place = if m.place.is_empty() { "the floor".to_string() } else { m.place.clone() };
    LivePlan {
        incident_id: m.incident_id,
        record: "first-aid-wrist".into(),
        note: format!("on scene at {place}: slipped on a spilled drink, right wrist sprain; ice and a wrap at first aid"),
        resolution: "treated on site".into(),
        cost_cents: 0,
        camera: false,
    }
}

/// Seconds since a timestamp.
fn since(t: spacetimedb_sdk::Timestamp) -> i64 {
    (now_micros() - micros(t)) / 1_000_000
}

/// How long the medic takes to reach incident `id`, 12 to 20 s, and to treat and resolve it, 10 to 15 s.
fn reach_secs(id: u64) -> i64 {
    12 + (id * 7 % 9) as i64
}

fn treat_secs(id: u64) -> i64 {
    10 + (id * 5 % 6) as i64
}

/// The person files their claim this long after the medic resolves the incident; the hospital report then
/// arrives on its own, drawn by the module's seeded generator.
const FILE_SECS: i64 = 8;
/// The camera's assessment and the organizer's cost note for broken equipment.
const CAMERA_SECS: i64 = 6;
const COST_SECS: i64 = 16;

pub fn run(app: &App, approve_after: u64) -> Result<()> {
    let db = app.db_with(LIVE_TABLES)?;
    say!(app, "live       watching the run on {} at {}", app.database, app.uri);
    file_left_records(app, &db)?;
    // Steps already taken this process, so a step that failed once is not retried every half second.
    let mut done: HashSet<(u64, &'static str)> = HashSet::new();
    let mut phase = None;
    loop {
        let Some(r) = db.db.live_run().id().find(&0) else {
            sleep_ms(1000);
            continue;
        };
        if phase != Some(r.phase) {
            say!(app, "live       {:?}, {} people, step {}", r.phase, r.crowd, r.step);
            phase = Some(r.phase);
        }
        // Paused, the floor staff wait with everyone else.
        if r.phase == LivePhase::Idle || db.db.live_pause().id().find(&0).is_some() {
            sleep_ms(1000);
            continue;
        }
        let markers: Vec<IncidentMarker> = db.db.incident_marker().iter().filter(|m| m.opened_at >= r.started_at).collect();
        for m in markers {
            let plan = db.db.live_plan().incident_id().find(&m.incident_id).unwrap_or_else(|| default_plan(&m));
            if let Err(e) = floor(app, &m, &plan, &mut done) {
                say!(app, "live       incident {}: {e:#}", m.incident_id);
            }
        }
        if approve_after > 0 {
            let waiting: Vec<Claim> = db
                .db
                .claim()
                .iter()
                .filter(|c| c.status == ClaimStatus::Routed && since(c.updated_at) >= approve_after as i64)
                // This run's claims, and any an earlier run left waiting.
                .filter(|c| c.opened_at >= r.started_at || db.db.live_plan().incident_id().find(&c.incident_id).is_some())
                .collect();
            for c in waiting {
                if done.insert((c.id, "decide")) {
                    if let Err(e) = decide_claim(app, &c) {
                        say!(app, "live       claim {}: {e:#}", c.id);
                    }
                }
            }
        }
        sleep_ms(500);
    }
}

/// Claims from earlier runs left waiting for a record PDF that nobody files. The medic's record goes on each
/// injury, one at a time in the background so the run is not held up; a claim where the medic treated no
/// injury is closed.
fn file_left_records(app: &App, db: &DbConnection) -> Result<()> {
    let left: Vec<(u64, LivePlan)> = db
        .db
        .claim()
        .iter()
        .filter(|c| c.status == ClaimStatus::AwaitingRecord && c.status_note == "waiting for the medical record")
        .filter_map(|c| db.db.live_plan().incident_id().find(&c.incident_id).map(|p| (c.id, p)))
        .collect();
    let (records, none): (Vec<_>, Vec<_>) = left.into_iter().partition(|(_, p)| !p.record.is_empty());
    for (claim, plan) in none {
        let reason = format!("the medic treated no injury ({})", plan.resolution);
        let closed = app.actor("medic").and_then(|medic| call!(medic, close_claim_without_injury_then(claim, reason.clone())));
        match closed {
            Ok(_) => say!(app, "medic      claim {claim}: closed, {reason}"),
            Err(e) => say!(app, "live       claim {claim}: {e:#}"),
        }
    }
    if records.is_empty() {
        return Ok(());
    }
    say!(app, "live       filing the medic's record on {} claims left waiting for one", records.len());
    let exe = std::env::current_exe()?;
    std::thread::spawn(move || {
        for (claim, plan) in records {
            let _ = Command::new(&exe)
                .args(["attach-record", "--claim", &claim.to_string(), "--template", &plan.record, "--for-claimant"])
                .stdin(Stdio::null())
                .status();
        }
    });
    Ok(())
}

/// The next step on one incident, when its time has come.
fn floor(app: &App, m: &IncidentMarker, plan: &LivePlan, done: &mut HashSet<(u64, &'static str)>) -> Result<()> {
    let id = m.incident_id;
    let i = app.incident(id)?;
    if plan.camera || i.kind == IncidentKind::Property {
        return property(app, &i, m, plan, done);
    }
    if !i.resolved {
        if i.assigned_medic.is_none() {
            if since(i.opened_at) >= reach_secs(id) && done.insert((id, "treat")) {
                let medic = app.actor("medic")?;
                call!(medic, assign_medic_then(id))?;
                if !plan.note.is_empty() {
                    call!(medic, add_incident_note_then(id, plan.note.clone(), None))?;
                }
                say!(app, "medic      incident {id} at {}: {}", m.place, if plan.note.is_empty() { "on scene" } else { &plan.note });
            }
        } else if m.responding_at.is_some_and(|t| since(t) >= treat_secs(id)) && done.insert((id, "resolve")) {
            // Not `flow::resolve`, which files the claim at once and leaves its record to a PDF upload: here the
            // person files below, and only when the medic treated an injury.
            let medic = app.actor("medic")?;
            call!(medic, resolve_incident_then(id, plan.resolution.clone()))?;
            say!(app, "resolved   incident {id} at {}: {}", m.place, plan.resolution);
        }
        return Ok(());
    }
    // An injury the medic noted becomes a claim: the person files it in their own words, and staff file it
    // for them here since the crowd has no phones. Which hospital report comes back is the module's seeded draw.
    if plan.record.is_empty() || app.db()?.db.claim().incident_id().find(&id).is_some() {
        return Ok(());
    }
    if i.resolved_at.map(since).unwrap_or(0) >= FILE_SECS && done.insert((id, "file")) {
        let medic = app.actor("medic")?;
        let statement = statement(&plan.record, &m.place);
        call!(medic, file_claim_for_wearer_then(id, statement.clone(), "random".into()))?;
        say!(app, "filed      incident {id}: {} filed a claim: {statement}", if m.person.is_empty() { "the wearer" } else { &m.person });
    }
    Ok(())
}

/// What the person writes when they file, matching what the medic saw.
fn statement(record: &str, place: &str) -> String {
    let place = if place.is_empty() { "the venue" } else { place };
    match record {
        "urgent-care-wrist" => format!("The crowd surged at {place} and I fell onto my left wrist. It kept swelling after first aid, so I went to urgent care."),
        "urgent-care-ankle-home" => format!("My right ankle gave way at {place} and swelled up. The medic splinted it and sent me to urgent care."),
        _ => format!("I slipped on a spilled drink at {place} and landed on my right wrist. The medic iced and wrapped it at first aid."),
    }
}

/// Broken equipment: the camera confirms it, the organizer logs the repair cost and resolves it.
fn property(app: &App, i: &Incident, m: &IncidentMarker, plan: &LivePlan, done: &mut HashSet<(u64, &'static str)>) -> Result<()> {
    if i.resolved {
        return Ok(());
    }
    let age = since(i.opened_at);
    if plan.camera && age >= CAMERA_SECS && i.vision_status == "none" && done.insert((i.id, "camera")) {
        let db = app.db()?;
        let zone = db.db.zone().id().find(&i.zone_id).ok_or_else(|| anyhow::anyhow!("no zone {}", i.zone_id))?;
        flow::vision_stub(app, i, &zone, &plan.note, &plan.note)?;
    }
    if age >= COST_SECS && done.insert((i.id, "cost")) {
        let ops = app.actor("ops")?;
        if plan.cost_cents > 0 {
            let note = format!("repair estimate from the vendor: {}", money(plan.cost_cents));
            call!(ops, add_incident_note_then(i.id, note, Some(plan.cost_cents)))?;
            say!(app, "organizer  incident {} at {}: logged the repair cost {}", i.id, m.place, money(plan.cost_cents));
        }
        flow::resolve(app, i.id, &plan.resolution, "ops")?;
    }
    Ok(())
}

/// The organizer's decision on a claim nobody decided in time: refused when
/// Claude recommended refusing it or there is nothing to pay, else approved.
fn decide_claim(app: &App, c: &Claim) -> Result<()> {
    if c.review_verdict == "refuse" {
        decide::refuse(app, c.id, None, "the organizer agrees with Claude's refusal", false)?;
    } else if c.payout_cents == 0 {
        decide::refuse(app, c.id, None, "nothing to pay: no hospital report covers it", false)?;
    } else {
        decide::approve(app, c.id, None, None, true, false, false)?;
    }
    Ok(())
}
