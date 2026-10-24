mod gateway;
mod module_bindings;

use anyhow::{Context, Result, anyhow};
use gateway::{Ack, BandLine, Line, Lines};
use module_bindings::*;
use spacetimedb_sdk::{DbContext, Table, credentials};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{ErrorKind, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const BAND_REFRESH: Duration = Duration::from_secs(1);
const STATION_REFRESH: Duration = Duration::from_secs(2);
const COMMAND_MAX_AGE_MICROS: i64 = 30_000_000;
const ACK_WAIT: Duration = Duration::from_millis(400);
const INFO_RETRY: Duration = Duration::from_secs(2);
const SETTLE: Duration = Duration::from_secs(1);
const REOPEN: Duration = Duration::from_secs(1);
const STATUS_EVERY: Duration = Duration::from_secs(10);
const CONNECT_WAIT: Duration = Duration::from_secs(10);
const BACKOFF_MAX: Duration = Duration::from_secs(15);
const PORT_WAIT: Duration = Duration::from_secs(2);

struct Args {
    port: String,
    server: String,
    db: String,
    bands: Vec<u8>,
}

fn args() -> Result<Args> {
    let env = |k: &str, d: &str| std::env::var(k).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| d.into());
    let mut a = Args {
        port: String::new(),
        server: env("SPACETIMEDB_URL", "http://localhost:3000"),
        db: env("SPACETIMEDB_DATABASE", "band1t"),
        bands: (1..=9).collect(),
    };
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let v = it.next().ok_or_else(|| anyhow!("{k} needs a value"))?;
        match k.as_str() {
            "--port" => a.port = v,
            "--server" => a.server = v,
            "--db" => a.db = v,
            "--bands" => a.bands = gateway::parse_bands(&v).ok_or_else(|| anyhow!("--bands takes 1-9 or 1,2,5"))?,
            _ => return Err(anyhow!("unknown option {k}")),
        }
    }
    if a.port.is_empty() {
        return Err(anyhow!("usage: band1t-bridge --port <serial port> [--server <url>] [--db <name>] [--bands 1-9]"));
    }
    Ok(a)
}

#[derive(Default)]
struct Stats {
    lines: u64,
    bands: u64,
    heard: u64,
    stations: u64,
    commands_ok: u64,
    commands_failed: u64,
    ignored: u64,
    dropped: u64,
    reducer_errors: u64,
    last_line: Option<Instant>,
}

struct Link {
    conn: Mutex<Option<Arc<DbConnection>>>,
    alive: AtomicBool,
    gateway: Mutex<Option<(String, String)>>,
}

impl Link {
    fn current(&self) -> Option<Arc<DbConnection>> {
        if self.alive.load(Ordering::SeqCst) { self.conn.lock().ok()?.clone() } else { None }
    }
}

fn connect(a: &Args, link: Arc<Link>, commands: Sender<Command>) -> Result<Arc<DbConnection>> {
    let key = format!("band1t-bridge-{}", a.db);
    let token = credentials::File::new(key.clone()).load().ok().flatten();
    let on_connect_link = link.clone();
    let on_disconnect_link = link.clone();
    let on_error_link = link.clone();
    let conn = DbConnection::builder()
        .with_uri(a.server.as_str())
        .with_database_name(a.db.clone())
        .with_token(token)
        .on_connect(move |conn, identity, token| {
            if let Err(e) = credentials::File::new(key).save(token) {
                eprintln!("could not save the bridge token: {e:?}");
            }
            eprintln!("connected as {identity}");
            let gateway = on_connect_link.gateway.lock().ok().and_then(|g| g.clone());
            let _ = conn.reducers.register_bridge_then(move |ctx, r| match r {
                Ok(Ok(())) => {
                    eprintln!("registered as the bridge");
                    if let Some((mac, fw)) = gateway {
                        let _ = ctx.reducers.gateway_up(mac, fw);
                    }
                }
                Ok(Err(e)) => eprintln!("register_bridge refused: {e} (the owner can call reset_bridge)"),
                Err(e) => eprintln!("register_bridge failed: {e:?}"),
            });
            on_connect_link.alive.store(true, Ordering::SeqCst);
        })
        .on_connect_error(move |_, e| {
            eprintln!("connection error: {e:?}");
            on_error_link.alive.store(false, Ordering::SeqCst);
        })
        .on_disconnect(move |_, e| {
            eprintln!("disconnected from SpacetimeDB: {e:?}");
            on_disconnect_link.alive.store(false, Ordering::SeqCst);
        })
        .build()
        .context("connecting to SpacetimeDB")?;
    conn.run_threaded();
    watch_commands(&conn, commands);
    Ok(Arc::new(conn))
}

