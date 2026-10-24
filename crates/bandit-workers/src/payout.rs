//! `claim_payout`: deposits an injury payout into the claimant's Nessie account.
//! Safe to retry: a customer and account made for a claim are remembered in
//! `<data_dir>/nessie/<database>-claim-<id>.json` until the module stores them, and a
//! deposit whose description equals the memo is reused.

use std::path::{Path, PathBuf};

use hyphenate_core::payloads::PayoutPayload;
use serde::{Deserialize, Serialize};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::nessie::{Nessie, split_name};
use crate::sink::Finish;

/// The Nessie ids made for one claim.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Made {
    customer_id: String,
    account_id: String,
}

/// Keyed by database too, so a republished database never reuses another's deposit.
fn made_path(data_dir: &Path, claim_id: u64) -> PathBuf {
    let db = std::env::var("SPACETIMEDB_DATABASE").unwrap_or_default();
    data_dir.join("nessie").join(format!("{db}-claim-{claim_id}.json"))
}

fn load_made(path: &Path) -> Made {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_made(path: &Path, made: &Made) -> Result<(), JobError> {
    let write = || -> std::io::Result<()> {
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        std::fs::write(path, serde_json::to_vec(made)?)
    };
    write().map_err(|e| JobError::msg(format!("saving {}: {e}", path.display())))
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: PayoutPayload) -> Result<(), JobError> {
    let nessie = ctx.nessie.as_ref().ok_or_else(|| JobError::msg("NESSIE_BASE_URL or NESSIE_API_KEY is not set"))?;
    if p.payout_cents == 0 {
        return Err(JobError::msg("nothing to pay"));
    }
    let (customer_id, account_id) = account(nessie, &ctx.data_dir, &p).await?;
    let date = hyphenate_core::time::local_date(spacetimedb_sdk::Timestamp::now().to_micros_since_unix_epoch(), ctx.tz_offset_minutes);
    let existing = nessie.deposits(&account_id).await?.into_iter().find(|d| d.description == p.memo);
    let deposit_id = match existing {
        Some(d) => {
            tracing::info!(job_id = job.id, deposit_id = %d.id, "deposit already made, reusing it");
            d.id
        }
        None => nessie.deposit(&account_id, p.payout_cents, &date, &p.memo).await?,
    };
    tracing::info!(job_id = job.id, claim_id = p.claim_id, %customer_id, %account_id, %deposit_id, "payout deposited");
    ctx.sink.finish(job.id, Finish::ClaimPayout { customer_id, account_id, deposit_id }, Vec::new()).await?;
    Ok(())
}

/// The claimant's customer and account: from the payload, from an earlier
/// attempt, or made now.
async fn account(nessie: &Nessie, data_dir: &Path, p: &PayoutPayload) -> Result<(String, String), JobError> {
    if !p.account_id.is_empty() {
        return Ok((p.customer_id.clone(), p.account_id.clone()));
    }
    let path = made_path(data_dir, p.claim_id);
    let mut made = load_made(&path);
    if made.customer_id.is_empty() {
        let (first, last) = split_name(&p.claimant_name);
        made.customer_id = nessie.create_customer(&first, &last).await?;
        save_made(&path, &made)?;
    }
    if made.account_id.is_empty() {
        made.account_id = nessie.create_wallet(&made.customer_id).await?;
        save_made(&path, &made)?;
    }
    Ok((made.customer_id, made.account_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn made_ids_round_trip() {
        let dir = std::env::temp_dir().join(format!("bandit-workers-test-{}", std::process::id()));
        let path = made_path(&dir, 7);
        assert_eq!(load_made(&path), Made::default());
        let made = Made { customer_id: "c1".into(), account_id: "a1".into() };
        save_made(&path, &made).ok().unwrap();
        assert_eq!(load_made(&path), made);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
