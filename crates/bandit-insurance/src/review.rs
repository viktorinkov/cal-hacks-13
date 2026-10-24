//! The claims agent: Claude reads the whole pack (facts, checks, amounts fixed
//! by code, the record's history, similar past claims from Elastic) and makes
//! the judgment call code cannot: does this story hang together, and does the
//! treated injury follow from the incident? Its verdict can only stop
//! automation and send the claim to a person; it never changes an amount.

use crate::letters::unknown_figures;
use crate::outcome::ReviewGate;
use crate::{Causation, Cents, Verdict};
use serde::{Deserialize, Serialize};

/// What the model returns. `schemas::agent_review_schema` mirrors it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentReview {
    pub verdict: Verdict,
    pub causation: Causation,
    /// Two to four sentences for the approver's screen.
    pub summary: String,
    pub concerns: Vec<Concern>,
    /// Benign readings of anything that looks off, for example a late note.
    pub innocent_explanations: Vec<String>,
    /// Evidence a person could fetch to settle a concern.
    pub missing_evidence: Vec<String>,
    /// Facts the verdict rests on, by `seq`.
    pub cited_fact_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Concern {
    /// `causation`, `timing`, `location`, `identity`, `amount`, `duplicate` or `other`.
    pub kind: String,
    pub detail: String,
    pub fact_ids: Vec<u32>,
}

/// Code validation of a review:
/// - every cited id (top level and in concerns) is one of `fact_seqs`;
/// - `summary` is 1 to 800 characters; each concern detail at most 400; at most
///   6 concerns, 6 explanations and 6 missing-evidence items;
/// - every dollar figure in `summary` and in concern details is one of `allowed_amounts`
///   (see `letters::unknown_figures`);
/// - a `consistent` verdict has no concerns and causation `supported`.
pub fn validate_review(review: &AgentReview, fact_seqs: &[u32], allowed_amounts: &[Cents]) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    let mut unknown: Vec<u32> = Vec::new();
    for id in review.cited_fact_ids.iter().chain(review.concerns.iter().flat_map(|c| &c.fact_ids)) {
        if !fact_seqs.contains(id) && !unknown.contains(id) {
            unknown.push(*id);
        }
    }
    errors.extend(unknown.iter().map(|id| format!("cited fact {id} is not in the pack")));

    let n = review.summary.trim().chars().count();
    if !(1..=800).contains(&n) {
        errors.push(format!("summary is {n} characters, expected 1 to 800"));
    }
    for (i, c) in review.concerns.iter().enumerate() {
        let n = c.detail.chars().count();
        if n > 400 {
            errors.push(format!("concern {} detail is {n} characters, at most 400", i + 1));
        }
    }
    for (what, len) in [
        ("concerns", review.concerns.len()),
        ("innocent explanations", review.innocent_explanations.len()),
        ("missing evidence items", review.missing_evidence.len()),
    ] {
        if len > 6 {
            errors.push(format!("{len} {what}, at most 6"));
        }
    }

    for f in unknown_figures(&review.summary, allowed_amounts) {
        errors.push(format!("summary figure {f} is not one of the claim's amounts"));
    }
    for (i, c) in review.concerns.iter().enumerate() {
        for f in unknown_figures(&c.detail, allowed_amounts) {
            errors.push(format!("concern {} figure {f} is not one of the claim's amounts", i + 1));
        }
    }

    if review.verdict == Verdict::Consistent {
        if !review.concerns.is_empty() {
            errors.push(format!("consistent verdict with {} concerns", review.concerns.len()));
        }
        if review.causation != Causation::Supported {
            errors.push(format!("consistent verdict with causation {}", review.causation.as_str()));
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(errors) }
}

