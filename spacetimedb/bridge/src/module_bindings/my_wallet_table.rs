#![allow(unused, clippy::all)]
use super::my_wallet_type::MyWallet;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyWalletTableHandle<'ctx> {
    imp: __sdk::TableHandle<MyWallet>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyWalletTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyWalletTableAccessor {
    type Row = MyWallet;
    type Handle<'db> = MyWalletTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_wallet()
    }
}

#[allow(non_camel_case_types)]
pub trait MyWalletTableAccess {
    #[allow(non_snake_case)]
    fn my_wallet(&self) -> MyWalletTableHandle<'_>;
}

impl MyWalletTableAccess for super::RemoteTables {
    fn my_wallet(&self) -> MyWalletTableHandle<'_> {
        MyWalletTableHandle {
            imp: self.imp.get_table::<MyWallet>("my_wallet"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyWalletInsertCallbackId(__sdk::CallbackId);
pub struct MyWalletDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyWalletTableHandle<'ctx> {
    type Row = MyWallet;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MyWallet> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyWalletTableHandle<'ctx> {
    type Row = MyWallet;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MyWallet> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyWalletInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletInsertCallbackId {
        MyWalletInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyWalletInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyWalletDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletDeleteCallbackId {
        MyWalletDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyWalletDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyWalletTableHandle<'ctx> {
    type InsertCallbackId = MyWalletInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletInsertCallbackId {
        MyWalletInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyWalletInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyWalletTableHandle<'ctx> {
    type DeleteCallbackId = MyWalletDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyWalletDeleteCallbackId {
        MyWalletDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyWalletDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<MyWallet>("my_wallet");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<MyWallet>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<MyWallet>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_walletQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_wallet(&self) -> __sdk::__query_builder::Table<MyWallet>;
}

impl my_walletQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_wallet(&self) -> __sdk::__query_builder::Table<MyWallet> {
        __sdk::__query_builder::Table::new("my_wallet")
    }
}
