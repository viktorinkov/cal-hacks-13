use super::tables::*;
use crate::roles::require_role;
use spacetimedb::{ReducerContext, Table};
use std::collections::HashMap;

macro_rules! upsert {
    ($ctx:expr, $table:ident, $row:expr, $count:expr) => {{
        let mut row = $row;
        match $ctx.db.$table().source_key().find(&row.source_key) {
            Some(old) => {
                row.id = old.id;
                row.updated_at = old.updated_at;
                if row == old {
                    old
                } else {
                    row.updated_at = $ctx.timestamp;
                    $count.updated += 1;
                    $ctx.db.$table().id().update(row)
                }
            }
            None => {
                row.updated_at = $ctx.timestamp;
                $count.inserted += 1;
                $ctx.db.$table().insert(row)
            }
        }
    }};
}

fn section(name: &str) -> SectionCount {
    SectionCount { section: name.into(), inserted: 0, updated: 0 }
}

fn resolve(ids: &HashMap<String, u64>, key: &str, what: &str, from: &str) -> Result<u64, String> {
    if key.is_empty() {
        return Ok(0);
    }
    ids.get(key).copied().ok_or_else(|| format!("{from} points at unknown {what} {key}"))
}

fn named(source_key: &str, name: &str, what: &str) -> Result<(), String> {
    if source_key.is_empty() || name.trim().is_empty() {
        return Err(format!("{what} {source_key:?} needs a source_key and a name"));
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn import_event(ctx: &ReducerContext, bundle: EventBundle) -> Result<(), String> {
    require_role(ctx, &["ingest", "ops"])?;
    let v = bundle.venue;
    named(&v.source_key, &v.name, "venue")?;

    let mut venue_count = section("venue");
    let venue_id = upsert!(
        ctx,
        venue,
        Venue {
            id: 0,
            source_key: v.source_key,
            name: v.name,
            venue_name: v.venue_name,
            address: v.address,
            latitude: v.latitude,
            longitude: v.longitude,
            website: v.website,
            timezone: v.timezone,
            starts_at: v.starts_at,
            ends_at: v.ends_at,
            description: v.description,
            facts: v.facts,
            source_url: v.source_url,
            fetched_at: v.fetched_at,
            updated_at: ctx.timestamp,
        },
        venue_count
    )
    .id;

    let mut zone_count = section("zones");
    let mut zones = HashMap::new();
    let mut stations: HashMap<u8, String> = HashMap::new();
    for z in bundle.zones {
        named(&z.source_key, &z.name, "zone")?;
        if z.station_id != 0 {
            if let Some(other) = stations.insert(z.station_id, z.name.clone()) {
                return Err(format!("station {} anchors both {other} and {}", z.station_id, z.name));
            }
        }
        let key = z.source_key.clone();
        let saved = upsert!(
            ctx,
            zone,
            Zone {
                id: 0,
                source_key: z.source_key,
                venue_id,
                name: z.name,
                kind: z.kind,
                station_id: z.station_id,
                plan_x_m: z.plan_x_m,
                plan_y_m: z.plan_y_m,
                area_sq_m: z.area_sq_m,
                capacity: z.capacity,
                exit_colour: z.exit_colour,
                description: z.description,
                updated_at: ctx.timestamp,
            },
            zone_count
        );
        zones.insert(key, saved.id);
    }

    let mut org_count = section("organizations");
    let mut orgs = HashMap::new();
    for o in bundle.organizations {
        named(&o.source_key, &o.name, "organization")?;
        let key = o.source_key.clone();
        let saved = upsert!(
            ctx,
            organization,
            Organization {
                id: 0,
                source_key: o.source_key,
                venue_id,
                name: o.name,
                kind: o.kind,
                sponsor_tier: o.sponsor_tier,
                website: o.website,
                domain: o.domain,
                logo_url: o.logo_url,
                description: o.description,
                category: o.category,
                tags: o.tags,
                industry: o.industry,
                headquarters: o.headquarters,
                size_range: o.size_range,
                founded_year: o.founded_year,
                linkedin_url: o.linkedin_url,
                prizes: o.prizes,
                source_url: o.source_url,
                fetched_at: o.fetched_at,
                updated_at: ctx.timestamp,
            },
            org_count
        );
        orgs.insert(key, saved.id);
    }

    let mut person_count = section("people");
    let mut people = HashMap::new();
    for p in bundle.people {
        named(&p.source_key, &p.display_name, "person")?;
        let organization_id = resolve(&orgs, &p.organization_key, "organization", &p.source_key)?;
        let key = p.source_key.clone();
        let saved = upsert!(
            ctx,
            person,
            Person {
                id: 0,
                source_key: p.source_key,
                venue_id,
                display_name: p.display_name,
                kind: p.kind,
                role: p.role,
                title: p.title,
                organization_id,
                bio: p.bio,
                headshot_url: p.headshot_url,
                links: p.links,
                source_url: p.source_url,
                fetched_at: p.fetched_at,
                updated_at: ctx.timestamp,
            },
            person_count
        );
        people.insert(key, saved.id);
    }

    let mut booth_count = section("booths");
    let mut booths = HashMap::new();
    for b in bundle.booths {
        named(&b.source_key, &b.name, "booth")?;
        let mut row = Booth {
            id: 0,
            zone_id: resolve(&zones, &b.zone_key, "zone", &b.source_key)?,
            organization_id: resolve(&orgs, &b.organization_key, "organization", &b.source_key)?,
            source_key: b.source_key,
            venue_id,
            booth_number: b.booth_number,
            name: b.name,
            kind: b.kind,
            description: b.description,
            tags: b.tags,
            plan_x_m: b.plan_x_m,
            plan_y_m: b.plan_y_m,
            placement: b.placement,
            source_url: b.source_url,
            fetched_at: b.fetched_at,
            updated_at: ctx.timestamp,
        };
        if let Some(old) = ctx.db.booth().source_key().find(&row.source_key) {
            if old.placement == "manual" {
                row.zone_id = old.zone_id;
                row.plan_x_m = old.plan_x_m;
                row.plan_y_m = old.plan_y_m;
                row.placement = old.placement;
            }
        }
        let key = row.source_key.clone();
        let saved = upsert!(ctx, booth, row, booth_count);
        booths.insert(key, saved.id);
    }

    let mut slot_count = section("schedule");
    for s in bundle.schedule {
        named(&s.source_key, &s.title, "schedule slot")?;
        let speaker_person_ids = s
            .speaker_keys
            .iter()
            .map(|k| resolve(&people, k, "person", &s.source_key))
            .collect::<Result<Vec<_>, _>>()?;
        upsert!(
            ctx,
            schedule_slot,
            ScheduleSlot {
                id: 0,
                zone_id: resolve(&zones, &s.zone_key, "zone", &s.source_key)?,
                booth_id: resolve(&booths, &s.booth_key, "booth", &s.source_key)?,
                host_organization_id: resolve(&orgs, &s.host_organization_key, "organization", &s.source_key)?,
                speaker_person_ids,
                source_key: s.source_key,
                venue_id,
                title: s.title,
                kind: s.kind,
                description: s.description,
                location_text: s.location_text,
                starts_at: s.starts_at,
                ends_at: s.ends_at,
                source_url: s.source_url,
                fetched_at: s.fetched_at,
                updated_at: ctx.timestamp,
            },
            slot_count
        );
    }

    ctx.db.import_run().insert(ImportRun {
        id: 0,
        run_id: bundle.run_id,
        venue_id,
        organizer: bundle.organizer,
        bundle_hash: bundle.bundle_hash,
        imported_by: ctx.sender(),
        imported_at: ctx.timestamp,
        counts: vec![venue_count, zone_count, org_count, person_count, booth_count, slot_count],
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn place_booth(ctx: &ReducerContext, booth_id: u64, zone_id: u64, plan_x_m: f32, plan_y_m: f32) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let booth = ctx.db.booth().id().find(booth_id).ok_or("no such booth")?;
    if zone_id != 0 && ctx.db.zone().id().find(zone_id).is_none() {
        return Err("no such zone".into());
    }
    ctx.db.booth().id().update(Booth {
        zone_id,
        plan_x_m,
        plan_y_m,
        placement: "manual".into(),
        updated_at: ctx.timestamp,
        ..booth
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_zone_station(ctx: &ReducerContext, zone_id: u64, station_id: u8) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    let zone = ctx.db.zone().id().find(zone_id).ok_or("no such zone")?;
    if station_id != 0 {
        if let Some(other) = ctx.db.zone().station_id().filter(station_id).find(|z| z.id != zone_id) {
            return Err(format!("station {station_id} already anchors {}", other.name));
        }
    }
    ctx.db.zone().id().update(Zone { station_id, updated_at: ctx.timestamp, ..zone });
    Ok(())
}
