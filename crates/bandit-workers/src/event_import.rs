//! Organizer-started event ingestion. The blocking importer runs on a server
//! thread while the job runner continues renewing the lease and serving other jobs.

use bandit_bindings as db;
use bandit_ingest::{bundle as source, config::Config};
use serde::Deserialize;
use spacetimedb_sdk::Timestamp;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::sink::Finish;

pub const KIND: &str = "event_import";

#[derive(Deserialize)]
pub struct Payload {
    pub import_id: u64,
    pub event_slug: String,
    pub run_id: String,
}

fn check_payload(payload: &Payload) -> Result<(), JobError> {
    if payload.event_slug != "calhacks-13"
        || payload.import_id == 0
        || payload.run_id != format!("{}-import-{}", payload.event_slug, payload.import_id)
    {
        return Err(JobError::msg("event import payload does not match a configured run"));
    }
    Ok(())
}

pub async fn run(ctx: &Ctx, job: &JobIn, payload: Payload) -> Result<(), JobError> {
    check_payload(&payload)?;
    let (root, sink, job_id, attempt) = (ctx.data_dir.clone(), ctx.sink.clone(), job.id, job.attempts);
    let runtime = tokio::runtime::Handle::current();
    let bundle = tokio::task::spawn_blocking(move || -> anyhow::Result<source::EventBundle> {
        let cfg = Config::for_worker(&payload.event_slug, payload.import_id, attempt, &root)?;
        bandit_ingest::prepare_bundle(&cfg, &payload.run_id, |name, detail| {
            runtime.block_on(sink.import_step(job_id, name.into(), detail.into()))
        })
    })
    .await
    .map_err(|e| JobError::msg(format!("event import task failed: {e}")))?
    .map_err(|error| {
        tracing::warn!(job_id = job.id, error = %format!("{error:#}"), "event import pipeline failed");
        JobError::msg("Could not finish importing the event data. Please try again.")
    })?;
    ctx.sink.import_step(job.id, "Saving".into(), "Applying the checked event data in one transaction".into()).await?;
    ctx.sink.finish(job.id, Finish::EventImport { bundle: event_bundle(bundle) }, vec![]).await?;
    Ok(())
}

fn timestamp(value: source::Ts) -> Timestamp {
    Timestamp::from_micros_since_unix_epoch(value.micros)
}

fn optional_timestamp(value: source::OptTs) -> Option<Timestamp> {
    match value {
        source::OptTs::Some(value) => Some(timestamp(value)),
        source::OptTs::None(_) => None,
    }
}

fn fact(value: source::Fact) -> db::Fact {
    db::Fact { label: value.label, value: value.value }
}

fn venue_in(value: source::VenueIn) -> db::VenueIn {
    db::VenueIn {
        source_key: value.source_key,
        name: value.name,
        venue_name: value.venue_name,
        address: value.address,
        latitude: value.latitude,
        longitude: value.longitude,
        website: value.website,
        timezone: value.timezone,
        starts_at: optional_timestamp(value.starts_at),
        ends_at: optional_timestamp(value.ends_at),
        description: value.description,
        facts: value.facts.into_iter().map(fact).collect(),
        source_url: value.source_url,
        fetched_at: timestamp(value.fetched_at),
    }
}

fn zone_in(value: source::ZoneIn) -> db::ZoneIn {
    db::ZoneIn {
        source_key: value.source_key,
        name: value.name,
        kind: value.kind,
        station_id: value.station_id,
        plan_x_m: value.plan_x_m,
        plan_y_m: value.plan_y_m,
        area_sq_m: value.area_sq_m,
        capacity: value.capacity,
        exit_colour: value.exit_colour,
        description: value.description,
    }
}

fn organization_in(value: source::OrganizationIn) -> db::OrganizationIn {
    db::OrganizationIn {
        source_key: value.source_key,
        name: value.name,
        kind: value.kind,
        sponsor_tier: value.sponsor_tier,
        website: value.website,
        domain: value.domain,
        logo_url: value.logo_url,
        description: value.description,
        category: value.category,
        tags: value.tags,
        industry: value.industry,
        headquarters: value.headquarters,
        size_range: value.size_range,
        founded_year: value.founded_year,
        linkedin_url: value.linkedin_url,
        prizes: value.prizes,
        crunchbase_url: value.crunchbase_url,
        funding_summary: value.funding_summary,
        source_url: value.source_url,
        fetched_at: timestamp(value.fetched_at),
    }
}

