#![allow(unused, clippy::all)]
use super::visit_type::Visit;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SocialVisitsTableHandle<'ctx> {
    imp: __sdk::TableHandle<Visit>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SocialVisitsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SocialVisitsTableAccessor {
    type Row = Visit;
    type Handle<'db> = SocialVisitsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.social_visits()
    }
}

#[allow(non_camel_case_types)]
pub trait SocialVisitsTableAccess {
    #[allow(non_snake_case)]
    fn social_visits(&self) -> SocialVisitsTableHandle<'_>;
}

impl SocialVisitsTableAccess for super::RemoteTables {
    fn social_visits(&self) -> SocialVisitsTableHandle<'_> {
        SocialVisitsTableHandle {
            imp: self.imp.get_table::<Visit>("social_visits"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SocialVisitsInsertCallbackId(__sdk::CallbackId);
pub struct SocialVisitsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SocialVisitsTableHandle<'ctx> {
    type Row = Visit;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Visit> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SocialVisitsTableHandle<'ctx> {
    type Row = Visit;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Visit> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SocialVisitsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialVisitsInsertCallbackId {
        SocialVisitsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialVisitsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SocialVisitsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialVisitsDeleteCallbackId {
        SocialVisitsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialVisitsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SocialVisitsTableHandle<'ctx> {
    type InsertCallbackId = SocialVisitsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialVisitsInsertCallbackId {
        SocialVisitsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialVisitsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SocialVisitsTableHandle<'ctx> {
    type DeleteCallbackId = SocialVisitsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialVisitsDeleteCallbackId {
        SocialVisitsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialVisitsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Visit>("social_visits");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Visit>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Visit>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait social_visitsQueryTableAccess {
    #[allow(non_snake_case)]
    fn social_visits(&self) -> __sdk::__query_builder::Table<Visit>;
}

impl social_visitsQueryTableAccess for __sdk::QueryTableAccessor {
    fn social_visits(&self) -> __sdk::__query_builder::Table<Visit> {
        __sdk::__query_builder::Table::new("social_visits")
    }
}
