#![allow(unused, clippy::all)]
use super::import_run_type::ImportRun;
use super::section_count_type::SectionCount;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ImportRunTableHandle<'ctx> {
    imp: __sdk::TableHandle<ImportRun>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ImportRunTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ImportRunTableAccessor {
    type Row = ImportRun;
    type Handle<'db> = ImportRunTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.import_run()
    }
}

#[allow(non_camel_case_types)]
pub trait ImportRunTableAccess {
    #[allow(non_snake_case)]
    fn import_run(&self) -> ImportRunTableHandle<'_>;
}

impl ImportRunTableAccess for super::RemoteTables {
    fn import_run(&self) -> ImportRunTableHandle<'_> {
        ImportRunTableHandle {
            imp: self.imp.get_table::<ImportRun>("import_run"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ImportRunInsertCallbackId(__sdk::CallbackId);
pub struct ImportRunDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ImportRunTableHandle<'ctx> {
    type Row = ImportRun;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ImportRun> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ImportRunTableHandle<'ctx> {
    type Row = ImportRun;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ImportRun> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ImportRunInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ImportRunInsertCallbackId {
        ImportRunInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ImportRunInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ImportRunDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ImportRunDeleteCallbackId {
        ImportRunDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ImportRunDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ImportRunTableHandle<'ctx> {
    type InsertCallbackId = ImportRunInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ImportRunInsertCallbackId {
        ImportRunInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ImportRunInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ImportRunTableHandle<'ctx> {
    type DeleteCallbackId = ImportRunDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ImportRunDeleteCallbackId {
        ImportRunDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ImportRunDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct ImportRunUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for ImportRunTableHandle<'ctx> {
    type UpdateCallbackId = ImportRunUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ImportRunUpdateCallbackId {
        ImportRunUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ImportRunUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for ImportRunTableHandle<'ctx> {
    type UpdateCallbackId = ImportRunUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ImportRunUpdateCallbackId {
        ImportRunUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ImportRunUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct ImportRunIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<ImportRun, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> ImportRunTableHandle<'ctx> {
    pub fn id(&self) -> ImportRunIdUnique<'ctx> {
        ImportRunIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> ImportRunIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<ImportRun> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ImportRun>("import_run");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ImportRun>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ImportRun>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait import_runQueryTableAccess {
    #[allow(non_snake_case)]
    fn import_run(&self) -> __sdk::__query_builder::Table<ImportRun>;
}

impl import_runQueryTableAccess for __sdk::QueryTableAccessor {
    fn import_run(&self) -> __sdk::__query_builder::Table<ImportRun> {
        __sdk::__query_builder::Table::new("import_run")
    }
}
