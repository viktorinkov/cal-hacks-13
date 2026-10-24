#![allow(unused, clippy::all)]
use super::link_type::Link;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct LinkTableHandle<'ctx> {
    imp: __sdk::TableHandle<Link>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct LinkTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for LinkTableAccessor {
    type Row = Link;
    type Handle<'db> = LinkTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.link()
    }
}

#[allow(non_camel_case_types)]
pub trait LinkTableAccess {
    #[allow(non_snake_case)]
    fn link(&self) -> LinkTableHandle<'_>;
}

impl LinkTableAccess for super::RemoteTables {
    fn link(&self) -> LinkTableHandle<'_> {
        LinkTableHandle {
            imp: self.imp.get_table::<Link>("link"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct LinkInsertCallbackId(__sdk::CallbackId);
pub struct LinkDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for LinkTableHandle<'ctx> {
    type Row = Link;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Link> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for LinkTableHandle<'ctx> {
    type Row = Link;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Link> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = LinkInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> LinkInsertCallbackId {
        LinkInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: LinkInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = LinkDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> LinkDeleteCallbackId {
        LinkDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: LinkDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for LinkTableHandle<'ctx> {
    type InsertCallbackId = LinkInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> LinkInsertCallbackId {
        LinkInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: LinkInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for LinkTableHandle<'ctx> {
    type DeleteCallbackId = LinkDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> LinkDeleteCallbackId {
        LinkDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: LinkDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct LinkUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for LinkTableHandle<'ctx> {
    type UpdateCallbackId = LinkUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> LinkUpdateCallbackId {
        LinkUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: LinkUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for LinkTableHandle<'ctx> {
    type UpdateCallbackId = LinkUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> LinkUpdateCallbackId {
        LinkUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: LinkUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct LinkKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Link, u16>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> LinkTableHandle<'ctx> {
    pub fn key(&self) -> LinkKeyUnique<'ctx> {
        LinkKeyUnique {
            imp: self.imp.get_unique_constraint::<u16>("key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> LinkKeyUnique<'ctx> {
    pub fn find(&self, col_val: &u16) -> Option<Link> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Link>("link");
    _table.add_unique_constraint::<u16>("key", |row| &row.key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Link>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Link>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait linkQueryTableAccess {
    #[allow(non_snake_case)]
    fn link(&self) -> __sdk::__query_builder::Table<Link>;
}

impl linkQueryTableAccess for __sdk::QueryTableAccessor {
    fn link(&self) -> __sdk::__query_builder::Table<Link> {
        __sdk::__query_builder::Table::new("link")
    }
}
