//! The plain web pages and what they need from bandit-api: the static files, the connection
//! settings, file uploads into the blob store, the Elastic-ranked recap for a signed-in attendee,
//! and, with `BANDIT_DEMO=1`, the demo identities and a press on a simulated band.

use crate::{App, AppState, ranked_summary};
use anyhow::{Context, Result};
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use bandit_bindings::{ApiSessionsTableAccess, BandTableAccess, register_blob};
use serde::Deserialize;
use serde_json::{Value, json};
use spacetimedb_sdk::{Identity, Table};
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};

/// The header the pages send with the token they registered through `open_api_session`.
pub const SESSION_HEADER: &str = "x-bandit-session";

/// Staff and attendees `bandit-claims setup` created, offered by the "play as" switcher.
const DEMO_ACTORS: &[(&str, &str)] = &[
    ("ops", "Ops desk (organizer)"),
    ("medic", "Ari Ramos (medic)"),
    ("sam", "Sam Okafor (floor manager)"),
    ("dana", "Dana Ruiz (risk manager)"),
    ("priya", "Priya Nair (adjuster, Northwind Mutual)"),
    ("photographer", "Event photographer"),
    ("jordan", "Jordan Alvarez (attendee, band 90)"),
    ("maya", "Maya Chen (attendee, band 91)"),
    ("sam-patel", "Sam Patel (attendee, band 92)"),
    ("lee", "Lee Park (attendee, band 93)"),
];

pub struct Web {
    pub root: PathBuf,
    pub spacetimedb_url: String,
    pub database: String,
    pub kibana_url: String,
    /// The SpacetimeAuth client the pages sign in with; empty until the project is set up.
    pub auth_client_id: String,
    pub demo: bool,
    pub http: reqwest::Client,
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
        .nest_service("/merch", ServeDir::new(web.root.join("assets/merch")))
        .nest_service("/fixtures", ServeDir::new(web.root.join("fixtures/medical-records/rendered")))
        .route("/config.json", get(config))
        .route("/api/blobs", post(upload))
        .route("/blobs/{hash}", get(blob))
        .route("/api/recap", get(recap))
        .route("/api/actors", get(actors))
        .route("/api/dev/press/{band}", post(press))
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
        ("Event story", "bandit-event-calhacks-13"),
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
        "demo": w.demo,
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
    /// `medical` or `photo`.
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
/// (medical) or register it as an event photo (photo).
async fn upload(State(app): AppState, Query(q): Query<UploadQuery>, headers: HeaderMap, body: Bytes) -> ApiResult<Json<Value>> {
    let (access, default_type) = match q.purpose.as_str() {
        "medical" => ("staff", "application/pdf"),
        "photo" => ("shared", "image/jpeg"),
        _ => return Err(error(StatusCode::BAD_REQUEST, "purpose is medical or photo")),
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
        .register_blob_then(blob.sha256.clone(), None, access.into(), q.purpose.clone(), content_type.clone(), blob.size_bytes, move |_, r| {
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

/// Demo only: the identities `bandit-claims setup` created, so one browser can play each person.
async fn actors(State(app): AppState) -> ApiResult<Json<Value>> {
    if !app.web.demo {
        return Err(error(StatusCode::NOT_FOUND, "demo actors are off"));
    }
    let mut out = Vec::new();
    for (name, label) in DEMO_ACTORS {
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

/// Demo only: presses a simulated band's button, for testing the claim without hardware.
async fn press(State(app): AppState, Path(band): Path<u8>) -> ApiResult<Json<Value>> {
    if !app.web.demo {
        return Err(error(StatusCode::NOT_FOUND, "demo press is off"));
    }
    if !(90..=99).contains(&band) {
        return Err(error(StatusCode::BAD_REQUEST, "only the simulated bands 90 to 99 can be pressed from here; press a real band's button"));
    }
    let token = app
        .tokens
        .load("sim")
        .ok()
        .flatten()
        .context("no simulator identity; run scripts/e2e-setup")
        .map_err(|e| error(StatusCode::CONFLICT, format!("{e:#}")))?;
    let station = app.conn.db.band().iter().find(|b| b.id == band && b.zone != 0).map(|b| b.zone).unwrap_or(104);
    for pressed in [false, true, false] {
        sim_report(&app.web, &token, band, station, pressed)
            .await
            .map_err(|e| error(StatusCode::BAD_GATEWAY, format!("{e:#}")))?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    Ok(Json(json!({ "pressed": band })))
}
