//! The attendee's BandIt wallet: a Nessie sandbox account opened with $200 when the attendee saves
//! their name, spent on merch after the event, and paid into by injury claims. Nessie holds the
//! accounts and records every purchase and deposit; the sandbox never moves an account's balance
//! field, so the balance shown is the sum of the wallet's entries here, exact and live.

use crate::insurance::*;
use crate::jobs::{self, *};
use crate::roles::*;
use crate::social::tables::*;
use crate::tables::*;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

pub const KIND_WALLET_OPEN: &str = "wallet_open";
/// $200 in every new wallet.
pub const OPENING_CENTS: u64 = 20_000;

/// One movement of money in a wallet.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = wallet_entry)]
pub struct WalletEntry {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub identity: Identity,
    /// `opening`, `purchase` or `payout`.
    pub kind: String,
    /// Money in is positive, money out negative.
    pub amount_cents: i64,
    pub memo: String,
    /// The Nessie account, purchase or deposit.
    pub nessie_id: String,
    pub created_at: Timestamp,
}

/// Queues the wallet for an attendee who has none and none on the way.
pub fn open_for(ctx: &ReducerContext, a: &Attendee) {
    if a.crowd || ctx.db.claimant_account().identity().find(a.identity).is_some() {
        return;
    }
    if ctx.db.job().kind().filter(KIND_WALLET_OPEN).any(|j| j.open && j.subject_id == a.node_id) {
        return;
    }
    let payload = serde_json::json!({ "name": a.display_name, "opening_cents": OPENING_CENTS });
    jobs::enqueue(ctx, KIND_WALLET_OPEN, payload.to_string(), "attendee", a.node_id);
}

/// The attendee connects their Capital One wallet during band setup; the worker opens it on Nessie.
#[spacetimedb::reducer]
pub fn connect_wallet(ctx: &ReducerContext) -> Result<(), String> {
    let a = ctx.db.attendee().identity().find(ctx.sender()).ok_or("claim your band first")?;
    if a.display_name.is_empty() {
        return Err("add your name first".into());
    }
    open_for(ctx, &a);
    Ok(())
}

/// The worker opened the Nessie customer and account.
#[spacetimedb::reducer]
pub fn record_wallet(ctx: &ReducerContext, job_id: u64, customer_id: String, account_id: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let a = ctx.db.attendee().node_id().find(job.subject_id).ok_or("no such attendee")?;
    jobs::finish(ctx, job, account_id.clone());
    if ctx.db.claimant_account().identity().find(a.identity).is_some() {
        return Ok(());
    }
    ctx.db.claimant_account().insert(ClaimantAccount { identity: a.identity, customer_id, account_id: account_id.clone(), created_at: ctx.timestamp });
    add_entry(ctx, a.identity, "opening", OPENING_CENTS as i64, "BandIt wallet opened".into(), account_id);
    Ok(())
}

/// An injury payout landed in the claimant's account.
pub fn on_payout(ctx: &ReducerContext, identity: Identity, claim_id: u64, cents: u64, deposit_id: String) {
    add_entry(ctx, identity, "payout", cents as i64, format!("BandIt claim {claim_id} payout"), deposit_id);
}

pub fn add_entry(ctx: &ReducerContext, identity: Identity, kind: &str, amount_cents: i64, memo: String, nessie_id: String) {
    ctx.db.wallet_entry().insert(WalletEntry { id: 0, identity, kind: kind.into(), amount_cents, memo, nessie_id, created_at: ctx.timestamp });
}

/// What the wallet can still spend: its entries less the merch orders being paid.
pub fn spendable(ctx: &ReducerContext, who: Identity) -> i64 {
    let entries: i64 = ctx.db.wallet_entry().identity().filter(who).map(|e| e.amount_cents).sum();
    entries - crate::merch::held_cents(ctx, who)
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct MyWallet {
    pub account_id: String,
    /// What the wallet can spend now.
    pub balance_cents: i64,
    pub opened_at: Timestamp,
}

#[spacetimedb::view(accessor = my_wallet, public)]
pub fn my_wallet(ctx: &ViewContext) -> Option<MyWallet> {
    let me = ctx.sender();
    let account = ctx.db.claimant_account().identity().find(me)?;
    Some(MyWallet { account_id: account.account_id, balance_cents: balance(ctx, me), opened_at: account.created_at })
}

fn balance(ctx: &ViewContext, who: Identity) -> i64 {
    let entries: i64 = ctx.db.wallet_entry().identity().filter(who).map(|e| e.amount_cents).sum();
    entries - crate::merch::my_held_cents(ctx, who)
}

/// One attendee's wallet, for the organizer buying merch as them.
#[derive(SpacetimeType, Clone, Debug)]
pub struct BoardWallet {
    pub node_id: u64,
    pub account_id: String,
    pub balance_cents: i64,
}

/// Every attendee's wallet and what it can spend, for the organizer (ops) only.
#[spacetimedb::view(accessor = board_wallets, public)]
pub fn board_wallets(ctx: &ViewContext) -> Vec<BoardWallet> {
    let ops = ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| r.role == "ops");
    if !ops {
        return Vec::new();
    }
    ctx.db
        .attendee()
        .person_id()
        .filter(0u64..)
        .filter_map(|a| {
            let account = ctx.db.claimant_account().identity().find(a.identity)?;
            Some(BoardWallet { node_id: a.node_id, account_id: account.account_id, balance_cents: balance(ctx, a.identity) })
        })
        .collect()
}

/// The wallet's movements, oldest first.
#[spacetimedb::view(accessor = my_wallet_entries, public)]
pub fn my_wallet_entries(ctx: &ViewContext) -> Vec<WalletEntry> {
    ctx.db.wallet_entry().identity().filter(ctx.sender()).collect()
}
