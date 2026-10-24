use crate::config::Config;
use crate::records::{self, Record};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ZoneSpec {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub station_id: u8,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub area_sq_m: f32,
    pub capacity: u32,
    pub exit_colour: u8,
    pub description: String,
}

#[derive(Deserialize)]
struct ZonesFile {
    zones: Vec<ZoneSpec>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct Spot {
    pub plan_x_m: f32,
    pub plan_y_m: f32,
}

#[derive(Deserialize)]
pub struct BoothsFile {
    pub default_spot: Spot,
    pub spots: BTreeMap<String, Spot>,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

pub fn zones(cfg: &Config) -> Result<Vec<ZoneSpec>> {
    Ok(read_json::<ZonesFile>(&cfg.data_dir.join("zones.json"))?.zones)
}

pub fn booths(cfg: &Config) -> Result<BoothsFile> {
    read_json(&cfg.data_dir.join("booths.json"))
}

pub fn nearest_zone(zones: &[ZoneSpec], spot: Spot) -> &ZoneSpec {
    let dist = |z: &ZoneSpec| (z.plan_x_m - spot.plan_x_m).powi(2) + (z.plan_y_m - spot.plan_y_m).powi(2);
    zones.iter().min_by(|a, b| dist(a).total_cmp(&dist(b))).expect("zones.json has no zones")
}

fn plan_record(kind: &str, source_key: String, name: String, fields: serde_json::Value) -> Record {
    Record {
        index: records::RAW_PLAN.into(),
        record_kind: kind.into(),
        source_key,
        source_url: "zones.json".into(),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        location_norm: records::norm_key(&name),
        name,
        fields,
        ..Default::default()
    }
}

pub fn run(cfg: &Config) -> Result<()> {
    let zones = zones(cfg)?;
    let booths = booths(cfg)?;
    let mut out: Vec<Record> = zones
        .iter()
        .map(|z| {
            let mut r = plan_record(records::ZONE, z.key.clone(), z.name.clone(), serde_json::to_value(z).unwrap());
            r.text = z.description.clone();
            r.aliases = vec![z.kind.clone(), format!("station {}", z.station_id)];
            r
        })
        .collect();
    for (domain, spot) in &booths.spots {
        let zone = nearest_zone(&zones, *spot);
        let fields = serde_json::json!({ "plan_x_m": spot.plan_x_m, "plan_y_m": spot.plan_y_m, "zone_key": zone.key });
        let mut r = plan_record(records::BOOTH_SPOT, format!("plan:booth:{domain}"), domain.clone(), fields);
        r.domain = domain.clone();
        out.push(r);
    }
    let path = cfg.data_dir.join("records/plan.jsonl");
    records::write_jsonl(&path, &out)?;
    println!("map: {} zones, {} booth spots -> {}", zones.len(), booths.spots.len(), path.display());
    Ok(())
}
