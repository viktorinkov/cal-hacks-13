//! The plain web pages and what they need from bandit-api: the static files, the connection
//! settings, file uploads into the blob store, the Elastic-ranked recap for a signed-in attendee,
//! and, with `BANDIT_SIMULATE=1`, the test identities and a press on a simulated band.

use crate::{App, AppState, ranked_summary};
use anyhow::{Context, Result};
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use bandit_bindings::{ApiSessionsTableAccess, BandTableAccess, EventStateTableAccess, ZoneTableAccess, register_blob};
use serde::Deserialize;
use serde_json::{Value, json};
use spacetimedb_sdk::{Identity, Table};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};

/// The header the pages send with the token they registered through `open_api_session`.
pub const SESSION_HEADER: &str = "x-bandit-session";

/// Staff and attendees `bandit-claims setup` created, offered by the "play as" switcher.
const ACTORS: &[(&str, &str)] = &[
    ("ops", "Ops desk (organizer)"),
    ("medic", "Ari Ramos (medic)"),
    ("photographer", "Event photographer"),
    ("jordan", "Jordan Alvarez (attendee, band 90)"),
    ("maya", "Maya Chen (attendee, band 91)"),
    ("sam-patel", "Sam Patel (attendee, band 92)"),
    ("lee", "Lee Park (attendee, band 93)"),
];

/// Simulated bands a tester claims from the tap link. 90 to 93 belong to the claims story's attendees.
pub const TAP_SIM_BANDS: std::ops::RangeInclusive<u8> = 94..=99;

pub struct Web {
    pub root: PathBuf,
    pub spacetimedb_url: String,
    pub database: String,
    pub kibana_url: String,
    /// The SpacetimeAuth client the pages sign in with; empty until the project is set up.
    pub auth_client_id: String,
    pub simulate: bool,
    pub http: reqwest::Client,
    /// The station each pressed simulated band reports from, kept alive by `heartbeat`.
    pub sim_bands: std::sync::Mutex<std::collections::BTreeMap<u8, u8>>,
}

pub fn routes(web: &Web) -> axum::Router<Arc<App>> {
    let file = |name: &str| ServeFile::new(web.root.join("web").join(name));
    axum::Router::new()
        .route_service("/", file("index.html"))
        .route_service("/t/{token}", file("t.html"))
        .route_service("/callback", file("t.html"))
        .route_service("/organizer", file("organizer.html"))
        .route_service("/photo", file("photo.html"))
        .route_service("/style.css", file("style.css"))
        .nest_service("/js", ServeDir::new(web.root.join("web/dist")))
        .nest_service("/assets/merch", ServeDir::new(web.root.join("assets/merch")))
        .route("/config.json", get(config))
        .route("/api/blobs", post(upload))
        .route("/blobs/{hash}", get(blob))
        .route("/api/recap", get(recap))
        .route("/api/actors", get(actors))
        .route("/api/dev/press/{band}", post(press))
        .route("/api/dev/move/{band}/{station}", post(move_band))
        .route("/api/dev/record/{claim}/{template}", post(sample_record))
        .route("/api/dev/fall/{band}", post(fall))
        .route("/api/dev/property/{station}", post(property))
        .nest_service("/samples", ServeDir::new(web.root.join("fixtures/attendee-documents/rendered")))
}

fn error(status: StatusCode, message: impl ToString) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message.to_string() })))
}

type ApiResult<T> = Result<T, (StatusCode, Json<Value>)>;

/// Where the pages connect: the WebSocket form of the SpacetimeDB URL, and the Kibana dashboards.
async fn config(State(app): AppState) -> Json<Value> {
    let w = &app.web;
    let ws = w.spacetimedb_url.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    let kibana = w.kibana_url.trim_end_matches('/');
    let dashboards: Vec<Value> = [
        ("Import run", "bandit-pipeline-calhacks-13"),
        ("Sponsors and prizes", "bandit-event-calhacks-13"),
        ("Claims", "bandit-claims"),
    ]
    .iter()
    .map(|(title, id)| json!({ "title": title, "url": format!("{kibana}/app/dashboards#/view/{id}") }))
    .collect();
    Json(json!({
        "spacetimedb_url": ws,
        "database": w.database,
        "kibana_url": kibana,
        "dashboards": dashboards,
        "auth_client_id": w.auth_client_id,
        "simulate": w.simulate,
    }))
}

