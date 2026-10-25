#![allow(unused, clippy::all)]
use super::social_handle_type::SocialHandle;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SocialHandlesTableHandle<'ctx> {
    imp: __sdk::TableHandle<SocialHandle>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SocialHandlesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SocialHandlesTableAccessor {
    type Row = SocialHandle;
    type Handle<'db> = SocialHandlesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.social_handles()
    }
}

#[allow(non_camel_case_types)]
pub trait SocialHandlesTableAccess {
    #[allow(non_snake_case)]
    fn social_handles(&self) -> SocialHandlesTableHandle<'_>;
}

impl SocialHandlesTableAccess for super::RemoteTables {
    fn social_handles(&self) -> SocialHandlesTableHandle<'_> {
        SocialHandlesTableHandle {
            imp: self.imp.get_table::<SocialHandle>("social_handles"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SocialHandlesInsertCallbackId(__sdk::CallbackId);
pub struct SocialHandlesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SocialHandlesTableHandle<'ctx> {
    type Row = SocialHandle;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SocialHandle> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SocialHandlesTableHandle<'ctx> {
    type Row = SocialHandle;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SocialHandle> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SocialHandlesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialHandlesInsertCallbackId {
        SocialHandlesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialHandlesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SocialHandlesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialHandlesDeleteCallbackId {
        SocialHandlesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialHandlesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SocialHandlesTableHandle<'ctx> {
    type InsertCallbackId = SocialHandlesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialHandlesInsertCallbackId {
        SocialHandlesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialHandlesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SocialHandlesTableHandle<'ctx> {
    type DeleteCallbackId = SocialHandlesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialHandlesDeleteCallbackId {
        SocialHandlesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialHandlesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<SocialHandle>("social_handles");
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
pub trait social_handlesQueryTableAccess {
    #[allow(non_snake_case)]
    fn social_handles(&self) -> __sdk::__query_builder::Table<SocialHandle>;
}

impl social_handlesQueryTableAccess for __sdk::QueryTableAccessor {
    fn social_handles(&self) -> __sdk::__query_builder::Table<SocialHandle> {
        __sdk::__query_builder::Table::new("social_handles")
    }
}
