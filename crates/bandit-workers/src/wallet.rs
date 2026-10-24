//! `wallet_open`: opens a new attendee's BandIt wallet, a Nessie customer with a checking account
//! funded with the opening amount. Safe to retry: the ids made for a job are remembered in
//! `<data_dir>/nessie/wallet-job-<id>.json` until the module stores them.

use serde::Deserialize;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::nessie::split_name;
use crate::payout::{load_made, save_made};
use crate::sink::Finish;

pub const KIND: &str = "wallet_open";

#[derive(Clone, Debug, Deserialize)]
pub struct WalletPayload {
    pub name: String,
    pub opening_cents: u64,
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: WalletPayload) -> Result<(), JobError> {
    let nessie = ctx.nessie.as_ref().ok_or_else(|| JobError::msg("NESSIE_BASE_URL or NESSIE_API_KEY is not set"))?;
    let path = ctx.data_dir.join("nessie").join(format!("wallet-job-{}.json", job.id));
    let mut made = load_made(&path);
    if made.customer_id.is_empty() {
        let (first, last) = split_name(&p.name);
        made.customer_id = nessie.create_customer(&first, &last).await?;
        save_made(&path, &made)?;
    }
    if made.account_id.is_empty() {
        made.account_id = nessie.create_wallet(&made.customer_id, p.opening_cents).await?;
        save_made(&path, &made)?;
    }
    tracing::info!(job_id = job.id, customer_id = %made.customer_id, account_id = %made.account_id, "wallet opened");
    ctx.sink.finish(job.id, Finish::WalletOpened { customer_id: made.customer_id, account_id: made.account_id }, Vec::new()).await?;
    Ok(())
}
