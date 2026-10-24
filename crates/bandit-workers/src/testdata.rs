//! The payload files under `testdata/`, shared by the unit tests and `--once` runs.

use hyphenate_core::letters::LetterData;
use hyphenate_core::payloads::*;

fn load<T: serde::de::DeserializeOwned>(json: &str) -> T {
    serde_json::from_str(json).unwrap()
}

/// Jordan Alvarez's wrist claim after the urgent care record was read.
pub fn review_payload() -> ReviewPayload {
    load(include_str!("../testdata/review-wrist.json"))
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
    load::<RecordExtractPayload>(include_str!("../testdata/record-extract.json"));
    load::<ReviewPayload>(include_str!("../testdata/review-ankle-home.json"));
    load::<ReviewPayload>(include_str!("../testdata/review-first-aid.json"));
    let payout = load::<PayoutPayload>(include_str!("../testdata/payout.json"));
    assert_eq!((payout.claimant_name.as_str(), payout.payout_cents), ("Maya Chen", 18_000));
    let wallet = load::<crate::wallet::WalletPayload>(include_str!("../testdata/wallet.json"));
    assert_eq!(wallet.opening_cents, 20_000);
    let merch = load::<crate::merch::PurchasePayload>(include_str!("../testdata/merch.json"));
    assert_eq!((merch.order_id, merch.amount_cents), (900_104, 2_500));
}
