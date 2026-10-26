#![allow(unused, clippy::all)]
use super::claim_line_type::ClaimLine;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardLinesTableHandle<'ctx> {
    imp: __sdk::TableHandle<ClaimLine>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardLinesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardLinesTableAccessor {
    type Row = ClaimLine;
    type Handle<'db> = BoardLinesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_lines()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardLinesTableAccess {
    #[allow(non_snake_case)]
    fn board_lines(&self) -> BoardLinesTableHandle<'_>;
}

impl BoardLinesTableAccess for super::RemoteTables {
    fn board_lines(&self) -> BoardLinesTableHandle<'_> {
        BoardLinesTableHandle {
            imp: self.imp.get_table::<ClaimLine>("board_lines"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardLinesInsertCallbackId(__sdk::CallbackId);
pub struct BoardLinesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardLinesTableHandle<'ctx> {
    type Row = ClaimLine;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimLine> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardLinesTableHandle<'ctx> {
    type Row = ClaimLine;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimLine> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardLinesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardLinesInsertCallbackId {
        BoardLinesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardLinesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardLinesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardLinesDeleteCallbackId {
        BoardLinesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardLinesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardLinesTableHandle<'ctx> {
    type InsertCallbackId = BoardLinesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardLinesInsertCallbackId {
        BoardLinesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardLinesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardLinesTableHandle<'ctx> {
    type DeleteCallbackId = BoardLinesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardLinesDeleteCallbackId {
        BoardLinesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardLinesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ClaimLine>("board_lines");
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
pub trait board_linesQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_lines(&self) -> __sdk::__query_builder::Table<ClaimLine>;
}

impl board_linesQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_lines(&self) -> __sdk::__query_builder::Table<ClaimLine> {
        __sdk::__query_builder::Table::new("board_lines")
    }
}
