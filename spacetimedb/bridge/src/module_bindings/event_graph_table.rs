#![allow(unused, clippy::all)]
use super::event_link_type::EventLink;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct EventGraphTableHandle<'ctx> {
    imp: __sdk::TableHandle<EventLink>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct EventGraphTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for EventGraphTableAccessor {
    type Row = EventLink;
    type Handle<'db> = EventGraphTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.event_graph()
    }
}

#[allow(non_camel_case_types)]
pub trait EventGraphTableAccess {
    #[allow(non_snake_case)]
    fn event_graph(&self) -> EventGraphTableHandle<'_>;
}

impl EventGraphTableAccess for super::RemoteTables {
    fn event_graph(&self) -> EventGraphTableHandle<'_> {
        EventGraphTableHandle {
            imp: self.imp.get_table::<EventLink>("event_graph"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct EventGraphInsertCallbackId(__sdk::CallbackId);
pub struct EventGraphDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for EventGraphTableHandle<'ctx> {
    type Row = EventLink;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EventLink> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for EventGraphTableHandle<'ctx> {
    type Row = EventLink;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EventLink> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = EventGraphInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventGraphInsertCallbackId {
        EventGraphInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: EventGraphInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = EventGraphDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventGraphDeleteCallbackId {
        EventGraphDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: EventGraphDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for EventGraphTableHandle<'ctx> {
    type InsertCallbackId = EventGraphInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventGraphInsertCallbackId {
        EventGraphInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: EventGraphInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for EventGraphTableHandle<'ctx> {
    type DeleteCallbackId = EventGraphDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventGraphDeleteCallbackId {
        EventGraphDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: EventGraphDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<EventLink>("event_graph");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<EventLink>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<EventLink>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait event_graphQueryTableAccess {
    #[allow(non_snake_case)]
    fn event_graph(&self) -> __sdk::__query_builder::Table<EventLink>;
}

impl event_graphQueryTableAccess for __sdk::QueryTableAccessor {
    fn event_graph(&self) -> __sdk::__query_builder::Table<EventLink> {
        __sdk::__query_builder::Table::new("event_graph")
    }
}
