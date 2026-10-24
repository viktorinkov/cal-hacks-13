mod brightdata;
mod bundle;
mod config;
mod elastic;
mod fetch;
mod load;
mod map;
mod organize;
mod parse;
mod records;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Scrape an event through Bright Data, organize it in Elastic, load it into SpacetimeDB")]
struct Cli {
    #[arg(long, global = true, help = "the folder under events/, for example calhacks-13")]
    event: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Fetch,
    Parse,
    Map,
    ElasticSetup,
    Organize {
        #[arg(long)]
        run_id: Option<String>,
    },
    Assemble {
        #[arg(long)]
        run_id: String,
    },
    Load {
        bundle: PathBuf,
    },
    Verify {
        bundle: PathBuf,
    },
    Run,
}

fn new_run_id(cfg: &config::Config) -> String {
    format!("{}-{}", cfg.event.slug, chrono::Utc::now().format("%Y%m%dt%H%Mz"))
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let cfg = config::Config::load(cli.event.as_deref().context("--event <slug> is required, for example --event calhacks-13")?)?;
    match cli.command {
        Command::Fetch => fetch::run(&cfg),
        Command::Parse => parse::run(&cfg),
        Command::Map => map::run(&cfg),
        Command::ElasticSetup => organize::setup(&cfg),
        Command::Organize { run_id } => organize::run(&cfg, &run_id.unwrap_or_else(|| new_run_id(&cfg))).map(|_| ()),
        Command::Assemble { run_id } => bundle::assemble(&cfg, &run_id).map(|_| ()),
        Command::Load { bundle } => load::run(&cfg, &bundle),
        Command::Verify { bundle } => load::verify(&cfg, &bundle),
        Command::Run => {
            let run_id = new_run_id(&cfg);
            fetch::run(&cfg)?;
            parse::run(&cfg)?;
            map::run(&cfg)?;
            organize::run(&cfg, &run_id)?;
            let path = bundle::assemble(&cfg, &run_id)?;
            load::run(&cfg, &path)?;
            load::verify(&cfg, &path)
        }
    }
}
