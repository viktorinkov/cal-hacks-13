//! Claude drafts, code checks, a person sends. Two guardrails live here: every
//! dollar figure in a letter must be one the claim's payload carries, and a
//! recovery letter is a question, never an accusation. The templates are the
//! letters code writes when the agent is unavailable.

use crate::coverage::Amounts;
use crate::money::{format_cents, parse_dollars};
use crate::pack::short_sha;
use crate::Cents;
use serde::{Deserialize, Serialize};

/// Every `$` amount in `text`: `$180`, `$180.00`, `$2,400.00`, `$ 75`.
pub fn dollar_figures(text: &str) -> Vec<Cents> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'$' {
            i += 1;
            continue;
        }
        let mut j = i + 1;
        while j < b.len() && b[j] == b' ' {
            j += 1;
        }
        let start = j;
        while j < b.len() && (b[j].is_ascii_digit() || b[j] == b',') {
            j += 1;
        }
        let mut end = j;
        while end > start && b[end - 1] == b',' {
            end -= 1;
        }
        let has_fraction = end == j && j + 1 < b.len() && b[j] == b'.' && b[j + 1].is_ascii_digit();
        if !((start < end && b[start].is_ascii_digit()) || (start == end && has_fraction)) {
            i += 1;
            continue;
        }
        let whole = if start == end { "0" } else { &text[start..end] };
        let mut figure = whole.to_string();
        if has_fraction {
            let from = j + 1;
            j = from;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            // Cents are two digits; any further digits are ignored.
            figure = format!("{whole}.{}", &text[from..j.min(from + 2)]);
        }
        // A figure too large to parse is still a figure, and never an allowed one.
        out.push(parse_dollars(&figure).unwrap_or(Cents::MAX));
        i = j;
    }
    out
}

/// Figures in `text` that are not in `allowed`, formatted like `$12.00`.
pub fn unknown_figures(text: &str, allowed: &[Cents]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for f in dollar_figures(text) {
        let s = format_cents(f);
        if !allowed.contains(&f) && !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// Phrases that assign fault; a recovery letter containing any is rejected.
/// Matched case-insensitively as substrings.
pub const FAULT_PHRASES: &[&str] = &[
    "your fault",
    "at fault",
    "you caused",
    "caused by your",
    "you damaged",
    "your crew damaged",
    "you are responsible",
    "you are liable",
    "liable for",
    "negligen",
    "we hold you",
    "you must pay",
    "demand payment",
    "breach",
];

/// Runs of whitespace count as one space, so a line break cannot hide a phrase.
pub fn fault_phrases_in(text: &str) -> Vec<&'static str> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    FAULT_PHRASES.iter().copied().filter(|p| text.contains(p)).collect()
}

/// What every letter can say. Built by code from the claim and its pack.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LetterData {
    pub claim_id: u64,
    pub pack_sha256: String,
    pub policy_number: String,
    pub insurer_name: String,
    pub fnol_contact: String,
    pub venue_name: String,
    pub claimant_name: String,
    /// `fall`, `sos` or `property`.
    pub incident_kind: String,
    pub zone_name: String,
    /// Local `YYYY-MM-DD HH:MM:SS`.
    pub incident_time: String,
    pub amounts: Amounts,
    /// `settled automatically under rule v1, approved by Ops desk (ops)`.
    pub decision_text: String,
    /// `[seq] key = value` lines of the pack.
    pub fact_lines: Vec<String>,
    /// For recovery letters: who is asked, and how to reach them.
    pub counterparty_name: String,
    pub counterparty_contact: String,
    /// Other people hurt in the same occurrence, one line each, for example
    /// `claim 14: Lee Park, fall, routed to the organizer`.
    #[serde(default)]
    pub related_claims: Vec<String>,
}

