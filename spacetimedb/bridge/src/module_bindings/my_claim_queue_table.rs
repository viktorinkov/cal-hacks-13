#![allow(unused, clippy::all)]
use super::claim_status_type::ClaimStatus;
use super::claim_type::Claim;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MyClaimQueueTableHandle<'ctx> {
    imp: __sdk::TableHandle<Claim>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MyClaimQueueTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MyClaimQueueTableAccessor {
    type Row = Claim;
    type Handle<'db> = MyClaimQueueTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.my_claim_queue()
    }
}

#[allow(non_camel_case_types)]
pub trait MyClaimQueueTableAccess {
    #[allow(non_snake_case)]
    fn my_claim_queue(&self) -> MyClaimQueueTableHandle<'_>;
}

impl MyClaimQueueTableAccess for super::RemoteTables {
    fn my_claim_queue(&self) -> MyClaimQueueTableHandle<'_> {
        MyClaimQueueTableHandle {
            imp: self.imp.get_table::<Claim>("my_claim_queue"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MyClaimQueueInsertCallbackId(__sdk::CallbackId);
pub struct MyClaimQueueDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MyClaimQueueTableHandle<'ctx> {
    type Row = Claim;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Claim> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MyClaimQueueTableHandle<'ctx> {
    type Row = Claim;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Claim> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MyClaimQueueInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyClaimQueueInsertCallbackId {
        MyClaimQueueInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyClaimQueueInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MyClaimQueueDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyClaimQueueDeleteCallbackId {
        MyClaimQueueDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyClaimQueueDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MyClaimQueueTableHandle<'ctx> {
    type InsertCallbackId = MyClaimQueueInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyClaimQueueInsertCallbackId {
        MyClaimQueueInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MyClaimQueueInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MyClaimQueueTableHandle<'ctx> {
    type DeleteCallbackId = MyClaimQueueDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MyClaimQueueDeleteCallbackId {
        MyClaimQueueDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MyClaimQueueDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Claim>("my_claim_queue");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Claim>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Claim>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait my_claim_queueQueryTableAccess {
    #[allow(non_snake_case)]
    fn my_claim_queue(&self) -> __sdk::__query_builder::Table<Claim>;
}

impl my_claim_queueQueryTableAccess for __sdk::QueryTableAccessor {
    fn my_claim_queue(&self) -> __sdk::__query_builder::Table<Claim> {
        __sdk::__query_builder::Table::new("my_claim_queue")
    }
}
