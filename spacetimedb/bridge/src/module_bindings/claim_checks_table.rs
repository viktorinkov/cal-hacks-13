#![allow(unused, clippy::all)]
use super::claim_check_type::ClaimCheck;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ClaimChecksTableHandle<'ctx> {
    imp: __sdk::TableHandle<ClaimCheck>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ClaimChecksTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ClaimChecksTableAccessor {
    type Row = ClaimCheck;
    type Handle<'db> = ClaimChecksTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.claim_checks()
    }
}

#[allow(non_camel_case_types)]
pub trait ClaimChecksTableAccess {
    #[allow(non_snake_case)]
    fn claim_checks(&self) -> ClaimChecksTableHandle<'_>;
}

impl ClaimChecksTableAccess for super::RemoteTables {
    fn claim_checks(&self) -> ClaimChecksTableHandle<'_> {
        ClaimChecksTableHandle {
            imp: self.imp.get_table::<ClaimCheck>("claim_checks"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ClaimChecksInsertCallbackId(__sdk::CallbackId);
pub struct ClaimChecksDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ClaimChecksTableHandle<'ctx> {
    type Row = ClaimCheck;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimCheck> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ClaimChecksTableHandle<'ctx> {
    type Row = ClaimCheck;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimCheck> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ClaimChecksInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimChecksInsertCallbackId {
        ClaimChecksInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimChecksInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ClaimChecksDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimChecksDeleteCallbackId {
        ClaimChecksDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimChecksDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ClaimChecksTableHandle<'ctx> {
    type InsertCallbackId = ClaimChecksInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimChecksInsertCallbackId {
        ClaimChecksInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimChecksInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ClaimChecksTableHandle<'ctx> {
    type DeleteCallbackId = ClaimChecksDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimChecksDeleteCallbackId {
        ClaimChecksDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimChecksDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ClaimCheck>("claim_checks");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ClaimCheck>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ClaimCheck>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait claim_checksQueryTableAccess {
    #[allow(non_snake_case)]
    fn claim_checks(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<ClaimCheck>;
}

impl claim_checksQueryTableAccess for __sdk::QueryTableAccessor {
    fn claim_checks(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<ClaimCheck> {
        __sdk::__query_builder::ViewCall::new(
            "claim_checks",
            [__sdk::__query_builder::SqlLiteral::to_sql_literal(claim_id)],
        )
    }
}
