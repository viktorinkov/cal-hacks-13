//! `claim_verify`: Elastic validates the de-identified claim document and ranks similar past claims.

use bandit_bindings::{CheckIn, PrecedentIn};
use claims_elastic::{ClaimDoc, NarrativeParts, ValidationResult, narrative_for};
use hyphenate_core::payloads::VerifyPayload;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::sink::Finish;

const PRECEDENTS: usize = 3;

pub async fn run(ctx: &Ctx, job: &JobIn, p: VerifyPayload) -> Result<(), JobError> {
    let es = ctx.elastic().await?;
    let doc = claim_doc(&p);
    let validation = es.index_claim(&doc).await?;
    let similar = es.similar_claims(&doc.narrative, doc.claim_id, PRECEDENTS).await?;
    let precedents = similar
        .into_iter()
        .map(|c| PrecedentIn { reference: c.doc_id, outcome: c.outcome, payout_cents: c.payout_cents.max(0) as u64, narrative: c.narrative, score: c.score as f32 })
        .collect();
    let checks = vec![validation_check(&validation)];
    ctx.sink.finish(job.id, Finish::ClaimChecks { checks, precedents }, Vec::new()).await?;
    Ok(())
}

/// The pipeline's verdict as the `elastic_validation` check.
pub fn validation_check(v: &ValidationResult) -> CheckIn {
    let (result, detail) = if v.valid {
        ("pass", "the claim document passed the bandit-claims-validate pipeline".to_string())
    } else {
        ("fail", v.errors.join(", "))
    };
    CheckIn { name: "elastic_validation".into(), result: result.into(), detail }
}

/// The de-identified copy: codes, amounts, zone, time and a code-built
/// narrative. No names and no staff free text (the property description is
/// typed by staff, so a property claim is described as "equipment damaged").
pub fn claim_doc(p: &VerifyPayload) -> ClaimDoc {
    let diagnoses: Vec<(&str, &str)> = p.diagnoses.iter().map(|(c, d)| (c.as_str(), d.as_str())).collect();
    let cost = cost_phrase(p);
    let narrative = narrative_for(&NarrativeParts {
        incident_kind: &p.incident_kind,
        zone_name: &p.zone_name,
        local_time: &p.local_time,
        setting: None,
        witnesses_in_zone: p.witness_count,
        minutes_to_staff_note: p.minutes_to_first_note.map(|m| m.clamp(0, u32::MAX as i64) as u32),
        diagnoses: &diagnoses,
        property: None,
        cost: Some(cost),
        finding: match p.corroboration.as_str() {
            "uncorroborated" => Some("no second source"),
            "disputed" => Some("the sources disagree"),
            _ => None,
        },
    });
    ClaimDoc {
        doc_id: ClaimDoc::live_id(p.claim_id as i64, p.pack_version as i32),
        claim_id: p.claim_id as i64,
        pack_version: p.pack_version as i32,
        source: "live".into(),
        venue: p.venue_name.clone(),
        incident_kind: p.incident_kind.clone(),
        cover_kind: p.cover_kind.clone(),
        zone_id: p.zone_id as i64,
        zone_name: p.zone_name.clone(),
        incident_at: p.incident_at_micros.div_euclid(1000),
        corroboration: p.corroboration.clone(),
        witness_count: p.witness_count as i32,
        diagnosis_codes: p.diagnoses.iter().map(|(c, _)| c.clone()).collect(),
        service_codes: p.service_codes.clone(),
        record_sha256: p.record_hash.clone(),
        billed_cents: p.billed_cents as i64,
        covered_cents: p.covered_cents as i64,
        payout_cents: p.payout_cents as i64,
        outcome: String::new(),
        narrative,
    }
}

/// What kind of care the service codes show, in the words the seeded history uses.
fn cost_phrase(p: &VerifyPayload) -> &'static str {
    let any = |pred: fn(&str) -> bool| p.service_codes.iter().any(|c| pred(c));
    if p.incident_kind == "property" {
        "repair cost logged by staff"
    } else if any(|c| c.starts_with("9928")) {
        "emergency department visit"
    } else if any(|c| matches!(c, "99202" | "99203" | "99204" | "99205" | "99212" | "99213" | "99214" | "99215")) {
        if any(|c| c.starts_with("7")) { "urgent care visit with x-ray" } else { "urgent care visit" }
    } else if p.service_codes.is_empty() {
        "first aid only"
    } else {
        "treated on site, no transport"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdata;

    #[test]
    fn payload_to_claim_doc() {
        let p = testdata::verify_payload();
        let d = claim_doc(&p);
        assert_eq!(d.doc_id, "claim-900101-v2");
        assert_eq!((d.source.as_str(), d.zone_id, d.witness_count), ("live", 101, 3));
        assert_eq!(d.incident_at, p.incident_at_micros / 1000);
        assert_eq!(d.diagnosis_codes, ["S63.502A", "W01.0XXA"]);
        assert_eq!(d.service_codes.len(), 8);
        assert_eq!((d.billed_cents, d.covered_cents, d.payout_cents), (130_800, 89_500, 89_500));
        assert_eq!(d.outcome, "");
        assert!(d.narrative.starts_with("Fall in zone Main stage at 21:45; 3 light-circle witnesses in the same zone; medic note within 6 minutes; "), "{}", d.narrative);
        assert!(d.narrative.ends_with("urgent care visit with x-ray."), "{}", d.narrative);
        assert!(!d.narrative.contains("Jordan") && !d.narrative.contains("Alvarez"));
    }

    #[test]
    fn property_doc_leaves_out_staff_text() {
        let mut p = testdata::verify_payload();
        p.incident_kind = "property".into();
        p.property_description = "Dana saw the crew drop it".into();
        p.corroboration = "uncorroborated".into();
        let d = claim_doc(&p);
        assert!(d.narrative.contains("equipment damaged") && !d.narrative.contains("Dana"), "{}", d.narrative);
        assert!(d.narrative.ends_with("repair cost logged by staff; no second source."), "{}", d.narrative);
    }

    #[test]
    fn validation_becomes_a_check() {
        let ok = validation_check(&ValidationResult { valid: true, errors: vec![] });
        assert_eq!((ok.name.as_str(), ok.result.as_str()), ("elastic_validation", "pass"));
        let bad = validation_check(&ValidationResult { valid: false, errors: vec!["incident_in_future".into(), "bad_cents:billed_cents".into()] });
        assert_eq!((bad.result.as_str(), bad.detail.as_str()), ("fail", "incident_in_future, bad_cents:billed_cents"));
    }
}
