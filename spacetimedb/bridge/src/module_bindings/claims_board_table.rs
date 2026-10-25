#![allow(unused, clippy::all)]
use super::claim_status_type::ClaimStatus;
use super::claim_type::Claim;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ClaimsBoardTableHandle<'ctx> {
    imp: __sdk::TableHandle<Claim>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ClaimsBoardTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ClaimsBoardTableAccessor {
    type Row = Claim;
    type Handle<'db> = ClaimsBoardTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.claims_board()
    }
}

#[allow(non_camel_case_types)]
pub trait ClaimsBoardTableAccess {
    #[allow(non_snake_case)]
    fn claims_board(&self) -> ClaimsBoardTableHandle<'_>;
}

impl ClaimsBoardTableAccess for super::RemoteTables {
    fn claims_board(&self) -> ClaimsBoardTableHandle<'_> {
        ClaimsBoardTableHandle {
            imp: self.imp.get_table::<Claim>("claims_board"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ClaimsBoardInsertCallbackId(__sdk::CallbackId);
pub struct ClaimsBoardDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ClaimsBoardTableHandle<'ctx> {
    type Row = Claim;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Claim> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ClaimsBoardTableHandle<'ctx> {
    type Row = Claim;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Claim> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ClaimsBoardInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimsBoardInsertCallbackId {
        ClaimsBoardInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimsBoardInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ClaimsBoardDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimsBoardDeleteCallbackId {
        ClaimsBoardDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimsBoardDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ClaimsBoardTableHandle<'ctx> {
    type InsertCallbackId = ClaimsBoardInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimsBoardInsertCallbackId {
        ClaimsBoardInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimsBoardInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ClaimsBoardTableHandle<'ctx> {
    type DeleteCallbackId = ClaimsBoardDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimsBoardDeleteCallbackId {
        ClaimsBoardDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimsBoardDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Claim>("claims_board");
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
pub trait claims_boardQueryTableAccess {
    #[allow(non_snake_case)]
    fn claims_board(&self) -> __sdk::__query_builder::Table<Claim>;
}

impl claims_boardQueryTableAccess for __sdk::QueryTableAccessor {
    fn claims_board(&self) -> __sdk::__query_builder::Table<Claim> {
        __sdk::__query_builder::Table::new("claims_board")
    }
}
