use serde::{Deserialize, Serialize};

/// Starting values for verification, set by the venue and stored in the
/// module's `insurance_settings` row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// A camera frame must lie within this many seconds of the band's flag.
    pub photo_window_secs: i64,
    /// The first staff note must be written while the incident is open or
    /// within this many seconds of resolution.
    pub note_window_secs: i64,
    /// Light-circle witnesses that must share the subject band's zone.
    pub min_witnesses: u32,
    /// Offset from UTC used to print times and dates (Pacific daylight time).
    pub tz_offset_minutes: i32,
    /// Auto-settle only after the claims agent called the claim consistent.
    pub review_required: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            photo_window_secs: 120,
            note_window_secs: 30 * 60,
            min_witnesses: 2,
            tz_offset_minutes: -7 * 60,
            review_required: true,
        }
    }
}
