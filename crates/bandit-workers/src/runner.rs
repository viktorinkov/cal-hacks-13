//! The job loop: lease queued jobs from `worker_jobs`, run each leased job
//! once on its own task, and keep its lease alive while it runs.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bandit_bindings::*;
use spacetimedb_sdk::{DbContext, Identity, Table, Timestamp};

use crate::jobs::{self, Ctx, JobIn};
use crate::sink::reduce;

const TICK: Duration = Duration::from_millis(500);
const LEASE_EVERY: Duration = Duration::from_secs(30);
const MAX_RUNNING: usize = 4;

/// Jobs keyed by (id, attempts): a retry of the same job is a new key.
#[derive(Default)]
struct State {
    claiming: HashSet<u64>,
    running: HashSet<(u64, u8)>,
    finished: HashSet<(u64, u8)>,
}

pub async fn run(conn: Arc<DbConnection>, me: Identity, ctx: Arc<Ctx>) -> anyhow::Result<()> {
    let state = Arc::new(Mutex::new(State::default()));
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    tracing::info!(identity = %me.to_hex(), "waiting for jobs");
    loop {
        tick.tick().await;
        if !conn.is_active() {
            anyhow::bail!("lost the SpacetimeDB connection");
        }
        let now = Timestamp::now();
        let jobs: Vec<Job> = conn.db.worker_jobs().iter().filter(|j| jobs::handles(&j.kind)).collect();
        let mut st = state.lock().unwrap();
        st.finished.retain(|(id, _)| jobs.iter().any(|j| j.id == *id));

        for job in jobs.iter().filter(|j| j.status == JobStatus::Leased && j.lease_holder == Some(me)) {
            let key = (job.id, job.attempts);
            let live = job.lease_until.is_some_and(|t| t > now);
            if !live || st.running.contains(&key) || st.finished.contains(&key) || st.running.len() >= MAX_RUNNING {
                continue;
            }
            st.running.insert(key);
            tokio::spawn(run_job(conn.clone(), ctx.clone(), state.clone(), job.clone()));
        }

        let free = MAX_RUNNING.saturating_sub(st.running.len() + st.claiming.len());
        let ready: Vec<u64> = jobs
            .iter()
            .filter(|j| j.status == JobStatus::Queued && j.not_before.is_none_or(|t| t <= now) && !st.claiming.contains(&j.id))
            .take(free)
            .map(|j| j.id)
            .collect();
        for id in ready {
            st.claiming.insert(id);
            let (conn, state) = (conn.clone(), state.clone());
            tokio::spawn(async move {
                if let Err(e) = reduce!(conn, claim_job_then(id)) {
                    tracing::debug!(job_id = id, error = %e, "could not lease the job");
                }
                state.lock().unwrap().claiming.remove(&id);
            });
        }
    }
}

async fn run_job(conn: Arc<DbConnection>, ctx: Arc<Ctx>, state: Arc<Mutex<State>>, job: Job) {
    let key = (job.id, job.attempts);
    let input = JobIn { id: job.id, kind: job.kind.clone(), payload: job.payload.clone(), attempts: job.attempts, max_attempts: job.max_attempts };
    tracing::info!(job_id = job.id, kind = %job.kind, claim_id = job.subject_id, attempt = job.attempts, "job started");

    let lease = {
        let (conn, id) = (conn.clone(), job.id);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(LEASE_EVERY).await;
                if let Err(e) = reduce!(conn, extend_job_lease_then(id)) {
                    tracing::warn!(job_id = id, error = %e, "could not extend the lease");
                }
            }
        })
    };
    let handler = {
        let (ctx, input) = (ctx.clone(), input.clone());
        tokio::spawn(async move { jobs::run(&ctx, &input).await })
    };
    let result = match handler.await {
        Ok(r) => r,
        Err(e) => Err(jobs::JobError::msg(format!("handler panicked: {e}"))),
    };
    lease.abort();

    match result {
        Ok(()) => tracing::info!(job_id = job.id, kind = %job.kind, claim_id = job.subject_id, "job finished"),
        Err(e) => {
            tracing::warn!(job_id = job.id, kind = %job.kind, claim_id = job.subject_id, error = %e.error, "job failed");
            if let Err(f) = ctx.sink.fail(job.id, e.error, e.calls).await {
                tracing::error!(job_id = job.id, error = %format!("{f:#}"), "could not report the failure; the lease will expire");
            }
        }
    }
    let mut st = state.lock().unwrap();
    st.running.remove(&key);
    st.finished.insert(key);
}
