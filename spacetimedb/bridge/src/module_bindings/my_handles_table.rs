#![allow(unused, clippy::all)]
use super::social_handle_type::SocialHandle;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyHandlesTableHandle<'ctx> {
    imp: __sdk::TableHandle<SocialHandle>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyHandlesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyHandlesTableAccessor {
    type Row = SocialHandle;
    type Handle<'db> = MyHandlesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_handles()
    }
}

#[allow(non_camel_case_types)]
pub trait MyHandlesTableAccess {
    #[allow(non_snake_case)]
    fn my_handles(&self) -> MyHandlesTableHandle<'_>;
}

impl MyHandlesTableAccess for super::RemoteTables {
    fn my_handles(&self) -> MyHandlesTableHandle<'_> {
        MyHandlesTableHandle {
            imp: self.imp.get_table::<SocialHandle>("my_handles"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyHandlesInsertCallbackId(__sdk::CallbackId);
pub struct MyHandlesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyHandlesTableHandle<'ctx> {
    type Row = SocialHandle;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SocialHandle> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyHandlesTableHandle<'ctx> {
    type Row = SocialHandle;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SocialHandle> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyHandlesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyHandlesInsertCallbackId {
        MyHandlesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyHandlesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyHandlesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyHandlesDeleteCallbackId {
        MyHandlesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyHandlesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyHandlesTableHandle<'ctx> {
    type InsertCallbackId = MyHandlesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyHandlesInsertCallbackId {
        MyHandlesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyHandlesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyHandlesTableHandle<'ctx> {
    type DeleteCallbackId = MyHandlesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyHandlesDeleteCallbackId {
        MyHandlesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyHandlesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<SocialHandle>("my_handles");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<SocialHandle>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<SocialHandle>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_handlesQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_handles(&self) -> __sdk::__query_builder::Table<SocialHandle>;
}

impl my_handlesQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_handles(&self) -> __sdk::__query_builder::Table<SocialHandle> {
        __sdk::__query_builder::Table::new("my_handles")
    }
}
