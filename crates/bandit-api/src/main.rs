//! bandit-api: the HTTP edge. It holds the Elastic key, so browsers never talk to Elastic, and it reads
//! summary links and social rows from SpacetimeDB by subscription (it needs the `api` role).
//! It serves the recap behind an attendee's special link, with suggestions ranked by Elastic,
//! and the plain web pages (see `web`).

mod search;
mod summary;
mod web;

use anyhow::{Context, Result};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use bandit_bindings::{
    BoothTableAccess, DbConnection, MyRolesTableAccess,
    SocialAttendeesTableAccess,
    SocialEncountersTableAccess, SocialHandlesTableAccess, SocialPhotoTagsTableAccess,
    SocialPhotosTableAccess, SocialSharedVisitsTableAccess, SocialVisitsTableAccess,
    SummaryLinksTableAccess, ZoneTableAccess, connect,
};
use bandit_common::{BlobStore, Config, TokenStore};
use search::Elastic;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use spacetimedb_sdk::{DbContext, Identity, Table};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

const SERVICE: &str = "bandit-api";
const QUERIES: [&str; 13] = [
    "SELECT * FROM zone",
    "SELECT * FROM booth",
    "SELECT * FROM summary_links",
    "SELECT * FROM social_attendees",
    "SELECT * FROM social_handles",
    "SELECT * FROM social_visits",
    "SELECT * FROM social_encounters",
    "SELECT * FROM social_shared_visits",
    "SELECT * FROM social_photos",
    "SELECT * FROM social_photo_tags",
    "SELECT * FROM my_roles",
    "SELECT * FROM api_sessions",
    "SELECT * FROM band",
];

pub struct App {
    conn: DbConnection,
    es: Elastic,
    web: web::Web,
    blobs: BlobStore,
    tokens: TokenStore,
}

pub type AppState = State<Arc<App>>;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::load()?;
    let addr = std::env::var("BANDIT_API_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let prefix = std::env::var("ELASTIC_INDEX_PREFIX").unwrap_or_else(|_| "bandit".into());
    let es = Elastic::new(
        config
            .elasticsearch_url
            .as_deref()
            .context("set ELASTICSEARCH_URL")?,
        config
            .elasticsearch_api_key
            .as_deref()
            .context("set ELASTICSEARCH_API_KEY")?,
        &prefix,
    )?;
    let database = config
        .spacetimedb_database
        .clone()
        .context("set SPACETIMEDB_DATABASE")?;
    let tokens = config.token_store();
    let (conn, identity, token) =
        connect(&config.spacetimedb_url, &database, tokens.load(SERVICE)?)?;
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

    let root = config
        .env_file
        .as_ref()
        .and_then(|p| p.parent())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let web = web::Web {
        root,
        spacetimedb_url: config.spacetimedb_url.clone(),
        database: database.clone(),
        kibana_url: config.kibana_url.clone().unwrap_or_default(),
        demo: std::env::var("BANDIT_DEMO").is_ok_and(|v| v == "1"),
        http: reqwest::Client::new(),
    };
    let pages = web::routes(&web);
    let app = Router::new()
        .route("/health", get(health))
        .route("/summary/{token}", get(summary_page))
        .merge(pages)
        .layer(CorsLayer::permissive())
        .with_state(Arc::new(App { conn, es, web, blobs: config.blob_store(), tokens }));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("bandit-api listening on {addr}, ranking with {prefix}-*");
    axum::serve(listener, app).await?;
    Ok(())
}

/// The app registers this hash with `create_summary_link` and puts the token itself in the link.
fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Liveness, and the roles this service holds, so the owner can see that `grant_role` landed.
async fn health(State(app): AppState) -> Json<Value> {
    let roles: Vec<String> = app.conn.db.my_roles().iter().map(|r| r.role).collect();
    Json(json!({ "status": "ok", "roles": roles }))
}

/// The special link: the token in the URL is the secret, so the route needs no session.
async fn summary_page(
    State(app): AppState,
    Path(token): Path<String>,
) -> Result<Json<summary::Summary>, (StatusCode, Json<Value>)> {
    let not_found = || (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" })));
    let hash = token_hash(&token);
    let link = app
        .conn
        .db
        .summary_links()
        .iter()
        .find(|l| l.token_hash == hash)
        .ok_or_else(not_found)?;
    ranked_summary(&app, link.attendee).await.map(Json).ok_or_else(not_found)
}

/// The summary of `who` from the subscription cache, with the suggestions in Elastic's order.
/// When Elastic cannot rank, the suggestions keep their minutes order and say so.
pub async fn ranked_summary(app: &App, who: Identity) -> Option<summary::Summary> {
    let db = &app.conn.db;
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
    let mut recap = summary::summary(&rows, who)?;
    let people: Vec<u64> = recap.suggested_people.iter().map(|p| p.node_id).collect();
    let booths: Vec<u64> = recap.suggested_booths.iter().map(|b| b.booth_id).collect();
    let fallback = summary::visited_text(&rows, who);
    let attendee_id = who.to_hex().to_string();
    match app.es.rank(&attendee_id, &fallback, &people, &booths).await {
        Ok(ranking) => summary::apply_ranking(&mut recap, &ranking.people, &ranking.booths),
        Err(e) => eprintln!("suggestions left unranked: {e:#}"),
    }
    Some(recap)
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
