//! The work queue, model-call records and blob references shared by every
//! feature. Slow or external work (Claude, Elastic) is a `job` row; a
//! `bandit-workers` process leases it, does the work, and hands the result to
//! the feature's own reducer, which checks the lease and finishes the job in
//! the same transaction.

use crate::roles::*;
use crate::tables::*;
use spacetimedb::{Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, TimeDuration, Timestamp, ViewContext};

pub const LEASE_MICROS: i64 = 60_000_000;
pub const MAX_ATTEMPTS: u8 = 3;
const RETRY_MICROS: i64 = 5_000_000;
const REAPER_SECS: u64 = 10;

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    Queued,
    Leased,
    Done,
    Dead,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = job)]
pub struct Job {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub kind: String,
    pub status: JobStatus,
    /// True while queued or leased, so workers can subscribe by index.
    #[index(btree)]
    pub open: bool,
    /// The job's input as JSON; each kind's payload type lives with its feature.
    pub payload: String,
    pub subject_table: String,
    pub subject_id: u64,
    pub lease_holder: Option<Identity>,
    pub lease_until: Option<Timestamp>,
    pub attempts: u8,
    pub max_attempts: u8,
    /// Earliest time a retry may be leased.
    pub not_before: Option<Timestamp>,
    pub result: String,
    pub error: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// One Claude call, recorded for audit whatever its outcome.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = model_call)]
pub struct ModelCall {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub job_id: u64,
    pub kind: String,
    pub model_requested: String,
    pub model_used: String,
    pub effort: String,
    pub request_hash: String,
    /// `ok`, `refusal` or `error`.
    pub status: String,
    pub stop_reason: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub latency_ms: u32,
    pub response: String,
    pub error: String,
    pub recorded_by: Identity,
    pub created_at: Timestamp,
}

/// A worker's report of one Claude call, passed into the reducer that uses it.
#[derive(SpacetimeType, Clone, Debug, Default)]
pub struct ModelCallIn {
    pub kind: String,
    pub model_requested: String,
    pub model_used: String,
    pub effort: String,
    pub request_hash: String,
    pub status: String,
    pub stop_reason: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub latency_ms: u32,
    pub response: String,
    pub error: String,
}

/// A file held in the blob store (PDFs, frames, letters), addressed by its SHA-256.
#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = blob_ref)]
pub struct BlobRef {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[unique]
    pub hash: String,
    pub owner: Option<Identity>,
    /// `owner_only`, `staff` or `shared`.
    pub access: String,
    /// `medical`, `frame`, `letter`, `photo` or `other`.
    pub purpose: String,
    pub content_type: String,
    pub size_bytes: u64,
    pub created_by: Identity,
    pub created_at: Timestamp,
}

#[spacetimedb::table(accessor = job_reaper_timer, scheduled(crate::jobs::job_reaper))]
pub struct JobReaperTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Queues a job. Called from feature reducers, never by clients.
pub fn enqueue(ctx: &ReducerContext, kind: &str, payload: String, subject_table: &str, subject_id: u64) -> u64 {
    ctx.db
        .job()
        .insert(Job {
            id: 0,
            kind: kind.to_string(),
            status: JobStatus::Queued,
            open: true,
            payload,
            subject_table: subject_table.to_string(),
            subject_id,
            lease_holder: None,
            lease_until: None,
            attempts: 0,
            max_attempts: MAX_ATTEMPTS,
            not_before: None,
            result: String::new(),
            error: String::new(),
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        })
        .id
}

/// The job, if the caller holds its live lease. Feature result reducers call
/// this first so a slow duplicate can never overwrite a newer result.
pub fn leased_by_caller(ctx: &ReducerContext, job_id: u64) -> Result<Job, String> {
    let job = ctx.db.job().id().find(job_id).ok_or_else(|| format!("no job {job_id}"))?;
    let live = job.status == JobStatus::Leased
        && job.lease_holder == Some(ctx.sender())
        && job.lease_until.is_some_and(|t| t >= ctx.timestamp);
    if live { Ok(job) } else { Err(format!("job {job_id} is not leased by the caller")) }
}

/// Marks a leased job done. Feature reducers call it after applying the result.
pub fn finish(ctx: &ReducerContext, job: Job, result: impl Into<String>) {
    ctx.db.job().id().update(Job {
        status: JobStatus::Done,
        open: false,
        result: result.into(),
        lease_holder: None,
        lease_until: None,
        updated_at: ctx.timestamp,
        ..job
    });
}

/// Records a Claude call and returns its id.
pub fn record_call(ctx: &ReducerContext, job_id: u64, call: &ModelCallIn) -> u64 {
    ctx.db
        .model_call()
        .insert(ModelCall {
            id: 0,
            job_id,
            kind: call.kind.clone(),
            model_requested: call.model_requested.clone(),
            model_used: call.model_used.clone(),
            effort: call.effort.clone(),
            request_hash: call.request_hash.clone(),
            status: call.status.clone(),
            stop_reason: call.stop_reason.clone(),
            input_tokens: call.input_tokens,
            output_tokens: call.output_tokens,
            latency_ms: call.latency_ms,
            response: call.response.clone(),
            error: call.error.clone(),
            recorded_by: ctx.sender(),
            created_at: ctx.timestamp,
        })
        .id
}

fn retry_or_bury(ctx: &ReducerContext, job: Job, error: String) {
    if job.attempts >= job.max_attempts {
        let dead = ctx.db.job().id().update(Job {
            status: JobStatus::Dead,
            open: false,
            error,
            lease_holder: None,
            lease_until: None,
            updated_at: ctx.timestamp,
            ..job
        });
        crate::insurance::on_job_dead(ctx, &dead);
        crate::merch::on_job_dead(ctx, &dead);
        crate::venue::setup::on_job_dead(ctx, &dead);
    } else {
        let backoff = TimeDuration::from_micros(RETRY_MICROS * job.attempts as i64);
        ctx.db.job().id().update(Job {
            status: JobStatus::Queued,
            error,
            lease_holder: None,
            lease_until: None,
            not_before: Some(ctx.timestamp + backoff),
            updated_at: ctx.timestamp,
            ..job
        });
    }
}

/// Starts the lease reaper. Idempotent; `bandit-claims setup` calls it once.
#[spacetimedb::reducer]
pub fn start_job_reaper(ctx: &ReducerContext) -> Result<(), String> {
    require_role(ctx, &["ops"])?;
    if ctx.db.job_reaper_timer().count() == 0 {
        ctx.db.job_reaper_timer().insert(JobReaperTimer {
            scheduled_id: 0,
            scheduled_at: ScheduleAt::Interval(std::time::Duration::from_secs(REAPER_SECS).into()),
        });
    }
    Ok(())
}

/// Leases a queued job to the calling worker for 60 s.
#[spacetimedb::reducer]
pub fn claim_job(ctx: &ReducerContext, job_id: u64) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = ctx.db.job().id().find(job_id).ok_or_else(|| format!("no job {job_id}"))?;
    if job.status != JobStatus::Queued || job.not_before.is_some_and(|t| t > ctx.timestamp) {
        return Err(format!("job {job_id} is not ready to lease"));
    }
    ctx.db.job().id().update(Job {
        status: JobStatus::Leased,
        lease_holder: Some(ctx.sender()),
        lease_until: Some(ctx.timestamp + TimeDuration::from_micros(LEASE_MICROS)),
        attempts: job.attempts + 1,
        updated_at: ctx.timestamp,
        ..job
    });
    Ok(())
}

