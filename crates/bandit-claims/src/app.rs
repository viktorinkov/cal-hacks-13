//! Connections, actors and the small helpers every command shares.

use anyhow::{Context, Result, anyhow, bail};
use bandit_bindings::*;
use bandit_common::{BlobStore, Config, TokenStore};
use spacetimedb_sdk::{Identity, Table, Timestamp};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::fmt::Display;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

pub const DEFAULT_URL: &str = "http://127.0.0.1:3088";
pub const DEFAULT_DATABASE: &str = "bandit-insurance";

/// Staff actors: token name, role, label.
pub const STAFF: &[(&str, &str, &str)] = &[
    ("worker", "worker", "bandit-workers"),
    ("sim", "simulator", "bandit-claims"),
    ("vision", "vision", "bandit-vision"),
    ("ops", "ops", "Ops desk"),
    ("medic", "medic", "Ari Ramos"),
    ("sam", "floor_manager", "Sam Okafor"),
    ("dana", "risk_manager", "Dana Ruiz"),
    ("priya", "adjuster", "Priya Nair, Northwind Mutual"),
];

/// Attendees: token name, display name, band.
pub const ATTENDEES: &[(&str, &str, u8)] =
    &[("jordan", "Jordan Alvarez", 90), ("maya", "Maya Chen", 91), ("sam-patel", "Sam Patel", 92), ("lee", "Lee Park", 93)];

/// Zones the story uses, looked up by name: the venue import decides their stations.
pub const MAIN_STAGE: &str = "Main stage";
pub const SPONSOR_ROW: &str = "Sponsor row";
pub const HACKING_FLOOR: &str = "Hacking floor";

/// Who acts for each rung of the authority matrix.
pub fn approver_for_role(role: &str) -> Option<&'static str> {
    match role {
        "floor_manager" => Some("sam"),
        "risk_manager" => Some("dana"),
        "adjuster" => Some("priya"),
        _ => None,
    }
}

/// Tables the owner connection mirrors (private ones included).
const TABLES: &[&str] = &[
    "staff_role",
    "medical_document",
    "band",
    "band_owner",
    "attendee",
    "zone",
    "booth",
    "schedule_slot",
    "venue",
    "camera",
    "incident",
    "incident_snapshot",
    "incident_band",
    "incident_note",
    "vision_assessment",
    "claim",
    "evidence_fact",
    "evidence_pack",
    "claim_check",
    "medical_record",
    "claim_line",
    "claim_precedent",
    "claim_review",
    "approval",
    "settlement_rule",
    "ledger_entry",
    "authority_limit",
    "insurance_policy",
    "coverage_rule",
    "insurance_settings",
    "claimant_account",
    "job",
    "blob_ref",
    "incident_watch_timer",
    "job_reaper_timer",
];

pub struct App {
    pub cfg: Config,
    pub uri: String,
    pub database: String,
    /// The repository root, for `fixtures/`.
    pub root: PathBuf,
    /// Set by the scorecard: the flow commands then print nothing.
    pub quiet: Cell<bool>,
    owner: RefCell<Option<Rc<DbConnection>>>,
    actors: RefCell<HashMap<String, Rc<DbConnection>>>,
}

impl App {
    /// `SPACETIMEDB_URL` and `SPACETIMEDB_DATABASE` come from the real environment
    /// (read before `.env`, which points at Maincloud); the defaults are the local test server.
    pub fn load() -> Result<App> {
        let env = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let (uri, database) = (env("SPACETIMEDB_URL"), env("SPACETIMEDB_DATABASE"));
        let cfg = Config::load()?;
        let root = cfg
            .env_file
            .as_ref()
            .and_then(|p| p.parent())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
        Ok(App {
            cfg,
            uri: uri.unwrap_or_else(|| DEFAULT_URL.into()),
            database: database.unwrap_or_else(|| DEFAULT_DATABASE.into()),
            root,
            quiet: Cell::new(false),
            owner: RefCell::new(None),
            actors: RefCell::new(HashMap::new()),
        })
    }

    pub fn tokens(&self) -> TokenStore {
        self.cfg.token_store()
    }

    pub fn blobs(&self) -> BlobStore {
        self.cfg.blob_store()
    }

    /// The module owner's token: `BANDIT_OWNER_TOKEN`, else `spacetimedb_token` in `var/spacetime/cli.toml`.
    fn owner_token(&self) -> Result<String> {
        if let Some(t) = std::env::var("BANDIT_OWNER_TOKEN").ok().filter(|t| !t.trim().is_empty()) {
            return Ok(t.trim().into());
        }
        let path = self.cfg.data_dir.join("spacetime/cli.toml");
        let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        text.lines()
            .find_map(|l| {
                let (k, v) = l.split_once('=')?;
                (k.trim() == "spacetimedb_token").then(|| v.trim().trim_matches('"').to_string())
            })
            .with_context(|| format!("no spacetimedb_token in {}", path.display()))
    }