fn supervise(a: Arc<Args>, link: Arc<Link>, commands: Sender<Command>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        if link.alive.load(Ordering::SeqCst) {
            backoff = Duration::from_secs(1);
            std::thread::sleep(Duration::from_millis(500));
            continue;
        }
        if let Some(old) = link.conn.lock().ok().and_then(|mut c| c.take()) {
            let _ = old.disconnect();
        }
        match connect(&a, link.clone(), commands.clone()) {
            Ok(conn) => {
                if let Ok(mut c) = link.conn.lock() {
                    *c = Some(conn);
                }
                let started = Instant::now();
                while !link.alive.load(Ordering::SeqCst) && started.elapsed() < CONNECT_WAIT {
                    std::thread::sleep(Duration::from_millis(100));
                }
                if link.alive.load(Ordering::SeqCst) {
                    continue;
                }
            }
            Err(e) => eprintln!("{e:#}"),
        }
        eprintln!("reconnecting in {} s", backoff.as_secs());
        std::thread::sleep(backoff);
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

fn now_micros() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as i64).unwrap_or(0)
}

fn watch_commands(conn: &DbConnection, tx: Sender<Command>) {
    conn.db.command().on_insert(move |_, c| {
        if c.pending {
            let _ = tx.send(c.clone());
        }
    });
    conn.subscription_builder()
        .on_error(|_, e| eprintln!("subscription error: {e:?}"))
        .subscribe(["SELECT * FROM command WHERE pending = true"]);
}

enum Reply {
    Ack(Ack),
    Error(String),
}

type Writer = Box<dyn Write + Send>;
type SharedWriter = Arc<Mutex<Option<Writer>>>;

fn write_line(port: &SharedWriter, line: &str) -> std::io::Result<()> {
    let started = Instant::now();
    loop {
        let res = match port.lock() {
            Ok(mut w) => match w.as_mut() {
                Some(w) => w.write_all(line.as_bytes()).and_then(|_| w.flush()),
                None => Err(std::io::Error::new(ErrorKind::NotConnected, "the gateway port is not open")),
            },
            Err(_) => Err(std::io::Error::other("writer poisoned")),
        };
        match res {
            Err(e) if matches!(e.kind(), ErrorKind::NotConnected | ErrorKind::WouldBlock) && started.elapsed() < PORT_WAIT => {
                std::thread::sleep(Duration::from_millis(50));
            }
            other => return other,
        }
    }
}

fn deliver(c: &Command, port: &SharedWriter, replies: &Receiver<Reply>) -> Result<(), String> {
    while replies.try_recv().is_ok() {}
    let line = gateway::command_line(c.target, &c.name, c.arg, c.arg_2);
    let expect = gateway::expected_ack(c.target, &c.name, c.arg, c.arg_2);
    let mut retried = false;
    write_line(port, &line).map_err(|e| format!("serial write: {e}"))?;
    let mut deadline = Instant::now() + ACK_WAIT;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err("no ack from the gateway".into());
        }
        match replies.recv_timeout(left) {
            Ok(Reply::Ack(a)) if expect.is_none() || expect == Some(a) => return Ok(()),
            Ok(Reply::Ack(_)) => continue,
            Ok(Reply::Error(e)) if e.starts_with("busy") && !retried => {
                retried = true;
                std::thread::sleep(Duration::from_millis(100));
                write_line(port, &line).map_err(|e| format!("serial write: {e}"))?;
                deadline = Instant::now() + ACK_WAIT;
            }
            Ok(Reply::Error(e)) => return Err(e),
            Err(RecvTimeoutError::Timeout) => return Err("no ack from the gateway".into()),
            Err(RecvTimeoutError::Disconnected) => return Err("serial reader stopped".into()),
        }
    }
}

