#![allow(unused, clippy::all)]
use super::evidence_fact_type::EvidenceFact;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardFactsTableHandle<'ctx> {
    imp: __sdk::TableHandle<EvidenceFact>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardFactsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardFactsTableAccessor {
    type Row = EvidenceFact;
    type Handle<'db> = BoardFactsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_facts()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardFactsTableAccess {
    #[allow(non_snake_case)]
    fn board_facts(&self) -> BoardFactsTableHandle<'_>;
}

impl BoardFactsTableAccess for super::RemoteTables {
    fn board_facts(&self) -> BoardFactsTableHandle<'_> {
        BoardFactsTableHandle {
            imp: self.imp.get_table::<EvidenceFact>("board_facts"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardFactsInsertCallbackId(__sdk::CallbackId);
pub struct BoardFactsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardFactsTableHandle<'ctx> {
    type Row = EvidenceFact;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EvidenceFact> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardFactsTableHandle<'ctx> {
    type Row = EvidenceFact;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EvidenceFact> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardFactsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardFactsInsertCallbackId {
        BoardFactsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardFactsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardFactsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardFactsDeleteCallbackId {
        BoardFactsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardFactsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardFactsTableHandle<'ctx> {
    type InsertCallbackId = BoardFactsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardFactsInsertCallbackId {
        BoardFactsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardFactsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardFactsTableHandle<'ctx> {
    type DeleteCallbackId = BoardFactsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardFactsDeleteCallbackId {
        BoardFactsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardFactsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<EvidenceFact>("board_facts");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<EvidenceFact>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<EvidenceFact>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_factsQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_facts(&self) -> __sdk::__query_builder::Table<EvidenceFact>;
}

impl board_factsQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_facts(&self) -> __sdk::__query_builder::Table<EvidenceFact> {
        __sdk::__query_builder::Table::new("board_facts")
    }
}
