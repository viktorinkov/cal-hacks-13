//! bandit-api: the HTTP edge. It holds the Elastic key, so browsers never talk to Elastic, and it reads
//! social rows from SpacetimeDB by subscription (it needs the `api` role).
//! `ranked_summary` builds an attendee's recap with suggestions ranked by Elastic; the attendee pages
//! reached from the band's tap link call it.

mod search;
mod summary;

use anyhow::{Context, Result};
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use bandit_bindings::{
    BoothTableAccess, DbConnection, MyRolesTableAccess, SocialAttendeesTableAccess,
    SocialEncountersTableAccess, SocialHandlesTableAccess, SocialPhotoTagsTableAccess,
    SocialPhotosTableAccess, SocialSharedVisitsTableAccess, SocialVisitsTableAccess,
    ZoneTableAccess, connect,
};
use bandit_common::Config;
use search::Elastic;
use serde_json::{Value, json};
use spacetimedb_sdk::{DbContext, Identity, Table};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

const SERVICE: &str = "bandit-api";
const QUERIES: [&str; 10] = [
    "SELECT * FROM zone",
    "SELECT * FROM booth",
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
}

type AppState = State<Arc<App>>;

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

    let app = Router::new()
        .route("/health", get(health))
        .layer(CorsLayer::permissive())
        .with_state(Arc::new(App { conn, es }));
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("bandit-api listening on {addr}, ranking with {prefix}-*");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Liveness, and the roles this service holds, so the owner can see that `grant_role` landed.
async fn health(State(app): AppState) -> Json<Value> {
    let roles: Vec<String> = app.conn.db.my_roles().iter().map(|r| r.role).collect();
    Json(json!({ "status": "ok", "roles": roles }))
}

/// The recap of `who` from the subscription cache, with the suggestions in Elastic's order.
/// When Elastic cannot rank, the suggestions keep their minutes order and say so.
#[allow(dead_code)]
async fn ranked_summary(app: &App, who: Identity) -> Option<summary::Summary> {
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