/// The attendee behind the session token, from the module's `api_sessions` view.
pub fn session_identity(app: &App, headers: &HeaderMap) -> ApiResult<Identity> {
    let token = headers
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "open an API session first"))?;
    let hash = crate::token_hash(token);
    app.conn
        .db
        .api_sessions()
        .iter()
        .find(|s| s.token_hash == hash)
        .map(|s| s.identity)
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "unknown API session"))
}

/// The recap of the signed-in attendee, with Elastic's ranking of the people and booths.
async fn recap(State(app): AppState, headers: HeaderMap) -> ApiResult<Json<crate::summary::Summary>> {
    let who = session_identity(&app, &headers)?;
    ranked_summary(&app, who)
        .await
        .map(Json)
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "no recap for this attendee yet"))
}

#[derive(Deserialize)]
struct UploadQuery {
    /// `medical` (a clinic bill the medic files), `photo`, or the attendee's own `history` or
    /// `insurance` PDF, which needs their session and stays theirs.
    purpose: String,
}

/// PDF pages, counted the way the claims CLI counts them.
fn count_pages(pdf: &[u8]) -> u32 {
    let mut n = 0;
    let mut i = 0;
    while let Some(at) = pdf[i..].windows(5).position(|w| w == b"/Type") {
        let mut j = i + at + 5;
        while j < pdf.len() && pdf[j].is_ascii_whitespace() {
            j += 1;
        }
        if pdf[j..].starts_with(b"/Page") && !pdf.get(j + 5).is_some_and(|c| c.is_ascii_alphanumeric()) {
            n += 1;
        }
        i = j;
    }
    n.max(1)
}

/// Stores the file in the blob store and registers it, so the page can file it on a claim
/// (medical), register it as an event photo (photo), or file it on the attendee's medical card.
async fn upload(State(app): AppState, Query(q): Query<UploadQuery>, headers: HeaderMap, body: Bytes) -> ApiResult<Json<Value>> {
    let (access, default_type, owner) = match q.purpose.as_str() {
        "medical" => ("staff", "application/pdf", None),
        "photo" => ("shared", "image/jpeg", None),
        "history" | "insurance" => ("owner_only", "application/pdf", Some(session_identity(&app, &headers)?)),
        _ => return Err(error(StatusCode::BAD_REQUEST, "purpose is medical, photo, history or insurance")),
    };
    if body.is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "empty file"));
    }
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(default_type)
        .to_string();
    let blob = app.blobs.put(&body).map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.conn
        .reducers
        .register_blob_then(blob.sha256.clone(), owner, access.into(), q.purpose.clone(), content_type.clone(), blob.size_bytes, move |_, r| {
            let _ = tx.send(r.map_err(|e| e.to_string()).and_then(|r| r));
        })
        .map_err(|e| error(StatusCode::BAD_GATEWAY, e))?;
    rx.await
        .map_err(|e| error(StatusCode::BAD_GATEWAY, e))?
        .map_err(|e| error(StatusCode::BAD_GATEWAY, format!("register_blob: {e}")))?;
    let pages = if content_type == "application/pdf" { count_pages(&body) } else { 0 };
    Ok(Json(json!({
        "hash": blob.sha256,
        "size_bytes": blob.size_bytes,
        "pages": pages,
        "url": format!("/blobs/{}", blob.sha256),
    })))
}

