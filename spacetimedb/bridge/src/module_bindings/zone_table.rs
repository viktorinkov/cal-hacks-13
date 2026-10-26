#![allow(unused, clippy::all)]
use super::zone_type::Zone;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ZoneTableHandle<'ctx> {
    imp: __sdk::TableHandle<Zone>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ZoneTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ZoneTableAccessor {
    type Row = Zone;
    type Handle<'db> = ZoneTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.zone()
    }
}

#[allow(non_camel_case_types)]
pub trait ZoneTableAccess {
    #[allow(non_snake_case)]
    fn zone(&self) -> ZoneTableHandle<'_>;
}

impl ZoneTableAccess for super::RemoteTables {
    fn zone(&self) -> ZoneTableHandle<'_> {
        ZoneTableHandle {
            imp: self.imp.get_table::<Zone>("zone"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ZoneInsertCallbackId(__sdk::CallbackId);
pub struct ZoneDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ZoneTableHandle<'ctx> {
    type Row = Zone;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Zone> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ZoneTableHandle<'ctx> {
    type Row = Zone;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Zone> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ZoneInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneInsertCallbackId {
        ZoneInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ZoneInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ZoneDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneDeleteCallbackId {
        ZoneDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ZoneDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ZoneTableHandle<'ctx> {
    type InsertCallbackId = ZoneInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneInsertCallbackId {
        ZoneInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ZoneInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ZoneTableHandle<'ctx> {
    type DeleteCallbackId = ZoneDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ZoneDeleteCallbackId {
        ZoneDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ZoneDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct ZoneUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for ZoneTableHandle<'ctx> {
    type UpdateCallbackId = ZoneUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ZoneUpdateCallbackId {
        ZoneUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ZoneUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for ZoneTableHandle<'ctx> {
    type UpdateCallbackId = ZoneUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> ZoneUpdateCallbackId {
        ZoneUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: ZoneUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct ZoneIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Zone, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> ZoneTableHandle<'ctx> {
    pub fn id(&self) -> ZoneIdUnique<'ctx> {
        ZoneIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> ZoneIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Zone> {
        self.imp.find(col_val)
    }
}

pub struct ZoneSourceKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Zone, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> ZoneTableHandle<'ctx> {
    pub fn source_key(&self) -> ZoneSourceKeyUnique<'ctx> {
        ZoneSourceKeyUnique {
            imp: self.imp.get_unique_constraint::<String>("source_key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> ZoneSourceKeyUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<Zone> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Zone>("zone");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("source_key", |row| &row.source_key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Zone>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Zone>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait zoneQueryTableAccess {
    #[allow(non_snake_case)]
    fn zone(&self) -> __sdk::__query_builder::Table<Zone>;
}

impl zoneQueryTableAccess for __sdk::QueryTableAccessor {
    fn zone(&self) -> __sdk::__query_builder::Table<Zone> {
        __sdk::__query_builder::Table::new("zone")
    }
}
