use crate::config::Config;
use crate::elastic::{self, log_event};
use crate::records::{self, Record};
use anyhow::{Context, Result, bail};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const WORKFLOW: &str = "bandit-organize";
const RAW_INDICES: &str = "bandit-raw-pages,bandit-raw-orgs,bandit-raw-plan";
const BUNDLES: &str = "bandit-bundles";
const DECISIONS: &str = "bandit-organizer-decisions";

#[derive(Serialize, Deserialize)]
pub struct Organized {
    pub run_id: String,
    pub organizer: String,
    pub model: String,
    pub organizations: Vec<Organization>,
    pub prize_links: Vec<PrizeLink>,
    pub person_links: Vec<PersonLink>,
    pub schedule_links: Vec<ScheduleLink>,
    pub gaps: Vec<Gap>,
}

#[derive(Serialize, Deserialize)]
pub struct Organization {
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

#[derive(Serialize, Deserialize)]
pub struct PrizeLink {
    pub prize_key: String,
    pub organization_key: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize)]
pub struct PersonLink {
    pub person_key: String,
    pub organization_key: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize)]
pub struct ScheduleLink {
    pub slot_key: String,
    pub zone_key: String,
    pub organization_key: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize)]
pub struct Gap {
    pub key: String,
    pub reason: String,
}

#[derive(Deserialize)]
struct Answer {
    run_id: String,
    organizer: String,
    model: String,
    org_rows: Vec<(Value, Value, String)>,
    org_decisions: HashMap<String, OrgDecision>,
    prize_decisions: BTreeMap<String, LinkDecision>,
    person_decisions: BTreeMap<String, LinkDecision>,
    schedule_decisions: BTreeMap<String, SlotDecision>,
    gaps: Vec<Gap>,
}

#[derive(Deserialize)]
struct OrgDecision {
    key: String,
    name: String,
    facts_key: String,
    category: String,
    tags: Vec<String>,
    description: String,
    match_method: String,
    match_reason: String,
}

#[derive(Deserialize)]
struct LinkDecision {
    organization_key: String,
    reason: String,
}

#[derive(Deserialize)]
struct SlotDecision {
    zone_key: String,
    organization_key: String,
    reason: String,
}

pub fn setup(cfg: &Config) -> Result<()> {
    let dir = &cfg.elastic_dir;
    for path in files(&dir.join("indices"), "json")? {
        ensure_index(cfg, &path)?;
    }
    for path in files(&dir.join("tools"), "json")? {
        ensure_kibana(cfg, "/api/agent_builder/tools", read_json(&path)?)?;
    }
    for path in files(&dir.join("agents"), "json")? {
        ensure_kibana(cfg, "/api/agent_builder/agents", agent(&path)?)?;
    }
    for path in files(&dir.join("workflows"), "yaml")? {
        ensure_workflow(cfg, &path)?;
    }
    Ok(())
}

pub fn run(cfg: &Config, run_id: &str) -> Result<PathBuf> {
    let records = load_records(cfg)?;
    index_records(cfg, run_id, &records)?;
    run_workflow(cfg, run_id)?;
    let organized = read_bundle(cfg, run_id, &records)?;
    write_decisions(cfg, &organized, &records)?;
    save(cfg, &organized)
}

