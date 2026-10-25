//! Where a handler's result goes: the module's reducers, or stdout in `--once` mode.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use bandit_bindings::*;
use bandit_common::BlobInfo;
use serde_json::{Value, json};
use tokio::sync::oneshot;

use crate::model::new_call;

/// The one result reducer a handler ends with.
#[derive(Clone, Debug)]
pub enum Finish {
    MedicalRecord { record_json: String },
    ClaimChecks { checks: Vec<CheckIn>, precedents: Vec<PrecedentIn> },
    ClaimReview { review_json: String },
    ClaimLetters { fnol_hash: String, summary_hash: String, determination_hash: String },
    RecoveryLetter { hash: String },
    ClaimPayout { customer_id: String, account_id: String, deposit_id: String },
    WalletOpened { customer_id: String, account_id: String },
    MerchPaid { merchant_id: String, purchase_id: String },
    MedicalCard { card_json: String },
    VenueSetup { result: VenueSetupResult },
    ClinicReport { record_json: String, file_hash: String },
    PhotoFeatures { people_count: u32, caption: String },
    MerchPicks { picks: Vec<MerchPickIn> },
    DocumentTerms { read_json: String, pages: Vec<String> },
    RuleProposal { proposal_json: String },
}

pub enum Sink {
    Db(Arc<DbConnection>),
    Print,
}

/// How long to wait for a reducer's answer.
const REDUCER_TIMEOUT: Duration = Duration::from_secs(30);

/// What a reducer answered: its own result, or an SDK error `E`.
type Answered<E> = Result<Result<(), String>, E>;
/// Where the reducer's result arrives.
pub type Reply = oneshot::Receiver<Result<(), String>>;

/// A reducer callback that forwards the outcome, and the receiver to await it on.
pub fn waiter<E: std::fmt::Debug>() -> (impl FnOnce(&ReducerEventContext, Answered<E>) + Send + 'static, Reply) {
    let (tx, rx) = oneshot::channel();
    let cb = move |_: &ReducerEventContext, r: Answered<E>| {
        let _ = tx.send(r.unwrap_or_else(|e| Err(format!("{e:?}"))));
    };
    (cb, rx)
}

/// Waits for the reducer `name` invoked with `sent`.
pub async fn wait(name: &str, sent: spacetimedb_sdk::Result<()>, rx: Reply) -> Result<()> {
    sent.map_err(|e| anyhow!("{name}: could not send: {e:?}"))?;
    match tokio::time::timeout(REDUCER_TIMEOUT, rx).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(e))) => bail!("{name} failed: {e}"),
        Ok(Err(_)) => bail!("{name}: the connection dropped the callback"),
        Err(_) => bail!("{name}: no answer within {}s", REDUCER_TIMEOUT.as_secs()),
    }
}

/// Calls a reducer by its `_then` method and waits for it.
macro_rules! reduce {
    ($conn:expr, $name:ident ( $($arg:expr),* )) => {{
        let (cb, rx) = $crate::sink::waiter();
        $crate::sink::wait(stringify!($name), $conn.reducers.$name($($arg,)* cb), rx).await
    }};
}
pub(crate) use reduce;

impl Sink {
    /// Registers a text blob the handler stored (a letter or a hospital report) for staff.
    pub async fn register_text(&self, blob: &BlobInfo, purpose: &str) -> Result<()> {
        let (hash, size) = (blob.sha256.clone(), blob.size_bytes);
        match self {
            Sink::Db(conn) => reduce!(conn, register_blob_then(hash, None, "staff".into(), purpose.into(), "text/plain".into(), size)),
            Sink::Print => {
                print_call("register_blob", json!({"hash": hash, "owner": null, "access": "staff", "purpose": purpose, "content_type": "text/plain", "size_bytes": size}));
                Ok(())
            }
        }
    }

    /// Registers a file anyone with its link may load, such as a venue model.
    pub async fn register_shared(&self, blob: &BlobInfo, purpose: &str, content_type: &str) -> Result<()> {
        let (hash, size) = (blob.sha256.clone(), blob.size_bytes);
        match self {
            Sink::Db(conn) => reduce!(conn, register_blob_then(hash, None, "shared".into(), purpose.into(), content_type.into(), size)),
            Sink::Print => {
                print_call("register_blob", json!({"hash": hash, "owner": null, "access": "shared", "purpose": purpose, "content_type": content_type, "size_bytes": size}));
                Ok(())
            }
        }
    }