/// `Consistent` maps to `ReviewGate::Consistent`; anything else to
/// `Concerns` with the verdict and concern details joined, for example
/// `needs_human: causation: the record says the injury happened at home`.
pub fn gate(review: &AgentReview) -> ReviewGate {
    if review.verdict == Verdict::Consistent {
        return ReviewGate::Consistent;
    }
    let mut text = review.verdict.as_str().to_string();
    let concerns: Vec<String> = review.concerns.iter().map(|c| format!("{}: {}", c.kind, c.detail)).collect();
    if !concerns.is_empty() {
        text = format!("{text}: {}", concerns.join("; "));
    }
    ReviewGate::Concerns(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEQS: [u32; 6] = [1, 2, 3, 4, 5, 6];
    /// cost, payout, recoverable, venue cost.
    const AMOUNTS: [Cents; 4] = [18_000, 18_000, 8_000, 10_000];

    fn consistent() -> AgentReview {
        AgentReview {
            verdict: Verdict::Consistent,
            causation: Causation::Supported,
            summary: "Two witnesses in the main stage zone and a medic note within minutes back the fall. \
                      The first-aid record describes a slip onto an outstretched hand, which fits a wrist sprain. \
                      Covered cost is $180.00, and the venue keeps $100.00 of it."
                .to_string(),
            concerns: vec![],
            innocent_explanations: vec![],
            missing_evidence: vec![],
            cited_fact_ids: vec![1, 2, 4],
        }
    }

    fn needs_human() -> AgentReview {
        AgentReview {
            verdict: Verdict::NeedsHuman,
            causation: Causation::Unclear,
            summary: "The band and witnesses place a fall in the zone, but the record tells a different story.".to_string(),
            concerns: vec![Concern {
                kind: "causation".to_string(),
                detail: "the record says the injury happened at home".to_string(),
                fact_ids: vec![5],
            }],
            innocent_explanations: vec!["the patient may have described an older injury as well".to_string()],
            missing_evidence: vec!["the full intake form".to_string()],
            cited_fact_ids: vec![1, 5],
        }
    }

    #[test]
    fn consistent_review_opens_the_gate() {
        let r = consistent();
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS), Ok(()));
        assert_eq!(gate(&r), ReviewGate::Consistent);
    }

    #[test]
    fn causation_concern_goes_to_a_person() {
        let r = needs_human();
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS), Ok(()));
        assert_eq!(gate(&r), ReviewGate::Concerns("needs_human: causation: the record says the injury happened at home".to_string()));

        let mut two = r.clone();
        two.verdict = Verdict::Inconsistent;
        two.concerns.push(Concern { kind: "timing".to_string(), detail: "the note is late".to_string(), fact_ids: vec![] });
        assert_eq!(
            gate(&two),
            ReviewGate::Concerns("inconsistent: causation: the record says the injury happened at home; timing: the note is late".to_string())
        );
        two.concerns.clear();
        assert_eq!(gate(&two), ReviewGate::Concerns("inconsistent".to_string()));
    }

    #[test]
    fn rejects_invented_fact_ids() {
        let mut r = needs_human();
        r.cited_fact_ids.push(99);
        r.concerns[0].fact_ids.extend([99, 7]);
        assert_eq!(
            validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(),
            ["cited fact 99 is not in the pack", "cited fact 7 is not in the pack"]
        );
    }

    #[test]
    fn rejects_figures_not_in_the_amounts() {
        let mut r = consistent();
        r.summary.push_str(" The bill was $1,240.00.");
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(), ["summary figure $1,240.00 is not one of the claim's amounts"]);

        let mut r = needs_human();
        r.concerns[0].detail = "the record bills $ 75 for a visit".to_string();
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(), ["concern 1 figure $75.00 is not one of the claim's amounts"]);
    }

    #[test]
    fn rejects_bad_lengths() {
        let mut r = consistent();
        r.summary = "x".repeat(801);
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(), ["summary is 801 characters, expected 1 to 800"]);
        r.summary = "é".repeat(800);
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS), Ok(()));
        r.summary = "  ".to_string();
        assert_eq!(validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(), ["summary is 0 characters, expected 1 to 800"]);

        let mut r = needs_human();
        r.concerns[0].detail = "y".repeat(401);
        r.missing_evidence = vec!["z".to_string(); 7];
        assert_eq!(
            validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(),
            ["concern 1 detail is 401 characters, at most 400", "7 missing evidence items, at most 6"]
        );
    }

    #[test]
    fn consistent_means_no_concerns_and_supported_causation() {
        let mut r = needs_human();
        r.verdict = Verdict::Consistent;
        assert_eq!(
            validate_review(&r, &SEQS, &AMOUNTS).unwrap_err(),
            ["consistent verdict with 1 concerns", "consistent verdict with causation unclear"]
        );
    }
}
