//! `claim_verify`: Elastic validates the de-identified claim document and finds
//! the clauses of the claim's two policies that bear on it.

use bandit_bindings::{CheckIn, ClauseIn};
use bandit_insurance::IncidentKind;
use bandit_insurance::payloads::VerifyPayload;
use claims_elastic::{ClaimDoc, ClauseHit, NarrativeParts, ValidationResult, item_kind_of, narrative_for, sections_for_kind};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::sink::Finish;

/// Clauses kept for the claim.
const CLAUSES: usize = 5;

pub async fn run(ctx: &Ctx, job: &JobIn, p: VerifyPayload) -> Result<(), JobError> {
    let es = ctx.elastic().await?;
    let doc = claim_doc(&p);
    let validation = es.index_claim(&doc).await?;
    let attendee = attendee_hash(&p);
    // The clause search never fails the job: without clauses Claude decides with its own searches, or none.
    let found = es
        .search_clauses(&doc.narrative, Some(p.venue_policy_hash.as_str()).filter(|h| !h.is_empty()), attendee, sections_for_kind(&p.incident_kind), CLAUSES)
        .await
        .map_err(|e| format!("{e:#}"));
    if let Err(e) = &found {
        tracing::warn!(job_id = job.id, claim_id = p.claim_id, error = %e, "the policy clause search failed");
    }
    let checks = vec![validation_check(&validation), clauses_check(&p.incident_kind, attendee.is_some(), &found)];
    let clauses = found.unwrap_or_default().into_iter().map(clause_in).collect();
    ctx.sink.finish(job.id, Finish::ClaimChecks { checks, clauses }, Vec::new()).await?;
    Ok(())
}

/// The attendee's own policy document, when one is on file.
fn attendee_hash(p: &VerifyPayload) -> Option<&str> {
    Some(p.attendee_policy_hash.trim()).filter(|h| !h.is_empty())
}

fn clause_in(c: ClauseHit) -> ClauseIn {
    ClauseIn { clause_id: c.clause_id, policy: c.policy, section: c.section, page: c.page, text: c.text, score: c.score }
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

/// What the Evidence Engine looks for in the policies, by kind of incident.
fn looked_for(kind: &str) -> &'static str {
    match kind {
        "sos" | "fall" => "the venue's medical payments cover, its limits, exclusions and service window, and the other-insurance clause",
        "property" => "the venue's property policy, its limits and deductible, its exclusions and the subrogation clause",
        "theft" => {
            "the attendee's own personal property cover, its limits, deductible and exclusions such as property left unattended, \
             the subrogation clause, and the venue's exclusion of guests' property"
        }
        "breakage" => {
            "the attendee's own personal property cover, its limits, deductible and exclusions, the subrogation clause, \
             and the venue's exclusion of guests' property"
        }
        _ => "the clauses of the claim's policies",
    }
}

/// `3 clauses of the venue's policy (theft, subrogation)`, one policy's share of the hits.
fn share(found: &[ClauseHit], policy: &str) -> (usize, String) {
    let mut sections: Vec<String> = Vec::new();
    for c in found.iter().filter(|c| c.policy == policy) {
        let s = c.section.replace('_', " ");
        if !s.is_empty() && !sections.contains(&s) {
            sections.push(s);
        }
    }
    let n = found.iter().filter(|c| c.policy == policy).count();
    (n, if sections.is_empty() { String::new() } else { format!(" ({})", sections.join(", ")) })
}

/// The `policy_clauses` check: what the Evidence Engine looked for for this
/// kind of incident and what it found, for example `3 clauses of the venue's
/// policy (theft, subrogation) and 0 of the attendee's; looked for ...`. It
/// passes when a clause was found and is `info` otherwise; it never fails a claim.
pub fn clauses_check(kind: &str, attendee_on_file: bool, found: &Result<Vec<ClauseHit>, String>) -> CheckIn {
    let what = looked_for(kind);
    let (result, detail) = match found {
        Err(e) => ("info", format!("the clause search failed ({e}); looked for {what}")),
        Ok(found) => {
            let (venue, venue_sections) = share(found, "venue");
            let (attendee, attendee_sections) = share(found, "attendee");
            let clauses = if venue == 1 { "clause" } else { "clauses" };
            let attendee = if attendee_on_file { format!("{attendee} of the attendee's{attendee_sections}") } else { "no attendee policy on file".to_string() };
            let joiner = if attendee_on_file { " and " } else { "; " };
            let result = if found.is_empty() { "info" } else { "pass" };
            (result, format!("{venue} {clauses} of the venue's policy{venue_sections}{joiner}{attendee}; looked for {what}"))
        }
    };
    CheckIn { name: "policy_clauses".into(), result: result.into(), detail }
}

