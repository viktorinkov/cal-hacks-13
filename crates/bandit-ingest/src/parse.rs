use crate::config::Config;
use crate::fetch::Snapshot;
use crate::records::{self, Record, domain_of, norm_key};
use anyhow::{Context, Result, bail};
use chrono::{FixedOffset, NaiveDateTime, TimeZone};
use chrono_tz::Tz;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};

fn base(snap: &Snapshot, index: &str, kind: &str, key: &str, name: &str) -> Record {
    Record {
        index: index.into(),
        record_kind: kind.into(),
        source_key: format!("{}:{key}", snap.source),
        source_url: snap.url.clone(),
        fetched_at: snap.fetched_at.clone(),
        snapshot_sha256: snap.sha256.clone(),
        name: name.into(),
        fields: json!({}),
        ..Default::default()
    }
}

fn section<'a>(body: &'a str, start: &str, end: &str) -> Result<&'a str> {
    let from = body.find(start).with_context(|| format!("no {start:?} in the page"))? + start.len();
    let to = body[from..].find(end).with_context(|| format!("no {end:?} after {start:?}"))? + from;
    Ok(&body[from..to])
}

fn lines(text: &str) -> Vec<&str> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).collect()
}

fn chunks(text: &str) -> Vec<Vec<&str>> {
    Regex::new(r"\n\s*\n\s*\n").unwrap().split(text).map(lines).filter(|c| !c.is_empty()).collect()
}

fn local_time(month: &str, day: &str, year: &str, time: &str, zone: &str, tz: Tz) -> Result<String> {
    let hours = match zone {
        "PDT" => -7,
        "PST" => -8,
        "MDT" => -6,
        "MST" => -7,
        "CDT" => -5,
        "CST" => -6,
        "EDT" => -4,
        "EST" => -5,
        _ => bail!("unknown time zone {zone}"),
    };
    let local = NaiveDateTime::parse_from_str(&format!("{month} {day} {year} {time}"), "%B %d %Y %I:%M%p")?;
    let at = FixedOffset::east_opt(hours * 3600).unwrap().from_local_datetime(&local).unwrap();
    Ok(at.with_timezone(&tz).to_rfc3339())
}

fn site_orgs(snap: &Snapshot) -> Vec<Record> {
    let link = Regex::new(r"^(?:\*\s+)?\[(?:!\[([^\]]*)\]\(([^)\s]+)[^)]*\))?([^\]]*)\]\((https?://[^)\s]+)\)$").unwrap();
    let own = domain_of(&snap.url);
    let page = url::Url::parse(&snap.url).unwrap();
    let mut tier = "";
    let mut out = Vec::new();
    for line in lines(&snap.body) {
        let Some(c) = link.captures(line) else {
            let lower = line.to_lowercase();
            tier = if lower.contains("partner") { "partner" } else if lower.contains("sponsor") { "sponsor" } else { "" };
            continue;
        };
        let domain = domain_of(&c[4]);
        if tier.is_empty() || domain == own {
            continue;
        }
        let name = c.get(1).map_or(&c[3], |alt| alt.as_str()).trim();
        let mut r = base(snap, records::RAW_PAGES, records::ORGANIZATION_CANDIDATE, &format!("org:{domain}"), name);
        r.org_key = norm_key(name);
        r.aliases = vec![domain.clone(), norm_key(name)];
        r.domain = domain;
        r.tier_text = tier.into();
        r.links = vec![c[4].to_string()];
        if let Some(logo) = c.get(2) {
            r.fields = json!({"logo_url": page.join(logo.as_str()).unwrap().to_string()});
        }
        out.push(r);
    }
    out
}

fn speaker_slots(headings: &[(String, bool)], n: usize) -> Vec<String> {
    let mut slots = vec![String::new(); n];
    let mut end = n;
    for (k, (slot, plural)) in headings.iter().enumerate().rev() {
        let start = if *plural { k.min(end) } else { end.saturating_sub(1) };
        slots[start..end].fill(slot.clone());
        end = start;
    }
    slots
}

fn speakers(snap: &Snapshot) -> Vec<Record> {
    let heading = Regex::new(r"(?i)(\w+) speaker(s?)$").unwrap();
    let mut headings = Vec::new();
    let mut people = Vec::new();
    for chunk in chunks(&snap.body) {
        for line in &chunk {
            if let Some(c) = heading.captures(line) {
                headings.push((c[1].to_lowercase(), !c[2].is_empty()));
            }
        }
        if chunk.len() >= 3 && chunk[2].starts_with('@') {
            people.push(chunk);
        }
    }
    let slots = speaker_slots(&headings, people.len());
    people
        .iter()
        .zip(slots)
        .map(|(l, slot)| {
            let name = l[0].trim_start_matches('#').trim();
            let org = l[2].trim_start_matches('@').trim();
            let mut r = base(snap, records::RAW_PAGES, records::PERSON_CANDIDATE, &format!("person:{}", norm_key(name)), name);
            r.role_text = l[1].into();
            r.org_key = norm_key(org);
            r.text = l[3..].join("\n");
            r.fields = json!({"organization_text": org, "speaker_slot": slot});
            r
        })
        .collect()
}

