#![allow(unused, clippy::all)]
use super::medical_record_type::MedicalRecord;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardRecordsTableHandle<'ctx> {
    imp: __sdk::TableHandle<MedicalRecord>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardRecordsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardRecordsTableAccessor {
    type Row = MedicalRecord;
    type Handle<'db> = BoardRecordsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_records()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardRecordsTableAccess {
    #[allow(non_snake_case)]
    fn board_records(&self) -> BoardRecordsTableHandle<'_>;
}

impl BoardRecordsTableAccess for super::RemoteTables {
    fn board_records(&self) -> BoardRecordsTableHandle<'_> {
        BoardRecordsTableHandle {
            imp: self.imp.get_table::<MedicalRecord>("board_records"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardRecordsInsertCallbackId(__sdk::CallbackId);
pub struct BoardRecordsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardRecordsTableHandle<'ctx> {
    type Row = MedicalRecord;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MedicalRecord> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardRecordsTableHandle<'ctx> {
    type Row = MedicalRecord;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MedicalRecord> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardRecordsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRecordsInsertCallbackId {
        BoardRecordsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardRecordsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardRecordsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRecordsDeleteCallbackId {
        BoardRecordsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardRecordsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardRecordsTableHandle<'ctx> {
    type InsertCallbackId = BoardRecordsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRecordsInsertCallbackId {
        BoardRecordsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardRecordsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardRecordsTableHandle<'ctx> {
    type DeleteCallbackId = BoardRecordsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRecordsDeleteCallbackId {
        BoardRecordsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardRecordsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<MedicalRecord>("board_records");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<MedicalRecord>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<MedicalRecord>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_recordsQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_records(&self) -> __sdk::__query_builder::Table<MedicalRecord>;
}

impl board_recordsQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_records(&self) -> __sdk::__query_builder::Table<MedicalRecord> {
        __sdk::__query_builder::Table::new("board_records")
    }
}
