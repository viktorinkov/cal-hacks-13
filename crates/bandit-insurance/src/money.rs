use crate::Cents;

/// `18000` -> `$180.00`, `240000` -> `$2,400.00`.
pub fn format_cents(cents: Cents) -> String {
    let dollars = cents / 100;
    let rest = cents % 100;
    let digits = dollars.to_string();
    let mut grouped = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("${grouped}.{rest:02}")
}

/// Parses `180`, `180.5`, `180.00`, `2,400.00` (no `$`) into cents.
pub fn parse_dollars(s: &str) -> Option<Cents> {
    let s = s.trim().replace(',', "");
    if s.is_empty() {
        return None;
    }
    let (whole, frac) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s.as_str(), ""),
    };
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) || frac.len() > 2 || !frac.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let whole: Cents = whole.parse().ok()?;
    let frac: Cents = match frac.len() {
        0 => 0,
        1 => frac.parse::<Cents>().ok()? * 10,
        _ => frac.parse().ok()?,
    };
    whole.checked_mul(100)?.checked_add(frac)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_with_grouping() {
        assert_eq!(format_cents(0), "$0.00");
        assert_eq!(format_cents(5), "$0.05");
        assert_eq!(format_cents(18000), "$180.00");
        assert_eq!(format_cents(240000), "$2,400.00");
        assert_eq!(format_cents(123456789), "$1,234,567.89");
    }

    #[test]
    fn parses_dollar_text() {
        assert_eq!(parse_dollars("180"), Some(18000));
        assert_eq!(parse_dollars("180.5"), Some(18050));
        assert_eq!(parse_dollars("2,400.00"), Some(240000));
        assert_eq!(parse_dollars("1.234"), None);
        assert_eq!(parse_dollars("abc"), None);
    }
}