fn faq(snap: &Snapshot) -> Vec<Record> {
    let Some(chunk) = chunks(&snap.body).into_iter().find(|c| c[0].contains("FAQ")) else { return Vec::new() };
    let mut group = String::new();
    let mut pairs: Vec<(String, String, Vec<&str>)> = Vec::new();
    for line in &chunk[1..] {
        let text = line.trim_start_matches(|c: char| !c.is_alphanumeric());
        if text.ends_with('?') {
            pairs.push((group.clone(), text.to_string(), Vec::new()));
        } else if text.ends_with(['.', '!', ')']) {
            if let Some((_, _, answer)) = pairs.last_mut() {
                answer.push(text);
            }
        } else {
            group = text.to_string();
        }
    }
    pairs
        .into_iter()
        .map(|(group, q, answer)| {
            let mut r = base(snap, records::RAW_PAGES, records::VENUE_FACT, &format!("fact:{}", norm_key(&q)), &q);
            r.text = answer.join("\n\n");
            r.fields = json!({"faq_group": group});
            r
        })
        .collect()
}

fn event_site(snap: &Snapshot) -> Result<Vec<Record>> {
    let mut out = site_orgs(snap);
    out.extend(speakers(snap));
    out.extend(faq(snap));
    Ok(out)
}

fn devpost_orgs(snap: &Snapshot, text: &str) -> Vec<Record> {
    let link = Regex::new(r#"\[(?:!\[[^\]]*\]\(([^)\s]+)[^)]*\)\s*)?([^\]]+)\]\((\S+) "Go to"#).unwrap();
    let mut tier = "";
    let mut out = Vec::new();
    for line in lines(text) {
        if !line.starts_with('[') {
            tier = if line == "Partners" { "Partner" } else { line.trim_end_matches(" Sponsors") };
            continue;
        }
        for c in link.captures_iter(line) {
            let (name, website) = (c[2].trim(), &c[3]);
            let mut r = base(snap, records::RAW_PAGES, records::ORGANIZATION_CANDIDATE, &format!("org:{}", norm_key(name)), name);
            r.domain = domain_of(website);
            r.org_key = norm_key(name);
            r.aliases = vec![r.domain.clone(), norm_key(name)];
            r.tier_text = tier.into();
            r.links = vec![website.into()];
            if let Some(logo) = c.get(1) {
                r.fields = json!({"logo_url": logo.as_str()});
            }
            out.push(r);
        }
    }
    out
}

fn prizes(snap: &Snapshot, text: &str) -> Vec<Record> {
    let winners = Regex::new(r"^(\d+) winners?$").unwrap();
    let cash = Regex::new(r"^\$([\d,]+) in cash$").unwrap();
    let tag = Regex::new(r"^\\?\[([^\]]+)\]\s*(.+)$").unwrap();
    let l = lines(text);
    let at: Vec<usize> = (0..l.len()).filter(|&i| winners.is_match(l[i])).collect();
    let starts: Vec<usize> = at.iter().map(|&i| if cash.is_match(l[i - 1]) { i - 2 } else { i - 1 }).collect();
    at.iter()
        .zip(&starts)
        .enumerate()
        .map(|(n, (&i, &start))| {
            let (role, title) = match tag.captures(l[start]) {
                Some(c) => (c[1].to_string(), c[2].to_string()),
                None => (String::new(), l[start].to_string()),
            };
            let cash_usd: u64 = cash.captures(l[i - 1]).map_or(0, |c| c[1].replace(',', "").parse().unwrap());
            let end = starts.get(n + 1).copied().unwrap_or(l.len());
            let mut r = base(snap, records::RAW_PAGES, records::PRIZE, &format!("prize:{}", norm_key(&title)), &title);
            r.org_key = norm_key(&role);
            r.role_text = role;
            r.text = l[i + 1..end].join("\n");
            r.fields = json!({"cash_usd": cash_usd, "winners": winners.captures(l[i]).unwrap()[1].parse::<u64>().unwrap()});
            r
        })
        .collect()
}

fn devpost_fact(snap: &Snapshot, label: &str, text: &str, fields: Value) -> Record {
    let mut r = base(snap, records::RAW_PAGES, records::VENUE_FACT, &format!("fact:{}", norm_key(label)), label);
    r.text = text.into();
    r.fields = fields;
    r
}

fn deadline(body: &str) -> Result<regex::Captures<'_>> {
    let re = Regex::new(r"Deadline: (([A-Z][a-z]+) (\d{1,2}), (\d{4}) @ (\d{1,2}:\d{2}[ap]m) ([A-Z]{3}))").unwrap();
    re.captures(body).context("no deadline on the Devpost page")
}

