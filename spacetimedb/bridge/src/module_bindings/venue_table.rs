#![allow(unused, clippy::all)]
use super::fact_type::Fact;
use super::venue_type::Venue;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct VenueTableHandle<'ctx> {
    imp: __sdk::TableHandle<Venue>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct VenueTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for VenueTableAccessor {
    type Row = Venue;
    type Handle<'db> = VenueTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.venue()
    }
}

#[allow(non_camel_case_types)]
pub trait VenueTableAccess {
    #[allow(non_snake_case)]
    fn venue(&self) -> VenueTableHandle<'_>;
}

impl VenueTableAccess for super::RemoteTables {
    fn venue(&self) -> VenueTableHandle<'_> {
        VenueTableHandle {
            imp: self.imp.get_table::<Venue>("venue"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct VenueInsertCallbackId(__sdk::CallbackId);
pub struct VenueDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for VenueTableHandle<'ctx> {
    type Row = Venue;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Venue> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for VenueTableHandle<'ctx> {
    type Row = Venue;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Venue> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = VenueInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> VenueInsertCallbackId {
        VenueInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: VenueInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = VenueDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> VenueDeleteCallbackId {
        VenueDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: VenueDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for VenueTableHandle<'ctx> {
    type InsertCallbackId = VenueInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> VenueInsertCallbackId {
        VenueInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: VenueInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for VenueTableHandle<'ctx> {
    type DeleteCallbackId = VenueDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> VenueDeleteCallbackId {
        VenueDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: VenueDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct VenueUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for VenueTableHandle<'ctx> {
    type UpdateCallbackId = VenueUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> VenueUpdateCallbackId {
        VenueUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: VenueUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for VenueTableHandle<'ctx> {
    type UpdateCallbackId = VenueUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> VenueUpdateCallbackId {
        VenueUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: VenueUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct VenueIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Venue, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> VenueTableHandle<'ctx> {
    pub fn id(&self) -> VenueIdUnique<'ctx> {
        VenueIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> VenueIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Venue> {
        self.imp.find(col_val)
    }
}

pub struct VenueSourceKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Venue, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> VenueTableHandle<'ctx> {
    pub fn source_key(&self) -> VenueSourceKeyUnique<'ctx> {
        VenueSourceKeyUnique {
            imp: self.imp.get_unique_constraint::<String>("source_key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> VenueSourceKeyUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<Venue> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Venue>("venue");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("source_key", |row| &row.source_key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Venue>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Venue>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait venueQueryTableAccess {
    #[allow(non_snake_case)]
    fn venue(&self) -> __sdk::__query_builder::Table<Venue>;
}

impl venueQueryTableAccess for __sdk::QueryTableAccessor {
    fn venue(&self) -> __sdk::__query_builder::Table<Venue> {
        __sdk::__query_builder::Table::new("venue")
    }
}
