use crate::config::Config;
use anyhow::{Result, bail};
use serde_json::{Value, json};

fn esql(query: String) -> Value {
    json!({ "type": "esql", "query": query })
}

fn panel(grid: (u32, u32, u32, u32), config: Value) -> Value {
    json!({ "type": "vis", "grid": { "x": grid.0, "y": grid.1, "w": grid.2, "h": grid.3 }, "config": config })
}

fn metric(grid: (u32, u32, u32, u32), title: &str, query: String, column: &str) -> Value {
    panel(grid, json!({ "type": "metric", "title": title, "data_source": esql(query), "metrics": [{ "type": "primary", "column": column }] }))
}

fn bar(grid: (u32, u32, u32, u32), title: &str, query: String, x: &str, y: &str) -> Value {
    panel(
        grid,
        json!({ "type": "xy", "title": title, "layers": [{ "type": "bar_horizontal", "data_source": esql(query), "x": { "column": x }, "y": [{ "column": y }] }] }),
    )
}

fn pie(grid: (u32, u32, u32, u32), title: &str, query: String, group: &str, value: &str) -> Value {
    panel(
        grid,
        json!({ "type": "pie", "title": title, "data_source": esql(query), "metrics": [{ "column": value }], "group_by": [{ "column": group }] }),
    )
}

fn table(grid: (u32, u32, u32, u32), title: &str, query: String, rows: &[&str], metrics: &[&str]) -> Value {
    let rows: Vec<Value> = rows.iter().map(|c| json!({ "column": c })).collect();
    let metrics: Vec<Value> = metrics.iter().map(|c| json!({ "column": c })).collect();
    panel(grid, json!({ "type": "data_table", "title": title, "data_source": esql(query), "rows": rows, "metrics": metrics }))
}

fn tags(grid: (u32, u32, u32, u32), title: &str, query: String, tag: &str, value: &str) -> Value {
    panel(
        grid,
        json!({ "type": "tag_cloud", "title": title, "data_source": esql(query), "metric": { "column": value }, "tag_by": { "column": tag } }),
    )
}

fn markdown(grid: (u32, u32, u32, u32), content: String) -> Value {
    json!({ "type": "markdown", "grid": { "x": grid.0, "y": grid.1, "w": grid.2, "h": grid.3 }, "config": { "content": content } })
}

fn pipeline(cfg: &Config, run_id: &str) -> Value {
    let run = format!("WHERE run_id == \"{run_id}\"");
    let raw = format!("FROM bandit-raw-pages, bandit-raw-orgs, bandit-raw-plan | {run}");
    let decisions = format!("FROM bandit-organizer-decisions | {run}");
    let (y0, y1, y2, y3, y4) = (0, 5, 13, 27, 43);
    json!({
        "title": format!("BandIt · {} · scrape pipeline", cfg.event.name),
        "description": "Bright Data fetched every page, Elastic organized the records, Rust checked the bundle, SpacetimeDB holds the rows.",
        "panels": [
            markdown((0, y0, 48, 5), format!(
                "**{}**, run `{run_id}`. Bright Data scraped the event pages and the company datasets. The records landed in the raw indices, ES|QL `LOOKUP JOIN` made the exact joins, and the Agent Builder agent `bandit-organizer` resolved the rest and gave a reason for every decision. The checked bundle then went into SpacetimeDB in one `import_event` transaction.",
                cfg.event.name
            )),
            metric((0, y1, 12, 8), "Raw records from Bright Data", format!("{raw} | STATS records = COUNT()"), "records"),
            metric((12, y1, 12, 8), "Organizations after merging", format!("{decisions} | WHERE decision_kind == \"organization\" | STATS organizations = COUNT()"), "organizations"),
            metric((24, y1, 12, 8), "Matches only the agent could make", format!("{decisions} | WHERE match_method == \"agent\" | STATS merges = COUNT()"), "merges"),
            metric((36, y1, 12, 8), "Gaps flagged for review", format!("{decisions} | WHERE decision_kind == \"gap\" | STATS gaps = COUNT()"), "gaps"),
            bar((0, y2, 24, 14), "Records by source and kind", format!("{raw} | EVAL source = CONCAT(MV_FIRST(SPLIT(source_key, \":\")), \" · \", record_kind) | STATS n = COUNT() BY source | SORT n DESC"), "source", "n"),
            pie((24, y2, 24, 14), "How each organization was matched", format!("{decisions} | WHERE decision_kind == \"organization\" | STATS n = COUNT() BY match_method"), "match_method", "n"),
            table((0, y3, 48, 16), "Organizer decisions and reasons", format!("{decisions} | WHERE decision_kind != \"gap\" | EVAL rank = CASE(match_method == \"agent\", 0, decision_kind == \"organization\", 1, 2) | STATS rows = COUNT() BY rank, name, decision_kind, match_method, category, reason | SORT rank, name | LIMIT 300"), &["name", "decision_kind", "match_method", "category", "reason"], &["rows"]),
            bar((0, y4, 24, 12), "Pipeline steps (ms)", format!("FROM bandit-pipeline-events | {run} | STATS ms = SUM(duration_ms) BY stage | SORT ms DESC"), "stage", "ms"),
            table((24, y4, 24, 12), "Gaps", format!("{decisions} | WHERE decision_kind == \"gap\" | STATS n = COUNT() BY key, reason | LIMIT 100"), &["key", "reason"], &["n"]),
        ]
    })
}

