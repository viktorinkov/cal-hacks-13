#![allow(unused, clippy::all)]
use super::photo_tag_type::PhotoTag;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SocialPhotoTagsTableHandle<'ctx> {
    imp: __sdk::TableHandle<PhotoTag>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SocialPhotoTagsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SocialPhotoTagsTableAccessor {
    type Row = PhotoTag;
    type Handle<'db> = SocialPhotoTagsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.social_photo_tags()
    }
}

#[allow(non_camel_case_types)]
pub trait SocialPhotoTagsTableAccess {
    #[allow(non_snake_case)]
    fn social_photo_tags(&self) -> SocialPhotoTagsTableHandle<'_>;
}

impl SocialPhotoTagsTableAccess for super::RemoteTables {
    fn social_photo_tags(&self) -> SocialPhotoTagsTableHandle<'_> {
        SocialPhotoTagsTableHandle {
            imp: self.imp.get_table::<PhotoTag>("social_photo_tags"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SocialPhotoTagsInsertCallbackId(__sdk::CallbackId);
pub struct SocialPhotoTagsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SocialPhotoTagsTableHandle<'ctx> {
    type Row = PhotoTag;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = PhotoTag> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SocialPhotoTagsTableHandle<'ctx> {
    type Row = PhotoTag;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = PhotoTag> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SocialPhotoTagsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotoTagsInsertCallbackId {
        SocialPhotoTagsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialPhotoTagsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SocialPhotoTagsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotoTagsDeleteCallbackId {
        SocialPhotoTagsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialPhotoTagsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SocialPhotoTagsTableHandle<'ctx> {
    type InsertCallbackId = SocialPhotoTagsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotoTagsInsertCallbackId {
        SocialPhotoTagsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialPhotoTagsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SocialPhotoTagsTableHandle<'ctx> {
    type DeleteCallbackId = SocialPhotoTagsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialPhotoTagsDeleteCallbackId {
        SocialPhotoTagsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialPhotoTagsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<PhotoTag>("social_photo_tags");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<PhotoTag>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<PhotoTag>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait social_photo_tagsQueryTableAccess {
    #[allow(non_snake_case)]
    fn social_photo_tags(&self) -> __sdk::__query_builder::Table<PhotoTag>;
}

impl social_photo_tagsQueryTableAccess for __sdk::QueryTableAccessor {
    fn social_photo_tags(&self) -> __sdk::__query_builder::Table<PhotoTag> {
        __sdk::__query_builder::Table::new("social_photo_tags")
    }
}
