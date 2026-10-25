//! The scripted story: six claims that show every outcome, from the organizer's
//! approvals kept as precedents to a refusal that lists its checks.

use crate::app::*;
use crate::test_bands::{Pose, TEST_BANDS, TestBands};
use crate::{decide, flow, setup, show};
use anyhow::{Context, Result};
use bandit_bindings::*;
use spacetimedb_sdk::Table;
use std::io::BufRead;

/// Long enough for the Evidence Engine to read a record and Claude to review the pack.
const FLOW_SECS: u64 = 360;

pub fn run(app: &App, pause: bool) -> Result<()> {
    let test_bands = setup::run(app)?;
    let existing = app.db()?.db.claim().count();
    if existing > 0 {
        println!(
            "\nnote: the database already has {existing} claims, so rules and duplicate checks from them apply. For a clean story:\n    var/stdb publish -s insurance-local -p spacetimedb/server {} -c -y && rm -rf var/identities",
            app.database
        );
    }
    if !app.worker_active() {
        println!("\nnote: {}", app.worker_hint());
    }
    let main = app.station(MAIN_STAGE)?;
    let mut crowd: Vec<(u8, Pose)> = TEST_BANDS.map(|b| (b, Pose::at(main))).collect();
    crowd[2].1 = Pose::at(app.station(HACKING_FLOOR)?);
    test_bands.place(&crowd);
    println!("\ncrowd      test bands 90-99 online: Sam Patel (92) on the Hacking floor, everyone else at Main stage");

    step(pause, "1. Jordan Alvarez falls in the Main stage pit; bands 94, 95 and 96 around him light the circle")?;
    let note = "on scene in the pit: left wrist pain and swelling after the crowd surged; wrapping the wrist, referring him to urgent care";
    let jordan = injury(app, &test_bands, 90, MAIN_STAGE, &[94, 95, 96], MAIN_STAGE, note)?;
    flow::attach_record(app, jordan, "urgent-care-wrist", None, None)?;
    let c = show::wait_for(app, jordan, FLOW_SECS, |c| !in_pipeline(c.status))?;
    show::summary(app, jordan)?;
    if c.status == ClaimStatus::Routed {
        println!("\nThe organizer's screen is a minute old:");
        decide::approve(app, jordan, None, true, false)?;
        println!();
        decide::approve(app, jordan, None, false, true)?;
        show::wait_for(app, jordan, FLOW_SECS, |c| !in_pipeline(c.status))?;
        show::summary(app, jordan)?;
    } else {
        println!("claim {jordan} did not wait for a person ({}); the story continues", status_name(c.status));
    }

    step(pause, "2. A minute later Maya Chen slips near the stage; bands 97 and 98 light the circle")?;
    let note = "on scene near the stage: right wrist pain after slipping on a spilled drink; walking her to the medical station";
    let maya = injury(app, &test_bands, 91, MAIN_STAGE, &[97, 98], MAIN_STAGE, note)?;
    flow::attach_record(app, maya, "first-aid-wrist", None, None)?;
    let c = show::wait_for(app, maya, FLOW_SECS, |c| !in_pipeline(c.status))?;
    show::summary(app, maya)?;
    if c.status == ClaimStatus::Routed {
        println!();
        decide::approve(app, maya, None, false, true)?;
    }

    step(pause, "3. Sam Patel goes down on the Hacking floor; his urgent-care record says he hurt the ankle at home")?;
    let note = "on scene at the tables: right ankle pain and swelling after a stumble; splinting it, referring him to urgent care";
    let sam = injury(app, &test_bands, 92, HACKING_FLOOR, &[94, 99], HACKING_FLOOR, note)?;
    flow::attach_record(app, sam, "urgent-care-ankle-home", None, None)?;
    show::wait_for(app, sam, FLOW_SECS, |c| !in_pipeline(c.status))?;
    show::summary(app, sam)?;

    step(pause, "4. Lee Park's band reports a fall at Main stage, but the light circle forms on Sponsor row")?;
    let note = "on scene: says they fell; no visible injury, giving an ice pack";
    let lee = injury(app, &test_bands, 93, MAIN_STAGE, &[95, 96, 97], SPONSOR_ROW, note)?;
    show::summary(app, lee)?;

    step(pause, "5. A speaker falls off its stand at Main stage; the overhead camera sees it")?;
    let speaker = flow::property(app, MAIN_STAGE, "speaker knocked off its stand into the pit", 240_000, true)?
        .context("no claim opened for the speaker")?;
    let c = show::wait_for(app, speaker.id, FLOW_SECS, |c| !in_pipeline(c.status))?;
    if c.status == ClaimStatus::Routed {
        println!();
        decide::approve(app, speaker.id, None, false, true)?;
    }
    let c = app.claim(speaker.id)?;
    if matches!(c.status, ClaimStatus::Settled | ClaimStatus::Reconciled) {
        decide::recovery(app, speaker.id, "Stagecraft AV", "ops@stagecraft.test", None)?;
        let drafted = until(180.0, || app.claim(speaker.id).ok().filter(|c| !c.recovery_hash.is_empty()));
        println!("recovery   {}", if drafted.is_some() { "letter drafted" } else { "letter not drafted yet; see `letters` later" });
    }
    show::summary(app, speaker.id)?;

    step(pause, "6. Northwind Mutual pays claim 1's receivable")?;
    let c = app.claim(jordan)?;
    if c.status == ClaimStatus::Settled {
        decide::insurer_paid(app, jordan, c.recoverable_cents, "NWM-55120", None)?;
    } else {
        println!("claim {jordan} is {}, not settled; skipping the insurer payment", status_name(c.status));
    }
    show::summary(app, jordan)?;
    drop(test_bands);

    println!("\nclaims");
    show::claims(app)?;
    println!();
    if until(180.0, || app.claim(jordan).ok().filter(show::letters_ready)).is_none() {
        println!("(the letters for claim {jordan} are not all drafted yet)");
    }
    show::letters(app, jordan)
}

/// One injury from fall to an open claim: the band, the medic on scene, resolution.
fn injury(app: &App, test_bands: &TestBands, band: u8, zone: &str, witnesses: &[u8], witness_zone: &str, note: &str) -> Result<u64> {
    let incident = flow::fall(app, test_bands, band, app.station(zone)?, witnesses, app.station(witness_zone)?)?;
    flow::print_incident(app, incident.id)?;
    println!("medic      Ari Ramos is on the way ({} s)", flow::RESPONSE_SECS);
    sleep_ms(flow::RESPONSE_SECS * 1000);
    flow::treat(app, incident.id, note)?;
    let claim = flow::resolve(app, incident.id, "treated on site", "medic")?.context("no claim opened")?;
    Ok(claim.id)
}

fn step(pause: bool, title: &str) -> Result<()> {
    println!("\n== {title}");
    if pause {
        println!("(press Enter)");
        let mut line = String::new();
        std::io::stdin().lock().read_line(&mut line)?;
    }
    Ok(())
}
