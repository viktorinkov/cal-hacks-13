#![allow(unused, clippy::all)]
use super::schedule_slot_type::ScheduleSlot;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ScheduleSlotTableHandle<'ctx> {
    imp: __sdk::TableHandle<ScheduleSlot>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ScheduleSlotTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ScheduleSlotTableAccessor {
    type Row = ScheduleSlot;
    type Handle<'db> = ScheduleSlotTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.schedule_slot()
    }
}

#[allow(non_camel_case_types)]
pub trait ScheduleSlotTableAccess {
    #[allow(non_snake_case)]
    fn schedule_slot(&self) -> ScheduleSlotTableHandle<'_>;
}

impl ScheduleSlotTableAccess for super::RemoteTables {
    fn schedule_slot(&self) -> ScheduleSlotTableHandle<'_> {
        ScheduleSlotTableHandle {
            imp: self.imp.get_table::<ScheduleSlot>("schedule_slot"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ScheduleSlotInsertCallbackId(__sdk::CallbackId);
pub struct ScheduleSlotDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ScheduleSlotTableHandle<'ctx> {
    type Row = ScheduleSlot;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ScheduleSlot> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ScheduleSlotTableHandle<'ctx> {
    type Row = ScheduleSlot;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ScheduleSlot> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ScheduleSlotInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ScheduleSlotInsertCallbackId {
        ScheduleSlotInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ScheduleSlotInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ScheduleSlotDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ScheduleSlotDeleteCallbackId {
        ScheduleSlotDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ScheduleSlotDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ScheduleSlotTableHandle<'ctx> {
    type InsertCallbackId = ScheduleSlotInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ScheduleSlotInsertCallbackId {
        ScheduleSlotInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ScheduleSlotInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ScheduleSlotTableHandle<'ctx> {
    type DeleteCallbackId = ScheduleSlotDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ScheduleSlotDeleteCallbackId {
        ScheduleSlotDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ScheduleSlotDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct ScheduleSlotUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for ScheduleSlotTableHandle<'ctx> {
    type UpdateCallbackId = ScheduleSlotUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ScheduleSlotUpdateCallbackId {
        ScheduleSlotUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ScheduleSlotUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for ScheduleSlotTableHandle<'ctx> {
    type UpdateCallbackId = ScheduleSlotUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ScheduleSlotUpdateCallbackId {
        ScheduleSlotUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ScheduleSlotUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct ScheduleSlotIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<ScheduleSlot, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> ScheduleSlotTableHandle<'ctx> {
    pub fn id(&self) -> ScheduleSlotIdUnique<'ctx> {
        ScheduleSlotIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> ScheduleSlotIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<ScheduleSlot> {
        self.imp.find(col_val)
    }
}

pub struct ScheduleSlotSourceKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<ScheduleSlot, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> ScheduleSlotTableHandle<'ctx> {
    pub fn source_key(&self) -> ScheduleSlotSourceKeyUnique<'ctx> {
        ScheduleSlotSourceKeyUnique {
            imp: self.imp.get_unique_constraint::<String>("source_key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> ScheduleSlotSourceKeyUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<ScheduleSlot> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ScheduleSlot>("schedule_slot");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("source_key", |row| &row.source_key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ScheduleSlot>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ScheduleSlot>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait schedule_slotQueryTableAccess {
    #[allow(non_snake_case)]
    fn schedule_slot(&self) -> __sdk::__query_builder::Table<ScheduleSlot>;
}

impl schedule_slotQueryTableAccess for __sdk::QueryTableAccessor {
    fn schedule_slot(&self) -> __sdk::__query_builder::Table<ScheduleSlot> {
        __sdk::__query_builder::Table::new("schedule_slot")
    }
}