fn send_commands(link: Arc<Link>, port: SharedWriter, rx: Receiver<Command>, replies: Receiver<Reply>, stats: Arc<Mutex<Stats>>) {
    let mut done: HashMap<u64, Option<String>> = HashMap::new();
    for c in rx {
        let outcome = match done.get(&c.id) {
            Some(o) => o.clone(),
            None => {
                let o = if now_micros() - c.created.to_micros_since_unix_epoch() > COMMAND_MAX_AGE_MICROS {
                    Some("expired before the bridge saw it".to_string())
                } else {
                    deliver(&c, &port, &replies).err()
                };
                if let Ok(mut s) = stats.lock() {
                    if o.is_none() { s.commands_ok += 1 } else { s.commands_failed += 1 }
                }
                if let Some(e) = &o {
                    eprintln!("command {} ({} {} {} {}) failed: {e}", c.id, c.target, c.name, c.arg, c.arg_2);
                }
                done.insert(c.id, o.clone());
                if done.len() > 1024 {
                    let mut ids: Vec<u64> = done.keys().copied().collect();
                    ids.sort();
                    for id in &ids[..512] {
                        done.remove(id);
                    }
                }
                o
            }
        };
        match link.current() {
            Some(conn) => {
                let _ = conn.reducers.command_sent(c.id, outcome);
            }
            None => eprintln!("command {}: no connection to confirm it, it is confirmed when it comes back", c.id),
        }
    }
}

struct Throttle {
    bands: HashMap<u8, (BandLine, Instant)>,
    stations: HashMap<u8, (u8, Instant)>,
}

impl Throttle {
    fn band(&mut self, b: &BandLine) -> bool {
        let key = BandLine { rssi: 0, seq: 0, ..*b };
        let now = Instant::now();
        match self.bands.get(&b.id) {
            Some((last, at)) if *last == key && now.duration_since(*at) < BAND_REFRESH => false,
            _ => {
                self.bands.insert(b.id, (key, now));
                true
            }
        }
    }

    fn station(&mut self, id: u8, colour: u8) -> bool {
        let now = Instant::now();
        match self.stations.get(&id) {
            Some((c, at)) if *c == colour && now.duration_since(*at) < STATION_REFRESH => false,
            _ => {
                self.stations.insert(id, (colour, now));
                true
            }
        }
    }
}

struct Forwarder {
    link: Arc<Link>,
    replies: Sender<Reply>,
    stats: Arc<Mutex<Stats>>,
    throttle: Throttle,
    bands: Vec<u8>,
    ignored: Vec<u8>,
}

impl Forwarder {
    fn ignore(&mut self, id: u8) {
        if let Ok(mut s) = self.stats.lock() {
            s.ignored += 1;
        }
        if !self.ignored.contains(&id) {
            self.ignored.push(id);
            eprintln!("ignoring band {id}: not in --bands (the module keeps 10 to 99 for simulated bands)");
        }
    }

