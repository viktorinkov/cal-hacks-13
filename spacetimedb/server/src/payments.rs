use crate::commands::enqueue;
use crate::log_event;
use crate::tables::*;
use spacetimedb::{ReducerContext, Table, TimeDuration};

const PROMPT_MICROS: i64 = 8_000_000;

#[spacetimedb::reducer]
pub fn request_payment(ctx: &ReducerContext, band_id: u8, amount_cents: u32, merchant: String) -> Result<(), String> {
    if band_id == 0 || band_id > BAND_ID_MAX {
        return Err(format!("band id {band_id} out of range"));
    }
    for p in ctx.db.payment().band_id().filter(band_id).filter(|p| p.status == PaymentStatus::Pending).collect::<Vec<_>>() {
        ctx.db.payment().id().update(Payment { status: PaymentStatus::Declined, ..p });
    }
    ctx.db.payment().insert(Payment {
        id: 0,
        band_id,
        amount_cents,
        merchant,
        status: PaymentStatus::Pending,
        created: ctx.timestamp,
        expires: ctx.timestamp + TimeDuration::from_micros(PROMPT_MICROS),
        approved_at: None,
        purchase_ref: None,
    });
    enqueue(ctx, band_id, "pay", 0, 0);
    Ok(())
}

pub(crate) fn on_press(ctx: &ReducerContext, band_id: u8) {
    let now = micros(ctx.timestamp);
    let pending = ctx
        .db
        .payment()
        .band_id()
        .filter(band_id)
        .filter(|p| p.status == PaymentStatus::Pending && micros(p.expires) >= now)
        .max_by_key(|p| p.id);
    if let Some(p) = pending {
        log_event(ctx, band_id, EventKind::PaymentApproved, format!("payment {} {} cents {}", p.id, p.amount_cents, p.merchant));
        ctx.db.payment().id().update(Payment { status: PaymentStatus::Approved, approved_at: Some(ctx.timestamp), ..p });
    }
}

#[spacetimedb::reducer]
pub fn complete_payment(ctx: &ReducerContext, payment_id: u64, purchase_ref: String) -> Result<(), String> {
    let Some(p) = ctx.db.payment().id().find(payment_id) else {
        return Err(format!("no payment {payment_id}"));
    };
    if p.status != PaymentStatus::Approved {
        return Err(format!("payment {payment_id} is {:?}, not approved", p.status));
    }
    log_event(ctx, p.band_id, EventKind::PaymentCompleted, format!("payment {} {purchase_ref}", p.id));
    enqueue(ctx, p.band_id, "paid", 0, 0);
    ctx.db.payment().id().update(Payment { status: PaymentStatus::Completed, purchase_ref: Some(purchase_ref), ..p });
    Ok(())
}

#[spacetimedb::reducer]
pub fn decline_payment(ctx: &ReducerContext, payment_id: u64) -> Result<(), String> {
    let Some(p) = ctx.db.payment().id().find(payment_id) else {
        return Err(format!("no payment {payment_id}"));
    };
    if matches!(p.status, PaymentStatus::Pending | PaymentStatus::Approved) {
        log_event(ctx, p.band_id, EventKind::PaymentDeclined, format!("payment {}", p.id));
        ctx.db.payment().id().update(Payment { status: PaymentStatus::Declined, ..p });
    }
    Ok(())
}

pub(crate) fn expire(ctx: &ReducerContext) {
    let now = micros(ctx.timestamp);
    for p in ctx.db.payment().iter().filter(|p| p.status == PaymentStatus::Pending && micros(p.expires) < now).collect::<Vec<_>>() {
        log_event(ctx, p.band_id, EventKind::PaymentDeclined, format!("payment {} timed out", p.id));
        ctx.db.payment().id().update(Payment { status: PaymentStatus::Declined, ..p });
    }
}
