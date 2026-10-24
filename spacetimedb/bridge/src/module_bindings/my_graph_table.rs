#![allow(unused, clippy::all)]
use super::graph_link_type::GraphLink;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyGraphTableHandle<'ctx> {
    imp: __sdk::TableHandle<GraphLink>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyGraphTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyGraphTableAccessor {
    type Row = GraphLink;
    type Handle<'db> = MyGraphTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_graph()
    }
}

#[allow(non_camel_case_types)]
pub trait MyGraphTableAccess {
    #[allow(non_snake_case)]
    fn my_graph(&self) -> MyGraphTableHandle<'_>;
}

impl MyGraphTableAccess for super::RemoteTables {
    fn my_graph(&self) -> MyGraphTableHandle<'_> {
        MyGraphTableHandle {
            imp: self.imp.get_table::<GraphLink>("my_graph"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyGraphInsertCallbackId(__sdk::CallbackId);
pub struct MyGraphDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyGraphTableHandle<'ctx> {
    type Row = GraphLink;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = GraphLink> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyGraphTableHandle<'ctx> {
    type Row = GraphLink;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = GraphLink> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyGraphInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyGraphInsertCallbackId {
        MyGraphInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyGraphInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyGraphDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyGraphDeleteCallbackId {
        MyGraphDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyGraphDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyGraphTableHandle<'ctx> {
    type InsertCallbackId = MyGraphInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyGraphInsertCallbackId {
        MyGraphInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyGraphInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyGraphTableHandle<'ctx> {
    type DeleteCallbackId = MyGraphDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyGraphDeleteCallbackId {
        MyGraphDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyGraphDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<GraphLink>("my_graph");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<GraphLink>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<GraphLink>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_graphQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_graph(&self) -> __sdk::__query_builder::Table<GraphLink>;
}

impl my_graphQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_graph(&self) -> __sdk::__query_builder::Table<GraphLink> {
        __sdk::__query_builder::Table::new("my_graph")
    }
}