    fn handle(&mut self, line: Line) {
        if let Ok(mut s) = self.stats.lock() {
            s.lines += 1;
            s.last_line = Some(Instant::now());
        }
        let line = match line {
            Line::Ack(a) => {
                let _ = self.replies.send(Reply::Ack(a));
                return;
            }
            Line::CommandError(e) => {
                let _ = self.replies.send(Reply::Error(e));
                return;
            }
            Line::Error(raw) => {
                eprintln!("gateway: {raw}");
                return;
            }
            Line::Gateway { mac, fw } => {
                eprintln!("gateway {mac} fw {fw}");
                if let Ok(mut g) = self.link.gateway.lock() {
                    *g = Some((mac.clone(), fw.clone()));
                }
                Line::Gateway { mac, fw }
            }
            Line::Band(b) if !self.bands.contains(&b.id) => {
                self.ignore(b.id);
                return;
            }
            Line::Heard { id, .. } if !self.bands.contains(&id) => {
                self.ignore(id);
                return;
            }
            Line::Heard { id, heard } => {
                let keep = heard.into_iter().filter(|(h, _)| *h >= 101 || self.bands.contains(h)).collect();
                Line::Heard { id, heard: keep }
            }
            other => other,
        };
        let Some(conn) = self.link.current() else {
            if !matches!(line, Line::Other) {
                if let Ok(mut s) = self.stats.lock() {
                    s.dropped += 1;
                }
            }
            return;
        };
        let (sent, kind) = match line {
            Line::Band(b) if self.throttle.band(&b) => (
                conn.reducers.ingest_band(BandBeacon {
                    id: b.id,
                    rssi: b.rssi,
                    flags: b.flags,
                    neigh: b.neigh,
                    zone: b.zone,
                    bat: b.bat,
                    state: b.state,
                    seq: b.seq,
                    find: b.find,
                }),
                1,
            ),
            Line::Station { id, exit_colour, rssi } if self.throttle.station(id, exit_colour) => {
                (conn.reducers.ingest_station(id, exit_colour, rssi), 2)
            }
            Line::Heard { id, heard } => (
                conn.reducers.ingest_heard(id, heard.into_iter().map(|(id, rssi)| HeardEntry { id, rssi }).collect()),
                4,
            ),
            Line::Gateway { mac, fw } => (conn.reducers.gateway_up(mac, fw), 0),
            _ => return,
        };
        if let Ok(mut s) = self.stats.lock() {
            match (&sent, kind) {
                (Err(_), _) => s.reducer_errors += 1,
                (Ok(_), 1) => s.bands += 1,
                (Ok(_), 2) => s.stations += 1,
                (Ok(_), 4) => s.heard += 1,
                _ => {}
            }
        }
        if let Err(e) = sent {
            eprintln!("reducer call failed: {e:?}");
        }
    }
}

type Reader = Box<dyn Read + Send>;

fn open_port(path: &str) -> Result<(Reader, Writer, Option<RawFd>)> {
    match serialport::new(path, 115200).timeout(Duration::from_millis(200)).open() {
        Ok(p) => {
            let w = p.try_clone().context("cloning the serial port")?;
            Ok((Box::new(p), Box::new(w), None))
        }
        Err(e) => {
            let f = OpenOptions::new().read(true).write(true).open(path).with_context(|| format!("opening {path}"))?;
            let fd = f.as_raw_fd();
            unsafe {
                let flags = libc::fcntl(fd, libc::F_GETFL);
                libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
            }
            eprintln!("{path} is not a serial port ({e}); using it as a plain terminal");
            let w = f.try_clone()?;
            Ok((Box::new(f), Box::new(w), Some(fd)))
        }
    }
}

fn wait_readable(fd: RawFd, timeout: Duration) -> bool {
    let mut p = libc::pollfd { fd, events: libc::POLLIN, revents: 0 };
    unsafe { libc::poll(&mut p, 1, timeout.as_millis() as libc::c_int) > 0 }
}

