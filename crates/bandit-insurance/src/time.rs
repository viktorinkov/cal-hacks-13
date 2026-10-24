//! Civil dates and clock times without a time-zone database: one fixed UTC
//! offset from `Config::tz_offset_minutes` is enough for a one-night venue.

use crate::Micros;

const MICROS_PER_SEC: i64 = 1_000_000;
const SECS_PER_DAY: i64 = 86_400;

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date for a day count from `days_from_civil`.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Parses `YYYY-MM-DD` into a day count. Rejects impossible dates.
pub fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    let mut parts = s.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let (y, m, d): (i64, u32, u32) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let days = days_from_civil(y, m, d);
    (civil_from_days(days) == (y, m, d)).then_some(days)
}

/// `b - a` in days, for two `YYYY-MM-DD` dates.
pub fn date_diff_days(a: &str, b: &str) -> Option<i64> {
    Some(parse_date(b)? - parse_date(a)?)
}

fn local_secs(t: Micros, tz_offset_minutes: i32) -> i64 {
    t.div_euclid(MICROS_PER_SEC) + tz_offset_minutes as i64 * 60
}

/// The local calendar date of a timestamp, `YYYY-MM-DD`.
pub fn local_date(t: Micros, tz_offset_minutes: i32) -> String {
    let (y, m, d) = civil_from_days(local_secs(t, tz_offset_minutes).div_euclid(SECS_PER_DAY));
    format!("{y:04}-{m:02}-{d:02}")
}

/// The local clock time of a timestamp, `HH:MM:SS`.
pub fn local_hms(t: Micros, tz_offset_minutes: i32) -> String {
    let s = local_secs(t, tz_offset_minutes).rem_euclid(SECS_PER_DAY);
    format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60)
}

/// The local date and time, `YYYY-MM-DD HH:MM:SS`.
pub fn local_datetime(t: Micros, tz_offset_minutes: i32) -> String {
    format!("{} {}", local_date(t, tz_offset_minutes), local_hms(t, tz_offset_minutes))
}

/// A timestamp for a local date and time, for tests and fixtures.
pub fn micros_at(year: i64, month: u32, day: u32, h: i64, min: i64, s: i64, tz_offset_minutes: i32) -> Micros {
    let local = days_from_civil(year, month, day) * SECS_PER_DAY + h * 3600 + min * 60 + s;
    (local - tz_offset_minutes as i64 * 60) * MICROS_PER_SEC
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDT: i32 = -420;

    #[test]
    fn round_trips_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(civil_from_days(days_from_civil(2026, 10, 24)), (2026, 10, 24));
        assert_eq!(parse_date("2026-02-30"), None);
        assert_eq!(date_diff_days("2026-10-24", "2026-10-25"), Some(1));
        assert_eq!(date_diff_days("2026-10-24", "2026-10-14"), Some(-10));
    }

    #[test]
    fn prints_local_time() {
        let t = micros_at(2026, 10, 24, 22, 14, 5, PDT);
        assert_eq!(local_hms(t, PDT), "22:14:05");
        assert_eq!(local_date(t, PDT), "2026-10-24");
        assert_eq!(local_hms(t, 0), "05:14:05");
        assert_eq!(local_date(t, 0), "2026-10-25");
    }
}
