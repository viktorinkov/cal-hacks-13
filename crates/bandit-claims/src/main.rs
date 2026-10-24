//! `bandit-claims`: plays every person and device in BandIt's insurance
//! claims flow against the SpacetimeDB module, and shows what it recorded.

#[macro_use]
mod app;
mod decide;
mod story;
mod flow;
mod scorecard;
mod setup;
mod show;
mod test_bands;

use anyhow::Result;
use app::{App, parse_money, parse_status};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "bandit-claims", about = "Drive and show BandIt's insurance claims flow", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create the actors, venue, bands, policy and camera (safe to run again)
    Setup,
    /// Identities, roles, and whether the worker is running
    Status,
    /// A band reports a fall and the bands around it show the light circle
    Fall {
        /// A test band, 90-99
        #[arg(long)]
        band: u8,
        /// Comma-separated test band ids (90-99), for example 94,95,96
        #[arg(long, value_delimiter = ',')]
        witnesses: Vec<u8>,
        /// The zone the band falls in
        #[arg(long, default_value = app::MAIN_STAGE)]
        zone: String,
        /// The zone where the circle forms (default: the fall's zone)
        #[arg(long)]
        witness_zone: Option<String>,
        /// A raw station id instead of --zone
        #[arg(long)]
        station: Option<u8>,
        /// A raw station id instead of --witness-zone
        #[arg(long)]
        witness_station: Option<u8>,
    },
    /// The medic takes the incident and writes a note
    Treat {
        #[arg(long)]
        incident: u64,
        #[arg(long)]
        note: String,
    },
    /// The medic resolves the incident; a claim opens when it qualifies
    Resolve {
        #[arg(long)]
        incident: u64,
        #[arg(long, default_value = "treated on site")]
        resolution: String,
    },
    /// The floor manager logs damaged equipment and resolves it
    Property {
        #[arg(long)]
        zone: String,
        #[arg(long)]
        note: String,
        /// Repair cost in dollars, for example 2400.00
        #[arg(long)]
        cost: String,
        /// Also play the vision stub: a confirmed camera assessment
        #[arg(long)]
        camera: bool,
    },
    /// Render a medical record for the claim's incident date and file it as the medic
    AttachRecord {
        #[arg(long)]
        claim: u64,
        /// first-aid-wrist, urgent-care-wrist or urgent-care-ankle-home
        #[arg(long)]
        template: String,
        /// Invoice suffix (default: the template's)
        #[arg(long)]
        invoice_suffix: Option<String>,
        /// Make the record out to the claimant, with an invoice number of the claim's own
        #[arg(long)]
        for_claimant: bool,
    },
    /// One line per claim
    Claims,
    /// Everything about one claim
    Show { claim: u64 },
    /// Show the approval grid and approve with exactly what it shows
    Approve {
        claim: u64,
        /// The actor who decides (default: ops, the organizer)
        #[arg(long = "as")]
        as_: Option<String>,
        /// Ceiling for the learned rule, in dollars
        #[arg(long)]
        ceiling: Option<String>,
        #[arg(long)]
        no_learn: bool,
        /// Send a wrong amount on purpose to show the module failing closed
        #[arg(long)]
        stale: bool,
    },
    /// Show the approval grid and refuse
    Refuse {
        claim: u64,
        #[arg(long = "as")]
        as_: Option<String>,
        #[arg(long)]
        reason: String,
    },
    /// The insurer paid the venue (recorded by the organizer)
    InsurerPaid {
        claim: u64,
        #[arg(long)]
        amount: String,
        #[arg(long = "ref")]
        reference: String,
    },
    /// Ask for a recovery letter on a settled property claim (as the organizer)
    Recovery {
        claim: u64,
        #[arg(long)]
        to: String,
        #[arg(long)]
        contact: String,
    },
    /// Print the claim's letters from the blob store
    Letters { claim: u64 },
    /// Recompute the evidence pack hash from the stored facts
    VerifyPack {
        claim: u64,
        /// Also print the canonical lines that are hashed
        #[arg(long)]
        lines: bool,
    },
    /// Block until the claim reaches a status, printing each change
    Wait {
        claim: u64,
        #[arg(long, default_value = "settled")]
        status: String,
        #[arg(long, default_value_t = 180)]
        timeout: u64,
    },
    /// The scripted story, end to end
    Story {
        #[arg(long)]
        no_pause: bool,
    },
    /// Accuracy run: genuine falls and planted fakes, with the approvers played
    Scorecard {
        #[arg(long, default_value_t = 3)]
        rounds: u32,
    },
}