fn read_port(a: &Args, mut reader: Reader, fd: Option<RawFd>, writer: &SharedWriter, fwd: &mut Forwarder) -> anyhow::Error {
    let opened = Instant::now();
    let mut lines = Lines::new();
    let mut settled = false;
    let mut gateway_known = false;
    let mut last_info: Option<Instant> = None;
    let mut buf = [0u8; 4096];
    loop {
        if !settled && opened.elapsed() >= SETTLE {
            settled = true;
        }
        if settled && !gateway_known && last_info.is_none_or(|t| t.elapsed() >= INFO_RETRY) {
            let _ = write_line(writer, "info\n");
            last_info = Some(Instant::now());
        }
        if let Some(fd) = fd {
            if !wait_readable(fd, Duration::from_millis(100)) {
                continue;
            }
        }
        match reader.read(&mut buf) {
            Ok(0) => return anyhow!("{} closed", a.port),
            Ok(n) => {
                if !settled {
                    continue;
                }
                for text in lines.push(&buf[..n]) {
                    let line = gateway::parse(text.trim());
                    gateway_known |= matches!(line, Line::Gateway { .. });
                    fwd.handle(line);
                }
            }
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock | ErrorKind::Interrupted) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return anyhow!("reading {}: {e}", a.port),
        }
    }
}

fn status(link: Arc<Link>, writer: SharedWriter, stats: Arc<Mutex<Stats>>) {
    let mut last = 0u64;
    loop {
        std::thread::sleep(STATUS_EVERY);
        let connected = link.current().is_some();
        let port = writer.lock().map(|w| w.is_some()).unwrap_or(false);
        if let Ok(s) = stats.lock() {
            let age = s.last_line.map(|t| format!("{:.1} s ago", t.elapsed().as_secs_f32())).unwrap_or("never".into());
            eprintln!(
                "status: database {}, port {}, lines {} (+{}), last {age}; forwarded bands {} heard {} stations {}; \
                 commands ok {} failed {}; ignored {}, dropped while offline {}, reducer errors {}",
                if connected { "up" } else { "down" },
                if port { "open" } else { "closed" },
                s.lines,
                s.lines - last,
                s.bands,
                s.heard,
                s.stations,
                s.commands_ok,
                s.commands_failed,
                s.ignored,
                s.dropped,
                s.reducer_errors
            );
            last = s.lines;
        }
    }
}

fn main() -> Result<()> {
    let a = Arc::new(args()?);
    let link = Arc::new(Link { conn: Mutex::new(None), alive: AtomicBool::new(false), gateway: Mutex::new(None) });
    let stats = Arc::new(Mutex::new(Stats::default()));
    let writer: SharedWriter = Arc::new(Mutex::new(None));
    let (cmd_tx, cmd_rx) = mpsc::channel();
    let (reply_tx, reply_rx) = mpsc::channel();

    {
        let (a, link) = (a.clone(), link.clone());
        std::thread::spawn(move || supervise(a, link, cmd_tx));
    }
    {
        let (link, writer, stats) = (link.clone(), writer.clone(), stats.clone());
        std::thread::spawn(move || send_commands(link, writer, cmd_rx, reply_rx, stats));
    }
    {
        let (link, writer, stats) = (link.clone(), writer.clone(), stats.clone());
        std::thread::spawn(move || status(link, writer, stats));
    }

    let mut fwd = Forwarder {
        link,
        replies: reply_tx,
        stats,
        throttle: Throttle { bands: HashMap::new(), stations: HashMap::new() },
        bands: a.bands.clone(),
        ignored: Vec::new(),
    };
    eprintln!("bridging {} -> {} / {}, bands {:?}", a.port, a.server, a.db, a.bands);
    loop {
        match open_port(&a.port) {
            Ok((reader, w, fd)) => {
                if let Ok(mut slot) = writer.lock() {
                    *slot = Some(w);
                }
                let why = read_port(&a, reader, fd, &writer, &mut fwd);
                if let Ok(mut slot) = writer.lock() {
                    *slot = None;
                }
                eprintln!("{why:#}; reopening in 1 s");
            }
            Err(e) => eprintln!("{e:#}; retrying in 1 s"),
        }
        std::thread::sleep(REOPEN);
    }
}
