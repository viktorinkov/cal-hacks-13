//! `bandit-claims live`: the floor staff while the live run is on. The module decides who falls, where and
//! when; this plays the people who answer it. The medic reaches each person, notes what they found and
//! resolves the incident; the clinic files its record on the claim made out to the person who fell; the
//! camera confirms broken equipment and the organizer logs the repair cost. A claim left waiting for the
//! organizer is decided after `--approve-after` seconds so the run keeps moving: approved with a learned rule,
//! or refused when the claims agent found the injury happened away from the event.
//!
//! Each incident's plan comes from `live_plan`. An incident with no plan, such as a fall on a presenter's own
//! band, is treated as a sprain at first aid.

use crate::app::*;
use crate::{decide, flow};
use anyhow::Result;
use bandit_bindings::*;
use spacetimedb_sdk::Table;
use std::collections::HashSet;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

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

/// The record reaches the claim this long after the incident is resolved. Rendering it runs in its own
/// process, given this long before it is stopped, so a slow render never holds up the medic.
const RECORD_SECS: i64 = 8;
const RENDER_LIMIT: Duration = Duration::from_secs(120);
/// The camera's assessment and the organizer's cost note for broken equipment.
const CAMERA_SECS: i64 = 6;
const COST_SECS: i64 = 16;

pub fn run(app: &App, approve_after: u64) -> Result<()> {
    let db = app.db_with(LIVE_TABLES)?;
    // Taken now: after a rebuild the running process's own path reads as deleted, while this one is the new build.
    let exe = std::env::current_exe()?;
    say!(app, "live       watching the run on {} at {}", app.database, app.uri);
    // Steps already taken this process, so a step that failed once is not retried every half second.
    let mut done: HashSet<(u64, &'static str)> = HashSet::new();
    let mut records: Vec<(u64, Child, Instant)> = Vec::new();
    let mut phase = None;
    loop {
        records.retain_mut(|(claim, child, started)| match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    say!(app, "live       claim {claim}: filing the record failed ({status})");
                }
                false
            }
            Ok(None) if started.elapsed() > RENDER_LIMIT => {
                let _ = child.kill();
                let _ = child.wait();
                say!(app, "live       claim {claim}: the record took too long to render; stopped it");
                false
            }
            Ok(None) => true,
            Err(_) => false,
        });
        let Some(r) = db.db.live_run().id().find(&0) else {
            sleep_ms(1000);
            continue;
        };
        if phase != Some(r.phase) {
            say!(app, "live       {:?}, {} people, step {}", r.phase, r.crowd, r.step);
            phase = Some(r.phase);
        }
        if r.phase == LivePhase::Idle {
            sleep_ms(1000);
            continue;
        }
        let markers: Vec<IncidentMarker> = db.db.incident_marker().iter().filter(|m| m.opened_at >= r.started_at).collect();
        for m in markers {
            let plan = db.db.live_plan().incident_id().find(&m.incident_id).unwrap_or_else(|| default_plan(&m));
            if let Err(e) = floor(app, &exe, &m, &plan, &mut done, &mut records) {
                say!(app, "live       incident {}: {e:#}", m.incident_id);
            }
        }
        if approve_after > 0 {
            let waiting: Vec<Claim> = db
                .db
                .claim()
                .iter()
                .filter(|c| c.status == ClaimStatus::Routed && c.opened_at >= r.started_at && since(c.updated_at) >= approve_after as i64)
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

/// The next step on one incident, when its time has come.
fn floor(
    app: &App,
    exe: &std::path::Path,
    m: &IncidentMarker,
    plan: &LivePlan,
    done: &mut HashSet<(u64, &'static str)>,
    records: &mut Vec<(u64, Child, Instant)>,
) -> Result<()> {
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
            flow::resolve(app, id, &plan.resolution, "medic")?;
        }
        return Ok(());
    }
    if plan.record.is_empty() {
        return Ok(());
    }
    let Some(c) = app.db()?.db.claim().incident_id().find(&id) else { return Ok(()) };
    let resolved_secs = i.resolved_at.map(since).unwrap_or(0);
    if c.status == ClaimStatus::AwaitingRecord && resolved_secs >= RECORD_SECS && done.insert((id, "record")) {
        // `attach-record --for-claimant` makes the record out to the claimant with an invoice of the claim's own.
        let child = Command::new(exe)
            .args(["attach-record", "--claim", &c.id.to_string(), "--template", &plan.record, "--for-claimant"])
            .stdin(Stdio::null())
            .spawn()?;
        records.push((c.id, child, Instant::now()));
    }
    Ok(())
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

/// The organizer's decision on a claim nobody decided in time.
fn decide_claim(app: &App, c: &Claim) -> Result<()> {
    if c.status_note.contains("causation") {
        let reason = "the clinic record says the injury happened away from the event";
        decide::refuse(app, c.id, None, reason, false)?;
    } else {
        decide::approve(app, c.id, None, None, true, false, false)?;
    }
    Ok(())
}
