//! `bandit-claims live`: the floor staff while the live run is on. The module decides who falls, what breaks
//! or goes missing, where and when; this plays the people who answer it. The medic reaches each person, notes
//! what they found and resolves the incident; the person who fell files their claim (staff file it for them)
//! and the hospital report follows on its own; for the venue's broken equipment and what is stolen from the
//! venue, the camera confirms it, staff log the cost, name who did it and resolve it. A claim left waiting
//! for the organizer, in this run or an earlier one, is decided after `--approve-after` seconds so the run
//! keeps moving: approved, or refused when Claude recommended refusing it; a rule Claude proposed is approved
//! as long after; a proposed charge is approved when Claude recommends it and the band's checks passed, else
//! waived. While the run is paused, the floor staff wait too.
//!
//! - A fall or an SOS: the medic reaches the person, notes what they found and resolves the incident; the
//!   person files their claim (staff file it for them) and the hospital report follows on its own.
//! - The venue's broken equipment (`property`) or something stolen from the venue (`theft`): security
//!   answers it. The camera sighting when a camera covers the spot, the cost note (the repair estimate, or
//!   what was taken and its value), the attendee who broke or took it named by their band, then the incident
//!   resolved, which opens the venue's claim.
//!
//! After `--approve-after` seconds the organizer decides what is still waiting, so the run keeps moving: a
//! routed claim is approved with a learned rule, or refused when the claims agent found the injury happened
//! away from the event; a proposed charge the claims review has recommended on is approved when the band's
//! checks passed and the review recommends charging, and waived otherwise. While the run is paused, the floor
//! staff wait too.
//!
//! Each incident's plan comes from `live_plan`. An injury with no plan, such as a fall on a presenter's own
//! band, is the left wrist sprain `urgent-care-wrist` records: wrapped at first aid and referred to urgent care.
//! Broken or taken things with no plan are looked into and resolved with no cost and nobody named.

use crate::app::*;
use crate::{decide, flow};
use anyhow::{Context, Result};
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
    "rule_proposal",
    "insurance_policy",
    "coverage_rule",
    "insurance_settings",
    "charge",
    "live_run",
    "live_plan",
    "live_pause",
    "incident_marker",
];

