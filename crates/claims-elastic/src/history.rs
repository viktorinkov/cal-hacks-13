//! Synthetic, de-identified claims from two previous events at the same venue
//! (October 2024 and October 2025), seeded as precedents. Deterministic: the
//! same 30 documents every time.

use crate::{ClaimDoc, NarrativeParts, narrative_for};

const VENUE: &str = "Palace of Fine Arts";

/// History claim ids sit in the 800000s: live ids are far lower, test ids start at 900000.
const FIRST_CLAIM_ID: i64 = 800_001;

const ZONES: [(i64, &str); 7] = [
    (101, "Main stage left"),
    (102, "Stage B"),
    (103, "Main stage right"),
    (104, "Food court"),
    (105, "East entrance"),
    (106, "Rotunda lawn"),
    (107, "Lagoon path"),
];

struct Past {
    kind: &'static str,
    zone: i64,
    /// Local time (Pacific daylight time): year, month, day, hour, minute.
    at: (i64, i64, i64, i64, i64),
    setting: Option<&'static str>,
    witnesses: u32,
    note_min: Option<u32>,
    dx: &'static [(&'static str, &'static str)],
    svc: &'static [&'static str],
    property: Option<&'static str>,
    cost: &'static str,
    finding: Option<&'static str>,
    /// Billed, covered, payout.
    cents: (i64, i64, i64),
    outcome: &'static str,
    corroboration: &'static str,
}

const FALL: Past = Past {
    kind: "fall",
    zone: 101,
    at: (2024, 10, 18, 20, 0),
    setting: None,
    witnesses: 2,
    note_min: Some(10),
    dx: &[],
    svc: &[],
    property: None,
    cost: "first aid only",
    finding: None,
    cents: (0, 0, 0),
    outcome: "auto_settled",
    corroboration: "corroborated",
};
const SOS: Past = Past { kind: "sos", cost: "treated on site, no transport", ..FALL };
const PROPERTY: Past = Past { kind: "property", witnesses: 0, cost: "repair estimate attached", ..FALL };
const HEADLINE: Option<&str> = Some("during a headline set");