fn devpost(snap: &Snapshot, tz: Tz) -> Result<Vec<Record>> {
    let d = deadline(&snap.body)?;
    let deadline_at = local_time(&d[2], &d[3], &d[4], &d[5], &d[6], tz)?;
    let venue = Regex::new(r"\[([^\]]+)\]\((https://maps\.google\.com/\?q=[^)]+)\)").unwrap();
    let v = venue.captures(&snap.body).context("no venue link on the Devpost page")?;
    let maps = url::Url::parse(&v[2])?;
    let address = maps.query_pairs().find(|(k, _)| k == "q").map(|(_, a)| a.to_string()).unwrap_or_default();
    let mut out = devpost_orgs(snap, section(&snap.body, "Hackathon Sponsors", "\nPrizes\n")?);
    out.extend(prizes(snap, section(&snap.body, "\nPrizes\n", "Devpost Achievements")?));
    out.push(devpost_fact(snap, "Submission deadline", &d[1], json!({"deadline_at": deadline_at})));
    out.push(devpost_fact(snap, "Address", &address, json!({"venue_name": &v[1], "maps_url": &v[2]})));
    Ok(out)
}

fn devpost_dates(snap: &Snapshot, tz: Tz) -> Result<Vec<Record>> {
    let year = deadline(&snap.body)?[4].to_string();
    let time = Regex::new(r"^([A-Z][a-z]+) (\d{1,2}) at (\d{1,2}:\d{2}[ap]m) ([A-Z]{3})$").unwrap();
    let at = |t: &str| -> Result<String> {
        let c = time.captures(t).unwrap();
        local_time(&c[1], &c[2], &year, &c[3], &c[4], tz)
    };
    let mut rows: Vec<(&str, Vec<&str>)> = Vec::new();
    for line in lines(section(&snap.body, "\nEnds\n", "\nDevpost\n")?) {
        match rows.last_mut() {
            Some((_, times)) if time.is_match(line) => times.push(line),
            _ => rows.push((line, Vec::new())),
        }
    }
    let mut out = Vec::new();
    for (title, times) in rows.iter().filter(|(_, t)| !t.is_empty()) {
        let starts_at = at(times[0])?;
        let ends_at = times.get(1).map(|t| at(t)).transpose()?;
        let key = format!("slot:{}", norm_key(&format!("{title}{starts_at}")));
        let mut r = base(snap, records::RAW_PAGES, records::SCHEDULE_ITEM, &key, title);
        r.start_text = times[0].into();
        r.end_text = times.get(1).copied().unwrap_or_default().into();
        r.fields = json!({"starts_at": starts_at, "ends_at": ends_at});
        out.push(r);
    }
    let (title, times) = rows.iter().find(|(_, t)| t.len() == 2).context("no period with a start and an end")?;
    let text = format!("{title}: {} to {}", times[0], times[1]);
    out.push(devpost_fact(snap, "Dates", &text, json!({"starts_at": at(times[0])?, "ends_at": at(times[1])?})));
    Ok(out)
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().trim().to_string()
}

fn linkedin(snap: &Snapshot) -> Result<Vec<Record>> {
    let rows: Vec<Value> = serde_json::from_str(&snap.body)?;
    Ok(rows
        .iter()
        .filter(|c| c["website"].is_string())
        .map(|c| {
            let (name, website, url) = (text(&c["name"]), text(&c["website"]), text(&c["url"]));
            let domain = domain_of(&website);
            let mut r = base(snap, records::RAW_ORGS, records::COMPANY_FACTS, &format!("org:{domain}"), &name);
            r.source_url = url.clone();
            r.text = text(&c["about"]);
            r.org_key = norm_key(&name);
            r.aliases = vec![domain.clone(), norm_key(&name)];
            r.domain = domain;
            r.links = vec![url.clone(), website];
            r.fields = json!({
                "industry": text(&c["industries"]),
                "headquarters": text(&c["headquarters"]),
                "company_size": text(&c["company_size"]),
                "founded_year": c["founded"].as_u64().unwrap_or(0),
                "followers": c["followers"].as_u64().unwrap_or(0),
                "linkedin_url": url,
                "logo_url": text(&c["logo"]),
            });
            r
        })
        .collect())
}

