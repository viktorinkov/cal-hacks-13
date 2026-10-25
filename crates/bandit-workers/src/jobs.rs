//! What a handler gets (the job and the clients) and how it fails.

use std::path::PathBuf;

use bandit_bindings::ModelCallIn;
use bandit_common::BlobStore;
use claims_elastic::ClaimsIndex;
use bandit_insurance::payloads::*;
use serde::de::DeserializeOwned;

use crate::model::{Claude, Failed};
use crate::nessie::Nessie;
use crate::sink::Sink;
use crate::{charge, clinic, extract, investigate, letters, medical, merch, payout, photo, shop, venue, verify, wallet};

/// The job fields a handler needs.
#[derive(Clone, Debug)]
pub struct JobIn {
    pub id: u64,
    pub kind: String,
    pub payload: String,
    /// Attempts so far, this one included.
    pub attempts: u8,
    pub max_attempts: u8,
}

impl JobIn {
    /// No retry follows when this attempt fails.
    pub fn last_attempt(&self) -> bool {
        self.attempts >= self.max_attempts
    }

    pub fn payload<T: DeserializeOwned>(&self) -> Result<T, JobError> {
        serde_json::from_str(&self.payload).map_err(|e| JobError::msg(format!("bad {} payload: {e}", self.kind)))
    }
}

/// A failed attempt: the error for `fail_job` and every Claude call made.
#[derive(Debug)]
pub struct JobError {
    pub error: String,
    pub calls: Vec<ModelCallIn>,
}

impl JobError {
    pub fn msg(error: impl Into<String>) -> Self {
        Self { error: error.into(), calls: Vec::new() }
    }

    /// The failed call joins the calls made before it.
    pub fn from_call(failed: Failed, calls: &mut Vec<ModelCallIn>) -> Self {
        calls.push(failed.call);
        Self { error: failed.error, calls: std::mem::take(calls) }
    }
}

impl From<anyhow::Error> for JobError {
    fn from(e: anyhow::Error) -> Self {
        Self::msg(format!("{e:#}"))
    }
}

/// Clients and stores shared by every handler.
pub struct Ctx {
    pub claude: Claude,
    pub blobs: BlobStore,
    pub elastic: Option<ClaimsIndex>,
    /// Set once `ClaimsIndex::ensure_setup` has succeeded.
    pub elastic_ready: tokio::sync::OnceCell<()>,
    pub nessie: Option<Nessie>,
    pub data_dir: PathBuf,
    /// Local time for prompts and deposit dates (the venue's offset).
    pub tz_offset_minutes: i32,
    pub sink: Sink,
}

impl Ctx {
    /// The Elastic client, with the index and pipeline set up.
    pub async fn elastic(&self) -> Result<&ClaimsIndex, JobError> {
        let es = self.elastic.as_ref().ok_or_else(|| JobError::msg("ELASTICSEARCH_URL or ELASTICSEARCH_API_KEY is not set"))?;
        self.elastic_ready.get_or_try_init(|| es.ensure_setup()).await?;
        Ok(es)
    }
}

/// Kinds this worker runs.
pub fn handles(kind: &str) -> bool {
    INSURANCE_KINDS.contains(&kind) || kind == wallet::KIND || kind == merch::KIND || kind == medical::KIND || kind == venue::KIND || kind == photo::KIND || kind == shop::KIND
}

/// Runs one job to its result reducer. On `Err` the caller reports `fail_job`.
pub async fn run(ctx: &Ctx, job: &JobIn) -> Result<(), JobError> {
    match job.kind.as_str() {
        KIND_RECORD_EXTRACT => extract::run(ctx, job, job.payload()?).await,
        KIND_VERIFY => verify::run(ctx, job, job.payload()?).await,
        KIND_REVIEW => investigate::run(ctx, job, job.payload()?).await,
        KIND_DRAFT => letters::run_draft(ctx, job, job.payload()?).await,
        KIND_RECOVERY => letters::run_recovery(ctx, job, job.payload()?).await,
        KIND_PAYOUT => payout::run(ctx, job, job.payload()?).await,
        KIND_CLINIC => clinic::run(ctx, job, job.payload()?).await,
        KIND_CHARGE_PAYMENT => charge::run(ctx, job, job.payload()?).await,
        wallet::KIND => wallet::run(ctx, job, job.payload()?).await,
        merch::KIND => merch::run(ctx, job, job.payload()?).await,
        medical::KIND => medical::run(ctx, job, job.payload()?).await,
        venue::KIND => venue::run(ctx, job, job.payload()?).await,
        photo::KIND => photo::run(ctx, job, job.payload()?).await,
        shop::KIND => shop::run(ctx, job, job.payload()?).await,
        other => Err(JobError::msg(format!("no handler for job kind {other}"))),
    }
}
