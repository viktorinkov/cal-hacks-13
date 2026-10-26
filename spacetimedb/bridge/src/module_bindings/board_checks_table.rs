#![allow(unused, clippy::all)]
use super::claim_check_type::ClaimCheck;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardChecksTableHandle<'ctx> {
    imp: __sdk::TableHandle<ClaimCheck>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardChecksTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardChecksTableAccessor {
    type Row = ClaimCheck;
    type Handle<'db> = BoardChecksTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_checks()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardChecksTableAccess {
    #[allow(non_snake_case)]
    fn board_checks(&self) -> BoardChecksTableHandle<'_>;
}

impl BoardChecksTableAccess for super::RemoteTables {
    fn board_checks(&self) -> BoardChecksTableHandle<'_> {
        BoardChecksTableHandle {
            imp: self.imp.get_table::<ClaimCheck>("board_checks"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardChecksInsertCallbackId(__sdk::CallbackId);
pub struct BoardChecksDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardChecksTableHandle<'ctx> {
    type Row = ClaimCheck;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimCheck> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardChecksTableHandle<'ctx> {
    type Row = ClaimCheck;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimCheck> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardChecksInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardChecksInsertCallbackId {
        BoardChecksInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardChecksInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardChecksDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardChecksDeleteCallbackId {
        BoardChecksDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardChecksDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardChecksTableHandle<'ctx> {
    type InsertCallbackId = BoardChecksInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardChecksInsertCallbackId {
        BoardChecksInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardChecksInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardChecksTableHandle<'ctx> {
    type DeleteCallbackId = BoardChecksDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardChecksDeleteCallbackId {
        BoardChecksDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardChecksDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ClaimCheck>("board_checks");
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
pub trait board_checksQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_checks(&self) -> __sdk::__query_builder::Table<ClaimCheck>;
}

impl board_checksQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_checks(&self) -> __sdk::__query_builder::Table<ClaimCheck> {
        __sdk::__query_builder::Table::new("board_checks")
    }
}