fn crunchbase(snap: &Snapshot) -> Result<Vec<Record>> {
    let rows: Vec<Value> = serde_json::from_str(&snap.body)?;
    Ok(rows
        .iter()
        .filter(|c| c["website"].is_string())
        .map(|c| {
            let (name, website, url) = (text(&c["name"]), text(&c["website"]), text(&c["url"]));
            let domain = domain_of(&website);
            let industries: Vec<String> = c["industries"].as_array().into_iter().flatten().map(|i| text(&i["value"])).collect();
            let rounds = &c["funding_rounds"];
            let funding = format!("{} funding rounds, last {}", rounds["num_funding_rounds"].as_u64().unwrap_or(0), text(&rounds["last_funding_type"]));
            let mut r = base(snap, records::RAW_ORGS, records::COMPANY_FACTS, &format!("org:{domain}"), &name);
            r.source_url = url.clone();
            r.text = text(&c["full_description"]);
            r.org_key = norm_key(&name);
            r.aliases = vec![domain.clone(), norm_key(&name)];
            r.domain = domain;
            r.links = vec![url.clone(), website];
            r.fields = json!({
                "description": text(&c["about"]),
                "industry": industries.join(", "),
                "headquarters": text(&c["address"]),
                "founded_year": text(&c["founded_date"]).get(..4).and_then(|y| y.parse::<u64>().ok()).unwrap_or(0),
                "funding_summary": funding,
                "crunchbase_url": url,
                "logo_url": text(&c["image"]),
            });
            r
        })
        .collect())
}

fn google_maps(snap: &Snapshot) -> Result<Vec<Record>> {
    let rows: Vec<Value> = serde_json::from_str(&snap.body)?;
    Ok(rows
        .iter()
        .filter(|p| p["name"].is_string())
        .map(|p| {
            let name = text(&p["name"]);
            let website = text(&p["open_website"]);
            let mut r = base(snap, records::RAW_ORGS, records::VENUE_PLACE, &format!("venue:{}", norm_key(&name)), &name);
            r.source_url = text(&p["url"]);
            r.text = text(&p["description"]);
            r.domain = domain_of(&website);
            r.aliases = vec![r.domain.clone(), norm_key(&name)];
            r.links = vec![r.source_url.clone(), website.clone()];
            r.fields = json!({
                "address": text(&p["address"]),
                "latitude": p["lat"],
                "longitude": p["lon"],
                "rating": p["rating"],
                "reviews": p["reviews_count"],
                "phone": text(&p["phone_number"]),
                "website": website,
                "hours": hours(&p["open_hours"]),
            });
            r
        })
        .collect())
}

fn hours(v: &Value) -> Vec<String> {
    v.as_object().into_iter().flatten().map(|(day, h)| format!("{day}: {}", h.as_str().unwrap_or_default())).collect()
}

pub fn run(cfg: &Config) -> Result<()> {
    let tz: Tz = cfg.event.timezone.parse().map_err(|e| anyhow::anyhow!("event timezone: {e}"))?;
    let mut paths = Vec::new();
    for dir in std::fs::read_dir(cfg.data_dir.join("snapshots"))? {
        let dir = dir?.path();
        if dir.is_dir() {
            for f in std::fs::read_dir(&dir)? {
                paths.push(f?.path());
            }
        }
    }
    paths.retain(|p| p.extension().is_some_and(|e| e == "json"));
    paths.sort();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for path in &paths {
        let snap: Snapshot = serde_json::from_str(&std::fs::read_to_string(path)?).with_context(|| format!("reading {}", path.display()))?;
        let parsed = match snap.kind.as_str() {
            "event_site" => event_site(&snap),
            "devpost" => devpost(&snap, tz),
            "devpost_dates" => devpost_dates(&snap, tz),
            "linkedin_company" => linkedin(&snap),
            "crunchbase_company" => crunchbase(&snap),
            "google_maps" => google_maps(&snap),
            other => bail!("no parser for kind {other}"),
        }
        .with_context(|| format!("parsing {}", path.display()))?;
        out.extend(parsed.into_iter().filter(|r| seen.insert(r.source_key.clone())));
    }
    let path = cfg.data_dir.join("records/records.jsonl");
    records::write_jsonl(&path, &out)?;
    let mut counts = BTreeMap::new();
    for r in &out {
        *counts.entry(r.record_kind.as_str()).or_insert(0) += 1;
    }
    println!("parse: {} snapshots, {} records {:?} -> {}", paths.len(), out.len(), counts, path.display());
    Ok(())
}
