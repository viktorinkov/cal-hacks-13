#![allow(unused, clippy::all)]
use super::job_status_type::JobStatus;
use super::job_type::Job;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct WorkerJobsTableHandle<'ctx> {
    imp: __sdk::TableHandle<Job>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct WorkerJobsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for WorkerJobsTableAccessor {
    type Row = Job;
    type Handle<'db> = WorkerJobsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.worker_jobs()
    }
}

#[allow(non_camel_case_types)]
pub trait WorkerJobsTableAccess {
    #[allow(non_snake_case)]
    fn worker_jobs(&self) -> WorkerJobsTableHandle<'_>;
}

impl WorkerJobsTableAccess for super::RemoteTables {
    fn worker_jobs(&self) -> WorkerJobsTableHandle<'_> {
        WorkerJobsTableHandle {
            imp: self.imp.get_table::<Job>("worker_jobs"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct WorkerJobsInsertCallbackId(__sdk::CallbackId);
pub struct WorkerJobsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for WorkerJobsTableHandle<'ctx> {
    type Row = Job;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Job> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for WorkerJobsTableHandle<'ctx> {
    type Row = Job;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Job> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = WorkerJobsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> WorkerJobsInsertCallbackId {
        WorkerJobsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: WorkerJobsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = WorkerJobsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> WorkerJobsDeleteCallbackId {
        WorkerJobsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: WorkerJobsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for WorkerJobsTableHandle<'ctx> {
    type InsertCallbackId = WorkerJobsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> WorkerJobsInsertCallbackId {
        WorkerJobsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: WorkerJobsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for WorkerJobsTableHandle<'ctx> {
    type DeleteCallbackId = WorkerJobsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> WorkerJobsDeleteCallbackId {
        WorkerJobsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: WorkerJobsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Job>("worker_jobs");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Job>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Job>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait worker_jobsQueryTableAccess {
    #[allow(non_snake_case)]
    fn worker_jobs(&self) -> __sdk::__query_builder::Table<Job>;
}

impl worker_jobsQueryTableAccess for __sdk::QueryTableAccessor {
    fn worker_jobs(&self) -> __sdk::__query_builder::Table<Job> {
        __sdk::__query_builder::Table::new("worker_jobs")
    }
}
