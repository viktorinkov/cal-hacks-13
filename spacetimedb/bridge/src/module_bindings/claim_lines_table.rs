#![allow(unused, clippy::all)]
use super::claim_line_type::ClaimLine;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ClaimLinesTableHandle<'ctx> {
    imp: __sdk::TableHandle<ClaimLine>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ClaimLinesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ClaimLinesTableAccessor {
    type Row = ClaimLine;
    type Handle<'db> = ClaimLinesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.claim_lines()
    }
}

#[allow(non_camel_case_types)]
pub trait ClaimLinesTableAccess {
    #[allow(non_snake_case)]
    fn claim_lines(&self) -> ClaimLinesTableHandle<'_>;
}

impl ClaimLinesTableAccess for super::RemoteTables {
    fn claim_lines(&self) -> ClaimLinesTableHandle<'_> {
        ClaimLinesTableHandle {
            imp: self.imp.get_table::<ClaimLine>("claim_lines"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ClaimLinesInsertCallbackId(__sdk::CallbackId);
pub struct ClaimLinesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ClaimLinesTableHandle<'ctx> {
    type Row = ClaimLine;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimLine> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ClaimLinesTableHandle<'ctx> {
    type Row = ClaimLine;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimLine> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ClaimLinesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLinesInsertCallbackId {
        ClaimLinesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimLinesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ClaimLinesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLinesDeleteCallbackId {
        ClaimLinesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimLinesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ClaimLinesTableHandle<'ctx> {
    type InsertCallbackId = ClaimLinesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLinesInsertCallbackId {
        ClaimLinesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimLinesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ClaimLinesTableHandle<'ctx> {
    type DeleteCallbackId = ClaimLinesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLinesDeleteCallbackId {
        ClaimLinesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimLinesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ClaimLine>("claim_lines");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ClaimLine>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ClaimLine>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait claim_linesQueryTableAccess {
    #[allow(non_snake_case)]
    fn claim_lines(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<ClaimLine>;
}

impl claim_linesQueryTableAccess for __sdk::QueryTableAccessor {
    fn claim_lines(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<ClaimLine> {
        __sdk::__query_builder::ViewCall::new(
            "claim_lines",
            [__sdk::__query_builder::SqlLiteral::to_sql_literal(claim_id)],
        )
    }
}