fn booth_in(value: source::BoothIn) -> db::BoothIn {
    db::BoothIn {
        source_key: value.source_key,
        zone_key: value.zone_key,
        organization_key: value.organization_key,
        booth_number: value.booth_number,
        name: value.name,
        kind: value.kind,
        description: value.description,
        tags: value.tags,
        plan_x_m: value.plan_x_m,
        plan_y_m: value.plan_y_m,
        placement: value.placement,
        source_url: value.source_url,
        fetched_at: timestamp(value.fetched_at),
    }
}

fn schedule_slot_in(value: source::ScheduleSlotIn) -> db::ScheduleSlotIn {
    db::ScheduleSlotIn {
        source_key: value.source_key,
        title: value.title,
        kind: value.kind,
        description: value.description,
        location_text: value.location_text,
        zone_key: value.zone_key,
        booth_key: value.booth_key,
        host_organization_key: value.host_organization_key,
        speaker_keys: value.speaker_keys,
        starts_at: timestamp(value.starts_at),
        ends_at: optional_timestamp(value.ends_at),
        source_url: value.source_url,
        fetched_at: timestamp(value.fetched_at),
    }
}

fn person_in(value: source::PersonIn) -> db::PersonIn {
    db::PersonIn {
        source_key: value.source_key,
        display_name: value.display_name,
        kind: value.kind,
        role: value.role,
        title: value.title,
        organization_key: value.organization_key,
        bio: value.bio,
        headshot_url: value.headshot_url,
        links: value.links,
        source_url: value.source_url,
        fetched_at: timestamp(value.fetched_at),
    }
}

fn event_bundle(value: source::EventBundle) -> db::EventBundle {
    db::EventBundle {
        run_id: value.run_id,
        organizer: value.organizer,
        bundle_hash: value.bundle_hash,
        venue: venue_in(value.venue),
        zones: value.zones.into_iter().map(zone_in).collect(),
        organizations: value.organizations.into_iter().map(organization_in).collect(),
        people: value.people.into_iter().map(person_in).collect(),
        booths: value.booths.into_iter().map(booth_in).collect(),
        schedule: value.schedule.into_iter().map(schedule_slot_in).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_and_payload_match_the_configured_run() {
        assert!(crate::jobs::handles(KIND));
        let mut payload = Payload { import_id: 7, event_slug: "calhacks-13".into(), run_id: "calhacks-13-import-7".into() };
        assert!(check_payload(&payload).is_ok());
        payload.run_id = "another-run".into();
        assert!(check_payload(&payload).is_err());
        payload.event_slug = "../calhacks-13".into();
        assert!(check_payload(&payload).is_err());
    }

    #[test]
    fn checked_bundle_retains_keys_links_counts_and_timestamps() {
        let input: source::EventBundle =
            serde_json::from_str(include_str!("../../bandit-ingest/events/calhacks-13/bundles/calhacks-13-20261024t0828z.json")).unwrap();
        let output = event_bundle(input.clone());
        assert_eq!(output.run_id, input.run_id);
        assert_eq!(output.bundle_hash, input.bundle_hash);
        assert_eq!(output.venue.source_key, "event:calhacks-13");
        assert_eq!(output.venue.fetched_at.to_micros_since_unix_epoch(), input.venue.fetched_at.micros);
        assert_eq!(output.organizations.len(), input.organizations.len());
        assert_eq!(output.people.len(), input.people.len());
        assert_eq!(output.booths.len(), input.booths.len());
        assert_eq!(output.schedule.len(), input.schedule.len());
        for (before, after) in input.booths.iter().zip(&output.booths) {
            assert_eq!(after.organization_key, before.organization_key);
            assert_eq!(after.zone_key, before.zone_key);
        }
        for (before, after) in input.schedule.iter().zip(&output.schedule) {
            assert_eq!(after.speaker_keys, before.speaker_keys);
            assert_eq!(after.starts_at.to_micros_since_unix_epoch(), before.starts_at.micros);
        }
        assert_eq!(optional_timestamp(source::OptTs::None([])), None);
    }
}
