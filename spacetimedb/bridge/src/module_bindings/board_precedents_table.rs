#![allow(unused, clippy::all)]
use super::claim_precedent_type::ClaimPrecedent;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardPrecedentsTableHandle<'ctx> {
    imp: __sdk::TableHandle<ClaimPrecedent>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardPrecedentsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardPrecedentsTableAccessor {
    type Row = ClaimPrecedent;
    type Handle<'db> = BoardPrecedentsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_precedents()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardPrecedentsTableAccess {
    #[allow(non_snake_case)]
    fn board_precedents(&self) -> BoardPrecedentsTableHandle<'_>;
}

impl BoardPrecedentsTableAccess for super::RemoteTables {
    fn board_precedents(&self) -> BoardPrecedentsTableHandle<'_> {
        BoardPrecedentsTableHandle {
            imp: self.imp.get_table::<ClaimPrecedent>("board_precedents"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardPrecedentsInsertCallbackId(__sdk::CallbackId);
pub struct BoardPrecedentsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardPrecedentsTableHandle<'ctx> {
    type Row = ClaimPrecedent;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimPrecedent> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardPrecedentsTableHandle<'ctx> {
    type Row = ClaimPrecedent;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimPrecedent> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardPrecedentsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardPrecedentsInsertCallbackId {
        BoardPrecedentsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardPrecedentsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardPrecedentsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardPrecedentsDeleteCallbackId {
        BoardPrecedentsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardPrecedentsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardPrecedentsTableHandle<'ctx> {
    type InsertCallbackId = BoardPrecedentsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardPrecedentsInsertCallbackId {
        BoardPrecedentsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardPrecedentsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardPrecedentsTableHandle<'ctx> {
    type DeleteCallbackId = BoardPrecedentsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardPrecedentsDeleteCallbackId {
        BoardPrecedentsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardPrecedentsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ClaimPrecedent>("board_precedents");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ClaimPrecedent>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ClaimPrecedent>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_precedentsQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_precedents(&self) -> __sdk::__query_builder::Table<ClaimPrecedent>;
}

impl board_precedentsQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_precedents(&self) -> __sdk::__query_builder::Table<ClaimPrecedent> {
        __sdk::__query_builder::Table::new("board_precedents")
    }
}
