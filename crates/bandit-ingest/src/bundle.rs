use crate::config::Config;
use crate::map::{self, Spot};
use crate::records::{self, Record};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

pub const CATEGORIES: &[&str] = &[
    "ai", "developer_tools", "cloud", "data", "security", "fintech", "crypto", "venture", "design", "hardware", "gaming",
    "food_drink", "health", "education", "other",
];

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct Ts {
    #[serde(rename = "__timestamp_micros_since_unix_epoch__")]
    pub micros: i64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum OptTs {
    Some(Ts),
    None([u8; 0]),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Fact {
    pub label: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VenueIn {
    pub source_key: String,
    pub name: String,
    pub venue_name: String,
    pub address: String,
    pub latitude: f64,
    pub longitude: f64,
    pub website: String,
    pub timezone: String,
    pub starts_at: OptTs,
    pub ends_at: OptTs,
    pub description: String,
    pub facts: Vec<Fact>,
    pub source_url: String,
    pub fetched_at: Ts,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ZoneIn {
    pub source_key: String,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrganizationIn {
    pub source_key: String,
    pub name: String,
    pub kind: String,
    pub sponsor_tier: String,
    pub website: String,
    pub domain: String,
    pub logo_url: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub industry: String,
    pub headquarters: String,
    pub size_range: String,
    pub founded_year: u32,
    pub linkedin_url: String,
    pub prizes: Vec<String>,
    pub crunchbase_url: String,
    pub funding_summary: String,
    pub source_url: String,
    pub fetched_at: Ts,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BoothIn {
    pub source_key: String,
    pub zone_key: String,
    pub organization_key: String,
    pub booth_number: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub tags: Vec<String>,
    pub plan_x_m: f32,
    pub plan_y_m: f32,
    pub placement: String,
    pub source_url: String,
    pub fetched_at: Ts,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScheduleSlotIn {
    pub source_key: String,
    pub title: String,
    pub kind: String,
    pub description: String,
    pub location_text: String,
    pub zone_key: String,
    pub booth_key: String,
    pub host_organization_key: String,
    pub speaker_keys: Vec<String>,
    pub starts_at: Ts,
    pub ends_at: OptTs,
    pub source_url: String,
    pub fetched_at: Ts,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PersonIn {
    pub source_key: String,
    pub display_name: String,
    pub kind: String,
    pub role: String,
    pub title: String,
    pub organization_key: String,
    pub bio: String,
    pub headshot_url: String,
    pub links: Vec<String>,
    pub source_url: String,
    pub fetched_at: Ts,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EventBundle {
    pub run_id: String,
    pub organizer: String,
    pub bundle_hash: String,
    pub venue: VenueIn,
    pub zones: Vec<ZoneIn>,
    pub organizations: Vec<OrganizationIn>,
    pub people: Vec<PersonIn>,
    pub booths: Vec<BoothIn>,
    pub schedule: Vec<ScheduleSlotIn>,
}

#[derive(Deserialize, Debug)]
pub struct OrgDecision {
    pub key: String,
    pub name: String,
    pub domain: String,
    pub member_keys: Vec<String>,
    pub facts_key: String,
    pub category: String,
    pub tags: Vec<String>,
    pub description: String,
    pub match_method: String,
    pub match_reason: String,
}

#[derive(Deserialize, Debug)]
pub struct Link {
    #[serde(default)]
    pub prize_key: String,
    #[serde(default)]
    pub person_key: String,
    #[serde(default)]
    pub slot_key: String,
    #[serde(default)]
    pub zone_key: String,
    #[serde(default)]
    pub organization_key: String,
    pub reason: String,
}

#[derive(Deserialize, Debug)]
pub struct Gap {
    pub key: String,
    pub reason: String,
}

#[derive(Deserialize, Debug)]
pub struct Organized {
    pub run_id: String,
    pub organizer: String,
    pub organizations: Vec<OrgDecision>,
    pub prize_links: Vec<Link>,
    pub person_links: Vec<Link>,
    pub schedule_links: Vec<Link>,
    pub gaps: Vec<Gap>,
}

pub fn ts(rfc3339: &str) -> Result<Ts> {
    let t = chrono::DateTime::parse_from_rfc3339(rfc3339).with_context(|| format!("bad timestamp {rfc3339:?}"))?;
    Ok(Ts { micros: t.timestamp_micros() })
}

fn opt_ts(value: &serde_json::Value) -> Result<OptTs> {
    match value.as_str() {
        Some(s) if !s.is_empty() => Ok(OptTs::Some(ts(s)?)),
        _ => Ok(OptTs::None([])),
    }
}

fn field<'a>(r: &'a Record, name: &str) -> &'a serde_json::Value {
    &r.fields[name]
}

fn text_field(r: &Record, name: &str) -> String {
    match field(r, name) {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

struct Inputs {
    by_key: HashMap<String, Record>,
}

impl Inputs {
    fn get(&self, key: &str) -> Result<&Record> {
        self.by_key.get(key).ok_or_else(|| anyhow!("the organizer named {key}, which is not a record of this run"))
    }

    fn of_kind<'a>(&'a self, kind: &'a str) -> impl Iterator<Item = &'a Record> + 'a {
        let mut rows: Vec<&Record> = self.by_key.values().filter(move |r| r.record_kind == kind).collect();
        rows.sort_by(|a, b| a.source_key.cmp(&b.source_key));
        rows.into_iter()
    }
}

fn venue(cfg: &Config, inputs: &Inputs) -> Result<VenueIn> {
    let place = inputs.of_kind(records::VENUE_PLACE).next().context("no Google Maps venue record")?;
    let mut facts: Vec<Fact> = inputs
        .of_kind(records::VENUE_FACT)
        .map(|r| Fact { label: r.name.clone(), value: r.text.clone() })
        .collect();
    for label in ["rating", "phone", "hours"] {
        let value = text_field(place, label);
        if !value.is_empty() {
            facts.push(Fact { label: label.into(), value });
        }
    }
    let dates = inputs.of_kind(records::VENUE_FACT).find(|r| !field(r, "starts_at").is_null());
    Ok(VenueIn {
        source_key: format!("event:{}", cfg.event.slug),
        name: cfg.event.name.clone(),
        venue_name: place.name.clone(),
        address: text_field(place, "address"),
        latitude: field(place, "latitude").as_f64().context("venue latitude")?,
        longitude: field(place, "longitude").as_f64().context("venue longitude")?,
        website: cfg.event.website.clone(),
        timezone: cfg.event.timezone.clone(),
        starts_at: dates.map_or(Ok(OptTs::None([])), |r| opt_ts(field(r, "starts_at")))?,
        ends_at: dates.map_or(Ok(OptTs::None([])), |r| opt_ts(field(r, "ends_at")))?,
        description: place.text.clone(),
        facts,
        source_url: place.source_url.clone(),
        fetched_at: ts(&place.fetched_at)?,
    })
}

fn zones(cfg: &Config) -> Result<Vec<ZoneIn>> {
    Ok(map::zones(cfg)?
        .into_iter()
        .map(|z| ZoneIn {
            source_key: z.key,
            name: z.name,
            kind: z.kind,
            station_id: z.station_id,
            plan_x_m: z.plan_x_m,
            plan_y_m: z.plan_y_m,
            area_sq_m: z.area_sq_m,
            capacity: z.capacity,
            exit_colour: z.exit_colour,
            description: z.description,
        })
        .collect())
}

fn prize_line(prize: &Record) -> String {
    match field(prize, "cash_usd").as_u64() {
        Some(cash) if cash > 0 => format!("{} (${cash})", prize.name),
        _ => prize.name.clone(),
    }
}

fn organization(inputs: &Inputs, d: &OrgDecision, prizes: Vec<String>) -> Result<OrganizationIn> {
    if !CATEGORIES.contains(&d.category.as_str()) {
        bail!("{} has category {:?}, which is not on the fixed list", d.key, d.category);
    }
    let members = d.member_keys.iter().map(|k| inputs.get(k)).collect::<Result<Vec<_>>>()?;
    let primary = members.first().with_context(|| format!("{} merges no records", d.key))?;
    let devpost = members.iter().find(|r| r.source_key.starts_with("devpost:org:"));
    let tier = devpost.map(|r| r.tier_text.clone()).unwrap_or_default();
    let partner = members.iter().all(|r| r.tier_text.to_ascii_lowercase().starts_with("partner"));
    let facts = match d.facts_key.as_str() {
        "" => None,
        key => Some(inputs.get(key)?),
    };
    let fact = |name: &str| facts.map(|f| text_field(f, name)).unwrap_or_default();
    let crunchbase_key = format!("crunchbase:org:{}", d.domain);
    let crunchbase = std::iter::once(&d.facts_key)
        .chain(&d.member_keys)
        .chain(std::iter::once(&crunchbase_key))
        .find(|k| k.starts_with("crunchbase:org:") && inputs.by_key.contains_key(k.as_str()))
        .map(|k| &inputs.by_key[k.as_str()]);
    let logo = [facts, devpost.copied()]
        .into_iter()
        .flatten()
        .map(|r| text_field(r, "logo_url"))
        .find(|l| !l.is_empty())
        .unwrap_or_default();
    Ok(OrganizationIn {
        source_key: d.key.clone(),
        name: d.name.clone(),
        kind: if partner { "partner" } else { "sponsor" }.into(),
        sponsor_tier: tier,
        website: devpost.and_then(|r| r.links.first().cloned()).unwrap_or_else(|| format!("https://{}", d.domain)),
        domain: d.domain.clone(),
        logo_url: logo,
        description: d.description.clone(),
        category: d.category.clone(),
        tags: d.tags.iter().take(5).map(|t| t.to_lowercase()).collect(),
        industry: fact("industry"),
        headquarters: fact("headquarters"),
        size_range: fact("company_size"),
        founded_year: facts.and_then(|f| field(f, "founded_year").as_u64()).unwrap_or(0) as u32,
        linkedin_url: fact("linkedin_url"),
        prizes,
        crunchbase_url: crunchbase.map(|c| text_field(c, "crunchbase_url")).unwrap_or_default(),
        funding_summary: crunchbase.map(|c| text_field(c, "funding_summary")).unwrap_or_default(),
        source_url: primary.source_url.clone(),
        fetched_at: ts(&primary.fetched_at)?,
    })
}

fn booth(org: &OrganizationIn, spot: Spot, placement: &str, zone_key: &str) -> BoothIn {
    let mut tags = vec![org.category.clone()];
    tags.extend(org.tags.iter().cloned());
    BoothIn {
        source_key: format!("booth:{}", org.domain),
        zone_key: zone_key.into(),
        organization_key: org.source_key.clone(),
        booth_number: String::new(),
        name: org.name.clone(),
        kind: "sponsor".into(),
        description: org.description.clone(),
        tags,
        plan_x_m: spot.plan_x_m,
        plan_y_m: spot.plan_y_m,
        placement: placement.into(),
        source_url: org.source_url.clone(),
        fetched_at: org.fetched_at,
    }
}

fn person(r: &Record, organization_key: &str) -> Result<PersonIn> {
    let slot = text_field(r, "speaker_slot");
    Ok(PersonIn {
        source_key: r.source_key.clone(),
        display_name: r.name.clone(),
        kind: "speaker".into(),
        role: format!("{slot} speaker").trim().to_string(),
        title: r.role_text.clone(),
        organization_key: organization_key.into(),
        bio: r.text.clone(),
        headshot_url: String::new(),
        links: r.links.clone(),
        source_url: r.source_url.clone(),
        fetched_at: ts(&r.fetched_at)?,
    })
}

fn slot(r: &Record, link: Option<&Link>) -> Result<ScheduleSlotIn> {
    Ok(ScheduleSlotIn {
        source_key: r.source_key.clone(),
        title: r.name.clone(),
        kind: text_field(r, "kind"),
        description: r.text.clone(),
        location_text: r.location_text.clone(),
        zone_key: link.map(|l| l.zone_key.clone()).unwrap_or_default(),
        booth_key: String::new(),
        host_organization_key: link.map(|l| l.organization_key.clone()).unwrap_or_default(),
        speaker_keys: vec![],
        starts_at: ts(field(r, "starts_at").as_str().context("schedule item without starts_at")?)?,
        ends_at: opt_ts(field(r, "ends_at"))?,
        source_url: r.source_url.clone(),
        fetched_at: ts(&r.fetched_at)?,
    })
}

pub fn assemble(cfg: &Config, run_id: &str) -> Result<PathBuf> {
    let dir = cfg.data_dir.join("bundles");
    let organized: Organized = serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{run_id}.organized.json")))?)?;
    let mut by_key = HashMap::new();
    for r in records::read_jsonl(&cfg.data_dir.join("records/records.jsonl"))? {
        by_key.insert(r.source_key.clone(), r);
    }
    let inputs = Inputs { by_key };

    let zone_specs = map::zones(cfg)?;
    let booth_file = map::booths(cfg)?;
    let mut seen = HashSet::new();
    let mut organizations = Vec::new();
    let mut booths = Vec::new();
    for d in &organized.organizations {
        if !seen.insert(d.key.clone()) {
            bail!("the organizer returned {} twice", d.key);
        }
        let prizes = organized
            .prize_links
            .iter()
            .filter(|l| l.organization_key == d.key)
            .map(|l| inputs.get(&l.prize_key).map(prize_line))
            .collect::<Result<Vec<_>>>()?;
        let org = organization(&inputs, d, prizes)?;
        if org.kind == "sponsor" {
            let (spot, placement) = match booth_file.spots.get(&org.domain) {
                Some(s) => (*s, "plan"),
                None => (booth_file.default_spot, "zone"),
            };
            let zone_key = map::nearest_zone(&zone_specs, spot).key.clone();
            booths.push(booth(&org, spot, placement, &zone_key));
        }
        organizations.push(org);
    }
    for l in organized.prize_links.iter().chain(&organized.person_links).filter(|l| !l.organization_key.is_empty()) {
        if !seen.contains(&l.organization_key) {
            bail!("a link points at {}, which the organizer did not define", l.organization_key);
        }
    }

    let person_org: HashMap<&str, &str> = organized
        .person_links
        .iter()
        .map(|l| (l.person_key.as_str(), l.organization_key.as_str()))
        .collect();
    let people = inputs
        .of_kind(records::PERSON_CANDIDATE)
        .map(|r| person(r, person_org.get(r.source_key.as_str()).copied().unwrap_or("")))
        .collect::<Result<Vec<_>>>()?;
    let slot_links: HashMap<&str, &Link> = organized.schedule_links.iter().map(|l| (l.slot_key.as_str(), l)).collect();
    let schedule = inputs
        .of_kind(records::SCHEDULE_ITEM)
        .map(|r| slot(r, slot_links.get(r.source_key.as_str()).copied()))
        .collect::<Result<Vec<_>>>()?;

    let mut bundle = EventBundle {
        run_id: run_id.into(),
        organizer: organized.organizer.clone(),
        bundle_hash: String::new(),
        venue: venue(cfg, &inputs)?,
        zones: zones(cfg)?,
        organizations,
        people,
        booths,
        schedule,
    };
    bundle.bundle_hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&bundle)?));
    for g in &organized.gaps {
        println!("gap: {} ({})", g.key, g.reason);
    }
    let path = dir.join(format!("{run_id}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&bundle)?)?;
    println!(
        "assemble: {} organizations, {} booths, {} people, {} schedule slots, {} zones -> {}",
        bundle.organizations.len(),
        bundle.booths.len(),
        bundle.people.len(),
        bundle.schedule.len(),
        bundle.zones.len(),
        path.display()
    );
    Ok(path)
}