/// The de-identified copy: codes, amounts, zone, time, the kind of item as one
/// generic word, and a code-built narrative. No names and no staff free text:
/// the staff description only picks a word from `claims_elastic::ITEM_KINDS`.
pub fn claim_doc(p: &VerifyPayload) -> ClaimDoc {
    let injury = IncidentKind::parse(&p.incident_kind).is_none_or(IncidentKind::is_injury);
    let item_kind = if injury { "" } else { item_kind_of(&p.property_description) };
    let diagnoses: Vec<(&str, &str)> = p.diagnoses.iter().map(|(c, d)| (c.as_str(), d.as_str())).collect();
    let narrative = narrative_for(&NarrativeParts {
        incident_kind: &p.incident_kind,
        zone_name: &p.zone_name,
        local_time: &p.local_time,
        setting: None,
        witnesses_in_zone: p.witness_count,
        minutes_to_staff_note: p.minutes_to_first_note.map(|m| m.clamp(0, u32::MAX as i64) as u32),
        diagnoses: &diagnoses,
        item: (!injury).then_some(item_kind),
        loss_cents: (!injury).then_some(p.cost_cents),
        responsible_named: p.responsible_named,
        cost: injury.then(|| care_phrase(p)),
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
        cost_cents: if injury { 0 } else { p.cost_cents as i64 },
        item_kind: item_kind.to_string(),
        responsible_named: !injury && p.responsible_named,
        outcome: String::new(),
        narrative,
    }
}

/// What kind of care an injury's service codes show.
fn care_phrase(p: &VerifyPayload) -> &'static str {
    let any = |pred: fn(&str) -> bool| p.service_codes.iter().any(|c| pred(c));
    if any(|c| c.starts_with("9928")) {
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

    fn hit(policy: &str, section: &str) -> ClauseHit {
        ClauseHit { clause_id: format!("{policy}-{section}"), policy: policy.into(), section: section.into(), page: 3, text: "clause".into(), ..Default::default() }
    }

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
        assert_eq!((d.cost_cents, d.item_kind.as_str(), d.responsible_named), (0, "", false));
        assert_eq!(d.outcome, "");
        assert!(d.narrative.starts_with("Fall in zone Main stage at 21:45; 3 light-circle witnesses in the same zone; medic note within 6 minutes; "), "{}", d.narrative);
        assert!(d.narrative.ends_with("urgent care visit with x-ray."), "{}", d.narrative);
        assert!(!d.narrative.contains("Jordan") && !d.narrative.contains("Alvarez"));
    }

    #[test]
    fn property_doc_leaves_out_staff_text() {
        let mut p = testdata::verify_payload();
        p.incident_kind = "property".into();
        p.cover_kind = "property".into();
        p.property_description = "Dana saw the crew drop it".into();
        p.corroboration = "uncorroborated".into();
        p.cost_cents = 240_000;
        let d = claim_doc(&p);
        assert_eq!((d.item_kind.as_str(), d.cost_cents), ("other", 240_000));
        assert!(d.narrative.contains("the venue's equipment broken") && !d.narrative.contains("Dana"), "{}", d.narrative);
        assert!(d.narrative.ends_with("repair cost $2,400.00 logged by staff; no one named; no second source."), "{}", d.narrative);
    }

    #[test]
    fn theft_doc_names_the_item_never_the_people() {
        let mut p = testdata::verify_payload();
        p.incident_kind = "theft".into();
        p.cover_kind = "personal_property".into();
        p.property_description = "Maya's MacBook taken from table 4 while she was at the stage".into();
        p.cost_cents = 119_900;
        p.responsible_named = true;
        p.attendee_policy_hash = "ab12".into();
        let d = claim_doc(&p);
        assert_eq!((d.item_kind.as_str(), d.cost_cents, d.responsible_named), ("laptop", 119_900, true));
        assert!(d.narrative.starts_with("Theft in zone Main stage at 21:45: an attendee's own laptop stolen; staff note within 6 minutes; "), "{}", d.narrative);
        assert!(d.narrative.contains("value $1,199.00 logged by staff; a person named at the spot"), "{}", d.narrative);
        assert!(!d.narrative.contains("Maya") && !d.narrative.contains("table 4") && !d.narrative.contains("x-ray"), "{}", d.narrative);
        assert!(d.diagnosis_codes.len() == 2, "codes still copy as they are");
        assert_eq!(attendee_hash(&p), Some("ab12"));
        p.attendee_policy_hash = " ".into();
        assert_eq!(attendee_hash(&p), None);
    }

    #[test]
    fn validation_becomes_a_check() {
        let ok = validation_check(&ValidationResult { valid: true, errors: vec![] });
        assert_eq!((ok.name.as_str(), ok.result.as_str()), ("elastic_validation", "pass"));
        let bad = validation_check(&ValidationResult { valid: false, errors: vec!["incident_in_future".into(), "bad_cents:billed_cents".into()] });
        assert_eq!((bad.result.as_str(), bad.detail.as_str()), ("fail", "incident_in_future, bad_cents:billed_cents"));
    }

    #[test]
    fn the_clause_check_says_what_was_looked_for() {
        let found = Ok(vec![hit("attendee", "insuring_agreement"), hit("venue", "exclusions"), hit("attendee", "exclusions"), hit("venue", "exclusions")]);
        let c = clauses_check("theft", true, &found);
        assert_eq!((c.name.as_str(), c.result.as_str()), ("policy_clauses", "pass"));
        assert!(
            c.detail.starts_with("2 clauses of the venue's policy (exclusions) and 2 of the attendee's (insuring agreement, exclusions); looked for the attendee's own personal property cover"),
            "{}",
            c.detail
        );
        let c = clauses_check("property", false, &Ok(vec![hit("venue", "subrogation")]));
        assert!(c.detail.starts_with("1 clause of the venue's policy (subrogation); no attendee policy on file; looked for the venue's property policy"), "{}", c.detail);
        let none = clauses_check("fall", false, &Ok(vec![]));
        assert_eq!(none.result, "info");
        assert!(none.detail.starts_with("0 clauses of the venue's policy; no attendee policy on file; looked for the venue's medical payments cover"), "{}", none.detail);
        let failed = clauses_check("breakage", true, &Err("POST bandit-policy-clauses/_search returned 500".into()));
        assert_eq!(failed.result, "info");
        assert!(failed.detail.starts_with("the clause search failed (POST"), "{}", failed.detail);
        for kind in ["sos", "fall", "property", "theft", "breakage"] {
            assert_ne!(looked_for(kind), looked_for("slip"), "{kind}");
        }
    }
}
