//! Runs against the real Elastic project. Opt in with `CLAIMS_ELASTIC_IT=1`.
//! The seeded history stays in place; the test docs (claim ids 900001-900003)
//! are deleted at the start and at the end.

use std::time::{SystemTime, UNIX_EPOCH};

use claims_elastic::{ClaimDoc, ClaimsIndex, NarrativeParts, narrative_for};

const TEST_IDS: [&str; 3] = ["claim-900001-v1", "claim-900002-v1", "claim-900003-v1"];

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
    assert_eq!(es.seed_history().await?, 30);
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

    let similar = es.similar_claims(&valid.narrative, valid.claim_id, 5).await?;
    for (i, c) in similar.iter().enumerate() {
        eprintln!("#{} {:.4} {} {} {} {} | {}", i + 1, c.score, c.doc_id, c.incident_kind, c.outcome, c.payout_cents, c.narrative);
    }
    assert_eq!(similar.len(), 5);
    assert_eq!((similar[0].source.as_str(), similar[0].incident_kind.as_str()), ("history", "fall"));
    assert!(similar.iter().all(|c| c.claim_id < 900000 && !c.outcome.is_empty()));
    assert!(similar.windows(2).all(|w| w[0].score >= w[1].score));

    // Once decided, the test claim becomes a precedent for its own narrative.
    es.set_outcome(900001, 1, "approved", 18000).await?;
    let top = &es.similar_claims(&valid.narrative, 0, 3).await?[0];
    assert_eq!((top.claim_id, top.outcome.as_str(), top.payout_cents), (900001, "approved", 18000));
    assert!(es.set_outcome(900001, 1, "paid", 1).await.is_err());

    for id in TEST_IDS {
        assert!(es.delete_doc(id).await?, "{id} was not there to delete");
    }
    Ok(())
}
