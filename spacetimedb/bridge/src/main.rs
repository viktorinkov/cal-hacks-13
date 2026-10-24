mod gateway;
mod module_bindings;

use anyhow::{Context, Result, anyhow};
use gateway::{BandLine, Line};
use module_bindings::*;
use spacetimedb_sdk::{DbContext, Table, credentials};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{Arc, Mutex};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const BAND_REFRESH: Duration = Duration::from_secs(1);
const STATION_REFRESH: Duration = Duration::from_secs(2);
const COMMAND_MAX_AGE_MICROS: i64 = 30_000_000;
const ACK_WAIT: Duration = Duration::from_millis(400);
const INFO_RETRY: Duration = Duration::from_secs(2);

struct Args {
    port: String,
    server: String,
    db: String,
}

fn args() -> Result<Args> {
    let mut a = Args { port: String::new(), server: "http://localhost:3000".into(), db: "band1t".into() };
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let v = it.next().ok_or_else(|| anyhow!("{k} needs a value"))?;
        match k.as_str() {
            "--port" => a.port = v,
            "--server" => a.server = v,
            "--db" => a.db = v,
            _ => return Err(anyhow!("unknown option {k}")),
        }
    }
    if a.port.is_empty() {
        return Err(anyhow!("usage: band1t-bridge --port <serial port> [--server <url>] [--db <name>]"));
    }
    Ok(a)
}

