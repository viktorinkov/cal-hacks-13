#![allow(unused, clippy::all)]
use super::social_encounter_type::SocialEncounter;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SocialEncountersTableHandle<'ctx> {
    imp: __sdk::TableHandle<SocialEncounter>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SocialEncountersTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SocialEncountersTableAccessor {
    type Row = SocialEncounter;
    type Handle<'db> = SocialEncountersTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.social_encounters()
    }
}

#[allow(non_camel_case_types)]
pub trait SocialEncountersTableAccess {
    #[allow(non_snake_case)]
    fn social_encounters(&self) -> SocialEncountersTableHandle<'_>;
}

impl SocialEncountersTableAccess for super::RemoteTables {
    fn social_encounters(&self) -> SocialEncountersTableHandle<'_> {
        SocialEncountersTableHandle {
            imp: self.imp.get_table::<SocialEncounter>("social_encounters"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SocialEncountersInsertCallbackId(__sdk::CallbackId);
pub struct SocialEncountersDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SocialEncountersTableHandle<'ctx> {
    type Row = SocialEncounter;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SocialEncounter> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SocialEncountersTableHandle<'ctx> {
    type Row = SocialEncounter;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SocialEncounter> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SocialEncountersInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialEncountersInsertCallbackId {
        SocialEncountersInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialEncountersInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SocialEncountersDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialEncountersDeleteCallbackId {
        SocialEncountersDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialEncountersDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SocialEncountersTableHandle<'ctx> {
    type InsertCallbackId = SocialEncountersInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialEncountersInsertCallbackId {
        SocialEncountersInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialEncountersInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SocialEncountersTableHandle<'ctx> {
    type DeleteCallbackId = SocialEncountersDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialEncountersDeleteCallbackId {
        SocialEncountersDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialEncountersDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<SocialEncounter>("social_encounters");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<SocialEncounter>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<SocialEncounter>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait social_encountersQueryTableAccess {
    #[allow(non_snake_case)]
    fn social_encounters(&self) -> __sdk::__query_builder::Table<SocialEncounter>;
}

impl social_encountersQueryTableAccess for __sdk::QueryTableAccessor {
    fn social_encounters(&self) -> __sdk::__query_builder::Table<SocialEncounter> {
        __sdk::__query_builder::Table::new("social_encounters")
    }
}
