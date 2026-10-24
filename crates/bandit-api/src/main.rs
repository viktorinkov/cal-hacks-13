//! bandit-api: the HTTP edge. It holds the Elastic key, so browsers never talk to Elastic, and it reads
//! sessions, summary links and social rows from SpacetimeDB by subscription (it needs the `api` role).
//! Every response carries SpacetimeDB ids.

mod search;
mod summary;

use anyhow::{Context, Result};
use bandit_common::Config;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header::AUTHORIZATION};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use bandit_bindings::{
    ApiSessionsTableAccess, BoothTableAccess, DbConnection, MyRolesTableAccess,
    SocialAttendeesTableAccess, SocialEncountersTableAccess, SocialHandlesTableAccess,
    SocialPhotoTagsTableAccess, SocialPhotosTableAccess, SocialSharedVisitsTableAccess,
    SocialVisitsTableAccess, SummaryLinksTableAccess, ZoneTableAccess, connect,
};
use search::{Elastic, RANK_WINDOW};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use spacetimedb_sdk::{DbContext, Identity, Table, Timestamp};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

const SERVICE: &str = "bandit-api";
/// The big screen redraws the dashed links every 30 s; one Elastic pass serves every viewer in between.
const SIMILAR_TTL: Duration = Duration::from_secs(30);
const QUERIES: [&str; 12] = [
    "SELECT * FROM zone",
    "SELECT * FROM booth",
    "SELECT * FROM api_sessions",
    "SELECT * FROM summary_links",
    "SELECT * FROM social_attendees",
    "SELECT * FROM social_handles",
    "SELECT * FROM social_visits",
    "SELECT * FROM social_encounters",
    "SELECT * FROM social_shared_visits",
    "SELECT * FROM social_photos",
    "SELECT * FROM social_photo_tags",
    "SELECT * FROM my_roles",
];

struct App {
    conn: DbConnection,
    es: Elastic,
    similar: Mutex<Option<(Instant, usize, Value)>>,
}

type AppState = State<Arc<App>>;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::load()?;
    let addr = std::env::var("BANDIT_API_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let prefix = std::env::var("ELASTIC_INDEX_PREFIX").unwrap_or_else(|_| "bandit".into());
    let es = Elastic::new(
        config.elasticsearch_url.as_deref().context("set ELASTICSEARCH_URL")?,
        config.elasticsearch_api_key.as_deref().context("set ELASTICSEARCH_API_KEY")?,
        &prefix,
    )?;
    let database = config.spacetimedb_database.clone().context("set SPACETIMEDB_DATABASE")?;
    let tokens = config.token_store();
    let (conn, identity, token) = connect(&config.spacetimedb_url, &database, tokens.load(SERVICE)?)?;
    tokens.save(SERVICE, &token)?;
    eprintln!("{SERVICE} connected as {identity}; it needs the api role");
    let (synced, initial_sync) = tokio::sync::oneshot::channel();
    conn.subscription_builder()
        .on_applied(move |_| {
            let _ = synced.send(());
        })
        .on_error(|_, e| {
            eprintln!("subscription failed: {e:?}");
            std::process::exit(1);
        })
        .subscribe(QUERIES);
    initial_sync.await?;

    let app = Router::new()
        .route("/health", get(health))
        .route("/search/booths", get(search_booths))
        .route("/search/memories", get(search_memories))
        .route("/graph/similar", get(graph_similar))
        .route("/summary/{token}", get(summary_page))
        .layer(CorsLayer::permissive())
        .with_state(Arc::new(App { conn, es, similar: Mutex::new(None) }));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("bandit-api listening on {addr}, searching {prefix}-*");
    axum::serve(listener, app).await?;
    Ok(())
}

