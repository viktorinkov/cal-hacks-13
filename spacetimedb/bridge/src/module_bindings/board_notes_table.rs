#![allow(unused, clippy::all)]
use super::incident_note_type::IncidentNote;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardNotesTableHandle<'ctx> {
    imp: __sdk::TableHandle<IncidentNote>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardNotesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardNotesTableAccessor {
    type Row = IncidentNote;
    type Handle<'db> = BoardNotesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_notes()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardNotesTableAccess {
    #[allow(non_snake_case)]
    fn board_notes(&self) -> BoardNotesTableHandle<'_>;
}

impl BoardNotesTableAccess for super::RemoteTables {
    fn board_notes(&self) -> BoardNotesTableHandle<'_> {
        BoardNotesTableHandle {
            imp: self.imp.get_table::<IncidentNote>("board_notes"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardNotesInsertCallbackId(__sdk::CallbackId);
pub struct BoardNotesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardNotesTableHandle<'ctx> {
    type Row = IncidentNote;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = IncidentNote> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardNotesTableHandle<'ctx> {
    type Row = IncidentNote;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = IncidentNote> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardNotesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardNotesInsertCallbackId {
        BoardNotesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardNotesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardNotesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardNotesDeleteCallbackId {
        BoardNotesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardNotesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardNotesTableHandle<'ctx> {
    type InsertCallbackId = BoardNotesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardNotesInsertCallbackId {
        BoardNotesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardNotesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardNotesTableHandle<'ctx> {
    type DeleteCallbackId = BoardNotesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardNotesDeleteCallbackId {
        BoardNotesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardNotesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<IncidentNote>("board_notes");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<IncidentNote>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<IncidentNote>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_notesQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_notes(&self) -> __sdk::__query_builder::Table<IncidentNote>;
}

impl board_notesQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_notes(&self) -> __sdk::__query_builder::Table<IncidentNote> {
        __sdk::__query_builder::Table::new("board_notes")
    }
}