/// A stored file by its SHA-256, which is the secret in the URL.
async fn blob(State(app): AppState, Path(hash): Path<String>) -> Response {
    match app.blobs.get(&hash) {
        Ok(bytes) => {
            let kind = if bytes.starts_with(b"%PDF") {
                "application/pdf"
            } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                "image/png"
            } else {
                "image/jpeg"
            };
            ([(header::CONTENT_TYPE, kind), (header::CACHE_CONTROL, "max-age=86400")], bytes).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Simulation only: the identities `bandit-claims setup` created, so one browser can play each person.
async fn actors(State(app): AppState) -> ApiResult<Json<Value>> {
    if !app.web.simulate {
        return Err(error(StatusCode::NOT_FOUND, "test identities are off"));
    }
    let mut out = Vec::new();
    for (name, label) in ACTORS {
        if let Ok(Some(token)) = app.tokens.load(name) {
            out.push(json!({ "name": name, "label": label, "token": token }));
        }
    }
    Ok(Json(json!(out)))
}

/// One report of a simulated band (ids 90 to 99) through `report_sim_band`, as the `sim` identity.
async fn sim_report(web: &Web, token: &str, band: u8, station: u8, press: bool) -> Result<()> {
    let body = json!([band, station, 0, 0, false, false, press]);
    let url = format!("{}/v1/database/{}/call/report_sim_band", web.spacetimedb_url.trim_end_matches('/'), web.database);
    let res = web.http.post(url).bearer_auth(token).json(&body).send().await?;
    let status = res.status();
    if !status.is_success() {
        anyhow::bail!("report_sim_band answered {status}: {}", res.text().await.unwrap_or_default());
    }
    Ok(())
}

/// Simulation only: presses a simulated band's button, for testing the claim without hardware.
async fn press(State(app): AppState, Path(band): Path<u8>) -> ApiResult<Json<Value>> {
    if !app.web.simulate {
        return Err(error(StatusCode::NOT_FOUND, "simulated press is off"));
    }
    if !TAP_SIM_BANDS.contains(&band) {
        return Err(error(StatusCode::BAD_REQUEST, "only the simulated bands 94 to 99 can be pressed from here; press a real band's button"));
    }
    let token = sim_token(&app)?;
    let station = app.conn.db.band().iter().find(|b| b.id == band && b.zone != 0).map(|b| b.zone).unwrap_or(104);
    app.web.sim_bands.lock().unwrap().insert(band, station);
    for pressed in [false, true, false] {
        sim_report(&app.web, &token, band, station, pressed)
            .await
            .map_err(|e| error(StatusCode::BAD_GATEWAY, format!("{e:#}")))?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    Ok(Json(json!({ "pressed": band })))
}

fn sim_token(app: &App) -> ApiResult<String> {
    app.tokens
        .load("sim")
        .ok()
        .flatten()
        .context("no simulator identity; run scripts/e2e-setup")
        .map_err(|e| error(StatusCode::CONFLICT, format!("{e:#}")))
}

/// Simulation only: walks a simulated band (90 to 99) to another zone's station.
async fn move_band(State(app): AppState, Path((band, station)): Path<(u8, u8)>) -> ApiResult<Json<Value>> {
    if !app.web.simulate || !(90..=99).contains(&band) {
        return Err(error(StatusCode::NOT_FOUND, "only simulated bands move from here"));
    }
    let token = sim_token(&app)?;
    app.web.sim_bands.lock().unwrap().insert(band, station);
    sim_report(&app.web, &token, band, station, false).await.map_err(|e| error(StatusCode::BAD_GATEWAY, format!("{e:#}")))?;
    Ok(Json(json!({ "band": band, "station": station })))
}

/// Simulation only: reports every pressed simulated band every 2 s, as a worn band would, so it stays online,
/// keeps its zone visit open and mixes with the simulated crowd. The bands go quiet once the event ends.
pub async fn heartbeat(app: Arc<App>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if app.conn.db.event_state().iter().any(|e| e.ended) {
            continue;
        }
        let Ok(token) = sim_token(&app) else { continue };
        let bands: Vec<(u8, u8)> = app.web.sim_bands.lock().unwrap().iter().map(|(b, s)| (*b, *s)).collect();
        for (band, station) in bands {
            if let Err(e) = sim_report(&app.web, &token, band, station, false).await {
                eprintln!("simulated band {band} heartbeat: {e:#}");
            }
        }
    }
}

/// Simulation only: renders one of the synthetic clinic records, made out to the claimant, for the
/// claim's incident date and time, and files it as the medic through `bandit-claims attach-record`.
async fn sample_record(State(app): AppState, Path((claim, template)): Path<(u64, String)>) -> ApiResult<Json<Value>> {
    if !app.web.simulate {
        return Err(error(StatusCode::NOT_FOUND, "test records are off"));
    }
    if !["first-aid-wrist", "urgent-care-wrist", "urgent-care-ankle-home"].contains(&template.as_str()) {
        return Err(error(StatusCode::BAD_REQUEST, "unknown test record"));
    }
    let filed = claims_cli(&app, &["attach-record", "--claim", &claim.to_string(), "--template", &template, "--for-claimant"]).await?;
    Ok(Json(json!({ "filed": filed })))
}

/// Simulation only: the band falls where it is, with two of the claims story's attendees as the
/// bands around it, through `bandit-claims fall`. The heartbeats of the band and the witnesses pause
/// meanwhile so the fall shows; the witnesses stay where they gathered round.
async fn fall(State(app): AppState, Path(band): Path<u8>) -> ApiResult<Json<Value>> {
    if !app.web.simulate || !(90..=99).contains(&band) {
        return Err(error(StatusCode::NOT_FOUND, "only simulated bands fall from here"));
    }
    let station = app.conn.db.band().iter().find(|b| b.id == band && b.zone != 0).map(|b| b.zone).unwrap_or(104);
    let witnesses: Vec<u8> = [90u8, 92, 93, 91].into_iter().filter(|w| *w != band).take(2).collect();
    let (paused, gathered) = {
        let mut sims = app.web.sim_bands.lock().unwrap();
        let paused = sims.remove(&band);
        let gathered: Vec<u8> = witnesses.iter().copied().filter(|w| sims.remove(w).is_some()).collect();
        (paused, gathered)
    };
    let list: Vec<String> = witnesses.iter().map(u8::to_string).collect();
    let out = claims_cli(&app, &["fall", "--band", &band.to_string(), "--witnesses", &list.join(","), "--station", &station.to_string(), "--witness-station", &station.to_string()]).await;
    let mut sims = app.web.sim_bands.lock().unwrap();
    if let Some(s) = paused {
        sims.insert(band, s);
    }
    sims.extend(gathered.into_iter().map(|w| (w, station)));
    drop(sims);
    Ok(Json(json!({ "fell": out? })))
}

async fn claims_cli(app: &App, args: &[&str]) -> ApiResult<String> {
    let cli = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("bandit-claims")))
        .ok_or_else(|| error(StatusCode::INTERNAL_SERVER_ERROR, "bandit-claims not found"))?;
    let out = tokio::process::Command::new(cli)
        .args(args)
        .current_dir(&app.web.root)
        .output()
        .await
        .map_err(|e| error(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    if !out.status.success() {
        return Err(error(StatusCode::BAD_GATEWAY, String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Simulation only: a camera sees a speaker knocked off its stand in the zone, through
/// `bandit-claims property --camera`, which plays the vision service.
async fn property(State(app): AppState, Path(station): Path<u8>) -> ApiResult<Json<Value>> {
    if !app.web.simulate {
        return Err(error(StatusCode::NOT_FOUND, "simulation is off"));
    }
    let zone = app.conn.db.zone().iter().find(|z| z.station_id == station).map(|z| z.name).ok_or_else(|| error(StatusCode::BAD_REQUEST, "no zone has that station"))?;
    let out = claims_cli(&app, &["property", "--zone", &zone, "--note", "a speaker was knocked off its stand and cracked", "--cost", "2400.00", "--camera"]).await?;
    Ok(Json(json!({ "opened": out })))
}
