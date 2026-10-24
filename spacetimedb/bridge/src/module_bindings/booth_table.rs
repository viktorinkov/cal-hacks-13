#![allow(unused, clippy::all)]
use super::booth_type::Booth;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoothTableHandle<'ctx> {
    imp: __sdk::TableHandle<Booth>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoothTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoothTableAccessor {
    type Row = Booth;
    type Handle<'db> = BoothTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.booth()
    }
}

#[allow(non_camel_case_types)]
pub trait BoothTableAccess {
    #[allow(non_snake_case)]
    fn booth(&self) -> BoothTableHandle<'_>;
}

impl BoothTableAccess for super::RemoteTables {
    fn booth(&self) -> BoothTableHandle<'_> {
        BoothTableHandle {
            imp: self.imp.get_table::<Booth>("booth"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoothInsertCallbackId(__sdk::CallbackId);
pub struct BoothDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoothTableHandle<'ctx> {
    type Row = Booth;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Booth> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoothTableHandle<'ctx> {
    type Row = Booth;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Booth> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoothInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoothInsertCallbackId {
        BoothInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoothInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoothDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoothDeleteCallbackId {
        BoothDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoothDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoothTableHandle<'ctx> {
    type InsertCallbackId = BoothInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoothInsertCallbackId {
        BoothInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoothInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoothTableHandle<'ctx> {
    type DeleteCallbackId = BoothDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoothDeleteCallbackId {
        BoothDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoothDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct BoothUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for BoothTableHandle<'ctx> {
    type UpdateCallbackId = BoothUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BoothUpdateCallbackId {
        BoothUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BoothUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for BoothTableHandle<'ctx> {
    type UpdateCallbackId = BoothUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BoothUpdateCallbackId {
        BoothUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BoothUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct BoothIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Booth, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> BoothTableHandle<'ctx> {
    pub fn id(&self) -> BoothIdUnique<'ctx> {
        BoothIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> BoothIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Booth> {
        self.imp.find(col_val)
    }
}

pub struct BoothSourceKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Booth, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> BoothTableHandle<'ctx> {
    pub fn source_key(&self) -> BoothSourceKeyUnique<'ctx> {
        BoothSourceKeyUnique {
            imp: self.imp.get_unique_constraint::<String>("source_key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> BoothSourceKeyUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<Booth> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Booth>("booth");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("source_key", |row| &row.source_key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Booth>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Booth>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait boothQueryTableAccess {
    #[allow(non_snake_case)]
    fn booth(&self) -> __sdk::__query_builder::Table<Booth>;
}

impl boothQueryTableAccess for __sdk::QueryTableAccessor {
    fn booth(&self) -> __sdk::__query_builder::Table<Booth> {
        __sdk::__query_builder::Table::new("booth")
    }
}
