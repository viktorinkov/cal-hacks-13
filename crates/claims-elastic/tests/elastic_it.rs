//! Runs against the real Elastic project. Opt in with `CLAIMS_ELASTIC_IT=1`.
//! The test docs (claim ids 900001-900005) are deleted at the start and at the end.

use std::time::{SystemTime, UNIX_EPOCH};

use claims_elastic::{ClaimDoc, ClaimsIndex, NarrativeParts, narrative_for, sections_for_kind};

const TEST_IDS: [&str; 5] = ["claim-900001-v1", "claim-900002-v1", "claim-900003-v1", "claim-900004-v1", "claim-900005-v1"];

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

fn wrist_sprain_fall() -> ClaimDoc {
    let narrative = narrative_for(&NarrativeParts {
        incident_kind: "fall",
        zone_name: "Stage B",
        local_time: "22:14",
        witnesses_in_zone: 3,
        minutes_to_staff_note: Some(12),
        diagnoses: &[("S63.501A", "right wrist sprain")],
        cost: Some("first aid only"),
        ..Default::default()
    });
    ClaimDoc {
        doc_id: ClaimDoc::live_id(900001, 1),
        claim_id: 900001,
        pack_version: 1,
        source: "live".into(),
        venue: "Palace of Fine Arts".into(),
        incident_kind: "fall".into(),
        cover_kind: "medical_payments".into(),
        zone_id: 102,
        zone_name: "Stage B".into(),
        incident_at: now_ms() - 3_600_000,
        corroboration: "corroborated".into(),
        witness_count: 3,
        diagnosis_codes: vec!["S63.501A".into()],
        service_codes: vec!["A6449".into()],
        record_sha256: "9f2c".repeat(16),
        billed_cents: 18000,
        covered_cents: 18000,
        narrative,
        ..Default::default()
    }
}

fn laptop_theft() -> ClaimDoc {
    let narrative = narrative_for(&NarrativeParts {
        incident_kind: "theft",
        zone_name: "Sponsor row",
        local_time: "21:10",
        minutes_to_staff_note: Some(4),
        loss_cents: Some(119_900),
        responsible_named: true,
        ..Default::default()
    });
    ClaimDoc {
        doc_id: ClaimDoc::live_id(900004, 1),
        claim_id: 900004,
        incident_kind: "theft".into(),
        cover_kind: "property".into(),
        zone_id: 104,
        zone_name: "Sponsor row".into(),
        witness_count: 0,
        diagnosis_codes: vec![],
        service_codes: vec![],
        record_sha256: String::new(),
        billed_cents: 0,
        covered_cents: 0,
        payout_cents: 119_900,
        cost_cents: 119_900,
        responsible_named: true,
        narrative,
        ..wrist_sprain_fall()
    }
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

#[tokio::test]
async fn claims_round_trip() -> anyhow::Result<()> {
    if std::env::var("CLAIMS_ELASTIC_IT").as_deref() != Ok("1") {
        eprintln!("skipped: set CLAIMS_ELASTIC_IT=1 to run against Elastic");
        return Ok(());
    }
    let es = ClaimsIndex::from_env()?;
    es.ensure_setup().await?;
    es.ensure_setup().await?; // idempotent
    assert_eq!(es.delete_past_claims().await?, 0, "ensure_setup already removed the seeded past claims");
    for id in TEST_IDS {
        es.delete_doc(id).await?;
    }

    let valid = wrist_sprain_fall();
    let r = es.index_claim(&valid).await?;
    assert!(r.valid && r.errors.is_empty(), "{:?}", r.errors);

    // A fall with almost everything wrong.
    let bad = ClaimDoc {
        doc_id: ClaimDoc::live_id(900002, 1),
        claim_id: 900002,
        pack_version: 1,
        source: "live".into(),
        incident_kind: "fall".into(),
        cover_kind: "".into(),
        zone_id: 0,
        witness_count: -1,
        incident_at: now_ms() + 86_400_000,
        diagnosis_codes: vec!["S63.501A".into(), "U07.1".into(), "s63.5".into()],
        service_codes: vec!["99213".into(), "A6449".into(), "9921".into(), "Z9999".into()],
        billed_cents: 1000,
        covered_cents: 2000,
        payout_cents: -5,
        narrative: "".into(),
        ..Default::default()
    };
    let r = es.index_claim(&bad).await?;
    assert!(!r.valid);
    let expected = [
        "missing:cover_kind",
        "missing:narrative",
        "injury_needs_zone",
        "injury_needs_witness_count",
        "bad_cents:payout_cents",
        "bad_diagnosis_code:U07.1",
        "bad_diagnosis_code:s63.5",
        "bad_service_code:9921",
        "bad_service_code:Z9999",
        "incident_in_future",
        "covered_exceeds_billed",
    ];
    assert_eq!(sorted(r.errors), sorted(expected.map(String::from).to_vec()));

    // An unknown incident kind is reported, and is not held to injury rules.
    let odd = ClaimDoc {
        doc_id: ClaimDoc::live_id(900003, 1),
        claim_id: 900003,
        incident_kind: "slip".into(),
        ..valid.clone()
    };
    let r = es.index_claim(&odd).await?;
    assert_eq!((r.valid, r.errors), (false, vec!["bad_incident_kind:slip".to_string()]));

    // A theft is valid with its loss and its property cover.
    let theft = laptop_theft();
    let r = es.index_claim(&theft).await?;
    assert!(r.valid && r.errors.is_empty(), "{:?}", r.errors);

    // An attendee's own things need a value and the attendee's own cover.
    let lost = ClaimDoc {
        doc_id: ClaimDoc::live_id(900005, 1),
        claim_id: 900005,
        incident_kind: "belongings".into(),
        cost_cents: 0,
        ..theft.clone()
    };
    let r = es.index_claim(&lost).await?;
    assert_eq!(sorted(r.errors), sorted(vec!["cover_kind_mismatch:property".to_string(), "loss_needs_cost_cents".to_string()]));

    // The clause search answers, or is empty when no policy is read yet; it never fails the claim.
    let clauses = es.search_clauses(&theft.narrative, None, None, sections_for_kind("theft"), 5).await?;
    for (i, c) in clauses.iter().enumerate() {
        eprintln!("#{} {:.4} {} {} p{} | {}", i + 1, c.score, c.clause_id, c.section, c.page, c.text);
    }
    assert!(clauses.len() <= 5);
    assert!(clauses.iter().all(|c| c.policy == "venue" && sections_for_kind("theft").contains(&c.section.as_str())));
    assert!(clauses.windows(2).all(|w| w[0].score >= w[1].score));
    if let Some(first) = clauses.first() {
        let read = es.read_clause(&first.clause_id).await?.expect("a clause the search found can be read");
        assert_eq!((read.clause_id.as_str(), read.text.as_str()), (first.clause_id.as_str(), first.text.as_str()));
    }
    assert!(es.read_clause("no-such-clause-c0").await?.is_none());

    es.set_outcome(900001, 1, "approved", 18000).await?;
    assert!(es.set_outcome(900001, 1, "paid", 1).await.is_err());

    for id in TEST_IDS {
        assert!(es.delete_doc(id).await?, "{id} was not there to delete");
    }
    Ok(())
}
