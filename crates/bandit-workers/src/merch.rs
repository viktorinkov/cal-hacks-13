//! `merch_purchase`: records a merch order as a purchase on the attendee's Nessie account at the
//! BandIt merch merchant. The module has already checked the wallet's balance and holds the amount.
//! Safe to retry: a purchase whose description equals the memo is reused, and the merchant made
//! for the first purchase is remembered in `<data_dir>/nessie/merchant.json`.

use std::path::Path;

use serde::Deserialize;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::nessie::Nessie;
use crate::sink::Finish;

pub const KIND: &str = "merch_purchase";
const MERCHANT_NAME: &str = "BandIt merch";

#[derive(Clone, Debug, Deserialize)]
pub struct PurchasePayload {
    pub order_id: u64,
    pub account_id: String,
    /// Empty until the first purchase has created the merchant.
    pub merchant_id: String,
    pub amount_cents: u64,
    pub memo: String,
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: PurchasePayload) -> Result<(), JobError> {
    let nessie = ctx.nessie.as_ref().ok_or_else(|| JobError::msg("NESSIE_BASE_URL or NESSIE_API_KEY is not set"))?;
    let merchant_id = match p.merchant_id.as_str() {
        "" => merchant(nessie, &ctx.data_dir).await?,
        id => id.to_string(),
    };
    let existing = nessie.purchases(&p.account_id).await?.into_iter().find(|x| x.description == p.memo);
    let purchase_id = match existing {
        Some(x) => {
            tracing::info!(job_id = job.id, purchase_id = %x.id, "purchase already recorded, reusing it");
            x.id
        }
        None => {
            let date = bandit_insurance::time::local_date(spacetimedb_sdk::Timestamp::now().to_micros_since_unix_epoch(), ctx.tz_offset_minutes);
            nessie.purchase(&p.account_id, &merchant_id, p.amount_cents, &date, &p.memo).await?
        }
    };
    tracing::info!(job_id = job.id, order_id = p.order_id, %merchant_id, %purchase_id, "merch purchase recorded");
    ctx.sink.finish(job.id, Finish::MerchPaid { merchant_id, purchase_id }, Vec::new()).await?;
    Ok(())
}

/// The BandIt merch merchant: made once, then read back from the data dir.
async fn merchant(nessie: &Nessie, data_dir: &Path) -> Result<String, JobError> {
    let path = data_dir.join("nessie").join("merchant.json");
    let saved = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<String>(&s).ok());
    if let Some(id) = saved.filter(|id| !id.is_empty()) {
        return Ok(id);
    }
    let id = nessie.create_merchant(MERCHANT_NAME).await?;
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        std::fs::write(&path, serde_json::to_vec(&id)?)
    };
    write().map_err(|e| JobError::msg(format!("saving {}: {e}", path.display())))?;
    Ok(id)
}
