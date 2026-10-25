#![allow(unused, clippy::all)]
use super::evidence_fact_type::EvidenceFact;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ClaimFactsTableHandle<'ctx> {
    imp: __sdk::TableHandle<EvidenceFact>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ClaimFactsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ClaimFactsTableAccessor {
    type Row = EvidenceFact;
    type Handle<'db> = ClaimFactsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.claim_facts()
    }
}

#[allow(non_camel_case_types)]
pub trait ClaimFactsTableAccess {
    #[allow(non_snake_case)]
    fn claim_facts(&self) -> ClaimFactsTableHandle<'_>;
}

impl ClaimFactsTableAccess for super::RemoteTables {
    fn claim_facts(&self) -> ClaimFactsTableHandle<'_> {
        ClaimFactsTableHandle {
            imp: self.imp.get_table::<EvidenceFact>("claim_facts"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ClaimFactsInsertCallbackId(__sdk::CallbackId);
pub struct ClaimFactsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ClaimFactsTableHandle<'ctx> {
    type Row = EvidenceFact;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EvidenceFact> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ClaimFactsTableHandle<'ctx> {
    type Row = EvidenceFact;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = EvidenceFact> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ClaimFactsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimFactsInsertCallbackId {
        ClaimFactsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimFactsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ClaimFactsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimFactsDeleteCallbackId {
        ClaimFactsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimFactsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ClaimFactsTableHandle<'ctx> {
    type InsertCallbackId = ClaimFactsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimFactsInsertCallbackId {
        ClaimFactsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimFactsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ClaimFactsTableHandle<'ctx> {
    type DeleteCallbackId = ClaimFactsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimFactsDeleteCallbackId {
        ClaimFactsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimFactsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<EvidenceFact>("claim_facts");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<EvidenceFact>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<EvidenceFact>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait claim_factsQueryTableAccess {
    #[allow(non_snake_case)]
    fn claim_facts(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<EvidenceFact>;
}

impl claim_factsQueryTableAccess for __sdk::QueryTableAccessor {
    fn claim_facts(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<EvidenceFact> {
        __sdk::__query_builder::ViewCall::new(
            "claim_facts",
            [__sdk::__query_builder::SqlLiteral::to_sql_literal(claim_id)],
        )
    }
}
