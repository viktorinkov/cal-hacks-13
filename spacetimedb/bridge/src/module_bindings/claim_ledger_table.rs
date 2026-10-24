#![allow(unused, clippy::all)]
use super::ledger_entry_type::LedgerEntry;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ClaimLedgerTableHandle<'ctx> {
    imp: __sdk::TableHandle<LedgerEntry>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ClaimLedgerTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ClaimLedgerTableAccessor {
    type Row = LedgerEntry;
    type Handle<'db> = ClaimLedgerTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.claim_ledger()
    }
}

#[allow(non_camel_case_types)]
pub trait ClaimLedgerTableAccess {
    #[allow(non_snake_case)]
    fn claim_ledger(&self) -> ClaimLedgerTableHandle<'_>;
}

impl ClaimLedgerTableAccess for super::RemoteTables {
    fn claim_ledger(&self) -> ClaimLedgerTableHandle<'_> {
        ClaimLedgerTableHandle {
            imp: self.imp.get_table::<LedgerEntry>("claim_ledger"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ClaimLedgerInsertCallbackId(__sdk::CallbackId);
pub struct ClaimLedgerDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ClaimLedgerTableHandle<'ctx> {
    type Row = LedgerEntry;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = LedgerEntry> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ClaimLedgerTableHandle<'ctx> {
    type Row = LedgerEntry;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = LedgerEntry> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ClaimLedgerInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLedgerInsertCallbackId {
        ClaimLedgerInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimLedgerInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ClaimLedgerDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLedgerDeleteCallbackId {
        ClaimLedgerDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimLedgerDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ClaimLedgerTableHandle<'ctx> {
    type InsertCallbackId = ClaimLedgerInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLedgerInsertCallbackId {
        ClaimLedgerInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimLedgerInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ClaimLedgerTableHandle<'ctx> {
    type DeleteCallbackId = ClaimLedgerDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimLedgerDeleteCallbackId {
        ClaimLedgerDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimLedgerDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<LedgerEntry>("claim_ledger");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<LedgerEntry>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<LedgerEntry>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait claim_ledgerQueryTableAccess {
    #[allow(non_snake_case)]
    fn claim_ledger(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<LedgerEntry>;
}

impl claim_ledgerQueryTableAccess for __sdk::QueryTableAccessor {
    fn claim_ledger(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<LedgerEntry> {
        __sdk::__query_builder::ViewCall::new(
            "claim_ledger",
            [__sdk::__query_builder::SqlLiteral::to_sql_literal(claim_id)],
        )
    }
}