    /// The owner connection, subscribed to every table the CLI reads.
    pub fn db(&self) -> Result<Rc<DbConnection>> {
        if let Some(c) = self.owner.borrow().as_ref() {
            return Ok(c.clone());
        }
        let (conn, _, _) = bandit_bindings::connect(&self.uri, &self.database, Some(self.owner_token()?))
            .with_context(|| format!("connecting to {} at {} as the module owner", self.database, self.uri))?;
        let queries: Vec<String> = TABLES.iter().map(|t| format!("SELECT * FROM {t}")).collect();
        let queries: Vec<&str> = queries.iter().map(String::as_str).collect();
        bandit_bindings::subscribe(&conn, &queries)?;
        let conn = Rc::new(conn);
        *self.owner.borrow_mut() = Some(conn.clone());
        Ok(conn)
    }

    /// A fresh connection as the named actor. With `create`, a missing actor
    /// gets a new identity whose token is saved.
    pub fn connect_as(&self, name: &str, create: bool) -> Result<DbConnection> {
        let store = self.tokens();
        let token = store.load(name)?;
        if token.is_none() && !create {
            bail!("no identity {name} in {}; run `bandit-claims setup` first", store.dir().display());
        }
        let (conn, _, new_token) =
            bandit_bindings::connect(&self.uri, &self.database, token.clone()).with_context(|| format!("connecting as {name}"))?;
        if token.as_deref() != Some(new_token.as_str()) {
            store.save(name, &new_token)?;
        }
        Ok(conn)
    }

    /// The cached connection as the named actor (one per identity per process).
    pub fn actor_with(&self, name: &str, create: bool) -> Result<Rc<DbConnection>> {
        if let Some(c) = self.actors.borrow().get(name) {
            return Ok(c.clone());
        }
        let conn = Rc::new(self.connect_as(name, create)?);
        self.actors.borrow_mut().insert(name.into(), conn.clone());
        Ok(conn)
    }

    pub fn actor(&self, name: &str) -> Result<Rc<DbConnection>> {
        self.actor_with(name, false)
    }

    pub fn claim(&self, id: u64) -> Result<Claim> {
        self.db()?.db.claim().id().find(&id).with_context(|| format!("no claim {id}"))
    }

    pub fn incident(&self, id: u64) -> Result<Incident> {
        self.db()?.db.incident().id().find(&id).with_context(|| format!("no incident {id}"))
    }

    pub fn zone_by_name(&self, name: &str) -> Result<Zone> {
        let db = self.db()?;
        let found = db.db.zone().iter().find(|z| z.name.eq_ignore_ascii_case(name.trim()));
        found.with_context(|| {
            let names: Vec<String> = db.db.zone().iter().map(|z| z.name).collect();
            format!("no zone {name:?} (zones: {})", names.join(", "))
        })
    }

    /// The station that anchors the named zone.
    pub fn station(&self, zone_name: &str) -> Result<u8> {
        let zone = self.zone_by_name(zone_name)?;
        if zone.station_id == 0 {
            bail!("zone {} has no station", zone.name);
        }
        Ok(zone.station_id)
    }

    /// Zones that have a station, Main stage first.
    pub fn stationed_zones(&self) -> Result<Vec<Zone>> {
        let mut zones: Vec<Zone> = self.db()?.db.zone().iter().filter(|z| z.station_id != 0).collect();
        zones.sort_by_key(|z| (z.name != MAIN_STAGE, z.station_id));
        Ok(zones)
    }

    pub fn zone_by_station(&self, station: u8) -> Option<Zone> {
        self.db().ok()?.db.zone().iter().find(|z| z.station_id == station)
    }

    pub fn zone_name(&self, zone_id: u64) -> String {
        match self.db().ok().and_then(|db| db.db.zone().id().find(&zone_id)) {
            Some(z) => z.name,
            None if zone_id == 0 => "unzoned".into(),
            None => format!("zone {zone_id}"),
        }
    }

    pub fn station_name(&self, station: u8) -> String {
        self.zone_by_station(station).map(|z| z.name).unwrap_or_else(|| format!("station {station}"))
    }

    /// The venue's UTC offset, from the module's settings row.
    pub fn tz(&self) -> i32 {
        let default = hyphenate_core::config::Config::default().tz_offset_minutes;
        self.db().ok().and_then(|db| db.db.insurance_settings().id().find(&0)).map_or(default, |s| s.tz_offset_minutes)
    }

    /// `HH:MM:SS` in venue time.
    pub fn hms(&self, t: Timestamp) -> String {
        hyphenate_core::time::local_hms(micros(t), self.tz())
    }

    /// The display name of an identity: attendee, staff label, or short hex.
    pub fn person(&self, who: Identity) -> String {
        let Ok(db) = self.db() else { return short_id(who) };
        if let Some(a) = db.db.attendee().identity().find(&who).filter(|a| !a.display_name.is_empty()) {
            return a.display_name;
        }
        db.db.staff_role().iter().find(|r| r.identity == who).map(|r| r.label).unwrap_or_else(|| short_id(who))
    }