const PAST: [Past; 30] = [
    // October 2024, night one.
    Past { zone: 105, at: (2024, 10, 18, 20, 5), setting: Some("while doors opened"), note_min: Some(15),
        dx: &[("S80.01XA", "right knee contusion"), ("S80.811A", "right lower leg abrasion")], svc: &["A6402"],
        cents: (4200, 4200, 4200), ..FALL },
    Past { zone: 101, at: (2024, 10, 18, 21, 20), dx: &[("S93.401D", "right ankle sprain, subsequent encounter")],
        svc: &["S9083", "L4361"], cost: "urgent care visit with walking boot",
        finding: Some("record shows the ankle injury was first treated before the event"),
        cents: (96000, 82000, 0), outcome: "refused", ..FALL },
    Past { zone: 104, at: (2024, 10, 18, 21, 40), witnesses: 1, note_min: Some(5),
        dx: &[("T67.5XXA", "heat exhaustion"), ("E86.0", "dehydration")], svc: &["A0998"],
        cents: (18000, 18000, 18000), outcome: "approved", corroboration: "uncorroborated", ..SOS },
    Past { zone: 101, at: (2024, 10, 18, 22, 10), setting: HEADLINE, witnesses: 3, note_min: Some(12),
        dx: &[("S63.501A", "right wrist sprain")], svc: &["A6449", "L3908"], cents: (9800, 9800, 9800), ..FALL },
    Past { zone: 103, at: (2024, 10, 18, 22, 45), setting: HEADLINE, witnesses: 5, note_min: Some(4),
        dx: &[("R55", "fainting"), ("E86.0", "dehydration")], svc: &["A0998"], cents: (18000, 18000, 18000), ..SOS },
    Past { zone: 102, at: (2024, 10, 18, 23, 25), note_min: Some(8), dx: &[("S93.401A", "right ankle sprain")],
        svc: &["A6449"], cents: (6500, 6500, 6500), ..FALL },
    Past { zone: 103, at: (2024, 10, 18, 23, 55), note_min: Some(6),
        property: Some("crowd barrier section bent during a crowd surge"), cost: "replacement invoice attached",
        cents: (68000, 68000, 68000), outcome: "approved", ..PROPERTY },
    // October 2024, night two.
    Past { zone: 106, at: (2024, 10, 19, 19, 30), note_min: Some(20), dx: &[("S60.221A", "right hand contusion")],
        svc: &["A6449"], cents: (4000, 4000, 4000), ..FALL },
    Past { zone: 104, at: (2024, 10, 19, 21, 5), note_min: Some(3),
        property: Some("LED menu screen cracked by a thrown bottle"), cents: (45000, 45000, 45000), ..PROPERTY },
    Past { zone: 104, at: (2024, 10, 19, 21, 15), witnesses: 3, note_min: Some(6),
        dx: &[("T63.441A", "bee sting")], svc: &["A0998"], cents: (9000, 9000, 9000), ..SOS },
    Past { zone: 103, at: (2024, 10, 19, 22, 40), setting: HEADLINE, witnesses: 0, note_min: Some(41),
        dx: &[("S93.401A", "right ankle sprain")], svc: &["S9083", "73610"], cost: "urgent care visit with x-ray",
        finding: Some("2 light-circle witnesses heard the beacon from zone Food court, not the incident zone"),
        cents: (84000, 72000, 0), outcome: "refused", corroboration: "disputed", ..FALL },
    Past { zone: 102, at: (2024, 10, 19, 23, 50), setting: Some("after the last set"), witnesses: 1, note_min: Some(22),
        dx: &[("S93.401A", "right ankle sprain")], svc: &["A6449", "L1906"], cost: "first aid only; ankle brace issued",
        cents: (13500, 13500, 13500), outcome: "approved", corroboration: "uncorroborated", ..FALL },
    Past { zone: 105, at: (2024, 10, 20, 0, 20), setting: Some("while the crowd left at closing"), note_min: Some(26),
        dx: &[("S80.01XA", "right knee contusion")], svc: &["A6402"], cents: (4500, 4500, 4500), outcome: "approved",
        ..FALL },
    // October 2025, night one.
    Past { zone: 106, at: (2025, 10, 17, 19, 10), note_min: Some(4),
        property: Some("cable ramp crushed by a supply cart during setup"), cost: "replacement invoice attached",
        cents: (32000, 32000, 32000), ..PROPERTY },
    Past { zone: 106, at: (2025, 10, 17, 20, 15), witnesses: 1, note_min: Some(18),
        dx: &[("S60.222A", "left hand contusion")], svc: &["A6449"], cents: (4000, 4000, 4000), outcome: "approved",
        corroboration: "uncorroborated", ..FALL },
    Past { zone: 107, at: (2025, 10, 17, 20, 40), note_min: Some(11), dx: &[("S93.402A", "left ankle sprain")],
        svc: &["A6449", "L1906"], cost: "first aid only; ankle brace issued", cents: (14000, 14000, 14000), ..FALL },
    Past { zone: 105, at: (2025, 10, 17, 21, 0), witnesses: 1, note_min: Some(15),
        dx: &[("M54.50", "low back pain")], svc: &["S9083", "72100"], cost: "urgent care visit with x-ray",
        finding: Some("record shows the back pain was treated before the event"),
        cents: (61000, 52000, 0), outcome: "refused", corroboration: "uncorroborated", ..SOS },
    Past { zone: 101, at: (2025, 10, 17, 21, 55), setting: HEADLINE, note_min: Some(3),
        dx: &[("J45.901", "asthma attack")], svc: &["A0998", "94640", "J7613"],
        cost: "treated on site with a nebulizer, no transport", cents: (22000, 22000, 22000), outcome: "approved", ..SOS },
    Past { zone: 101, at: (2025, 10, 17, 22, 30), setting: HEADLINE, witnesses: 4, note_min: Some(9),
        dx: &[("S63.502A", "left wrist sprain")], svc: &["A6449"], cents: (5500, 5500, 5500), ..FALL },
    Past { zone: 101, at: (2025, 10, 17, 22, 55), setting: HEADLINE, witnesses: 3, note_min: Some(10),
        dx: &[("S52.501A", "right wrist fracture")], svc: &["S9083", "73110", "29125"],
        cost: "urgent care visit with x-ray and splint", cents: (142000, 128000, 128000), outcome: "approved", ..FALL },
    Past { zone: 102, at: (2025, 10, 17, 23, 5), witnesses: 3, note_min: Some(5),
        dx: &[("E86.0", "dehydration"), ("R42", "dizziness")], svc: &["A0998"], cents: (18000, 18000, 18000), ..SOS },
    Past { zone: 102, at: (2025, 10, 17, 23, 45), setting: Some("after the last set"), note_min: Some(12),
        dx: &[("S01.81XA", "scalp laceration")], svc: &["S9083", "12001"], cost: "urgent care visit for wound repair",
        cents: (86000, 74000, 74000), outcome: "approved", ..FALL },
    // October 2025, night two.
    Past { zone: 104, at: (2025, 10, 18, 19, 50), note_min: Some(14), dx: &[("S61.411A", "right hand laceration")],
        svc: &["A6402", "A4450"], cost: "first aid only; wound dressed", cents: (4800, 4800, 4800), ..FALL },
    Past { zone: 104, at: (2025, 10, 18, 20, 35), witnesses: 4, note_min: Some(4),
        dx: &[("R55", "fainting"), ("E86.0", "dehydration")], svc: &["S9083", "96360", "J7030"],
        cost: "urgent care visit with IV fluids", cents: (98000, 88000, 88000), outcome: "approved", ..SOS },
    Past { zone: 102, at: (2025, 10, 18, 21, 30), witnesses: 3, note_min: Some(6),
        dx: &[("T78.40XA", "allergic reaction")], svc: &["A0998", "J0171"],
        cost: "treated on site with epinephrine, no transport", cents: (28500, 28500, 28500), outcome: "approved", ..SOS },
    Past { zone: 102, at: (2025, 10, 18, 22, 5), witnesses: 0, note_min: Some(35),
        dx: &[("S63.501A", "right wrist sprain")], svc: &["A6449", "L3908"],
        finding: Some("3 light-circle witnesses were in zone Lagoon path at the reported time"),
        cents: (9800, 9800, 0), outcome: "refused", corroboration: "disputed", ..FALL },
    Past { zone: 103, at: (2025, 10, 18, 22, 20), setting: HEADLINE, witnesses: 3, note_min: Some(7),
        dx: &[("S00.83XA", "head contusion")], svc: &["A0998"], cents: (12000, 12000, 12000), ..FALL },
    Past { zone: 105, at: (2025, 10, 18, 23, 15), setting: Some("on the exit stairs"), witnesses: 3, note_min: Some(9),
        dx: &[("S93.401A", "right ankle sprain"), ("W10.9XXA", "fall on stairs")], svc: &["S9083", "73610", "L4361"],
        cost: "urgent care visit with x-ray and walking boot", cents: (112000, 96000, 96000), outcome: "approved", ..FALL },
    Past { zone: 107, at: (2025, 10, 18, 23, 30), note_min: Some(16),
        dx: &[("S93.402A", "left ankle sprain"), ("S80.812A", "left lower leg abrasion")], svc: &["A6449", "A6402"],
        cents: (7500, 7500, 7500), outcome: "approved", ..FALL },
    Past { zone: 102, at: (2025, 10, 18, 23, 40), note_min: Some(2),
        property: Some("speaker knocked off its stand during load-out"), cents: (240000, 240000, 240000),
        outcome: "approved", ..PROPERTY },
];