/// A copy with `$` spelled `USD ` in every text field, so the only figures a
/// template prints are the four amounts (a staff note may mention a price).
fn plain(d: &LetterData) -> LetterData {
    let mut c = d.clone();
    for s in [
        &mut c.pack_sha256,
        &mut c.policy_number,
        &mut c.insurer_name,
        &mut c.fnol_contact,
        &mut c.venue_name,
        &mut c.claimant_name,
        &mut c.incident_kind,
        &mut c.zone_name,
        &mut c.incident_time,
        &mut c.decision_text,
        &mut c.counterparty_name,
        &mut c.counterparty_contact,
    ]
    .into_iter()
    .chain(c.fact_lines.iter_mut())
    .chain(c.related_claims.iter_mut())
    {
        *s = s.replace('$', "USD ");
    }
    c
}

fn kind_text(kind: &str) -> &str {
    match kind {
        "fall" => "a fall",
        "sos" => "an SOS alert",
        "property" | "breakage" => "property damage",
        "theft" => "a theft from the venue",
        other => other,
    }
}

/// First notice of loss to the insurer: the ACORD 1 property loss notice for
/// the venue's broken or stolen property, else the ACORD 3 liability notice of
/// occurrence, in its section order: carrier, policy, insured, occurrence,
/// injured or damaged, witnesses, other injured, remarks, then the facts.
pub fn fnol_template(d: &LetterData) -> String {
    let d = &plain(d);
    let a = d.amounts;
    let (form, line) = if matches!(d.incident_kind.as_str(), "property" | "theft" | "breakage") {
        ("PROPERTY LOSS NOTICE (ACORD 1 layout)", "commercial property, the property part of the package policy")
    } else {
        ("LIABILITY NOTICE OF OCCURRENCE / CLAIM (ACORD 3 layout)", "general liability, medical payments cover")
    };
    let mut t = format!(
        "{}\nClaim {}\n\n\
         CARRIER\nInsurer: {}\nNotice to: {}\n\n\
         POLICY\nPolicy number: {}\nLine of business: {}\n\n\
         INSURED\nName: {}\n\n\
         OCCURRENCE\nDate and time: {}\nLocation: {}, {}\nDescription: {} recorded by BandIt wristbands and venue staff\n\n\
         INJURED / PROPERTY DAMAGED\nClaimant: {}\nCovered cost: {}\nPaid to the claimant: {}\nRecoverable under the policy: {}\nVenue share (deductible): {}\n\n\
         WITNESSES\n",
        form,
        d.claim_id,
        d.insurer_name,
        d.fnol_contact,
        d.policy_number,
        line,
        d.venue_name,
        d.incident_time,
        d.zone_name,
        d.venue_name,
        kind_text(&d.incident_kind),
        d.claimant_name,
        format_cents(a.cost_cents),
        format_cents(a.payout_cents),
        format_cents(a.recoverable_cents),
        format_cents(a.venue_cost_cents),
    );
    let witnesses: Vec<&String> = d.fact_lines.iter().filter(|l| l.contains("] witness = ")).collect();
    if witnesses.is_empty() {
        t.push_str("None recorded\n");
    }
    for w in witnesses {
        t.push_str(w);
        t.push('\n');
    }
    t.push_str("\nOTHER INJURED IN THIS OCCURRENCE\n");
    if d.related_claims.is_empty() {
        t.push_str("None\n");
    }
    for r in &d.related_claims {
        t.push_str(r);
        t.push('\n');
    }
    t.push_str(&format!("\nREMARKS\nDecision: {}\nEvidence pack SHA-256: {}\n\nEVIDENCE FACTS\n", d.decision_text, d.pack_sha256));
    for line in &d.fact_lines {
        t.push_str(line);
        t.push('\n');
    }
    t
}

/// One paragraph for the approver's screen.
pub fn summary_template(d: &LetterData) -> String {
    let d = &plain(d);
    let a = d.amounts;
    format!(
        "Claim {}: {}, {} in {} at {}, policy {} with {}. Covered cost {}; the claimant receives {}, \
         of which {} is recoverable from the insurer and {} is the venue's share. Decision: {}. Evidence pack {}, {} facts.",
        d.claim_id,
        d.claimant_name,
        kind_text(&d.incident_kind),
        d.zone_name,
        d.incident_time,
        d.policy_number,
        d.insurer_name,
        format_cents(a.cost_cents),
        format_cents(a.payout_cents),
        format_cents(a.recoverable_cents),
        format_cents(a.venue_cost_cents),
        d.decision_text,
        short_sha(&d.pack_sha256),
        d.fact_lines.len(),
    )
}