fn main() {
    if let Err(e) = run(Cli::parse()) {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<()> {
    let app = App::load()?;
    match cli.cmd {
        Cmd::Setup => setup::run(&app).map(drop),
        Cmd::Status => setup::status(&app),
        Cmd::Fall { band, witnesses, zone, witness_zone, station, witness_station } => {
            let station = match station {
                Some(s) => s,
                None => app.station(&zone)?,
            };
            let witness_station = match (witness_station, witness_zone) {
                (Some(s), _) => s,
                (None, Some(z)) => app.station(&z)?,
                (None, None) => station,
            };
            let test_bands = test_bands::TestBands::open(&app)?;
            sleep_for_preroll();
            let incident = flow::fall(&app, &test_bands, band, station, &witnesses, witness_station)?;
            drop(test_bands);
            flow::print_incident(&app, incident.id)
        }
        Cmd::Treat { incident, note } => flow::treat(&app, incident, &note),
        Cmd::Resolve { incident, resolution } => flow::resolve(&app, incident, &resolution, "medic").map(|_| ()),
        Cmd::Property { zone, note, cost, camera } => flow::property(&app, &zone, &note, parse_money(&cost)?, camera).map(|_| ()),
        Cmd::AttachRecord { claim, template, invoice_suffix, for_claimant } => {
            let (suffix, patient) = if for_claimant {
                let c = app.claim(claim)?;
                (Some(invoice_suffix.unwrap_or_else(|| format!("2410-{claim:04}"))), Some(c.claimant_name))
            } else {
                (invoice_suffix, None)
            };
            flow::attach_record(&app, claim, &template, suffix.as_deref(), patient.as_deref()).map(|_| ())
        }
        Cmd::Claims => show::claims(&app),
        Cmd::Show { claim } => show::show(&app, claim),
        Cmd::Approve { claim, as_, ceiling, no_learn, stale } => {
            let ceiling = ceiling.as_deref().map(parse_money).transpose()?;
            decide::approve(&app, claim, as_.as_deref(), ceiling, !no_learn, stale, true).map(|_| ())
        }
        Cmd::Refuse { claim, as_, reason } => decide::refuse(&app, claim, as_.as_deref(), &reason, true).map(|_| ()),
        Cmd::InsurerPaid { claim, amount, reference } => {
            decide::insurer_paid(&app, claim, parse_money(&amount)?, &reference, None).map(|_| ())
        }
        Cmd::Recovery { claim, to, contact } => decide::recovery(&app, claim, &to, &contact, None),
        Cmd::Letters { claim } => show::letters(&app, claim),
        Cmd::VerifyPack { claim, lines } => {
            if show::verify_pack(&app, claim, lines)? {
                Ok(())
            } else {
                anyhow::bail!("pack hash mismatch")
            }
        }
        Cmd::Wait { claim, status, timeout } => show::wait(&app, claim, parse_status(&status)?, timeout).map(|_| ()),
        Cmd::Story { no_pause } => story::run(&app, !no_pause),
        Cmd::Scorecard { rounds } => scorecard::run(&app, rounds),
    }
}

/// Lets the bands come online for a second before something happens to them.
fn sleep_for_preroll() {
    app::sleep_ms(1200);
}
