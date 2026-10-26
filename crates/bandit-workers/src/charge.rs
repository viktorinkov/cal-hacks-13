//! `charge_payment`: the charged attendee pays a charge from their wallet, a purchase on their Nessie
//! account at a merchant named after the venue. The module has already checked the wallet's balance
//! and holds the amount. Safe to retry: a customer and account made for a charge are remembered in
//! `<data_dir>/nessie/<database>-charge-<id>.json` until the module stores them, the venue's merchant
//! is made once and remembered in `<data_dir>/nessie/merchant-<slug>.json`, and a purchase whose
//! description equals the memo is reused.

use std::path::{Path, PathBuf};

use bandit_insurance::payloads::ChargePaymentPayload;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::nessie::{Nessie, split_name};
use crate::payout::{load_made, save_made};
use crate::sink::Finish;

/// The merchant's name when the venue has none yet.
const FALLBACK_MERCHANT: &str = "BandIt venue";

/// Keyed by database too, so a republished database never reuses another's account.
fn made_path(data_dir: &Path, charge_id: u64) -> PathBuf {
    let db = std::env::var("SPACETIMEDB_DATABASE").unwrap_or_default();
    data_dir.join("nessie").join(format!("{db}-charge-{charge_id}.json"))
}

/// `The Midway SF` -> `the-midway-sf`.
fn slug(name: &str) -> String {
    let lower = name.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).collect();
    if words.is_empty() { "venue".into() } else { words.join("-") }
}

fn merchant_path(data_dir: &Path, name: &str) -> PathBuf {
    data_dir.join("nessie").join(format!("merchant-{}.json", slug(name)))
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: ChargePaymentPayload) -> Result<(), JobError> {
    let nessie = ctx.nessie.as_ref().ok_or_else(|| JobError::msg("NESSIE_BASE_URL or NESSIE_API_KEY is not set"))?;
    if p.amount_cents == 0 {
        return Err(JobError::msg("nothing to pay"));
    }
    let (customer_id, account_id) = account(nessie, &ctx.data_dir, &p).await?;
    let name = if p.merchant_name.trim().is_empty() { FALLBACK_MERCHANT } else { p.merchant_name.trim() };
    let merchant_id = merchant(nessie, &ctx.data_dir, name).await?;
    let existing = nessie.purchases(&account_id).await?.into_iter().find(|x| x.description == p.memo);
    let purchase_id = match existing {
        Some(x) => {
            tracing::info!(job_id = job.id, purchase_id = %x.id, "charge purchase already recorded, reusing it");
            x.id
        }
        None => {
            let date = bandit_insurance::time::local_date(spacetimedb_sdk::Timestamp::now().to_micros_since_unix_epoch(), ctx.tz_offset_minutes);
            nessie.purchase(&account_id, &merchant_id, p.amount_cents, &date, &p.memo).await?
        }
    };
    tracing::info!(job_id = job.id, charge_id = p.charge_id, %customer_id, %account_id, %merchant_id, %purchase_id, "charge paid");
    ctx.sink.finish(job.id, Finish::ChargePaid { customer_id, account_id, purchase_id }, Vec::new()).await?;
    Ok(())
}

/// The payer's customer and account: from the payload, from an earlier attempt, or made now with
/// nothing in it.
async fn account(nessie: &Nessie, data_dir: &Path, p: &ChargePaymentPayload) -> Result<(String, String), JobError> {
    if !p.account_id.is_empty() {
        return Ok((p.customer_id.clone(), p.account_id.clone()));
    }
    let path = made_path(data_dir, p.charge_id);
    let mut made = load_made(&path);
    if made.customer_id.is_empty() {
        let (first, last) = split_name(&p.payer_name);
        made.customer_id = nessie.create_customer(&first, &last).await?;
        save_made(&path, &made)?;
    }
    if made.account_id.is_empty() {
        made.account_id = nessie.create_wallet(&made.customer_id, 0).await?;
        save_made(&path, &made)?;
    }
    Ok((made.customer_id, made.account_id))
}

/// The venue's merchant: made once, then read back from the data dir.
async fn merchant(nessie: &Nessie, data_dir: &Path, name: &str) -> Result<String, JobError> {
    let path = merchant_path(data_dir, name);
    let saved = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<String>(&s).ok());
    if let Some(id) = saved.filter(|id| !id.is_empty()) {
        return Ok(id);
    }
    let id = nessie.create_merchant(name).await?;
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        std::fs::write(&path, serde_json::to_vec(&id)?)
    };
    write().map_err(|e| JobError::msg(format!("saving {}: {e}", path.display())))?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payout::Made;

    #[test]
    fn made_ids_round_trip() {
        let dir = std::env::temp_dir().join(format!("bandit-workers-charge-test-{}", std::process::id()));
        let path = made_path(&dir, 3);
        assert!(path.to_string_lossy().ends_with("-charge-3.json"));
        assert_eq!(load_made(&path), Made::default());
        let made = Made { customer_id: "c1".into(), account_id: "a1".into() };
        save_made(&path, &made).ok().unwrap();
        assert_eq!(load_made(&path), made);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn merchant_file_is_named_after_the_venue() {
        let dir = Path::new("data");
        assert_eq!(merchant_path(dir, "The Midway SF"), dir.join("nessie").join("merchant-the-midway-sf.json"));
        assert_eq!(slug("  Pier 70 -- Hall B "), "pier-70-hall-b");
        assert_eq!(slug("***"), "venue");
    }
}
