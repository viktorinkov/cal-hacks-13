#![allow(unused, clippy::all)]
use super::my_visit_type::MyVisit;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyVisitsTableHandle<'ctx> {
    imp: __sdk::TableHandle<MyVisit>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyVisitsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyVisitsTableAccessor {
    type Row = MyVisit;
    type Handle<'db> = MyVisitsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_visits()
    }
}

#[allow(non_camel_case_types)]
pub trait MyVisitsTableAccess {
    #[allow(non_snake_case)]
    fn my_visits(&self) -> MyVisitsTableHandle<'_>;
}

impl MyVisitsTableAccess for super::RemoteTables {
    fn my_visits(&self) -> MyVisitsTableHandle<'_> {
        MyVisitsTableHandle {
            imp: self.imp.get_table::<MyVisit>("my_visits"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyVisitsInsertCallbackId(__sdk::CallbackId);
pub struct MyVisitsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyVisitsTableHandle<'ctx> {
    type Row = MyVisit;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MyVisit> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyVisitsTableHandle<'ctx> {
    type Row = MyVisit;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MyVisit> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyVisitsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyVisitsInsertCallbackId {
        MyVisitsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyVisitsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyVisitsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyVisitsDeleteCallbackId {
        MyVisitsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyVisitsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyVisitsTableHandle<'ctx> {
    type InsertCallbackId = MyVisitsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyVisitsInsertCallbackId {
        MyVisitsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyVisitsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyVisitsTableHandle<'ctx> {
    type DeleteCallbackId = MyVisitsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyVisitsDeleteCallbackId {
        MyVisitsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyVisitsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<MyVisit>("my_visits");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<MyVisit>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<MyVisit>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_visitsQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_visits(&self) -> __sdk::__query_builder::Table<MyVisit>;
}

impl my_visitsQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_visits(&self) -> __sdk::__query_builder::Table<MyVisit> {
        __sdk::__query_builder::Table::new("my_visits")
    }
}
