#![allow(unused, clippy::all)]
use super::encounter_type::Encounter;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct EncounterTableHandle<'ctx> {
    imp: __sdk::TableHandle<Encounter>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct EncounterTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for EncounterTableAccessor {
    type Row = Encounter;
    type Handle<'db> = EncounterTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.encounter()
    }
}

#[allow(non_camel_case_types)]
pub trait EncounterTableAccess {
    #[allow(non_snake_case)]
    fn encounter(&self) -> EncounterTableHandle<'_>;
}

impl EncounterTableAccess for super::RemoteTables {
    fn encounter(&self) -> EncounterTableHandle<'_> {
        EncounterTableHandle {
            imp: self.imp.get_table::<Encounter>("encounter"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct EncounterInsertCallbackId(__sdk::CallbackId);
pub struct EncounterDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for EncounterTableHandle<'ctx> {
    type Row = Encounter;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Encounter> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for EncounterTableHandle<'ctx> {
    type Row = Encounter;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Encounter> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = EncounterInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EncounterInsertCallbackId {
        EncounterInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: EncounterInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = EncounterDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EncounterDeleteCallbackId {
        EncounterDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: EncounterDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for EncounterTableHandle<'ctx> {
    type InsertCallbackId = EncounterInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EncounterInsertCallbackId {
        EncounterInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: EncounterInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for EncounterTableHandle<'ctx> {
    type DeleteCallbackId = EncounterDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EncounterDeleteCallbackId {
        EncounterDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: EncounterDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct EncounterUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for EncounterTableHandle<'ctx> {
    type UpdateCallbackId = EncounterUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> EncounterUpdateCallbackId {
        EncounterUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: EncounterUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for EncounterTableHandle<'ctx> {
    type UpdateCallbackId = EncounterUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> EncounterUpdateCallbackId {
        EncounterUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: EncounterUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct EncounterKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Encounter, u16>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> EncounterTableHandle<'ctx> {
    pub fn key(&self) -> EncounterKeyUnique<'ctx> {
        EncounterKeyUnique {
            imp: self.imp.get_unique_constraint::<u16>("key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> EncounterKeyUnique<'ctx> {
    pub fn find(&self, col_val: &u16) -> Option<Encounter> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Encounter>("encounter");
    _table.add_unique_constraint::<u16>("key", |row| &row.key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Encounter>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Encounter>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait encounterQueryTableAccess {
    #[allow(non_snake_case)]
    fn encounter(&self) -> __sdk::__query_builder::Table<Encounter>;
}

impl encounterQueryTableAccess for __sdk::QueryTableAccessor {
    fn encounter(&self) -> __sdk::__query_builder::Table<Encounter> {
        __sdk::__query_builder::Table::new("encounter")
    }
}