    /// True when a worker leased or finished a job in the last minute.
    pub fn worker_active(&self) -> bool {
        let Ok(db) = self.db() else { return false };
        let now = now_micros();
        db.db.job().iter().any(|j| j.status == JobStatus::Leased || (j.attempts > 0 && now - micros(j.updated_at) < 60_000_000))
    }

    /// How to start the worker; a local database gets its own Elastic index so
    /// test claims never become precedents in the live one.
    pub fn worker_hint(&self) -> String {
        let local = self.uri.contains("127.0.0.1") || self.uri.contains("localhost");
        let index = if local { format!(" ELASTIC_INDEX_PREFIX={}-local", self.database) } else { String::new() };
        format!(
            "no worker has leased a job in the last minute; if it is not running, start it with\n    SPACETIMEDB_URL={} SPACETIMEDB_DATABASE={}{index} cargo run -p bandit-workers",
            self.uri, self.database
        )
    }
}

/// `println!` unless the app is quiet.
macro_rules! say {
    ($app:expr, $($arg:tt)*) => {
        if !$app.quiet.get() {
            println!($($arg)*);
        }
    };
}

/// Calls a reducer through its `_then` variant and waits for the module's answer.
macro_rules! call {
    ($conn:expr, $reducer:ident ( $($arg:expr),* $(,)? )) => {{
        let (tx, rx) = std::sync::mpsc::channel();
        let sent = $conn.reducers.$reducer($($arg,)* move |_, r| {
            let _ = tx.send(r);
        });
        $crate::app::answer(stringify!($reducer), sent, rx)
    }};
}

/// The outcome of a reducer call, with the module's error text when it refused.
pub fn answer<E: Display>(
    name: &str,
    sent: spacetimedb_sdk::Result<()>,
    rx: Receiver<std::result::Result<std::result::Result<(), String>, E>>,
) -> Result<()> {
    let name = name.trim_end_matches("_then");
    sent.map_err(|e| anyhow!("{name}: {e}"))?;
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(msg))) => Err(anyhow!("{name}: {msg}")),
        Ok(Err(e)) => Err(anyhow!("{name}: {e}")),
        Err(_) => Err(anyhow!("{name}: no answer from SpacetimeDB in 30 s")),
    }
}

/// Polls `f` every 100 ms until it returns `Some` or `secs` pass.
pub fn until<T>(secs: f64, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let end = Instant::now() + Duration::from_secs_f64(secs);
    loop {
        if let Some(v) = f() {
            return Some(v);
        }
        if Instant::now() >= end {
            return None;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

pub fn micros(t: Timestamp) -> i64 {
    t.to_micros_since_unix_epoch()
}

pub fn now_micros() -> i64 {
    micros(Timestamp::now())
}

/// `$1,234.56`.
pub fn money(cents: u64) -> String {
    hyphenate_core::money::format_cents(cents)
}

/// Dollars from the command line (`2400`, `2,400.00`, `$895.00`) to cents.
pub fn parse_money(s: &str) -> Result<u64> {
    hyphenate_core::money::parse_dollars(s.trim().trim_start_matches('$')).with_context(|| format!("{s:?} is not a dollar amount"))
}

pub fn short_id(who: Identity) -> String {
    who.to_hex().to_string()[..12].to_string()
}

pub fn short_hash(h: &str) -> &str {
    hyphenate_core::pack::short_sha(h)
}

pub fn status_name(s: ClaimStatus) -> &'static str {
    match s {
        ClaimStatus::AwaitingRecord => "awaiting_record",
        ClaimStatus::ReadingRecord => "reading_record",
        ClaimStatus::Verifying => "verifying",
        ClaimStatus::Reviewing => "reviewing",
        ClaimStatus::Routed => "routed",
        ClaimStatus::Paying => "paying",
        ClaimStatus::Settled => "settled",
        ClaimStatus::Refused => "refused",
        ClaimStatus::Reconciled => "reconciled",
    }
}

pub fn parse_status(s: &str) -> Result<ClaimStatus> {
    use ClaimStatus::*;
    [AwaitingRecord, ReadingRecord, Verifying, Reviewing, Routed, Paying, Settled, Refused, Reconciled]
        .into_iter()
        .find(|x| status_name(*x) == s.trim().to_lowercase().replace('-', "_"))
        .with_context(|| format!("unknown claim status {s:?}"))
}

/// Still moving on its own: the record reader, Elastic, the agent or the payout.
pub fn in_pipeline(s: ClaimStatus) -> bool {
    matches!(s, ClaimStatus::ReadingRecord | ClaimStatus::Verifying | ClaimStatus::Reviewing | ClaimStatus::Paying)
}

pub fn kind_name(k: IncidentKind) -> &'static str {
    match k {
        IncidentKind::Sos => "sos",
        IncidentKind::Fall => "fall",
        IncidentKind::Property => "property",
    }
}
