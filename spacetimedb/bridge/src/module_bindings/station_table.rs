#![allow(unused, clippy::all)]
use super::station_type::Station;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct StationTableHandle<'ctx> {
    imp: __sdk::TableHandle<Station>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct StationTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for StationTableAccessor {
    type Row = Station;
    type Handle<'db> = StationTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.station()
    }
}

#[allow(non_camel_case_types)]
pub trait StationTableAccess {
    #[allow(non_snake_case)]
    fn station(&self) -> StationTableHandle<'_>;
}

impl StationTableAccess for super::RemoteTables {
    fn station(&self) -> StationTableHandle<'_> {
        StationTableHandle {
            imp: self.imp.get_table::<Station>("station"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct StationInsertCallbackId(__sdk::CallbackId);
pub struct StationDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for StationTableHandle<'ctx> {
    type Row = Station;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Station> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for StationTableHandle<'ctx> {
    type Row = Station;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Station> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = StationInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> StationInsertCallbackId {
        StationInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: StationInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = StationDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> StationDeleteCallbackId {
        StationDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: StationDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for StationTableHandle<'ctx> {
    type InsertCallbackId = StationInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> StationInsertCallbackId {
        StationInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: StationInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for StationTableHandle<'ctx> {
    type DeleteCallbackId = StationDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> StationDeleteCallbackId {
        StationDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: StationDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct StationUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for StationTableHandle<'ctx> {
    type UpdateCallbackId = StationUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> StationUpdateCallbackId {
        StationUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: StationUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for StationTableHandle<'ctx> {
    type UpdateCallbackId = StationUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> StationUpdateCallbackId {
        StationUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: StationUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct StationIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Station, u8>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> StationTableHandle<'ctx> {
    pub fn id(&self) -> StationIdUnique<'ctx> {
        StationIdUnique {
            imp: self.imp.get_unique_constraint::<u8>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> StationIdUnique<'ctx> {
    pub fn find(&self, col_val: &u8) -> Option<Station> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Station>("station");
    _table.add_unique_constraint::<u8>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Station>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Station>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait stationQueryTableAccess {
    #[allow(non_snake_case)]
    fn station(&self) -> __sdk::__query_builder::Table<Station>;
}

impl stationQueryTableAccess for __sdk::QueryTableAccessor {
    fn station(&self) -> __sdk::__query_builder::Table<Station> {
        __sdk::__query_builder::Table::new("station")
    }
}
