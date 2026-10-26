#![allow(unused, clippy::all)]
use super::attendee_type::Attendee;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyAttendeeTableHandle<'ctx> {
    imp: __sdk::TableHandle<Attendee>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyAttendeeTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyAttendeeTableAccessor {
    type Row = Attendee;
    type Handle<'db> = MyAttendeeTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_attendee()
    }
}

#[allow(non_camel_case_types)]
pub trait MyAttendeeTableAccess {
    #[allow(non_snake_case)]
    fn my_attendee(&self) -> MyAttendeeTableHandle<'_>;
}

impl MyAttendeeTableAccess for super::RemoteTables {
    fn my_attendee(&self) -> MyAttendeeTableHandle<'_> {
        MyAttendeeTableHandle {
            imp: self.imp.get_table::<Attendee>("my_attendee"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyAttendeeInsertCallbackId(__sdk::CallbackId);
pub struct MyAttendeeDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyAttendeeTableHandle<'ctx> {
    type Row = Attendee;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Attendee> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyAttendeeTableHandle<'ctx> {
    type Row = Attendee;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Attendee> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyAttendeeInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyAttendeeInsertCallbackId {
        MyAttendeeInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyAttendeeInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyAttendeeDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyAttendeeDeleteCallbackId {
        MyAttendeeDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyAttendeeDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyAttendeeTableHandle<'ctx> {
    type InsertCallbackId = MyAttendeeInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyAttendeeInsertCallbackId {
        MyAttendeeInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyAttendeeInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyAttendeeTableHandle<'ctx> {
    type DeleteCallbackId = MyAttendeeDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyAttendeeDeleteCallbackId {
        MyAttendeeDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyAttendeeDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Attendee>("my_attendee");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Attendee>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Attendee>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_attendeeQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_attendee(&self) -> __sdk::__query_builder::Table<Attendee>;
}

impl my_attendeeQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_attendee(&self) -> __sdk::__query_builder::Table<Attendee> {
        __sdk::__query_builder::Table::new("my_attendee")
    }
}