    /// Reports a step of a venue setup run, so the portal shows it as it happens.
    pub async fn step(&self, job_id: u64, name: String, detail: String) -> Result<()> {
        match self {
            Sink::Db(conn) => reduce!(conn, report_venue_setup_step_then(job_id, name, detail)),
            Sink::Print => {
                print_call("report_venue_setup_step", json!({"job_id": job_id, "name": name, "detail": detail}));
                Ok(())
            }
        }
    }

    /// Reports a step of a claim's investigation, so the decision history shows it as it happens.
    pub async fn claim_step(&self, job_id: u64, step: &bandit_insurance::decision::Step) -> Result<()> {
        let (actor, what, why) = (step.actor.clone(), step.summary.clone(), step.detail.clone());
        match self {
            Sink::Db(conn) => reduce!(conn, report_claim_step_then(job_id, actor, what, why)),
            Sink::Print => {
                print_call("report_claim_step", json!({"job_id": job_id, "actor": actor, "what": what, "why": why}));
                Ok(())
            }
        }
    }

    /// Calls the result reducer. The last call record goes with it; earlier
    /// ones (rejected first answers) are recorded with `record_model_call`.
    pub async fn finish(&self, job_id: u64, finish: Finish, mut calls: Vec<ModelCallIn>) -> Result<()> {
        // The venue setup and document reducers take no call record, so their last call is recorded too.
        let last = if matches!(finish, Finish::VenueSetup { .. } | Finish::DocumentTerms { .. }) { None } else { calls.pop() };
        for call in calls {
            self.record_call(call).await?;
        }
        let Sink::Db(conn) = self else {
            print_finish(job_id, &finish, last.as_ref());
            return Ok(());
        };
        let required = || last.clone().unwrap_or_else(|| new_call("none"));
        match finish {
            Finish::MedicalRecord { record_json } => reduce!(conn, apply_medical_record_then(job_id, record_json, required())),
            Finish::ClaimChecks { checks, precedents } => reduce!(conn, submit_claim_checks_then(job_id, checks, precedents)),
            Finish::ClaimReview { review_json } => reduce!(conn, submit_claim_review_then(job_id, review_json, required())),
            Finish::ClaimLetters { fnol_hash, summary_hash, determination_hash } => {
                reduce!(conn, attach_claim_letters_then(job_id, fnol_hash, summary_hash, determination_hash, last))
            }
            Finish::RecoveryLetter { hash } => reduce!(conn, attach_recovery_letter_then(job_id, hash, last)),
            Finish::ClaimPayout { customer_id, account_id, deposit_id } => {
                reduce!(conn, record_claim_payout_then(job_id, customer_id, account_id, deposit_id))
            }
            Finish::WalletOpened { customer_id, account_id } => reduce!(conn, record_wallet_then(job_id, customer_id, account_id)),
            Finish::MerchPaid { merchant_id, purchase_id } => reduce!(conn, settle_merch_order_then(job_id, merchant_id, purchase_id)),
            Finish::MedicalCard { card_json } => reduce!(conn, apply_medical_extract_then(job_id, card_json, required())),
            Finish::VenueSetup { result } => reduce!(conn, finish_venue_setup_then(job_id, result)),
            Finish::ClinicReport { record_json, file_hash } => reduce!(conn, file_clinic_report_then(job_id, record_json, file_hash, required())),
            Finish::PhotoFeatures { people_count, caption } => reduce!(conn, submit_photo_features_then(job_id, people_count, caption, required())),
            Finish::MerchPicks { picks } => reduce!(conn, submit_merch_picks_then(job_id, picks, required())),
            Finish::DocumentTerms { read_json, pages } => reduce!(conn, apply_document_terms_then(job_id, read_json, pages)),
            Finish::RuleProposal { proposal_json } => reduce!(conn, submit_rule_proposal_then(job_id, proposal_json, required())),
        }
        .with_context(|| format!("finishing job {job_id}"))
    }

    /// Reports a failed attempt; the module retries with back-off.
    pub async fn fail(&self, job_id: u64, error: String, mut calls: Vec<ModelCallIn>) -> Result<()> {
        let last = calls.pop();
        for call in calls {
            self.record_call(call).await?;
        }
        match self {
            Sink::Db(conn) => reduce!(conn, fail_job_then(job_id, error, last)),
            Sink::Print => {
                print_call("fail_job", json!({"job_id": job_id, "error": error, "call": last.as_ref().map(call_json)}));
                Ok(())
            }
        }
    }

    async fn record_call(&self, call: ModelCallIn) -> Result<()> {
        match self {
            Sink::Db(conn) => reduce!(conn, record_model_call_then(call)),
            Sink::Print => {
                print_call("record_model_call", json!({"call": call_json(&call)}));
                Ok(())
            }
        }
    }
}

