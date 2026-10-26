//! Runs against the real Elastic project. Opt in with `CLAIMS_ELASTIC_IT=1`.
//! The test docs (claim ids 900001-900005) are deleted at the start and at the end.

use std::time::{SystemTime, UNIX_EPOCH};

use claims_elastic::{ClaimDoc, ClaimsIndex, NarrativeParts, chunk_docs, cite, narrative_for, sections_for_kind};

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

/// A sponsor's display laptop taken from its booth: the venue's loss, paid by its property policy.
fn booth_laptop_theft() -> ClaimDoc {
    let narrative = narrative_for(&NarrativeParts {
        incident_kind: "theft",
        zone_name: "Sponsor booths",
        local_time: "21:10",
        minutes_to_staff_note: Some(4),
        item: Some("laptop"),
        loss_cents: Some(129_900),
        responsible_named: true,
        ..Default::default()
    });
    ClaimDoc {
        doc_id: ClaimDoc::live_id(900004, 1),
        claim_id: 900004,
        incident_kind: "theft".into(),
        cover_kind: "property".into(),
        zone_id: 104,
        zone_name: "Sponsor booths".into(),
        witness_count: 0,
        diagnosis_codes: vec![],
        service_codes: vec![],
        record_sha256: String::new(),
        billed_cents: 0,
        covered_cents: 0,
        payout_cents: 129_900,
        cost_cents: 129_900,
        item_kind: "laptop".into(),
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

    // A theft from the venue is valid with its loss and the venue's property cover.
    let theft = booth_laptop_theft();
    let r = es.index_claim(&theft).await?;
    assert!(r.valid && r.errors.is_empty(), "{:?}", r.errors);

    // A breakage is answered like property: the venue's property cover and the loss logged.
    // The item is optional, and no cover pays for an attendee's own belonging.
    let broken = ClaimDoc {
        doc_id: ClaimDoc::live_id(900005, 1),
        claim_id: 900005,
        incident_kind: "breakage".into(),
        cover_kind: "personal_property".into(),
        cost_cents: 0,
        item_kind: String::new(),
        ..theft.clone()
    };
    let r = es.index_claim(&broken).await?;
    let expected = ["cover_kind_mismatch:personal_property", "loss_needs_cost_cents"];
    assert_eq!(sorted(r.errors), sorted(expected.map(String::from).to_vec()));

    // The clause search answers, or is empty when no policy is read yet; it never fails the claim.
    let clauses = es.search_clauses(&theft.narrative, None, None, sections_for_kind("theft"), 5).await?;
    for (i, c) in clauses.iter().enumerate() {
        eprintln!("#{} {:.4} {} {} p{} | {}", i + 1, c.score, c.clause_id, c.section, c.page, c.text);
    }
    assert!(clauses.len() <= 5);
    assert!(clauses.iter().all(|c| c.policy == "venue" && sections_for_kind("theft").contains(&c.section.as_str())), "a theft searches the venue's policy only");
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

/// Copies a rule proposal offers: three approved wrist sprains, one of them not yet recorded, and a refused one.
const PRECEDENT_IDS: [&str; 5] = ["claim-900011-v1", "claim-900011-v2", "claim-900012-v2", "claim-900013-v2", "claim-900014-v2"];

fn precedent(claim_id: i64, pack_version: i32, payout_cents: i64) -> ClaimDoc {
    ClaimDoc { doc_id: ClaimDoc::live_id(claim_id, pack_version), claim_id, pack_version, payout_cents, ..wrist_sprain_fall() }
}

#[tokio::test]
async fn rule_precedents_are_counted_and_proposed() -> anyhow::Result<()> {
    if std::env::var("CLAIMS_ELASTIC_IT").as_deref() != Ok("1") {
        eprintln!("skipped: set CLAIMS_ELASTIC_IT=1 to run against Elastic");
        return Ok(());
    }
    let es = ClaimsIndex::from_env()?;
    es.ensure_setup().await?;
    for id in PRECEDENT_IDS {
        es.delete_doc(id).await?;
    }
    // Claim 900011's second pack is its newest copy, so it is the one counted.
    es.index_claim(&precedent(900011, 1, 0)).await?;
    es.index_claim(&precedent(900011, 2, 18_000)).await?;
    es.index_claim(&precedent(900012, 2, 15_000)).await?;
    es.index_claim(&precedent(900013, 2, 18_000)).await?;
    es.index_claim(&ClaimDoc { diagnosis_codes: vec!["S93.401A".into()], ..precedent(900014, 2, 9_500) }).await?;
    for (id, outcome, payout) in [(900011, "approved", 18_000), (900012, "approved", 15_000), (900014, "refused", 0)] {
        es.set_outcome(id, 2, outcome, payout).await?;
    }
    let newest = es.newest_copy(900011).await?.expect("claim 900011 has copies");
    assert_eq!((newest.doc_id.as_str(), newest.outcome.as_str()), ("claim-900011-v2", "approved"));
    assert!(es.newest_copy(900099).await?.is_none());
    // The approval the letters have not recorded yet, as the job records it.
    let late = es.newest_copy(900013).await?.unwrap();
    assert_eq!(late.outcome, "");
    es.set_outcome(late.claim_id, late.pack_version, "approved", 18_000).await?;

    let doc_ids: Vec<String> = ["claim-900011-v2", "claim-900012-v2", "claim-900013-v2", "claim-900014-v2"].map(String::from).to_vec();
    let out = es.claim_precedents(&doc_ids).await?;
    eprintln!("{out:#}");
    let col = |name: &str| out["columns"].as_array().unwrap().iter().position(|c| c["name"] == name).unwrap();
    let rows = out["values"].as_array().unwrap();
    let approved = rows.iter().find(|r| r[col("outcome")] == "approved" && r[col("diagnosis_codes")] == "S63.501A").expect("an approved wrist sprain row");
    assert_eq!(approved[col("claims")], 3);
    assert_eq!(approved[col("highest_payout_cents")], 18_000);
    assert_eq!(approved[col("lowest_payout_cents")], 15_000);
    let mut ids: Vec<i64> = approved[col("claim_ids")].as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
    ids.sort();
    assert_eq!(ids, [900011, 900012, 900013]);
    assert!(rows.iter().any(|r| r[col("outcome")] == "refused" && r[col("diagnosis_codes")] == "S93.401A" && r[col("claims")] == 1));
    assert!(!rows.iter().any(|r| r[col("claim_ids")].to_string().contains("900099")));

    // The agent counts the same copies with its tool and proposes the rule; the worker's checks are in bandit-workers.
    match (std::env::var("KIBANA_URL"), std::env::var("KIBANA_API_KEY")) {
        (Ok(url), Ok(key)) if !url.trim().is_empty() => {
            let kibana = claims_elastic::Kibana::new(&url, &key)?;
            kibana.ensure_proposer().await?;
            es.ensure_proposals_index().await?;
            let key = "proposal-900000-1";
            es.delete_rule_answer(key).await?;
            let task = "Venue: Test venue, policy GL-TEST.\nShape: fall claims under medical_payments cover.\n\
                        The cover's per-claim limit: 500000 cents ($5,000.00). Minimum payout: 0 cents ($0.00).\nRule in force: none.\n\n\
                        Approved precedents, which you may cite:\n\
                        - claim 900011: Maya Chen, Stage B, payout 18000 cents ($180.00); diagnoses S63.501A right wrist sprain; corroborated; approved by Ops desk.\n\
                        - claim 900012: Sam Patel, Stage B, payout 15000 cents ($150.00); diagnoses S63.501A right wrist sprain; corroborated; approved by Ops desk.\n\
                        - claim 900013: Lee Park, Stage B, payout 18000 cents ($180.00); diagnoses S63.501A right wrist sprain; corroborated; approved by Ops desk.\n\n\
                        Refused precedents, never cited:\n\
                        - claim 900014: Jordan Alvarez, Stage B, payout 9500 cents ($95.00); refused because the ankle was hurt at home";
            let schema = serde_json::json!({
                "type": "object",
                "properties": {
                    "propose": {"type": "boolean"}, "precedent_claim_ids": {"type": "array", "items": {"type": "integer"}},
                    "ceiling_cents": {"type": "integer"}, "rule": {"type": "string"}, "summary": {"type": "string"}
                },
                "required": ["propose", "precedent_claim_ids", "ceiling_cents", "rule", "summary"]
            });
            let inputs = serde_json::json!({
                "proposal_key": key, "claims_index": es.index(), "doc_ids": doc_ids.join(","), "task": task,
                "schema": schema.to_string(), "proposals_index": es.proposals_index(),
            });
            let execution = kibana.run_workflow(claims_elastic::proposer::WORKFLOW, inputs).await?;
            let done = kibana.wait_for(&execution, std::time::Duration::from_secs(5), std::time::Duration::from_secs(600)).await?;
            assert_eq!(done["status"], "completed", "{}", claims_elastic::reader::failure(&done));
            let saved = es.rule_answer(key).await?;
            eprintln!("{saved:#}");
            let answer = &saved["answer"];
            let mut cited: Vec<i64> = answer["precedent_claim_ids"].as_array().unwrap().iter().map(|v| v.as_i64().unwrap()).collect();
            cited.sort();
            assert_eq!((answer["propose"].as_bool(), cited, answer["ceiling_cents"].as_i64()), (Some(true), vec![900011, 900012, 900013], Some(18_000)));
            es.delete_rule_answer(key).await?;
        }
        _ => eprintln!("the agent is not run: set KIBANA_URL and KIBANA_API_KEY"),
    }

    for id in PRECEDENT_IDS {
        es.delete_doc(id).await?;
    }
    Ok(())
}

/// A fetched plan's two pages, under a hash no real PDF has.
const CHUNKED: &str = "00000000000000000000000000000000000000000000000000000000000c0de1";

#[tokio::test]
async fn fetched_pdf_chunks_are_searchable_and_cited() -> anyhow::Result<()> {
    if std::env::var("CLAIMS_ELASTIC_IT").as_deref() != Ok("1") {
        eprintln!("skipped: set CLAIMS_ELASTIC_IT=1 to run against Elastic");
        return Ok(());
    }
    let es = ClaimsIndex::from_env()?;
    es.ensure_clauses_index().await?;
    es.delete_chunks(CHUNKED).await?;
    let pages = vec![
        "Blue Shield of California: Silver 70 PPO 2500/55 Coverage Period: 01/01/2026 - 12/31/2026\n\
Summary of Benefits and Coverage: What this Plan Covers & What You Pay for Covered Services\n\n\
The Summary of Benefits and Coverage (SBC) document will help you choose a health plan. The SBC shows you how you and the plan would share the cost for covered health care services."
            .to_string(),
        "Important Questions Answers Why This Matters\nWhat is the overall deductible? $2,500 individual / $5,000 family\n\n\
If you visit a health care provider's office or clinic: urgent care $55 copay; emergency room care $500 copay after deductible"
            .to_string(),
    ];
    let docs = chunk_docs("attendee", CHUNKED, &pages);
    assert!(docs.len() >= 4, "{docs:?}");
    assert!(es.index_chunks(CHUNKED, &docs).await?, "a new PDF is chunked");
    assert!(!es.index_chunks(CHUNKED, &docs).await?, "the same PDF is chunked once");
    assert_eq!(es.chunk_count(CHUNKED).await?, docs.len() as u64);

    let hits = es.search_chunks("Blue Shield of California Silver 70 PPO summary of benefits and coverage", CHUNKED, None, 5).await?;
    for (i, h) in hits.iter().enumerate() {
        eprintln!("#{} {:.4} {} p{} | {}", i + 1, h.score, h.clause_id, h.page, h.text);
    }
    assert!(!hits.is_empty() && hits.iter().all(|h| h.document_hash == CHUNKED));
    let cited = cite(&hits, "Silver 70 PPO 2500/55").expect("a chunk to cite");
    assert_eq!((cited.clause_id.as_str(), cited.page), (format!("{CHUNKED}-p1-k1").as_str(), 1), "the chunk that prints the plan");

    let urgent = es.search_chunks("what does urgent care cost", CHUNKED, Some((2, 2)), 5).await?;
    assert!(!urgent.is_empty() && urgent.iter().all(|h| h.page == 2), "the page filter holds");

    let claims = es.search_clauses("urgent care copay", None, Some(CHUNKED), &[], 5).await?;
    assert!(claims.iter().all(|c| c.document_hash != CHUNKED), "a claim search never returns a chunk");

    assert_eq!(es.delete_chunks(CHUNKED).await?, docs.len() as u64);
    assert_eq!(es.chunk_count(CHUNKED).await?, 0);
    Ok(())
}
