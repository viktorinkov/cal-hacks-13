#![allow(unused, clippy::all)]
use super::attendee_type::Attendee;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SocialAttendeesTableHandle<'ctx> {
    imp: __sdk::TableHandle<Attendee>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SocialAttendeesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SocialAttendeesTableAccessor {
    type Row = Attendee;
    type Handle<'db> = SocialAttendeesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.social_attendees()
    }
}

#[allow(non_camel_case_types)]
pub trait SocialAttendeesTableAccess {
    #[allow(non_snake_case)]
    fn social_attendees(&self) -> SocialAttendeesTableHandle<'_>;
}

impl SocialAttendeesTableAccess for super::RemoteTables {
    fn social_attendees(&self) -> SocialAttendeesTableHandle<'_> {
        SocialAttendeesTableHandle {
            imp: self.imp.get_table::<Attendee>("social_attendees"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SocialAttendeesInsertCallbackId(__sdk::CallbackId);
pub struct SocialAttendeesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SocialAttendeesTableHandle<'ctx> {
    type Row = Attendee;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Attendee> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SocialAttendeesTableHandle<'ctx> {
    type Row = Attendee;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Attendee> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SocialAttendeesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialAttendeesInsertCallbackId {
        SocialAttendeesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialAttendeesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SocialAttendeesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialAttendeesDeleteCallbackId {
        SocialAttendeesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialAttendeesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SocialAttendeesTableHandle<'ctx> {
    type InsertCallbackId = SocialAttendeesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialAttendeesInsertCallbackId {
        SocialAttendeesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SocialAttendeesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SocialAttendeesTableHandle<'ctx> {
    type DeleteCallbackId = SocialAttendeesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SocialAttendeesDeleteCallbackId {
        SocialAttendeesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SocialAttendeesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Attendee>("social_attendees");
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
pub trait social_attendeesQueryTableAccess {
    #[allow(non_snake_case)]
    fn social_attendees(&self) -> __sdk::__query_builder::Table<Attendee>;
}

impl social_attendeesQueryTableAccess for __sdk::QueryTableAccessor {
    fn social_attendees(&self) -> __sdk::__query_builder::Table<Attendee> {
        __sdk::__query_builder::Table::new("social_attendees")
    }
}
