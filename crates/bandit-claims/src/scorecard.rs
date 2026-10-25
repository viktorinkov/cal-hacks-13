//! The accuracy run. Each round plants genuine falls and the four kinds of
//! fake, lets the flow run, plays the human approvers (approve what is
//! genuine, refuse what is planted) and scores what the automation paid.
//! Only the test bands 90-99 exist, so each planted claim reuses a band
//! and gives its owner a new display name (patients must differ, or the
//! module's duplicate check would fire); setup restores the story names.

use crate::app::*;
use crate::test_bands::{Pose, TEST_BANDS, TestBands};
use crate::{decide, flow, setup};
use anyhow::{Context, Result};
use bandit_bindings::*;
use spacetimedb_sdk::{Identity, Table};
use std::time::Instant;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Genuine,
    CircleElsewhere,
    InjuryAtHome,
    SameBillTwice,
    InjuredStaff,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::Genuine => "genuine",
            Kind::CircleElsewhere => "circle elsewhere",
            Kind::InjuryAtHome => "injury at home",
            Kind::SameBillTwice => "same bill twice",
            Kind::InjuredStaff => "injured staff",
        }
    }

    fn note(self) -> &'static str {
        match self {
            Kind::Genuine | Kind::SameBillTwice => {
                "on scene: right wrist pain after slipping on a spilled drink; walking her to the medical station"
            }
            Kind::CircleElsewhere => "on scene: says they fell and hurt a wrist; no swelling, giving an ice pack",
            Kind::InjuryAtHome => "on scene: right ankle pain and swelling; splinting it, referring him to urgent care",
            Kind::InjuredStaff => "on scene: stage crew member hurt a wrist moving a road case; wrapping it",
        }
    }
}

const FAKES: [Kind; 4] = [Kind::CircleElsewhere, Kind::InjuryAtHome, Kind::SameBillTwice, Kind::InjuredStaff];
/// Bands that fall, in turn: the spare test bands first, then the story attendees'.
const SUBJECTS: [u8; 10] = [94, 95, 96, 97, 98, 99, 90, 91, 92, 93];
/// The module's occurrence window (5 min) plus slack for when the incident opens.
const WINDOW: i64 = 330_000_000;
const ROUND_SECS: u64 = 600;

/// One planted claim and what happened to it.
struct Planted {
    kind: Kind,
    claim: u64,
    band: u8,
    name: String,
    record: Option<flow::Record>,
    /// The status note when the flow finished with it (the route reason, for routed claims).
    decided: Option<String>,
}

/// Turns in the subject and witness rotations.
#[derive(Default)]
struct Turns {
    subject: usize,
    witness: usize,
}

