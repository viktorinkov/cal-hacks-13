//! Incident to claim (Hyphenate track). The attendee files a claim for an
//! injury on their band in their own words; broken or taken property and an
//! attendee's own things open their claim on resolve. The claim gets a hashed
//! evidence pack; the hospital report arrives as drawn by the seeded generator,
//! or Claude reads a filed record; Elastic validates the evidence and finds the
//! policy clauses that bear on it, Claude investigates and decides, and code
//! decides coverage, amounts and the route: settle under a learned rule, send
//! to the organizer, or refuse and show every check. Whoever broke or took
//! something can be charged for it (`charges`). Money moves on a double-entry
//! ledger.

pub mod charges;
pub mod documents;
pub mod evidence;
pub mod filing;
pub mod flow;
pub mod own_policy;
pub mod people;
pub mod plan_lookup;
pub mod setup;
pub mod tables;
pub mod views;

#[cfg(test)]
mod tests;

pub use flow::{on_incident_resolved, on_job_dead};
pub use charges::*;
pub use own_policy::*;
pub use documents::{FeeScheduleLine, PolicyDocument, PolicyTerm, fee_schedule_line, policy_document, policy_term};
pub use tables::*;

use spacetimedb::{ReducerContext, Table, Timestamp};

pub const CLAIM_ROLES: &[&str] = &["ops"];

pub fn micros(t: Timestamp) -> i64 {
    t.to_micros_since_unix_epoch()
}

pub fn timestamp(micros: i64) -> Timestamp {
    Timestamp::from_micros_since_unix_epoch(micros)
}

/// The settings row, created with the starting values on first use.
pub fn settings(ctx: &ReducerContext) -> InsuranceSettings {
    ctx.db.insurance_settings().id().find(0).unwrap_or_else(|| {
        let c = bandit_insurance::config::Config::default();
        ctx.db.insurance_settings().insert(InsuranceSettings {
            id: 0,
            venue_name: "Cal Hacks 13.0".into(),
            photo_window_secs: c.photo_window_secs,
            note_window_secs: c.note_window_secs,
            min_witnesses: c.min_witnesses,
            tz_offset_minutes: c.tz_offset_minutes,
            review_required: c.review_required,
            next_journal_id: 1,
        })
    })
}

pub fn config(s: &InsuranceSettings) -> bandit_insurance::config::Config {
    bandit_insurance::config::Config {
        photo_window_secs: s.photo_window_secs,
        note_window_secs: s.note_window_secs,
        min_witnesses: s.min_witnesses,
        tz_offset_minutes: s.tz_offset_minutes,
        review_required: s.review_required,
    }
}