/// Pushes the lease out another 60 s while a long call runs.
#[spacetimedb::reducer]
pub fn extend_job_lease(ctx: &ReducerContext, job_id: u64) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = leased_by_caller(ctx, job_id)?;
    ctx.db.job().id().update(Job {
        lease_until: Some(ctx.timestamp + TimeDuration::from_micros(LEASE_MICROS)),
        updated_at: ctx.timestamp,
        ..job
    });
    Ok(())
}

/// Finishes a job whose kind has no result reducer of its own.
#[spacetimedb::reducer]
pub fn complete_job(ctx: &ReducerContext, job_id: u64, result: String) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = leased_by_caller(ctx, job_id)?;
    finish(ctx, job, result);
    Ok(())
}

/// Reports a failed attempt, with the Claude call when there was one. The job
/// is retried after a back-off, or is dead after its last attempt, and the
/// owning feature's fallback applies.
#[spacetimedb::reducer]
pub fn fail_job(ctx: &ReducerContext, job_id: u64, error: String, call: Option<ModelCallIn>) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = leased_by_caller(ctx, job_id)?;
    if let Some(call) = &call {
        record_call(ctx, job_id, call);
    }
    retry_or_bury(ctx, job, error);
    Ok(())
}

/// Records a Claude call made outside a job.
#[spacetimedb::reducer]
pub fn record_model_call(ctx: &ReducerContext, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker", "vision", "ingest"])?;
    record_call(ctx, 0, &call);
    Ok(())
}

/// Registers a stored file by its SHA-256. Idempotent.
#[spacetimedb::reducer]
pub fn register_blob(
    ctx: &ReducerContext,
    hash: String,
    owner: Option<Identity>,
    access: String,
    purpose: String,
    content_type: String,
    size_bytes: u64,
) -> Result<(), String> {
    require_role(ctx, &["worker", "api", "vision", "ops", "medic"])?;
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("blob hash must be a hex SHA-256".into());
    }
    if !["owner_only", "staff", "shared"].contains(&access.as_str()) {
        return Err(format!("unknown access class {access}"));
    }
    let hash = hash.to_lowercase();
    if ctx.db.blob_ref().hash().find(&hash).is_none() {
        ctx.db.blob_ref().insert(BlobRef {
            id: 0,
            hash,
            owner,
            access,
            purpose,
            content_type,
            size_bytes,
            created_by: ctx.sender(),
            created_at: ctx.timestamp,
        });
    }
    Ok(())
}

/// Returns expired leases to the queue, or buries them after the last attempt.
#[spacetimedb::reducer]
pub fn job_reaper(ctx: &ReducerContext, _timer: JobReaperTimer) -> Result<(), String> {
    if ctx.sender() != ctx.database_identity() {
        return Err("job_reaper is internal".into());
    }
    let expired: Vec<Job> = ctx
        .db
        .job()
        .iter()
        .filter(|j| j.status == JobStatus::Leased && j.lease_until.is_some_and(|t| t < ctx.timestamp))
        .collect();
    for job in expired {
        retry_or_bury(ctx, job, "lease expired".into());
    }
    Ok(())
}

fn is_worker(ctx: &ViewContext) -> bool {
    ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| r.role == "worker")
}

/// Queued and leased jobs, for workers to pick from.
#[spacetimedb::view(accessor = worker_jobs, public)]
pub fn worker_jobs(ctx: &ViewContext) -> Vec<Job> {
    if !is_worker(ctx) {
        return Vec::new();
    }
    ctx.db.job().open().filter(true).collect()
}

