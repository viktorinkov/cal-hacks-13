#![allow(unused, clippy::all)]
use super::wallet_entry_type::WalletEntry;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyWalletEntriesTableHandle<'ctx> {
    imp: __sdk::TableHandle<WalletEntry>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyWalletEntriesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyWalletEntriesTableAccessor {
    type Row = WalletEntry;
    type Handle<'db> = MyWalletEntriesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_wallet_entries()
    }
}

#[allow(non_camel_case_types)]
pub trait MyWalletEntriesTableAccess {
    #[allow(non_snake_case)]
    fn my_wallet_entries(&self) -> MyWalletEntriesTableHandle<'_>;
}

impl MyWalletEntriesTableAccess for super::RemoteTables {
    fn my_wallet_entries(&self) -> MyWalletEntriesTableHandle<'_> {
        MyWalletEntriesTableHandle {
            imp: self.imp.get_table::<WalletEntry>("my_wallet_entries"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyWalletEntriesInsertCallbackId(__sdk::CallbackId);
pub struct MyWalletEntriesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyWalletEntriesTableHandle<'ctx> {
    type Row = WalletEntry;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = WalletEntry> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyWalletEntriesTableHandle<'ctx> {
    type Row = WalletEntry;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = WalletEntry> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyWalletEntriesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletEntriesInsertCallbackId {
        MyWalletEntriesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyWalletEntriesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyWalletEntriesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletEntriesDeleteCallbackId {
        MyWalletEntriesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyWalletEntriesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyWalletEntriesTableHandle<'ctx> {
    type InsertCallbackId = MyWalletEntriesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletEntriesInsertCallbackId {
        MyWalletEntriesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyWalletEntriesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyWalletEntriesTableHandle<'ctx> {
    type DeleteCallbackId = MyWalletEntriesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletEntriesDeleteCallbackId {
        MyWalletEntriesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyWalletEntriesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<WalletEntry>("my_wallet_entries");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<WalletEntry>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<WalletEntry>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_wallet_entriesQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_wallet_entries(&self) -> __sdk::__query_builder::Table<WalletEntry>;
}

impl my_wallet_entriesQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_wallet_entries(&self) -> __sdk::__query_builder::Table<WalletEntry> {
        __sdk::__query_builder::Table::new("my_wallet_entries")
    }
}
