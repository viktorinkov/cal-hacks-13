#![allow(unused, clippy::all)]
use super::zone_visit_type::ZoneVisit;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ZoneVisitTableHandle<'ctx> {
    imp: __sdk::TableHandle<ZoneVisit>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ZoneVisitTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ZoneVisitTableAccessor {
    type Row = ZoneVisit;
    type Handle<'db> = ZoneVisitTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.zone_visit()
    }
}

#[allow(non_camel_case_types)]
pub trait ZoneVisitTableAccess {
    #[allow(non_snake_case)]
    fn zone_visit(&self) -> ZoneVisitTableHandle<'_>;
}

impl ZoneVisitTableAccess for super::RemoteTables {
    fn zone_visit(&self) -> ZoneVisitTableHandle<'_> {
        ZoneVisitTableHandle {
            imp: self.imp.get_table::<ZoneVisit>("zone_visit"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ZoneVisitInsertCallbackId(__sdk::CallbackId);
pub struct ZoneVisitDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ZoneVisitTableHandle<'ctx> {
    type Row = ZoneVisit;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ZoneVisit> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ZoneVisitTableHandle<'ctx> {
    type Row = ZoneVisit;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ZoneVisit> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ZoneVisitInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneVisitInsertCallbackId {
        ZoneVisitInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ZoneVisitInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ZoneVisitDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneVisitDeleteCallbackId {
        ZoneVisitDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ZoneVisitDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ZoneVisitTableHandle<'ctx> {
    type InsertCallbackId = ZoneVisitInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneVisitInsertCallbackId {
        ZoneVisitInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ZoneVisitInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ZoneVisitTableHandle<'ctx> {
    type DeleteCallbackId = ZoneVisitDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneVisitDeleteCallbackId {
        ZoneVisitDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ZoneVisitDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct ZoneVisitUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for ZoneVisitTableHandle<'ctx> {
    type UpdateCallbackId = ZoneVisitUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ZoneVisitUpdateCallbackId {
        ZoneVisitUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ZoneVisitUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for ZoneVisitTableHandle<'ctx> {
    type UpdateCallbackId = ZoneVisitUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ZoneVisitUpdateCallbackId {
        ZoneVisitUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ZoneVisitUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct ZoneVisitIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<ZoneVisit, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> ZoneVisitTableHandle<'ctx> {
    pub fn id(&self) -> ZoneVisitIdUnique<'ctx> {
        ZoneVisitIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> ZoneVisitIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<ZoneVisit> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ZoneVisit>("zone_visit");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ZoneVisit>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ZoneVisit>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait zone_visitQueryTableAccess {
    #[allow(non_snake_case)]
    fn zone_visit(&self) -> __sdk::__query_builder::Table<ZoneVisit>;
}

impl zone_visitQueryTableAccess for __sdk::QueryTableAccessor {
    fn zone_visit(&self) -> __sdk::__query_builder::Table<ZoneVisit> {
        __sdk::__query_builder::Table::new("zone_visit")
    }
}