/// The seeded past claims (`source: history`, ids `history-01` to `history-30`).
pub fn history_claims() -> Vec<ClaimDoc> {
    PAST.iter()
        .enumerate()
        .map(|(i, p)| {
            let (y, mo, d, h, mi) = p.at;
            let zone_name = ZONES.iter().find(|z| z.0 == p.zone).map_or("", |z| z.1);
            let narrative = narrative_for(&NarrativeParts {
                incident_kind: p.kind,
                zone_name,
                local_time: &format!("{h:02}:{mi:02}"),
                setting: p.setting,
                witnesses_in_zone: p.witnesses,
                minutes_to_staff_note: p.note_min,
                diagnoses: p.dx,
                property: p.property,
                cost: Some(p.cost),
                finding: p.finding,
            });
            ClaimDoc {
                doc_id: format!("history-{:02}", i + 1),
                claim_id: FIRST_CLAIM_ID + i as i64,
                pack_version: 1,
                source: "history".into(),
                venue: VENUE.into(),
                incident_kind: p.kind.into(),
                cover_kind: if p.kind == "property" { "property" } else { "medical_payments" }.into(),
                zone_id: p.zone,
                zone_name: zone_name.into(),
                incident_at: pdt_millis(y, mo, d, h, mi),
                corroboration: p.corroboration.into(),
                witness_count: p.witnesses as i32,
                diagnosis_codes: p.dx.iter().map(|(code, _)| code.to_string()).collect(),
                service_codes: p.svc.iter().map(|c| c.to_string()).collect(),
                // The past records themselves are not part of the seed.
                record_sha256: String::new(),
                billed_cents: p.cents.0,
                covered_cents: p.cents.1,
                payout_cents: p.cents.2,
                outcome: p.outcome.into(),
                narrative,
            }
        })
        .collect()
}

