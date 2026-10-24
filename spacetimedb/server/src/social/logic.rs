//! Plain rules of the social layer, kept free of database calls so they are easy to read and test.

use spacetimedb::{Identity, TimeDuration, Timestamp};

/// How often the social tick runs.
pub const TICK_MILLIS: u64 = 1_000;
/// A stay in one zone becomes a visit after this long (starting value, calibrate).
pub const VISIT_MIN_SECONDS: i64 = 120;
/// Two bands heard up close for this long make an encounter (starting value, calibrate).
pub const ENCOUNTER_MIN_SECONDS: u32 = 180;
/// Two visits to the same zone overlapping this long make a shared visit (starting value, calibrate).
pub const SHARED_VISIT_MIN_SECONDS: i64 = 300;
/// Rows are rewritten at most this often while a stay or encounter is still growing.
pub const REFRESH_SECONDS: i64 = 30;
/// The press must land this soon after the NFC tap to claim the band.
pub const CLAIM_WINDOW_SECONDS: i64 = 8;
pub const API_SESSION_HOURS: i64 = 12;

/// Firmware band states and how long to hold them, in tenths of a second.
pub const STATE_IDLE: u8 = 0;
pub const STATE_IDENT: u8 = 8;
pub const IDENT_TENTHS: u8 = 80;


/// At most this many people are tagged in one photo (starting value, calibrate).
pub const PHOTO_TAG_CAP: usize = 8;

pub const LINK_MET: &str = "met";
pub const LINK_VISITED: &str = "visited";
pub const LINK_WORKS_AT: &str = "works_at";
pub const LINK_EXHIBITS: &str = "exhibits";

pub const PLATFORMS: &[&str] = &["instagram", "facebook", "threads"];

/// The NFC sticker opens `https://<host>/t/BANDIT-0n`; the app passes the last path part.
pub fn band_from_token(token: &str) -> Result<u8, String> {
    let digits = token
        .trim()
        .strip_prefix("BANDIT-")
        .ok_or_else(|| format!("{token:?} is not a BandIt band token"))?;
    match digits.parse::<u8>() {
        Ok(id) if (1..=crate::tables::BAND_ID_MAX).contains(&id) => Ok(id),
        _ => Err(format!("{token:?} is not a BandIt band token")),
    }
}

pub fn clean_handle(platform: &str, handle: &str) -> Result<(String, String), String> {
    let platform = platform.trim().to_ascii_lowercase();
    if !PLATFORMS.contains(&platform.as_str()) {
        return Err(format!("platform must be one of {}", PLATFORMS.join(", ")));
    }
    let handle = handle.trim();
    if handle.is_empty() || handle.len() > 200 {
        return Err("handle must be 1 to 200 characters".into());
    }
    Ok((platform, handle.to_string()))
}

pub fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("display name must be 1 to 60 characters".into());
    }
    Ok(name.to_string())
}

/// SHA-256 hex digests are 64 lowercase hex characters.
pub fn check_token_hash(hash: &str) -> Result<(), String> {
    if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)) {
        Ok(())
    } else {
        Err("token_hash must be a lowercase SHA-256 hex digest".into())
    }
}

/// Both orderings of a pair map to one key, lower first.
pub fn ordered<T: Ord + Copy>(a: T, b: T) -> (T, T) {
    if a <= b { (a, b) } else { (b, a) }
}

pub fn micros(t: Timestamp) -> i64 {
    t.to_micros_since_unix_epoch()
}

pub fn seconds(n: i64) -> TimeDuration {
    TimeDuration::from_micros(n * 1_000_000)
}

pub fn minutes_between(from: Timestamp, to: Timestamp) -> f32 {
    ((micros(to) - micros(from)).max(0) as f64 / 60_000_000.0) as f32
}

/// A visit counts from when the band was in the zone and already owned.
pub fn visit_window(entered: Timestamp, left: Option<Timestamp>, claimed_at: Timestamp, now: Timestamp) -> (Timestamp, Timestamp) {
    let start = if micros(entered) > micros(claimed_at) { entered } else { claimed_at };
    (start, left.unwrap_or(now))
}

/// Seconds two stays overlap, and when the overlap began.
pub fn overlap(a: (Timestamp, Timestamp), b: (Timestamp, Timestamp)) -> (i64, Timestamp) {
    let start = if micros(a.0) > micros(b.0) { a.0 } else { b.0 };
    let end = micros(a.1).min(micros(b.1));
    (((end - micros(start)) / 1_000_000).max(0), start)
}

/// The other attendee of a pair, when `who` is one of the two.
pub fn other_of(a: Identity, b: Identity, who: Identity) -> Option<Identity> {
    if who == a {
        Some(b)
    } else if who == b {
        Some(a)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: i64) -> Timestamp {
        Timestamp::from_micros_since_unix_epoch(s * 1_000_000)
    }

    #[test]
    fn reads_band_tokens() {
        assert_eq!(band_from_token("BANDIT-03"), Ok(3));
        assert_eq!(band_from_token(" BANDIT-9 "), Ok(9));
        assert!(band_from_token("BANDIT-00").is_err());
        assert!(band_from_token("bandit-03").is_err());
        assert!(band_from_token("BAND-03").is_err());
    }

    #[test]
    fn cleans_handles() {
        assert_eq!(clean_handle(" Instagram ", "@ada "), Ok(("instagram".into(), "@ada".into())));
        assert!(clean_handle("myspace", "ada").is_err());
        assert!(clean_handle("x", "  ").is_err());
    }

    #[test]
    fn visit_starts_at_claim() {
        let (start, end) = visit_window(at(100), None, at(160), at(400));
        assert_eq!((start, end), (at(160), at(400)));
        let (start, end) = visit_window(at(200), Some(at(500)), at(160), at(900));
        assert_eq!((start, end), (at(200), at(500)));
    }

    #[test]
    fn overlaps() {
        assert_eq!(overlap((at(0), at(600)), (at(300), at(1200))), (300, at(300)));
        assert_eq!(overlap((at(0), at(100)), (at(200), at(300))).0, 0);
    }

    #[test]
    fn token_hash_shape() {
        assert!(check_token_hash(&"a".repeat(64)).is_ok());
        assert!(check_token_hash(&"A".repeat(64)).is_err());
        assert!(check_token_hash("abc").is_err());
    }
}
