#![allow(unused, clippy::all)]
use super::api_session_type::ApiSession;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ApiSessionsTableHandle<'ctx> {
    imp: __sdk::TableHandle<ApiSession>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ApiSessionsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ApiSessionsTableAccessor {
    type Row = ApiSession;
    type Handle<'db> = ApiSessionsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.api_sessions()
    }
}

#[allow(non_camel_case_types)]
pub trait ApiSessionsTableAccess {
    #[allow(non_snake_case)]
    fn api_sessions(&self) -> ApiSessionsTableHandle<'_>;
}

impl ApiSessionsTableAccess for super::RemoteTables {
    fn api_sessions(&self) -> ApiSessionsTableHandle<'_> {
        ApiSessionsTableHandle {
            imp: self.imp.get_table::<ApiSession>("api_sessions"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ApiSessionsInsertCallbackId(__sdk::CallbackId);
pub struct ApiSessionsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ApiSessionsTableHandle<'ctx> {
    type Row = ApiSession;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ApiSession> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ApiSessionsTableHandle<'ctx> {
    type Row = ApiSession;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ApiSession> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ApiSessionsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ApiSessionsInsertCallbackId {
        ApiSessionsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ApiSessionsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ApiSessionsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ApiSessionsDeleteCallbackId {
        ApiSessionsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ApiSessionsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ApiSessionsTableHandle<'ctx> {
    type InsertCallbackId = ApiSessionsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ApiSessionsInsertCallbackId {
        ApiSessionsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ApiSessionsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ApiSessionsTableHandle<'ctx> {
    type DeleteCallbackId = ApiSessionsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ApiSessionsDeleteCallbackId {
        ApiSessionsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ApiSessionsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ApiSession>("api_sessions");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ApiSession>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ApiSession>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait api_sessionsQueryTableAccess {
    #[allow(non_snake_case)]
    fn api_sessions(&self) -> __sdk::__query_builder::Table<ApiSession>;
}

impl api_sessionsQueryTableAccess for __sdk::QueryTableAccessor {
    fn api_sessions(&self) -> __sdk::__query_builder::Table<ApiSession> {
        __sdk::__query_builder::Table::new("api_sessions")
    }
}
