#![allow(unused, clippy::all)]
use super::photo_type::Photo;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SocialPhotosTableHandle<'ctx> {
    imp: __sdk::TableHandle<Photo>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SocialPhotosTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SocialPhotosTableAccessor {
    type Row = Photo;
    type Handle<'db> = SocialPhotosTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.social_photos()
    }
}

#[allow(non_camel_case_types)]
pub trait SocialPhotosTableAccess {
    #[allow(non_snake_case)]
    fn social_photos(&self) -> SocialPhotosTableHandle<'_>;
}

impl SocialPhotosTableAccess for super::RemoteTables {
    fn social_photos(&self) -> SocialPhotosTableHandle<'_> {
        SocialPhotosTableHandle {
            imp: self.imp.get_table::<Photo>("social_photos"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SocialPhotosInsertCallbackId(__sdk::CallbackId);
pub struct SocialPhotosDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SocialPhotosTableHandle<'ctx> {
    type Row = Photo;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Photo> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SocialPhotosTableHandle<'ctx> {
    type Row = Photo;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Photo> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SocialPhotosInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotosInsertCallbackId {
        SocialPhotosInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialPhotosInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SocialPhotosDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotosDeleteCallbackId {
        SocialPhotosDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialPhotosDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SocialPhotosTableHandle<'ctx> {
    type InsertCallbackId = SocialPhotosInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotosInsertCallbackId {
        SocialPhotosInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialPhotosInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SocialPhotosTableHandle<'ctx> {
    type DeleteCallbackId = SocialPhotosDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotosDeleteCallbackId {
        SocialPhotosDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialPhotosDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Photo>("social_photos");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Photo>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Photo>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait social_photosQueryTableAccess {
    #[allow(non_snake_case)]
    fn social_photos(&self) -> __sdk::__query_builder::Table<Photo>;
}

impl social_photosQueryTableAccess for __sdk::QueryTableAccessor {
    fn social_photos(&self) -> __sdk::__query_builder::Table<Photo> {
        __sdk::__query_builder::Table::new("social_photos")
    }
}