fn event(cfg: &Config, run_id: &str) -> Value {
    let run = format!("WHERE run_id == \"{run_id}\"");
    let pages = format!("FROM bandit-raw-pages | {run}");
    let decisions = format!("FROM bandit-organizer-decisions | {run} | WHERE decision_kind == \"organization\"");
    json!({
        "title": format!("BandIt · {} · sponsors and prizes", cfg.event.name),
        "description": "The event's sponsors, prizes and companies as Bright Data scraped them and Elastic organized them.",
        "panels": [
            metric((0, 0, 12, 8), "Prize cash", format!("{pages} | WHERE record_kind == \"prize\" | STATS usd = SUM(fields.cash_usd)"), "usd"),
            metric((12, 0, 12, 8), "Prizes", format!("{pages} | WHERE record_kind == \"prize\" | STATS prizes = COUNT()"), "prizes"),
            metric((24, 0, 12, 8), "Sponsors and partners", format!("{decisions} | STATS organizations = COUNT()"), "organizations"),
            metric((36, 0, 12, 8), "Company profiles (LinkedIn, Crunchbase)", format!("FROM bandit-raw-orgs | {run} | WHERE record_kind == \"company_facts\" | STATS profiles = COUNT()"), "profiles"),
            bar((0, 8, 24, 16), "Prize cash by sponsor", format!("{pages} | WHERE record_kind == \"prize\" | EVAL sponsor = CASE(role_text == \"\" OR role_text IS NULL, \"{}\", role_text) | STATS cash = SUM(fields.cash_usd) BY sponsor | SORT cash DESC | LIMIT 25", cfg.event.name), "sponsor", "cash"),
            pie((24, 8, 24, 16), "Sponsors by category (assigned by the agent)", format!("{decisions} | STATS n = COUNT() BY category"), "category", "n"),
            bar((0, 24, 24, 14), "Sponsors by tier", format!("{pages} | WHERE record_kind == \"organization_candidate\" AND tier_text IS NOT NULL AND tier_text != \"\" | STATS n = COUNT() BY tier_text"), "tier_text", "n"),
            tags((24, 24, 24, 14), "What the sponsors work on", format!("{decisions} | MV_EXPAND tags | WHERE tags IS NOT NULL | STATS n = COUNT() BY tags"), "tags", "n"),
            table((0, 38, 48, 16), "Companies (LinkedIn and Crunchbase via Bright Data)", format!("FROM bandit-raw-orgs | {run} | WHERE record_kind == \"company_facts\" | EVAL source = MV_FIRST(SPLIT(source_key, \":\")) | STATS founded = MAX(fields.founded_year) BY name, domain, source, industry = fields.industry, headquarters = fields.headquarters, size = fields.company_size | SORT name | LIMIT 200"), &["name", "domain", "source", "industry", "headquarters", "size"], &["founded"]),
        ]
    })
}

fn put(cfg: &Config, id: &str, body: &Value) -> Result<()> {
    let res = reqwest::blocking::Client::new()
        .put(format!("{}/api/dashboards/{id}", cfg.kibana_url))
        .header("Authorization", format!("ApiKey {}", cfg.kibana_key))
        .header("kbn-xsrf", "true")
        .json(body)
        .send()?;
    let status = res.status();
    if !status.is_success() {
        bail!("dashboard {id} refused: {status} {}", res.text()?);
    }
    println!("dashboards: {}/app/dashboards#/view/{id}", cfg.kibana_url);
    Ok(())
}

pub fn setup(cfg: &Config, run_id: &str) -> Result<()> {
    put(cfg, &format!("bandit-pipeline-{}", cfg.event.slug), &pipeline(cfg, run_id))?;
    put(cfg, &format!("bandit-event-{}", cfg.event.slug), &event(cfg, run_id))
}