fn connect(a: &Args) -> Result<DbConnection> {
    let key = format!("band1t-bridge-{}", a.db);
    let token = credentials::File::new(key.clone()).load().ok().flatten();
    let conn = DbConnection::builder()
        .with_uri(a.server.as_str())
        .with_database_name(a.db.clone())
        .with_token(token)
        .on_connect(move |conn, identity, token| {
            if let Err(e) = credentials::File::new(key).save(token) {
                eprintln!("could not save the bridge token: {e:?}");
            }
            eprintln!("connected as {identity}");
            let _ = conn.reducers.register_bridge_then(|_, r| match r {
                Ok(Ok(())) => eprintln!("registered as the bridge"),
                Ok(Err(e)) => eprintln!("register_bridge refused: {e}"),
                Err(e) => eprintln!("register_bridge failed: {e:?}"),
            });
        })
        .on_connect_error(|_, e| eprintln!("connection error: {e:?}"))
        .on_disconnect(|_, e| {
            eprintln!("disconnected from SpacetimeDB: {e:?}");
            std::process::exit(1);
        })
        .build()
        .context("connecting to SpacetimeDB")?;
    Ok(conn)
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

fn arg_count(name: &str) -> usize {
    match name {
        "clear" | "pay" | "paid" => 0,
        "exit" | "override" | "haptic" | "lowvis" | "sleep" | "buzz" => 1,
        _ => 2,
    }
}

fn command_line(c: &Command) -> String {
    let args = [c.arg, c.arg_2];
    let mut line = format!("cmd {} {}", c.target, c.name);
    for a in &args[..arg_count(&c.name)] {
        line.push_str(&format!(" {a}"));
    }
    line.push('\n');
    line
}

fn send_commands(conn: Arc<DbConnection>, port: Arc<Mutex<Writer>>, rx: Receiver<Command>, acks: Receiver<Option<String>>) {
    let mut done: Vec<u64> = Vec::new();
    for c in rx {
        if done.contains(&c.id) {
            continue;
        }
        if now_micros() - c.created.to_micros_since_unix_epoch() > COMMAND_MAX_AGE_MICROS {
            let _ = conn.reducers.command_sent(c.id, Some("expired before the bridge saw it".into()));
            done.push(c.id);
            continue;
        }
        while acks.try_recv().is_ok() {}
        let written = port.lock().map_err(|_| std::io::Error::other("writer poisoned")).and_then(|mut p| p.write_all(command_line(&c).as_bytes()));
        let result = written
            .map_err(|e| format!("serial write: {e}"))
            .and_then(|_| match acks.recv_timeout(ACK_WAIT) {
                Ok(None) => Ok(()),
                Ok(Some(err)) => Err(err),
                Err(RecvTimeoutError::Timeout) => Err("no ack from the gateway".into()),
                Err(RecvTimeoutError::Disconnected) => Err("serial reader stopped".into()),
            });
        let _ = conn.reducers.command_sent(c.id, result.err());
        done.push(c.id);
        if done.len() > 512 {
            done.drain(..256);
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

fn forward(conn: &DbConnection, line: Line, throttle: &mut Throttle, acks: &Sender<Option<String>>) {
    let sent = match line {
        Line::Band(b) if throttle.band(&b) => conn.reducers.ingest_band(BandBeacon {
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
        Line::Station { id, exit_colour, rssi } if throttle.station(id, exit_colour) => {
            conn.reducers.ingest_station(id, exit_colour, rssi)
        }
        Line::Heard { id, heard } => {
            conn.reducers.ingest_heard(id, heard.into_iter().map(|(id, rssi)| HeardEntry { id, rssi }).collect())
        }
        Line::Gateway { mac, fw } => {
            eprintln!("gateway {mac} fw {fw}");
            conn.reducers.gateway_up(mac, fw)
        }
        Line::Ack => {
            let _ = acks.send(None);
            Ok(())
        }
        Line::CommandError(e) => {
            let _ = acks.send(Some(e));
            Ok(())
        }
        Line::Error(raw) => {
            eprintln!("gateway: {raw}");
            Ok(())
        }
        _ => Ok(()),
    };
    if let Err(e) = sent {
        eprintln!("reducer call failed: {e:?}");
    }
}

type Reader = Box<dyn Read + Send>;
type Writer = Box<dyn Write + Send>;

fn open_port(path: &str) -> Result<(Reader, Writer)> {
    match serialport::new(path, 115200).timeout(Duration::from_millis(200)).open() {
        Ok(p) => {
            let w = p.try_clone().context("cloning the serial port")?;
            Ok((Box::new(p), Box::new(w)))
        }
        Err(e) => {
            let f = OpenOptions::new().read(true).write(true).open(path).with_context(|| format!("opening {path}"))?;
            eprintln!("{path} is not a serial port ({e}); using it as a plain terminal");
            let w = f.try_clone()?;
            Ok((Box::new(f), Box::new(w)))
        }
    }
}

fn main() -> Result<()> {
    let a = args()?;
    let conn = Arc::new(connect(&a)?);
    conn.run_threaded();

    let (port, writer) = open_port(&a.port)?;
    let writer = Arc::new(Mutex::new(writer));

    let (cmd_tx, cmd_rx) = mpsc::channel();
    let (ack_tx, ack_rx) = mpsc::channel();
    watch_commands(&conn, cmd_tx);
    let sender_conn = conn.clone();
    let sender_port = writer.clone();
    std::thread::spawn(move || send_commands(sender_conn, sender_port, cmd_rx, ack_rx));

    let mut reader = BufReader::new(port);
    let mut throttle = Throttle { bands: HashMap::new(), stations: HashMap::new() };
    let mut buf = String::new();
    let mut gateway_known = false;
    let mut last_info: Option<Instant> = None;
    eprintln!("bridging {} -> {} / {}", a.port, a.server, a.db);
    loop {
        if !gateway_known && last_info.is_none_or(|t| t.elapsed() >= INFO_RETRY) {
            if let Ok(mut w) = writer.lock() {
                w.write_all(b"info\n").ok();
            }
            last_info = Some(Instant::now());
        }
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) => return Err(anyhow!("{} closed", a.port)),
            Ok(_) => {
                let line = gateway::parse(buf.trim());
                gateway_known |= matches!(line, Line::Gateway { .. });
                forward(&conn, line, &mut throttle, &ack_tx);
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(e) => return Err(e).context("reading the gateway"),
        }
    }
}
