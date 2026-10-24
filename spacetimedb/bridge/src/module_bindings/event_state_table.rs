#![allow(unused, clippy::all)]
use super::event_state_type::EventState;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct EventStateTableHandle<'ctx> {
    imp: __sdk::TableHandle<EventState>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct EventStateTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for EventStateTableAccessor {
    type Row = EventState;
    type Handle<'db> = EventStateTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.event_state()
    }
}

#[allow(non_camel_case_types)]
pub trait EventStateTableAccess {
    #[allow(non_snake_case)]
    fn event_state(&self) -> EventStateTableHandle<'_>;
}

impl EventStateTableAccess for super::RemoteTables {
    fn event_state(&self) -> EventStateTableHandle<'_> {
        EventStateTableHandle {
            imp: self.imp.get_table::<EventState>("event_state"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct EventStateInsertCallbackId(__sdk::CallbackId);
pub struct EventStateDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for EventStateTableHandle<'ctx> {
    type Row = EventState;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EventState> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for EventStateTableHandle<'ctx> {
    type Row = EventState;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EventState> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = EventStateInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventStateInsertCallbackId {
        EventStateInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: EventStateInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = EventStateDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventStateDeleteCallbackId {
        EventStateDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: EventStateDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for EventStateTableHandle<'ctx> {
    type InsertCallbackId = EventStateInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventStateInsertCallbackId {
        EventStateInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: EventStateInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for EventStateTableHandle<'ctx> {
    type DeleteCallbackId = EventStateDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> EventStateDeleteCallbackId {
        EventStateDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: EventStateDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct EventStateUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for EventStateTableHandle<'ctx> {
    type UpdateCallbackId = EventStateUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> EventStateUpdateCallbackId {
        EventStateUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: EventStateUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for EventStateTableHandle<'ctx> {
    type UpdateCallbackId = EventStateUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> EventStateUpdateCallbackId {
        EventStateUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: EventStateUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct EventStateIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<EventState, u8>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> EventStateTableHandle<'ctx> {
    pub fn id(&self) -> EventStateIdUnique<'ctx> {
        EventStateIdUnique {
            imp: self.imp.get_unique_constraint::<u8>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> EventStateIdUnique<'ctx> {
    pub fn find(&self, col_val: &u8) -> Option<EventState> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<EventState>("event_state");
    _table.add_unique_constraint::<u8>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<EventState>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<EventState>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait event_stateQueryTableAccess {
    #[allow(non_snake_case)]
    fn event_state(&self) -> __sdk::__query_builder::Table<EventState>;
}

impl event_stateQueryTableAccess for __sdk::QueryTableAccessor {
    fn event_state(&self) -> __sdk::__query_builder::Table<EventState> {
        __sdk::__query_builder::Table::new("event_state")
    }
}