/// The plan for an incident nobody scripted: the left wrist sprain `urgent-care-wrist` records, or broken or taken
/// things looked into with no record, no cost and nobody named.
fn default_plan(m: &IncidentMarker, kind: IncidentKind) -> LivePlan {
    let place = if m.place.is_empty() { "the floor".to_string() } else { m.place.clone() };
    let (record, note, resolution) = if is_injury(kind) {
        (
            "urgent-care-wrist".to_string(),
            format!("on scene at {place}: fell when the crowd surged, left wrist pain and swelling; ice and a wrap, referring to urgent care"),
            "treated on site".to_string(),
        )
    } else {
        (String::new(), String::new(), format!("security looked into it at {place}; nothing to claim"))
    };
    LivePlan { incident_id: m.incident_id, record, note, resolution, cost_cents: 0, camera: false, culprit_band: 0, naming: String::new() }
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
/// The camera's sighting, then security's cost note, naming and resolution, for broken or taken things.
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
            let plan = db.db.live_plan().incident_id().find(&m.incident_id);
            if let Err(e) = floor(app, &m, plan, &mut done) {
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
            // A charge waits for its claim's review: the recommendation is set once the claim is decided.
            let charges: Vec<Charge> = db
                .db
                .charge()
                .iter()
                .filter(|c| c.status == "proposed" && !c.recommendation.is_empty() && c.created_at >= r.started_at && since(c.updated_at) >= approve_after as i64)
                // A charge is decided once its claim is: paid, or refused.
                .filter(|c| {
                    db.db.claim().id().find(&c.claim_id).is_some_and(|k| {
                        matches!(k.status, ClaimStatus::Paying | ClaimStatus::Settled | ClaimStatus::Reconciled | ClaimStatus::Refused)
                    })
                })
                .collect();
            for c in charges {
                if done.insert((c.id, "charge")) {
                    if let Err(e) = decide_charge(app, &c) {
                        say!(app, "live       charge {}: {e:#}", c.id);
                    }
                }
            }
            // The live runner handles ordinary proposals only; legacy scope reviews require the organizer.
            let proposed: Vec<RuleProposal> =
                db.db.rule_proposal().iter().filter(|p| p.status == "proposed" && !p.summary.starts_with("Scope review ") && p.proposed_at.is_some_and(|t| since(t) >= approve_after as i64)).collect();
            for p in proposed {
                if done.insert((p.id, "approve rule")) {
                    if let Err(e) = decide::approve_proposal(app, p.id, None) {
                        say!(app, "live       proposed rule {}: {e:#}", p.id);
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
fn floor(app: &App, m: &IncidentMarker, plan: Option<LivePlan>, done: &mut HashSet<(u64, &'static str)>) -> Result<()> {
    let id = m.incident_id;
    let i = app.incident(id)?;
    let plan = plan.unwrap_or_else(|| default_plan(m, i.kind));
    if !is_injury(i.kind) {
        return loss(app, &i, m, &plan, done);
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

/// The venue's broken equipment, or something stolen from the venue: security answers it. The camera sighting
/// when a camera covers the spot, the cost note, the attendee who did it named, then the incident resolved,
/// which opens its claim. Each step runs once; a step that fails leaves the next ones to the next tick.
fn loss(app: &App, i: &Incident, m: &IncidentMarker, plan: &LivePlan, done: &mut HashSet<(u64, &'static str)>) -> Result<()> {
    if i.resolved {
        return Ok(());
    }
    let age = since(i.opened_at);
    if plan.camera && age >= CAMERA_SECS && i.vision_status == "none" && done.insert((i.id, "camera")) {
        let db = app.db()?;
        let zone = db.db.zone().id().find(&i.zone_id).ok_or_else(|| anyhow::anyhow!("no zone {}", i.zone_id))?;
        camera_on(app, &zone)?;
        flow::vision_stub(app, i, &zone, &plan.note, &plan.note)?;
    }
    if age < COST_SECS {
        return Ok(());
    }
    if plan.cost_cents > 0 && done.insert((i.id, "cost")) {
        let ops = app.actor("ops")?;
        // Broken equipment gets the vendor's repair estimate; a theft's note already says what was taken and its value.
        let note =
            if i.kind == IncidentKind::Property { format!("repair estimate from the vendor: {}", money(plan.cost_cents)) } else { plan.note.clone() };
        call!(ops, add_incident_note_then(i.id, note, Some(plan.cost_cents)))?;
        say!(app, "organizer  incident {} at {}: logged the cost {}", i.id, m.place, money(plan.cost_cents));
    }
    if plan.culprit_band != 0 && done.insert((i.id, "name")) {
        let ops = app.actor("ops")?;
        call!(ops, name_responsible_band_then(i.id, plan.culprit_band, plan.naming.clone()))?;
        say!(app, "organizer  incident {} at {}: named band {}: {}", i.id, m.place, plan.culprit_band, plan.naming);
    }
    if done.insert((i.id, "resolve")) {
        flow::resolve(app, i.id, &plan.resolution, "ops")?;
    }
    Ok(())
}

/// The plan says a camera covers the spot: when no camera row covers the zone yet, security puts one up.
fn camera_on(app: &App, zone: &Zone) -> Result<()> {
    let db = app.db()?;
    if db.db.camera().iter().any(|c| c.zone_id == zone.id) {
        return Ok(());
    }
    let vision = app.actor("vision")?;
    call!(vision, upsert_camera_then(format!("{} camera", zone.name), zone.id, "overhead".into()))?;
    until(3.0, || db.db.camera().iter().any(|c| c.zone_id == zone.id).then_some(())).with_context(|| format!("no camera appeared on {}", zone.name))?;
    say!(app, "vision     camera up on {}", zone.name);
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
        decide::approve(app, c.id, None, false, false)?;
    }
    Ok(())
}

/// The organizer's decision on a proposed charge: approved with exactly the amount and pack it shows when the
/// band's checks passed and the review recommends charging, waived otherwise.
fn decide_charge(app: &App, c: &Charge) -> Result<()> {
    let ops = app.actor("ops")?;
    if c.checks_passed && c.recommendation == "charge" {
        call!(ops, approve_charge_then(c.id, c.amount_cents, c.pack_hash.clone()))?;
        say!(app, "organizer  charge {}: approved {} to {} on pack {}", c.id, money(c.amount_cents), c.attendee_name, short_hash(&c.pack_hash));
    } else {
        let reason = if c.checks_passed { "the review recommends no charge" } else { "a check of the named band failed" };
        call!(ops, waive_charge_then(c.id, reason.to_string()))?;
        say!(app, "organizer  charge {}: waived the charge to {}: {reason}", c.id, c.attendee_name);
    }
    Ok(())
}