/// A call record for printing; the response text is shown by its length.
pub fn call_json(c: &ModelCallIn) -> Value {
    json!({
        "kind": c.kind, "model_requested": c.model_requested, "model_used": c.model_used, "effort": c.effort,
        "request_hash": c.request_hash, "status": c.status, "stop_reason": c.stop_reason,
        "input_tokens": c.input_tokens, "output_tokens": c.output_tokens, "latency_ms": c.latency_ms,
        "response_chars": c.response.chars().count(), "error": c.error,
    })
}

fn print_call(reducer: &str, args: Value) {
    let line = json!({"reducer": reducer, "args": args});
    println!("{}", serde_json::to_string_pretty(&line).unwrap_or_default());
}

fn print_finish(job_id: u64, finish: &Finish, call: Option<&ModelCallIn>) {
    let call = call.map(call_json);
    let (reducer, args) = match finish {
        Finish::MedicalRecord { record_json } => ("apply_medical_record", json!({"record_json": parse_or_text(record_json), "call": call})),
        Finish::ClaimChecks { checks, precedents } => (
            "submit_claim_checks",
            json!({
                "checks": checks.iter().map(|c| json!({"name": c.name, "result": c.result, "detail": c.detail})).collect::<Vec<_>>(),
                "precedents": precedents.iter().map(|p| json!({"reference": p.reference, "outcome": p.outcome, "payout_cents": p.payout_cents, "narrative": p.narrative, "score": p.score})).collect::<Vec<_>>(),
            }),
        ),
        Finish::ClaimReview { review_json } => ("submit_claim_review", json!({"review_json": parse_or_text(review_json), "call": call})),
        Finish::ClaimLetters { fnol_hash, summary_hash, determination_hash } => (
            "attach_claim_letters",
            json!({"fnol_hash": fnol_hash, "summary_hash": summary_hash, "determination_hash": determination_hash, "call": call}),
        ),
        Finish::RecoveryLetter { hash } => ("attach_recovery_letter", json!({"recovery_hash": hash, "call": call})),
        Finish::ClaimPayout { customer_id, account_id, deposit_id } => {
            ("record_claim_payout", json!({"customer_id": customer_id, "account_id": account_id, "deposit_id": deposit_id}))
        }
        Finish::WalletOpened { customer_id, account_id } => ("record_wallet", json!({"customer_id": customer_id, "account_id": account_id})),
        Finish::MerchPaid { merchant_id, purchase_id } => ("settle_merch_order", json!({"merchant_id": merchant_id, "purchase_id": purchase_id})),
        Finish::MedicalCard { card_json } => ("apply_medical_extract", json!({"card_json": parse_or_text(card_json), "call": call})),
        Finish::ClinicReport { record_json, file_hash } => {
            ("file_clinic_report", json!({"record_json": parse_or_text(record_json), "file_hash": file_hash, "call": call}))
        }
        Finish::VenueSetup { result: r } => (
            "finish_venue_setup",
            json!({
                "event_site": r.event_site, "venue_name": r.venue_name, "address": r.address, "map_url": r.map_url,
                "method": r.method, "model_hash": r.model_hash, "layout_hash": r.layout_hash, "model_bytes": r.model_bytes,
                "meshes": r.meshes, "triangles": r.triangles, "places": r.places, "size": [r.size_x, r.size_y, r.size_z],
                "floor_plans": r.floor_plans, "sources": r.sources.iter().map(|f| json!({"label": f.label, "value": f.value})).collect::<Vec<_>>(),
            }),
        ),
        Finish::PhotoFeatures { people_count, caption } => ("submit_photo_features", json!({"people_count": people_count, "caption": caption, "call": call})),
        Finish::MerchPicks { picks } => (
            "submit_merch_picks",
            json!({
                "picks": picks.iter().map(|p| json!({"template_id": p.template_id, "photo_id": p.photo_id, "line": p.line, "reason": p.reason})).collect::<Vec<_>>(),
                "call": call,
            }),
        ),
        Finish::DocumentTerms { read_json, pages } => ("apply_document_terms", json!({"read_json": parse_or_text(read_json), "pages": pages})),
        Finish::RuleProposal { proposal_json } => ("submit_rule_proposal", json!({"proposal_json": parse_or_text(proposal_json), "call": call})),
    };
    let mut args = args;
    args["job_id"] = json!(job_id);
    print_call(reducer, args);
}

fn parse_or_text(s: &str) -> Value {
    serde_json::from_str(s).unwrap_or_else(|_| Value::String(s.to_string()))
}