/// Epoch milliseconds of a Pacific daylight time (UTC-7) wall-clock time.
fn pdt_millis(y: i64, m: i64, d: i64, hh: i64, mm: i64) -> i64 {
    // Days from 1970-01-01 to the civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    ((days * 24 + hh + 7) * 60 + mm) * 60_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdt_to_epoch() {
        // 2024-10-18 22:10 PDT is 2024-10-19 05:10 UTC.
        assert_eq!(pdt_millis(2024, 10, 18, 22, 10), 1_729_314_600_000);
    }

    #[test]
    fn history_is_consistent() {
        let docs = history_claims();
        assert_eq!(docs.len(), 30);
        assert_eq!(docs[0].doc_id, "history-01");
        assert_eq!(docs[29].doc_id, "history-30");
        let count = |o: &str| docs.iter().filter(|d| d.outcome == o).count();
        assert_eq!((count("auto_settled"), count("approved"), count("refused")), (13, 13, 4));
        for d in &docs {
            assert!(d.payout_cents <= d.covered_cents && d.covered_cents <= d.billed_cents, "{}", d.doc_id);
            assert_eq!(d.outcome == "refused", d.payout_cents == 0, "{}", d.doc_id);
            assert!(!d.zone_name.is_empty(), "{}", d.doc_id);
            assert_eq!(d.incident_kind == "property", d.diagnosis_codes.is_empty(), "{}", d.doc_id);
            for code in &d.diagnosis_codes {
                assert!(d.narrative.contains(code.as_str()), "{} misses {code}", d.doc_id);
            }
        }
        assert!(docs.windows(2).all(|w| w[0].incident_at < w[1].incident_at));
        assert_eq!(
            docs[3].narrative,
            "Fall in zone Main stage left at 22:10 during a headline set; 3 light-circle witnesses in the same zone; \
             medic note within 12 minutes; right wrist sprain S63.501A; first aid only."
        );
    }
}
