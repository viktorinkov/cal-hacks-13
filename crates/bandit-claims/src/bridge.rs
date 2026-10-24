//! The bridge: one connection that plays the radio gateway. A pump thread
//! reports every band it knows about once a second (bands drop offline after
//! 5 s of silence) and at once whenever a band's pose changes.

use crate::app::{App, sleep_ms};
use anyhow::{Context, Result};
use bandit_bindings::*;
use spacetimedb_sdk::Table;
use std::collections::BTreeMap;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

pub const F_FALL: u8 = 2;
pub const F_PRESS: u8 = 4;
/// Accelerometer and motor fitted.
const F_HARDWARE: u8 = 16 | 32;
/// The subject band's state after a fall (red, SOS).
pub const S_FALLEN: u8 = 3;
/// The light circle around a fallen band.
pub const S_CIRCLE: u8 = 4;

/// What one band reports: its station, firmware state and flag bits.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub zone: u8,
    pub state: u8,
    pub flags: u8,
}

impl Pose {
    pub fn at(zone: u8) -> Pose {
        Pose { zone, state: 0, flags: 0 }
    }
}

#[derive(Default)]
struct Shared {
    bands: BTreeMap<u8, Pose>,
    /// Offline bands to report once in no zone first: a band that comes back in
    /// the zone it left would otherwise not open a new zone visit.
    wake: Vec<u8>,
    heard: Vec<(u8, HeardEntry)>,
    stop: bool,
}

pub struct Bridge {
    shared: Arc<Mutex<Shared>>,
    kick: Sender<()>,
    pump: Option<JoinHandle<()>>,
}

impl Bridge {
    /// Connects as the bridge, confirms it is the registered one, and starts
    /// reporting every band the module knows in its last station.
    pub fn open(app: &App) -> Result<Bridge> {
        let conn = app.connect_as("bridge", false)?;
        call!(conn, register_bridge_then()).context("the bridge identity is not the registered bridge; run setup")?;
        let bridge = Bridge::start(conn);
        let db = app.db()?;
        let rows: Vec<Band> = db.db.band().iter().collect();
        let main = app.station(crate::app::MAIN_STAGE).unwrap_or(0);
        let poses: Vec<(u8, Pose)> = rows.iter().map(|b| (b.id, Pose::at(if b.zone == 0 { main } else { b.zone }))).collect();
        bridge.shared.lock().unwrap().wake = rows.iter().filter(|b| !b.online).map(|b| b.id).collect();
        bridge.place(&poses);
        Ok(bridge)
    }

    fn start(conn: DbConnection) -> Bridge {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let (kick, rx) = channel::<()>();
        let s = shared.clone();
        let pump = std::thread::spawn(move || {
            let mut seq: u16 = 0;
            loop {
                let _ = rx.recv_timeout(Duration::from_secs(1));
                while rx.try_recv().is_ok() {}
                let (bands, wake, heard, stop) = {
                    let mut g = s.lock().unwrap();
                    (g.bands.clone(), std::mem::take(&mut g.wake), std::mem::take(&mut g.heard), g.stop)
                };
                for id in wake {
                    seq = seq.wrapping_add(1);
                    let _ = conn.reducers.ingest_band(beacon(id, Pose::at(0), 0, seq));
                }
                for (id, entry) in heard {
                    let _ = conn.reducers.ingest_heard(id, vec![entry]);
                }
                for (&id, &p) in &bands {
                    let neigh = bands.values().filter(|o| o.zone == p.zone).count().saturating_sub(1).min(255) as u8;
                    seq = seq.wrapping_add(1);
                    let _ = conn.reducers.ingest_band(beacon(id, p, neigh, seq));
                }
                if stop {
                    break;
                }
            }
            sleep_ms(300);
            let _ = spacetimedb_sdk::DbContext::disconnect(&conn);
        });
        Bridge { shared, kick, pump: Some(pump) }
    }

    /// Sets poses (new bands included) and reports them now.
    pub fn place(&self, poses: &[(u8, Pose)]) {
        let mut g = self.shared.lock().unwrap();
        for (id, p) in poses {
            g.bands.insert(*id, *p);
        }
        drop(g);
        let _ = self.kick.send(());
    }

    pub fn pose(&self, id: u8) -> Option<Pose> {
        self.shared.lock().unwrap().bands.get(&id).copied()
    }

    /// The witness heard the subject band at `rssi` (sent before the circle lights).
    pub fn heard(&self, witness: u8, subject: u8, rssi: i8) {
        self.shared.lock().unwrap().heard.push((witness, HeardEntry { id: subject, rssi }));
    }

    /// A press on the band's button, as the claim flow expects after an NFC tap.
    pub fn press(&self, id: u8) {
        let p = self.pose(id).unwrap_or(Pose::at(0));
        self.place(&[(id, Pose { flags: p.flags | F_PRESS, ..p })]);
        sleep_ms(400);
        self.place(&[(id, p)]);
        sleep_ms(200);
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.shared.lock().unwrap().stop = true;
        let _ = self.kick.send(());
        if let Some(p) = self.pump.take() {
            let _ = p.join();
        }
    }
}

fn beacon(id: u8, p: Pose, neigh: u8, seq: u16) -> BandBeacon {
    BandBeacon { id, rssi: -60, flags: p.flags | F_HARDWARE, neigh, zone: p.zone, bat: 80 + id % 15, state: p.state, seq, find: 0 }
}
