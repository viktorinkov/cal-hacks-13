#![allow(unused, clippy::all)]
use super::band_type::Band;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BandTableHandle<'ctx> {
    imp: __sdk::TableHandle<Band>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BandTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BandTableAccessor {
    type Row = Band;
    type Handle<'db> = BandTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.band()
    }
}

#[allow(non_camel_case_types)]
pub trait BandTableAccess {
    #[allow(non_snake_case)]
    fn band(&self) -> BandTableHandle<'_>;
}

impl BandTableAccess for super::RemoteTables {
    fn band(&self) -> BandTableHandle<'_> {
        BandTableHandle {
            imp: self.imp.get_table::<Band>("band"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BandInsertCallbackId(__sdk::CallbackId);
pub struct BandDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BandTableHandle<'ctx> {
    type Row = Band;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Band> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BandTableHandle<'ctx> {
    type Row = Band;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Band> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BandInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BandInsertCallbackId {
        BandInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BandInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BandDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BandDeleteCallbackId {
        BandDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BandDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BandTableHandle<'ctx> {
    type InsertCallbackId = BandInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BandInsertCallbackId {
        BandInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BandInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BandTableHandle<'ctx> {
    type DeleteCallbackId = BandDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BandDeleteCallbackId {
        BandDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BandDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct BandUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for BandTableHandle<'ctx> {
    type UpdateCallbackId = BandUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BandUpdateCallbackId {
        BandUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BandUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for BandTableHandle<'ctx> {
    type UpdateCallbackId = BandUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BandUpdateCallbackId {
        BandUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BandUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct BandIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Band, u8>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> BandTableHandle<'ctx> {
    pub fn id(&self) -> BandIdUnique<'ctx> {
        BandIdUnique {
            imp: self.imp.get_unique_constraint::<u8>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> BandIdUnique<'ctx> {
    pub fn find(&self, col_val: &u8) -> Option<Band> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Band>("band");
    _table.add_unique_constraint::<u8>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Band>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Band>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait bandQueryTableAccess {
    #[allow(non_snake_case)]
    fn band(&self) -> __sdk::__query_builder::Table<Band>;
}

impl bandQueryTableAccess for __sdk::QueryTableAccessor {
    fn band(&self) -> __sdk::__query_builder::Table<Band> {
        __sdk::__query_builder::Table::new("band")
    }
}
