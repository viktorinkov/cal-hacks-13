//! The simulated bands (ids 90-99), reported through the module's
//! `report_sim_band` as the `sim` identity. Real bands and the hardware
//! bridge are never touched. A pump thread reports every band in the scenario
//! once a second (band1t marks a band offline after 5 s of silence) and at
//! once whenever a band's pose changes.

use crate::app::App;
use anyhow::{Context, Result, bail};
use bandit_bindings::*;
use spacetimedb_sdk::Table;
use std::collections::BTreeMap;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// The band ids the module lets the simulator report (`safety::SIM_BANDS`).
pub const SIM_BANDS: std::ops::RangeInclusive<u8> = 90..=99;
/// The subject band's state after a fall (red, SOS).
pub const S_FALLEN: u8 = 3;
/// The light circle around a fallen band.
pub const S_CIRCLE: u8 = 4;

/// What one band reports: its station, firmware state and flags.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub station: u8,
    pub state: u8,
    pub fall: bool,
    pub press: bool,
}

impl Pose {
    pub fn at(station: u8) -> Pose {
        Pose { station, state: 0, fall: false, press: false }
    }
}

#[derive(Default)]
struct Shared {
    bands: BTreeMap<u8, Pose>,
    stop: bool,
}

pub struct Sim {
    shared: Arc<Mutex<Shared>>,
    kick: Sender<()>,
    pump: Option<JoinHandle<()>>,
}

/// Fails unless every band is one the simulator may report.
pub fn check_bands(bands: &[u8]) -> Result<()> {
    if let Some(b) = bands.iter().find(|b| !SIM_BANDS.contains(b)) {
        bail!("band {b} is not a simulated band; use {} to {}", SIM_BANDS.start(), SIM_BANDS.end());
    }
    Ok(())
}

impl Sim {
    /// Connects as `sim` and starts reporting every simulated band the module
    /// knows, in its last station (Main stage when it has none).
    pub fn open(app: &App) -> Result<Sim> {
        let conn = app.connect_as("sim", false)?;
        let main = app.station(crate::app::MAIN_STAGE)?;
        let known: Vec<(u8, Pose)> = app
            .db()?
            .db
            .band()
            .iter()
            .filter(|b| SIM_BANDS.contains(&b.id))
            .map(|b| (b.id, Pose::at(if b.zone == 0 { main } else { b.zone })))
            .collect();
        if let Some((id, p)) = known.first() {
            call!(conn, report_sim_band_then(*id, p.station, 0, 0, false, false, false))
                .context("the sim identity cannot report bands; run setup (it grants the simulator role)")?;
        }
        let sim = Sim::start(conn);
        sim.place(&known);
        Ok(sim)
    }

    fn start(conn: DbConnection) -> Sim {
        let shared = Arc::new(Mutex::new(Shared::default()));
        let (kick, rx) = channel::<()>();
        let s = shared.clone();
        let pump = std::thread::spawn(move || {
            loop {
                let _ = rx.recv_timeout(Duration::from_secs(1));
                while rx.try_recv().is_ok() {}
                let (bands, stop) = {
                    let g = s.lock().unwrap();
                    (g.bands.clone(), g.stop)
                };
                for (&id, &p) in &bands {
                    let neigh = bands.values().filter(|o| o.station == p.station).count().saturating_sub(1).min(255) as u8;
                    let _ = conn.reducers.report_sim_band(id, p.station, p.state, neigh, false, p.fall, p.press);
                }
                if stop {
                    break;
                }
            }
            crate::app::sleep_ms(300);
            let _ = spacetimedb_sdk::DbContext::disconnect(&conn);
        });
        Sim { shared, kick, pump: Some(pump) }
    }

    /// Sets poses (new bands included) and reports them now. Ids outside 90-99 are ignored.
    pub fn place(&self, poses: &[(u8, Pose)]) {
        let mut g = self.shared.lock().unwrap();
        for (id, p) in poses.iter().filter(|(id, _)| SIM_BANDS.contains(id)) {
            g.bands.insert(*id, *p);
        }
        drop(g);
        let _ = self.kick.send(());
    }

    pub fn pose(&self, id: u8) -> Option<Pose> {
        self.shared.lock().unwrap().bands.get(&id).copied()
    }

    /// A press on the band's button, as the band claim expects after the NFC tap.
    pub fn press(&self, id: u8) {
        let p = self.pose(id).unwrap_or(Pose::at(0));
        self.place(&[(id, Pose { press: true, ..p })]);
        crate::app::sleep_ms(400);
        self.place(&[(id, p)]);
        crate::app::sleep_ms(200);
    }
}

impl Drop for Sim {
    fn drop(&mut self) {
        self.shared.lock().unwrap().stop = true;
        let _ = self.kick.send(());
        if let Some(p) = self.pump.take() {
            let _ = p.join();
        }
    }
}
