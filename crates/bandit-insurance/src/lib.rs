//! Pure claims logic for BandIt's incident-to-claim flow (Hyphenate track).
//!
//! Nothing here does I/O, reads a clock or draws randomness. The SpacetimeDB
//! module and the workers pass plain values in and get decisions back, so any
//! claim can be re-run by hand: the evidence pack hash, the corroboration
//! checks, the coverage arithmetic, the route and the ledger postings.
//!
//! The model reads documents and writes words; this crate decides money,
//! coverage and routing.

pub mod config;
pub mod corroboration;
pub mod coverage;
pub mod evidence;
pub mod fee_schedule;
pub mod ledger;
pub mod letters;
pub mod medical;
pub mod money;
pub mod outcome;
pub mod pack;
pub mod payloads;
pub mod review;
pub mod rules;
pub mod schemas;
pub mod time;
pub mod types;

pub use types::*;