/// The app registers this hash with `open_api_session` or `create_summary_link` and sends the token itself.
fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// The caller's attendee identity: the hash of the bearer token names an unexpired api_session.
fn caller(app: &App, headers: &HeaderMap) -> Result<Identity, ApiError> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    let hash = token_hash(token);
    let now = Timestamp::now();
    app.conn
        .db
        .api_sessions()
        .iter()
        .find(|s| s.token_hash == hash && s.expires_at > now)
        .map(|s| s.identity)
        .ok_or(ApiError::Unauthorized)
}

#[derive(Deserialize)]
struct SearchParams {
    q: String,
    kind: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct GraphParams {
    limit: Option<usize>,
}

/// Liveness, and the roles this service holds, so the owner can see that `grant_role` landed.
async fn health(State(app): AppState) -> Json<Value> {
    let roles: Vec<String> = app.conn.db.my_roles().iter().map(|r| r.role).collect();
    Json(json!({ "status": "ok", "roles": roles }))
}

async fn search_booths(
    State(app): AppState,
    Query(p): Query<SearchParams>,
) -> Result<Json<Value>, ApiError> {
    let body = search::booths_query(&p.q, p.limit.unwrap_or(10).clamp(1, RANK_WINDOW));
    let found = app.es.search("booths", &body).await?;
    Ok(Json(json!({ "hits": search::hits(&found) })))
}

async fn search_memories(
    State(app): AppState,
    headers: HeaderMap,
    Query(p): Query<SearchParams>,
) -> Result<Json<Value>, ApiError> {
    let me = caller(&app, &headers)?;
    let body = search::memories_query(
        &me.to_hex(),
        &p.q,
        p.kind.as_deref(),
        p.limit.unwrap_or(10).clamp(1, RANK_WINDOW),
    );
    let found = app.es.search("memories", &body).await?;
    Ok(Json(json!({ "hits": search::hits(&found) })))
}

async fn graph_similar(
    State(app): AppState,
    Query(p): Query<GraphParams>,
) -> Result<Json<Value>, ApiError> {
    let limit = p.limit.unwrap_or(3).clamp(1, RANK_WINDOW);
    let mut cached = app.similar.lock().await;
    if let Some((at, l, body)) = cached.as_ref() {
        if *l == limit && at.elapsed() < SIMILAR_TTL {
            return Ok(Json(body.clone()));
        }
    }
    let body = json!({ "pairs": app.es.similar_pairs(limit).await? });
    *cached = Some((Instant::now(), limit, body.clone()));
    Ok(Json(body))
}

/// The special link: the token in the URL is the secret, so the route needs no session.
async fn summary_page(
    State(app): AppState,
    Path(token): Path<String>,
) -> Result<Json<summary::Summary>, ApiError> {
    let hash = token_hash(&token);
    let db = &app.conn.db;
    let link = db
        .summary_links()
        .iter()
        .find(|l| l.token_hash == hash)
        .ok_or(ApiError::NotFound)?;
    let rows = summary::Rows {
        zones: db.zone().iter().collect(),
        booths: db.booth().iter().collect(),
        attendees: db.social_attendees().iter().collect(),
        handles: db.social_handles().iter().collect(),
        visits: db.social_visits().iter().collect(),
        encounters: db.social_encounters().iter().collect(),
        shared_visits: db.social_shared_visits().iter().collect(),
        photos: db.social_photos().iter().collect(),
        photo_tags: db.social_photo_tags().iter().collect(),
    };
    summary::summary(&rows, link.attendee)
        .map(Json)
        .ok_or(ApiError::NotFound)
}

enum ApiError {
    Unauthorized,
    NotFound,
    /// Elastic failed or took longer than 10 s.
    Unavailable,
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        eprintln!("elastic: {e:#}");
        ApiError::Unavailable
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "send Authorization: Bearer <token> of an open api session",
            ),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not found"),
            ApiError::Unavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "search is unavailable, try again",
            ),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_hash_is_lowercase_sha256_hex() {
        assert_eq!(
            token_hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(token_hash("").len(), 64);
    }
}
