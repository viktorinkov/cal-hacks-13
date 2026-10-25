//! The payload files under `testdata/`, shared by the unit tests and `--once` runs.

use bandit_insurance::letters::LetterData;
use bandit_insurance::payloads::*;

fn load<T: serde::de::DeserializeOwned>(json: &str) -> T {
    serde_json::from_str(json).unwrap()
}

/// Jordan Alvarez's wrist claim after the urgent care record was read.
pub fn review_payload() -> ReviewPayload {
    load(include_str!("../testdata/review-wrist.json"))
}

/// The hospital report for Jordan Alvarez's fall, drawn to match the incident.
pub fn clinic_payload() -> ClinicPayload {
    load(include_str!("../testdata/clinic.json"))
}

/// Maya Chen's laptop stolen from a table on the Hacking floor, with Sam Patel named by security.
pub fn theft_review_payload() -> ReviewPayload {
    load(include_str!("../testdata/review-theft.json"))
}

pub fn verify_payload() -> VerifyPayload {
    load(include_str!("../testdata/verify.json"))
}

/// The letter data of Jordan Alvarez's approved claim.
pub fn letter_data() -> LetterData {
    load::<DraftPayload>(include_str!("../testdata/draft.json")).letter
}

/// The property claim's letter data, with the counterparty.
pub fn recovery_data() -> LetterData {
    load::<RecoveryPayload>(include_str!("../testdata/recovery.json")).letter
}

#[test]
fn every_payload_file_parses() {
    load::<ReviewPayload>(include_str!("../testdata/review-ankle-home.json"));
    load::<ReviewPayload>(include_str!("../testdata/review-first-aid.json"));
    let theft = theft_review_payload();
    assert_eq!((theft.cover_kind.as_str(), theft.charge.as_ref().map(|c| c.amount_cents)), ("personal_property", Some(119_900)));
    let payout = load::<PayoutPayload>(include_str!("../testdata/payout.json"));
    assert_eq!((payout.claimant_name.as_str(), payout.payout_cents), ("Maya Chen", 18_000));
    let wallet = load::<crate::wallet::WalletPayload>(include_str!("../testdata/wallet.json"));
    assert_eq!(wallet.opening_cents, 20_000);
    let merch = load::<crate::merch::PurchasePayload>(include_str!("../testdata/merch.json"));
    assert_eq!((merch.order_id, merch.amount_cents), (900_104, 2_500));
}