/// The letter to the claimant stating what is paid and why.
pub fn determination_template(d: &LetterData) -> String {
    let d = &plain(d);
    let a = d.amounts;
    let basis = if d.incident_kind == "theft" {
        "Covered costs are the value of what was taken, as venue staff logged it for the incident."
    } else if matches!(d.incident_kind.as_str(), "property" | "breakage") {
        "Covered costs are the repair costs venue staff logged for the incident."
    } else {
        "Medical charges are paid up to the venue's fee schedule for each service, for treatment on or after the incident date."
    };
    let limit = if a.payout_cents < a.cost_cents { " The payment is limited by the policy's per-claim or aggregate limit." } else { "" };
    let which = match d.incident_kind.as_str() {
        "property" | "theft" | "breakage" => "the venue's property policy",
        _ => "the venue's general liability policy",
    };
    format!(
        "Dear {},\n\n\
         This letter is about claim {}: {} in {}, {}, at {}. The claim was handled under {which} \
         {} with {}.\n\n\
         Your covered costs come to {}, and you will be paid {}.\n\n\
         Decision: {}.\n\n\
         Why: {}{}\n\n\
         If you have questions, reply quoting claim {}.\n\n{}\n",
        d.claimant_name,
        d.claim_id,
        kind_text(&d.incident_kind),
        d.zone_name,
        d.venue_name,
        d.incident_time,
        d.policy_number,
        d.insurer_name,
        format_cents(a.cost_cents),
        format_cents(a.payout_cents),
        d.decision_text,
        basis,
        limit,
        d.claim_id,
        d.venue_name,
    )
}

