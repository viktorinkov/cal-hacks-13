#![allow(unused, clippy::all)]
use super::incident_kind_type::IncidentKind;
use super::incident_status_type::IncidentStatus;
use super::incident_type::Incident;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct OpenIncidentsTableHandle<'ctx> {
    imp: __sdk::TableHandle<Incident>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct OpenIncidentsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for OpenIncidentsTableAccessor {
    type Row = Incident;
    type Handle<'db> = OpenIncidentsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.open_incidents()
    }
}

#[allow(non_camel_case_types)]
pub trait OpenIncidentsTableAccess {
    #[allow(non_snake_case)]
    fn open_incidents(&self) -> OpenIncidentsTableHandle<'_>;
}

impl OpenIncidentsTableAccess for super::RemoteTables {
    fn open_incidents(&self) -> OpenIncidentsTableHandle<'_> {
        OpenIncidentsTableHandle {
            imp: self.imp.get_table::<Incident>("open_incidents"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct OpenIncidentsInsertCallbackId(__sdk::CallbackId);
pub struct OpenIncidentsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for OpenIncidentsTableHandle<'ctx> {
    type Row = Incident;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Incident> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for OpenIncidentsTableHandle<'ctx> {
    type Row = Incident;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Incident> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = OpenIncidentsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OpenIncidentsInsertCallbackId {
        OpenIncidentsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: OpenIncidentsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = OpenIncidentsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OpenIncidentsDeleteCallbackId {
        OpenIncidentsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: OpenIncidentsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for OpenIncidentsTableHandle<'ctx> {
    type InsertCallbackId = OpenIncidentsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OpenIncidentsInsertCallbackId {
        OpenIncidentsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: OpenIncidentsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for OpenIncidentsTableHandle<'ctx> {
    type DeleteCallbackId = OpenIncidentsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OpenIncidentsDeleteCallbackId {
        OpenIncidentsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: OpenIncidentsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Incident>("open_incidents");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Incident>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Incident>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait open_incidentsQueryTableAccess {
    #[allow(non_snake_case)]
    fn open_incidents(&self) -> __sdk::__query_builder::Table<Incident>;
}

impl open_incidentsQueryTableAccess for __sdk::QueryTableAccessor {
    fn open_incidents(&self) -> __sdk::__query_builder::Table<Incident> {
        __sdk::__query_builder::Table::new("open_incidents")
    }
}
