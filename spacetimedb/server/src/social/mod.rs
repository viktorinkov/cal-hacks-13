//! Social: the memories an attendee takes home from the event.
//!
//! - Onboarding: tap the band, press it to claim it, name yourself, claim your pre-populated profile, type your socials.
//! - Visits: stays in a zone, from band1t's `zone_visit`.
//! - Encounters: people you hung out with, from band1t's radio `encounter`; you see their name and socials.
//! - Shared visits: two people in the same zone at the same time.
//! - The people graph: `people_link` rows between people, booths and companies, read through `my_graph` and `event_graph`.
//! - Photos: the findable people whose bands were in a photo's zone are suggested as tags.
//! - A simulated crowd of fake attendees, so the graph looks like an event.
//!
//! Location and encounter detection is read only in `tick.rs`, so it can be swapped when the bands or cameras change.

pub mod crowd;
pub mod graph;
pub mod logic;
pub mod onboarding;
pub mod photos;
pub mod tables;
pub mod tick;
pub mod views;