/// A recovery letter worded as a question: what we recorded, what it cost,
/// could you tell us what you saw. Must pass `fault_phrases_in` with no hits.
pub fn recovery_template(d: &LetterData) -> String {
    let d = &plain(d);
    format!(
        "Subject: A question about claim {} at {}\n\n\
         To {} ({}),\n\n\
         We are looking into {} recorded in {}, {}, at {} (claim {}, policy {}, claimant {}). \
         The cost recorded for it is {}. Status: {}.\n\n\
         Was anyone from your team in {} around that time, and could you tell us what you saw?\n\n\
         Thank you,\n{}\n",
        d.claim_id,
        d.venue_name,
        d.counterparty_name,
        d.counterparty_contact,
        kind_text(&d.incident_kind),
        d.zone_name,
        d.venue_name,
        d.incident_time,
        d.claim_id,
        d.policy_number,
        d.claimant_name,
        format_cents(d.amounts.cost_cents),
        d.decision_text,
        d.zone_name,
        d.venue_name,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data() -> LetterData {
        LetterData {
            claim_id: 42,
            pack_sha256: "3b7f0c9e2a41d8f65e0b9c7a1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6".to_string(),
            policy_number: "GL-2026-0412".to_string(),
            insurer_name: "Example Mutual".to_string(),
            fnol_contact: "claims@example.test".to_string(),
            venue_name: "Riverside Fields".to_string(),
            claimant_name: "Maya Chen".to_string(),
            incident_kind: "fall".to_string(),
            zone_name: "Main Stage".to_string(),
            incident_time: "2026-10-24 22:14:05".to_string(),
            amounts: Amounts { cost_cents: 18_000, payout_cents: 18_000, recoverable_cents: 8_000, venue_cost_cents: 10_000 },
            decision_text: "settled automatically under rule v1, approved by Ops desk (ops)".to_string(),
            fact_lines: vec![
                "[1] incident_kind = fall".to_string(),
                "[2] fall_flag = 1".to_string(),
                "[9] note = medic: ice pack and wrap, about $20 in supplies".to_string(),
                "[21] record_billed_cents = 18000".to_string(),
            ],
            counterparty_name: "Stagecraft Rentals".to_string(),
            counterparty_contact: "ops@stagecraft.example".to_string(),
            related_claims: vec![],
        }
    }

    #[test]
    fn finds_dollar_figures() {
        assert_eq!(dollar_figures("$180 and $180.00, then $2,400.00 or $ 75; total $180.00."), [18_000, 18_000, 240_000, 7_500, 18_000]);
        assert_eq!(dollar_figures("costs $1,240, paid $895.5"), [124_000, 89_550]);
        assert_eq!(dollar_figures("$.50 and $12.345"), [50, 1_234]);
        assert!(dollar_figures("a $ sign, $abc, $, $. and US$ alone").is_empty());
        assert_eq!(dollar_figures("$99999999999999999999999"), [Cents::MAX]);
    }

    #[test]
    fn lists_unknown_figures_once() {
        let text = "Paid $180.00, plus $12 and $12.00 again; $80.00 recoverable.";
        assert_eq!(unknown_figures(text, &[18_000, 8_000]), ["$12.00"]);
        assert!(unknown_figures("no money here", &[]).is_empty());
    }

    #[test]
    fn finds_fault_phrases() {
        assert_eq!(fault_phrases_in("This was YOUR FAULT and plainly Negligent."), ["your fault", "negligen"]);
        assert_eq!(fault_phrases_in("we hold\nyou to account"), ["we hold you"]);
        assert!(fault_phrases_in("Could you tell us what you saw?").is_empty());
    }

    #[test]
    fn templates_use_only_the_claim_amounts() {
        let d = data();
        let allowed = d.amounts.figures();
        for (name, text) in [
            ("fnol", fnol_template(&d)),
            ("summary", summary_template(&d)),
            ("determination", determination_template(&d)),
            ("recovery", recovery_template(&d)),
        ] {
            assert!(unknown_figures(&text, &allowed).is_empty(), "{name}: {text}");
            for needed in [&d.claimant_name, &d.zone_name, &d.incident_time, &d.policy_number, &d.decision_text] {
                assert!(text.contains(needed.as_str()), "{name} lacks {needed}: {text}");
            }
        }
    }

    #[test]
    fn fnol_carries_amounts_sha_and_facts() {
        let t = fnol_template(&data());
        for needed in ["Claim 42", "ACORD 3", "OCCURRENCE", "WITNESSES", "Covered cost: $180.00", "Recoverable under the policy: $80.00", "Venue share (deductible): $100.00"] {
            assert!(t.contains(needed), "{needed}");
        }
        assert!(t.contains(&data().pack_sha256));
        assert!(t.contains("[9] note = medic: ice pack and wrap, about USD 20 in supplies\n"));
        assert!(t.ends_with("[21] record_billed_cents = 18000\n"));
        assert!(summary_template(&data()).contains("Evidence pack 3b7f0c9e, 4 facts."));
    }

    #[test]
    fn determination_explains_a_limited_payment() {
        let mut d = data();
        assert!(!determination_template(&d).contains("limited"));
        d.amounts = Amounts { cost_cents: 89_500, payout_cents: 50_000, recoverable_cents: 40_000, venue_cost_cents: 10_000 };
        let t = determination_template(&d);
        assert!(t.contains("Your covered costs come to $895.00, and you will be paid $500.00."));
        assert!(t.contains("limited by the policy's per-claim or aggregate limit"));
        assert!(unknown_figures(&t, &d.amounts.figures()).is_empty());
    }

    #[test]
    fn recovery_letter_is_a_question() {
        let mut d = data();
        d.incident_kind = "property".to_string();
        d.claimant_name = "Riverside Fields".to_string();
        let t = recovery_template(&d);
        assert!(fault_phrases_in(&t).is_empty(), "{t}");
        assert!(t.contains("could you tell us what you saw?"));
        assert!(t.contains("To Stagecraft Rentals (ops@stagecraft.example)"));
        assert!(t.contains("property damage recorded in Main Stage, Riverside Fields, at 2026-10-24 22:14:05"));
        assert!(t.contains("The cost recorded for it is $180.00."));
    }
}