fn files(dir: &Path, ext: &str) -> Result<Vec<PathBuf>> {
    let mut paths = std::fs::read_dir(dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .map(|e| e.map(|e| e.path()))
        .collect::<std::io::Result<Vec<_>>>()?;
    paths.retain(|p| p.extension().is_some_and(|e| e == ext));
    paths.sort();
    Ok(paths)
}

fn read_json(path: &Path) -> Result<Value> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

fn stem(path: &Path) -> String {
    path.file_stem().unwrap_or_default().to_string_lossy().into_owned()
}

fn ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

fn ensure_index(cfg: &Config, path: &Path) -> Result<()> {
    let name = stem(path);
    let body = read_json(path)?;
    if elastic::es_exists(cfg, &format!("/{name}"))? {
        elastic::es(cfg, Method::PUT, &format!("/{name}/_mapping"), Some(&body["mappings"]))?;
    } else {
        elastic::es(cfg, Method::PUT, &format!("/{name}"), Some(&body))?;
    }
    println!("index {name} ready");
    Ok(())
}

fn agent(path: &Path) -> Result<Value> {
    let mut body = read_json(path)?;
    let instructions = path.with_extension("instructions.md");
    body["configuration"]["instructions"] =
        json!(std::fs::read_to_string(&instructions).with_context(|| format!("reading {}", instructions.display()))?);
    Ok(body)
}

fn ensure_kibana(cfg: &Config, collection: &str, mut body: Value) -> Result<()> {
    let id = body["id"].as_str().context("asset file without an id")?.to_string();
    let path = format!("{collection}/{id}");
    if elastic::kibana_exists(cfg, &path)? {
        let fields = body.as_object_mut().context("asset file is not an object")?;
        fields.remove("id");
        fields.remove("type");
        elastic::kibana(cfg, Method::PUT, &path, Some(&body))?;
    } else {
        elastic::kibana(cfg, Method::POST, collection, Some(&body))?;
    }
    println!("{path} ready");
    Ok(())
}

fn ensure_workflow(cfg: &Config, path: &Path) -> Result<()> {
    let id = stem(path);
    let yaml = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let url = format!("/api/workflows/workflow/{id}");
    let out = if elastic::kibana_exists(cfg, &url)? {
        elastic::kibana(cfg, Method::PUT, &url, Some(&json!({ "yaml": yaml })))?
    } else {
        elastic::kibana(cfg, Method::POST, "/api/workflows/workflow", Some(&json!({ "id": id, "yaml": yaml })))?
    };
    if out["valid"] != json!(true) {
        bail!("workflow {id} is not valid: {}", out["validationErrors"]);
    }
    println!("workflow {id} ready");
    Ok(())
}

fn load_records(cfg: &Config) -> Result<Vec<Record>> {
    let dir = cfg.data_dir.join("records");
    let mut all = records::read_jsonl(&dir.join("records.jsonl"))?;
    all.extend(records::read_jsonl(&dir.join("plan.jsonl"))?);
    Ok(all)
}

fn index_records(cfg: &Config, run_id: &str, records: &[Record]) -> Result<()> {
    let started = Instant::now();
    elastic::delete_run(cfg, RAW_INDICES, run_id)?;
    let docs = records
        .iter()
        .map(|r| {
            let mut doc = serde_json::to_value(r)?;
            doc["run_id"] = json!(run_id);
            Ok((r.index.clone(), format!("{run_id}:{}", r.source_key), doc))
        })
        .collect::<Result<Vec<_>>>()?;
    elastic::bulk_index(cfg, &docs)?;
    let counts = count_kinds(cfg, run_id)?;
    log_event(cfg, run_id, "index_records", ms(started), counts.clone(), &format!("{} records", docs.len()))?;
    println!("indexed {} records: {counts}", docs.len());
    Ok(())
}

fn count_kinds(cfg: &Config, run_id: &str) -> Result<Value> {
    let query = "FROM bandit-raw-pages, bandit-raw-orgs, bandit-raw-plan | WHERE run_id == ?run_id | STATS n = COUNT(*) BY record_kind | LIMIT 50";
    let out = elastic::esql(cfg, query, json!([{ "run_id": run_id }]))?;
    let rows = out["values"].as_array().cloned().unwrap_or_default();
    Ok(rows.iter().map(|row| (row[1].as_str().unwrap_or("").to_string(), row[0].clone())).collect())
}

fn run_workflow(cfg: &Config, run_id: &str) -> Result<()> {
    let started = Instant::now();
    let path = format!("/api/workflows/workflow/{WORKFLOW}/run");
    let out = elastic::kibana(cfg, Method::POST, &path, Some(&json!({ "inputs": { "run_id": run_id } })))?;
    let id = out["workflowExecutionId"].as_str().context("the workflow run returned no execution id")?.to_string();
    println!("workflow {WORKFLOW} started, execution {id}");
    let execution = wait_for(cfg, &id)?;
    let steps = execution["stepExecutions"].as_array().cloned().unwrap_or_default();
    for step in &steps {
        let stage = format!("workflow.{}", step["stepId"].as_str().unwrap_or(""));
        let duration = step["executionTimeMs"].as_u64().unwrap_or(0);
        log_event(cfg, run_id, &stage, duration, step_counts(step), step["status"].as_str().unwrap_or(""))?;
        println!("  {stage}: {} in {duration} ms", step["status"]);
    }
    let status = execution["status"].as_str().unwrap_or("").to_string();
    log_event(cfg, run_id, "workflow", ms(started), json!({ "steps": steps.len() }), &format!("execution {id} {status}"))?;
    if status != "completed" {
        let errors: Vec<String> = steps.iter().filter(|s| !s["error"].is_null()).map(|s| format!("{}: {}", s["stepId"], s["error"])).collect();
        bail!("workflow execution {id} ended {status}: {} {}", execution["error"], errors.join("; "));
    }
    Ok(())
}

fn wait_for(cfg: &Config, id: &str) -> Result<Value> {
    let path = format!("/api/workflows/executions/{id}?includeOutput=true");
    let deadline = Instant::now() + Duration::from_secs(30 * 60);
    loop {
        let execution = elastic::kibana(cfg, Method::GET, &path, None)?;
        if matches!(execution["status"].as_str(), Some("completed" | "failed" | "cancelled" | "timed_out")) {
            return Ok(execution);
        }
        if Instant::now() > deadline {
            bail!("workflow execution {id} is still {} after 30 minutes", execution["status"]);
        }
        std::thread::sleep(Duration::from_secs(5));
    }
}

fn step_counts(step: &Value) -> Value {
    json!({
        "rows": step["output"]["values"].as_array().map_or(0, Vec::len),
        "input_tokens": step["usage"]["inputTokens"].as_u64().unwrap_or(0),
        "output_tokens": step["usage"]["outputTokens"].as_u64().unwrap_or(0),
    })
}

fn read_bundle(cfg: &Config, run_id: &str, records: &[Record]) -> Result<Organized> {
    let started = Instant::now();
    let hits = elastic::search(cfg, BUNDLES, &json!({ "query": { "term": { "run_id": run_id } }, "size": 1 }))?;
    let source = hits["hits"]["hits"][0]["_source"].clone();
    let answer: Answer =
        serde_json::from_value(source).with_context(|| format!("the {BUNDLES} document of run {run_id} does not have the workflow's shape"))?;
    let organized = assemble(answer)?;
    let problems = problems(&organized, records);
    let counts = json!({
        "organizations": organized.organizations.len(),
        "prize_links": organized.prize_links.len(),
        "person_links": organized.person_links.len(),
        "schedule_links": organized.schedule_links.len(),
        "gaps": organized.gaps.len(),
        "problems": problems.len(),
    });
    log_event(cfg, run_id, "read_bundle", ms(started), counts, &problems.join("; "))?;
    if !problems.is_empty() {
        bail!("the organized document of run {run_id} breaks the contract: {}", problems.join("; "));
    }
    Ok(organized)
}

fn assemble(a: Answer) -> Result<Organized> {
    let mut organizations: Vec<Organization> = Vec::new();
    for (members, _, domain) in &a.org_rows {
        let d = a.org_decisions.get(domain).with_context(|| format!("no organization decision for domain {domain}"))?;
        let members = strings(members);
        let Some(org) = organizations.iter_mut().find(|o| o.key == d.key) else {
            organizations.push(Organization {
                key: d.key.clone(),
                name: d.name.clone(),
                domain: d.key.trim_start_matches("org:").to_string(),
                member_keys: members,
                facts_key: d.facts_key.clone(),
                category: d.category.clone(),
                tags: d.tags.clone(),
                description: d.description.clone(),
                match_method: d.match_method.clone(),
                match_reason: d.match_reason.clone(),
            });
            continue;
        };
        org.member_keys.extend(members);
        if org.facts_key.is_empty() {
            org.facts_key = d.facts_key.clone();
        }
        if d.match_method == "agent" {
            org.match_method = d.match_method.clone();
            org.match_reason = d.match_reason.clone();
        }
    }
    Ok(Organized {
        run_id: a.run_id,
        organizer: a.organizer,
        model: a.model,
        organizations,
        prize_links: a
            .prize_decisions
            .into_iter()
            .map(|(prize_key, d)| PrizeLink { prize_key, organization_key: d.organization_key, reason: d.reason })
            .collect(),
        person_links: a
            .person_decisions
            .into_iter()
            .map(|(person_key, d)| PersonLink { person_key, organization_key: d.organization_key, reason: d.reason })
            .collect(),
        schedule_links: a
            .schedule_decisions
            .into_iter()
            .map(|(slot_key, d)| ScheduleLink { slot_key, zone_key: d.zone_key, organization_key: d.organization_key, reason: d.reason })
            .collect(),
        gaps: a.gaps,
    })
}

fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(items) => items.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        Value::String(s) => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn problems(o: &Organized, records: &[Record]) -> Vec<String> {
    let known: HashSet<&str> = records
        .iter()
        .map(|r| r.source_key.as_str())
        .chain(o.organizations.iter().map(|x| x.key.as_str()))
        .chain([""])
        .collect();
    let used = o
        .organizations
        .iter()
        .flat_map(|x| x.member_keys.iter().chain([&x.facts_key]))
        .chain(o.prize_links.iter().flat_map(|l| [&l.prize_key, &l.organization_key]))
        .chain(o.person_links.iter().flat_map(|l| [&l.person_key, &l.organization_key]))
        .chain(o.schedule_links.iter().flat_map(|l| [&l.slot_key, &l.zone_key, &l.organization_key]))
        .chain(o.gaps.iter().map(|g| &g.key));
    let mut out: Vec<String> = used.filter(|k| !known.contains(k.as_str())).map(|k| format!("unknown key {k}")).collect();
    let decided: HashSet<&str> = o
        .organizations
        .iter()
        .flat_map(|x| x.member_keys.iter())
        .chain(o.prize_links.iter().map(|l| &l.prize_key))
        .chain(o.person_links.iter().map(|l| &l.person_key))
        .chain(o.schedule_links.iter().map(|l| &l.slot_key))
        .map(String::as_str)
        .collect();
    let kinds = [records::ORGANIZATION_CANDIDATE, records::PRIZE, records::PERSON_CANDIDATE, records::SCHEDULE_ITEM];
    out.extend(
        records
            .iter()
            .filter(|r| kinds.contains(&r.record_kind.as_str()) && !decided.contains(r.source_key.as_str()))
            .map(|r| format!("no decision for {}", r.source_key)),
    );
    out
}

fn write_decisions(cfg: &Config, o: &Organized, records: &[Record]) -> Result<()> {
    let started = Instant::now();
    let docs = decisions(o, records);
    elastic::delete_run(cfg, DECISIONS, &o.run_id)?;
    elastic::bulk_index(cfg, &docs)?;
    log_event(cfg, &o.run_id, "write_decisions", ms(started), json!({ "decisions": docs.len() }), "")?;
    println!("wrote {} decisions to {DECISIONS}", docs.len());
    Ok(())
}

fn decisions(o: &Organized, records: &[Record]) -> Vec<(String, String, Value)> {
    let at = chrono::Utc::now().to_rfc3339();
    let mut names: HashMap<&str, &str> = records.iter().map(|r| (r.source_key.as_str(), r.name.as_str())).collect();
    names.extend(o.organizations.iter().map(|x| (x.key.as_str(), x.name.as_str())));
    let orgs: HashMap<&str, &Organization> = o.organizations.iter().map(|x| (x.key.as_str(), x)).collect();
    let doc = |kind: &str, key: &str, org_key: &str, reason: &str| {
        let org = orgs.get(org_key);
        let doc = json!({
            "run_id": o.run_id,
            "decision_kind": kind,
            "key": key,
            "organization_key": org_key,
            "name": names.get(key).copied().unwrap_or(""),
            "category": org.map_or("", |x| x.category.as_str()),
            "tags": org.filter(|x| x.key == key).map_or(&[][..], |x| &x.tags[..]),
            "match_method": org.filter(|x| x.key == key).map_or("", |x| x.match_method.as_str()),
            "reason": reason,
            "at": at,
        });
        (DECISIONS.to_string(), format!("{}:{kind}:{key}", o.run_id), doc)
    };
    let mut out: Vec<_> = o.organizations.iter().map(|x| doc("organization", &x.key, &x.key, &x.match_reason)).collect();
    out.extend(o.prize_links.iter().map(|l| doc("prize_link", &l.prize_key, &l.organization_key, &l.reason)));
    out.extend(o.person_links.iter().map(|l| doc("person_link", &l.person_key, &l.organization_key, &l.reason)));
    out.extend(o.schedule_links.iter().map(|l| doc("schedule_link", &l.slot_key, &l.organization_key, &l.reason)));
    out.extend(o.gaps.iter().map(|g| doc("gap", &g.key, "", &g.reason)));
    out
}

fn save(cfg: &Config, o: &Organized) -> Result<PathBuf> {
    let started = Instant::now();
    let path = cfg.data_dir.join("bundles").join(format!("{}.organized.json", o.run_id));
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, serde_json::to_string_pretty(o)? + "\n").with_context(|| format!("writing {}", path.display()))?;
    log_event(cfg, &o.run_id, "save_bundle", ms(started), json!({ "organizations": o.organizations.len() }), &path.display().to_string())?;
    println!("organized document saved to {}", path.display());
    Ok(path)
}
