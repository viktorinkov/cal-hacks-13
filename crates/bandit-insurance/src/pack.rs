//! The evidence pack hash. An auditor recomputes it from the `evidence_fact`
//! rows of one pack version with nothing but this file.

use crate::Fact;
use sha2::{Digest, Sha256};

/// One fact as hashed: `seq|source|key|value|observed_at|reader|reference`.
/// A `\` in a field becomes `\\`, a `|` becomes `\|` and a newline becomes `\n`,
/// so a line is never ambiguous.
pub fn canonical_line(fact: &Fact) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        fact.seq,
        fact.source.as_str(),
        escape(&fact.key),
        escape(&fact.value),
        fact.observed_at,
        fact.reader.as_str(),
        escape(&fact.reference)
    )
}

/// Lowercase hex SHA-256 over the canonical lines of `facts` sorted by `seq`,
/// each line followed by `\n`. The same facts always hash the same, whatever
/// order they are passed in.
pub fn pack_sha256(facts: &[Fact]) -> String {
    // Ties on `seq` (never expected) fall back to the line itself, so input order never matters.
    let mut lines: Vec<(u32, String)> = facts.iter().map(|f| (f.seq, canonical_line(f))).collect();
    lines.sort();
    let mut hasher = Sha256::new();
    for (_, line) in &lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The first 8 hex characters, as shown on the approval screen.
pub fn short_sha(sha256: &str) -> &str {
    &sha256[..sha256.len().min(8)]
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '|' => out.push_str("\\|"),
            '\n' => out.push_str("\\n"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Reader, Source};

    fn fact(seq: u32, source: Source, key: &str, value: &str, reference: &str) -> Fact {
        Fact {
            seq,
            source,
            key: key.into(),
            value: value.into(),
            observed_at: 1_792_905_245_000_000 + seq as i64,
            reader: Reader::Code,
            reference: reference.into(),
        }
    }

    fn sample() -> Vec<Fact> {
        vec![
            fact(1, Source::IncidentSnapshot, "incident_kind", "fall", "incident:1"),
            fact(2, Source::IncidentSnapshot, "zone_id", "102", "incident:1"),
            fact(3, Source::StaffNote, "cost_cents", "18000", "incident_note:501"),
        ]
    }

    #[test]
    fn canonical_line_joins_fields() {
        let f = fact(3, Source::StaffNote, "cost_cents", "18000", "incident_note:501");
        assert_eq!(canonical_line(&f), "3|staff_note|cost_cents|18000|1792905245000003|code|incident_note:501");
    }

    /// Pinned; reproduce with `printf '<the three canonical lines, each ending \n>' | shasum -a 256`.
    #[test]
    fn golden_hash() {
        let sha = pack_sha256(&sample());
        assert_eq!(sha, "037dde3f2cefb56674009dfa158b46a50a47d8ac2aff1a4dc140215c83dde6ad");
        assert_eq!(sha.len(), 64);
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(short_sha(&sha), &sha[..8]);
    }

    #[test]
    fn order_independent() {
        let facts = sample();
        let mut reversed = facts.clone();
        reversed.reverse();
        let mut rotated = facts.clone();
        rotated.rotate_left(1);
        assert_eq!(pack_sha256(&facts), pack_sha256(&reversed));
        assert_eq!(pack_sha256(&facts), pack_sha256(&rotated));
    }

    #[test]
    fn every_field_changes_the_hash() {
        let base = pack_sha256(&sample());
        let edits: [fn(&mut Fact); 7] = [
            |f| f.seq = 9,
            |f| f.source = Source::LightCircle,
            |f| f.key.push('x'),
            |f| f.value.push('0'),
            |f| f.observed_at += 1,
            |f| f.reader = Reader::Model,
            |f| f.reference.push('2'),
        ];
        for edit in edits {
            let mut facts = sample();
            edit(&mut facts[1]);
            assert_ne!(pack_sha256(&facts), base);
        }
        assert_ne!(pack_sha256(&sample()[..2]), base);
    }

    #[test]
    fn escaping_prevents_ambiguity() {
        let f = fact(1, Source::StaffNote, "note", "a|b\\c\nd", "incident_note:1");
        assert_eq!(canonical_line(&f), "1|staff_note|note|a\\|b\\\\c\\nd|1792905245000001|code|incident_note:1");

        // A `|` moved between key and value would otherwise give the same line.
        let a = fact(1, Source::StaffNote, "a|b", "c", "r");
        let b = fact(1, Source::StaffNote, "a", "b|c", "r");
        assert_ne!(canonical_line(&a), canonical_line(&b));
        assert_ne!(pack_sha256(&[a]), pack_sha256(&[b]));

        // A newline inside a value must not look like the start of another fact.
        let joined = fact(1, Source::StaffNote, "note", "x\n2|staff_note|note|y", "r");
        let split = [fact(1, Source::StaffNote, "note", "x", "r"), fact(2, Source::StaffNote, "note", "y", "r")];
        assert!(!canonical_line(&joined).contains('\n'));
        assert_ne!(pack_sha256(&[joined]), pack_sha256(&split));

        // An escaped bar and a literal backslash before a bar stay distinct.
        let bar = fact(1, Source::StaffNote, "note", "a|b", "r");
        let slash_bar = fact(1, Source::StaffNote, "note", "a\\|b", "r");
        assert_ne!(canonical_line(&bar), canonical_line(&slash_bar));
    }

    #[test]
    fn short_sha_of_short_input() {
        assert_eq!(short_sha("abc"), "abc");
        assert_eq!(short_sha("0123456789"), "01234567");
    }
}