pub fn run(app: &App, rounds: u32) -> Result<()> {
    let test_bands = setup::run(app)?;
    if !app.worker_active() {
        println!("\nnote: {}", app.worker_hint());
    }
    let main = app.station(MAIN_STAGE)?;
    let crowd: Vec<(u8, Pose)> = TEST_BANDS.map(|b| (b, test_bands.pose(b).unwrap_or(Pose::at(main)))).collect();
    test_bands.place(&crowd);
    drop_crew(app)?;
    let mut all: Vec<Planted> = Vec::new();
    let mut turns = Turns::default();
    for round in 1..=rounds {
        println!("\n== round {round}: 2 genuine falls and 4 fakes ({})", FAKES.map(Kind::label).join(", "));
        let mut planted = Vec::new();
        for kind in [Kind::Genuine, Kind::CircleElsewhere, Kind::InjuryAtHome, Kind::Genuine, Kind::InjuredStaff] {
            planted.push(plant(app, &test_bands, kind, None, &mut turns)?);
        }
        let first = &planted[0];
        app.quiet.set(true);
        let original = crate::show::wait_for(app, first.claim, ROUND_SECS, |c| {
            !matches!(c.status, ClaimStatus::AwaitingRecord | ClaimStatus::ReadingRecord)
        });
        app.quiet.set(false);
        original.context("the first genuine claim never got past reading its record")?;
        let dup = plant(app, &test_bands, Kind::SameBillTwice, Some(first), &mut turns)?;
        planted.push(dup);

        println!("  the flow runs:");
        finish_flow(app, &mut planted)?;
        approvers(app, &planted)?;
        until(180.0, || {
            let paying = planted.iter().filter(|p| app.claim(p.claim).is_ok_and(|c| c.status == ClaimStatus::Paying)).count();
            (paying == 0).then_some(())
        });
        println!("  results:");
        for p in &planted {
            let c = app.claim(p.claim)?;
            println!(
                "    claim {:>3}  {:<16} {:<16} {:<10} {:>9}  {}",
                c.id,
                p.kind.label(),
                clip(&p.name, 16),
                status_name(c.status),
                money(c.payout_cents),
                clip(&c.status_note, 110)
            );
        }
        score(app, &planted, &format!("round {round}"))?;
        all.extend(planted);
    }
    if rounds > 1 {
        println!("\n== all {rounds} rounds");
        score(app, &all, "total")?;
    }
    for (name, display, band) in ATTENDEES {
        setup::ensure_attendee(app, &test_bands, name, display, *band)?;
    }
    drop(test_bands);
    Ok(())
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Removes the temporary `crew` role a planted injured-staff claim gave a band's owner.
fn drop_crew(app: &App) -> Result<()> {
    let db = app.db()?;
    let crew: Vec<Identity> = db.db.staff_role().iter().filter(|r| r.role == "crew").map(|r| r.identity).collect();
    for who in crew {
        call!(db, revoke_role_then(who, "crew".into()))?;
    }
    Ok(())
}

/// The owner of `band` takes the name `name` (claiming the band first if it is new).
fn become_person(app: &App, test_bands: &TestBands, band: u8, name: &str) -> Result<Identity> {
    let token = ATTENDEES.iter().find(|a| a.2 == band).map(|a| a.0.to_string()).unwrap_or_else(|| format!("sc-{band}"));
    setup::ensure_attendee(app, test_bands, &token, name, band)
}

/// A fresh patient name for the next claim, so no two planted records share one.
fn fresh_name(app: &App, kind: Kind) -> Result<String> {
    const F: [&str; 10] = ["Ava", "Nora", "Leah", "Iris", "Zoe", "Ruby", "Elena", "Hana", "Tessa", "Mila"];
    const M: [&str; 10] = ["Omar", "Theo", "Ravi", "Marco", "Eli", "Jonah", "Kenji", "Luis", "Felix", "Dev"];
    const X: [&str; 10] = ["Kai", "Rowan", "Quinn", "Sage", "Reese", "Avery", "Drew", "Emery", "Jules", "Remy"];
    const LAST: [&str; 10] = ["Brooks", "Nguyen", "Rivera", "Haddad", "Silva", "Novak", "Mensah", "Tanaka", "Byrne", "Duarte"];
    let seed = app.db()?.db.claim().iter().map(|c| c.id).max().unwrap_or(0) as usize + 1;
    // The first-aid record is written for a woman, the ankle record for a man.
    let first = match kind {
        Kind::Genuine | Kind::SameBillTwice => F,
        Kind::InjuryAtHome => M,
        _ => X,
    };
    Ok(format!("{} {}", first[seed % 10], LAST[seed / 10 % 10]))
}

/// Plants one claim: a band (the source's, for the same bill twice) falls in a
/// zone with room under a fresh name, the medic treats and resolves, a record is filed.
fn plant(app: &App, test_bands: &TestBands, kind: Kind, source: Option<&Planted>, turns: &mut Turns) -> Result<Planted> {
    let station = pick_station(app)?;
    let witness_station = match kind {
        Kind::CircleElsewhere if app.station(SPONSOR_ROW)? != station => app.station(SPONSOR_ROW)?,
        Kind::CircleElsewhere => app.station(MAIN_STAGE)?,
        _ => station,
    };
    let (band, name) = match source {
        Some(p) => (p.band, p.name.clone()),
        None => {
            let band = SUBJECTS[turns.subject % SUBJECTS.len()];
            turns.subject += 1;
            (band, fresh_name(app, kind)?)
        }
    };
    let n = if kind == Kind::CircleElsewhere { 3 } else { 2 + turns.witness % 2 };
    let pool: Vec<u8> = TEST_BANDS.filter(|b| *b != band).collect();
    let witnesses: Vec<u8> = (0..n).map(|i| pool[(turns.witness + i) % pool.len()]).collect();
    turns.witness += n;
    let me = become_person(app, test_bands, band, &name)?;
    let db = app.db()?;
    if kind == Kind::InjuredStaff {
        call!(db, grant_role_then(me, "crew".into(), format!("{name}, stage crew")))?;
    }
    test_bands.place(&[(band, Pose::at(station))]);
    app.quiet.set(true);
    let planted = (|| {
        let incident = flow::fall(app, test_bands, band, station, &witnesses, witness_station)?;
        sleep_ms(flow::RESPONSE_SECS * 1000);
        flow::treat(app, incident.id, kind.note())?;
        let claim = flow::resolve(app, incident.id, "treated on site", "medic")?.context("no claim opened")?;
        let suffix = format!("SC{band:02}-{}", claim.id);
        let record = match kind {
            Kind::Genuine => Some(flow::attach_record(app, claim.id, "first-aid-wrist", Some(&suffix), Some(&name))?),
            Kind::InjuryAtHome => Some(flow::attach_record(app, claim.id, "urgent-care-ankle-home", Some(&suffix), Some(&name))?),
            Kind::SameBillTwice => {
                let r = source.and_then(|p| p.record.as_ref()).context("the original claim has no record")?;
                flow::file_record(app, claim.id, &r.sha256, r.size_bytes, r.pages)?;
                None
            }
            _ => None,
        };
        Ok::<_, anyhow::Error>(Planted { kind, claim: claim.id, band, name: name.clone(), record, decided: None })
    })();
    app.quiet.set(false);
    if kind == Kind::InjuredStaff {
        drop_crew(app)?;
    }
    let p = planted?;
    let filed = match kind {
        Kind::Genuine => ", first-aid record",
        Kind::InjuryAtHome => ", urgent-care ankle record",
        Kind::SameBillTwice => ", the earlier claim's PDF again",
        _ => "",
    };
    let circle = if witness_station == station { String::new() } else { format!(" (circle in {})", app.station_name(witness_station)) };
    println!(
        "  plant  claim {:>3}  {:<16} {} (band {band}) falls in {}, {n} witnesses{circle}{filed}",
        p.claim,
        kind.label(),
        name,
        app.station_name(station)
    );
    Ok(p)
}

/// A station whose zone can take another injury without three falling within
/// five minutes of each other (the module turns auto-settle off for such an
/// occurrence), waiting while none can.
fn pick_station(app: &App) -> Result<u8> {
    let mut said = false;
    loop {
        let db = app.db()?;
        let t = now_micros() + 15_000_000;
        let mut best: Option<(usize, u8)> = None;
        for zone in app.stationed_zones()? {
            let s = zone.station_id;
            let times: Vec<i64> = db
                .db
                .incident()
                .iter()
                .filter(|i| i.kind != IncidentKind::Property && i.zone_id == zone.id)
                .map(|i| micros(i.opened_at))
                .collect();
            let near = |x: i64| times.iter().filter(|y| (**y - x).abs() <= WINDOW).count() + usize::from((x - t).abs() <= WINDOW);
            let room = near(t) <= 2 && times.iter().filter(|x| (**x - t).abs() <= WINDOW).all(|x| near(*x) <= 2);
            let load = near(t);
            if room && best.is_none_or(|(l, _)| load < l) {
                best = Some((load, s));
            }
        }
        if let Some((_, s)) = best {
            return Ok(s);
        }
        if !said {
            println!("  (waiting for a zone to clear the five-minute occurrence window)");
            said = true;
        }
        sleep_ms(5000);
    }
}

/// Waits until every claim is out of the automatic flow, printing each decision.
fn finish_flow(app: &App, planted: &mut [Planted]) -> Result<()> {
    let start = Instant::now();
    loop {
        for p in planted.iter_mut().filter(|p| p.decided.is_none()) {
            let c = app.claim(p.claim)?;
            let done = match c.status {
                ClaimStatus::ReadingRecord | ClaimStatus::Verifying | ClaimStatus::Reviewing => false,
                ClaimStatus::AwaitingRecord => p.kind != Kind::Genuine && p.kind != Kind::InjuryAtHome && p.kind != Kind::SameBillTwice,
                _ => true,
            };
            if done {
                println!("    claim {:>3}  {:<16} {}: {}", c.id, p.kind.label(), status_name(c.status), c.status_note);
                p.decided = Some(c.status_note.clone());
            }
        }
        let pending = planted.iter().filter(|p| p.decided.is_none()).count();
        if pending == 0 {
            return Ok(());
        }
        if start.elapsed().as_secs() > ROUND_SECS {
            println!("    ({pending} claims still in the flow after {ROUND_SECS} s; scoring them as they stand)");
            return Ok(());
        }
        sleep_ms(1000);
    }
}

/// The named approvers: approve genuine claims (learning a rule), refuse planted fakes.
fn approvers(app: &App, planted: &[Planted]) -> Result<()> {
    for p in planted {
        let c = app.claim(p.claim)?;
        if c.status != ClaimStatus::Routed {
            continue;
        }
        let who = c.routed_to_name.clone();
        app.quiet.set(true);
        let r = if p.kind == Kind::Genuine {
            decide::approve(app, p.claim, None, None, true, false, false)
        } else {
            decide::refuse(app, p.claim, None, &format!("planted fake: {}", p.kind.label()), false)
        };
        app.quiet.set(false);
        let c = r?;
        let verb = if p.kind == Kind::Genuine { "approves" } else { "refuses" };
        println!("    {who} {verb} claim {} ({}, {}) -> {}", c.id, p.kind.label(), money(c.payout_cents), status_name(c.status));
    }
    Ok(())
}

/// How far a fake got: 0 refused by code, 1 stopped by a code check or rule
/// (Claude refuses on its own only a simple claim, on a failed check), 2
/// stopped only by Claude's judgment, 3 paid.
fn reach(p: &Planted, c: &Claim) -> (u8, String) {
    if matches!(c.status, ClaimStatus::Paying | ClaimStatus::Settled | ClaimStatus::Reconciled) {
        return (3, "paid".into());
    }
    let note = p.decided.clone().unwrap_or_else(|| c.status_note.clone());
    if c.decided_by == "code" {
        return (0, format!("refused by code ({})", note));
    }
    if c.decided_by == "claude" {
        return (1, format!("refused by Claude on a failed check ({note})"));
    }
    let judgment_only = note.starts_with("Claude recommends refusing") && note.contains("every check passed");
    if judgment_only || note.starts_with("Claude asks") || note.starts_with("Complications: Claude") {
        return (2, "caught only by Claude".into());
    }
    if in_pipeline(c.status) {
        return (1, format!("still {}", status_name(c.status)));
    }
    (1, format!("routed by code ({note})"))
}

fn score(app: &App, planted: &[Planted], label: &str) -> Result<()> {
    let db = app.db()?;
    let rows: Vec<(&Planted, Claim)> = planted.iter().map(|p| app.claim(p.claim).map(|c| (p, c))).collect::<Result<_>>()?;
    let paid = |c: &Claim| matches!(c.status, ClaimStatus::Paying | ClaimStatus::Settled | ClaimStatus::Reconciled);
    // Settled with no person: Claude's payment inside a learned rule, or the code-only rule.
    let auto = |c: &Claim| paid(c) && matches!(c.decided_by.as_str(), "claude" | "rule");
    let genuine: Vec<&(&Planted, Claim)> = rows.iter().filter(|(p, _)| p.kind == Kind::Genuine).collect();
    let fakes: Vec<&(&Planted, Claim)> = rows.iter().filter(|(p, _)| p.kind != Kind::Genuine).collect();
    let tp = genuine.iter().filter(|(_, c)| auto(c)).count();
    let fp = fakes.iter().filter(|(_, c)| auto(c)).count();
    let pct = |a: usize, b: usize| if b == 0 { "n/a".to_string() } else { format!("{:.0}%", 100.0 * a as f64 / b as f64) };
    let wrongly: u64 = fakes.iter().filter(|(_, c)| paid(c)).map(|(_, c)| c.payout_cents).sum();
    let billed = |set: &[&(&Planted, Claim)]| -> u64 {
        set.iter()
            .filter_map(|(p, _)| {
                db.db.medical_record().iter().filter(|r| r.claim_id == p.claim && r.status == "extracted").max_by_key(|r| r.id)
            })
            .map(|r| r.billed_cents)
            .sum()
    };
    let paid_sum = |set: &[&(&Planted, Claim)]| -> u64 { set.iter().filter(|(_, c)| paid(c)).map(|(_, c)| c.payout_cents).sum() };
    let mut minutes: Vec<f64> = genuine
        .iter()
        .filter_map(|(_, c)| {
            let opened = db.db.incident().id().find(&c.incident_id)?.opened_at;
            Some((micros(c.settled_at?) - micros(opened)) as f64 / 60e6)
        })
        .collect();
    minutes.sort_by(f64::total_cmp);
    let median = match minutes.len() {
        0 => "n/a".to_string(),
        n if n % 2 == 1 => format!("{:.1} min", minutes[n / 2]),
        n => format!("{:.1} min", (minutes[n / 2 - 1] + minutes[n / 2]) / 2.0),
    };
    let touches = db.db.approval().iter().filter(|a| planted.iter().any(|p| p.claim == a.claim_id)).count();
    let mut weakest: Option<(f64, Kind, String)> = None;
    for kind in FAKES {
        let mine: Vec<(u8, String)> = fakes.iter().filter(|(p, _)| p.kind == kind).map(|(p, c)| reach(p, c)).collect();
        if mine.is_empty() {
            continue;
        }
        let avg = mine.iter().map(|(r, _)| *r as f64).sum::<f64>() / mine.len() as f64;
        let worst = mine.iter().max_by_key(|(r, _)| *r).map(|(_, why)| why.clone()).unwrap_or_default();
        if weakest.as_ref().is_none_or(|(a, _, _)| avg > *a) {
            weakest = Some((avg, kind, worst));
        }
    }
    println!("  score ({label}):");
    println!("    straight-through     {tp} of {} genuine settled with no person ({})", genuine.len(), pct(tp, genuine.len()));
    println!("    wrongly paid         {} on {} fakes (target $0.00)", money(wrongly), fakes.len());
    println!("    auto-settle          precision {}  recall {}", pct(tp, tp + fp), pct(tp, genuine.len()));
    if let Some((_, kind, why)) = weakest {
        println!("    weakest fake type    {}: {why}", kind.label());
    }
    println!(
        "    billed vs paid       genuine {} billed, {} paid; fakes {} billed, {} paid",
        money(billed(&genuine)),
        money(paid_sum(&genuine)),
        money(billed(&fakes)),
        money(paid_sum(&fakes))
    );
    println!("    incident to payout   median {median} over {} paid genuine claims", minutes.len());
    println!(
        "    human touches        {:.2} per claim ({touches} approver decisions on {} claims)",
        touches as f64 / rows.len().max(1) as f64,
        rows.len()
    );
    Ok(())
}
