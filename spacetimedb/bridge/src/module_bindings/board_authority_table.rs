#![allow(unused, clippy::all)]
use super::authority_limit_row_type::AuthorityLimitRow;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardAuthorityTableHandle<'ctx> {
    imp: __sdk::TableHandle<AuthorityLimitRow>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardAuthorityTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardAuthorityTableAccessor {
    type Row = AuthorityLimitRow;
    type Handle<'db> = BoardAuthorityTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_authority()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardAuthorityTableAccess {
    #[allow(non_snake_case)]
    fn board_authority(&self) -> BoardAuthorityTableHandle<'_>;
}

impl BoardAuthorityTableAccess for super::RemoteTables {
    fn board_authority(&self) -> BoardAuthorityTableHandle<'_> {
        BoardAuthorityTableHandle {
            imp: self.imp.get_table::<AuthorityLimitRow>("board_authority"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardAuthorityInsertCallbackId(__sdk::CallbackId);
pub struct BoardAuthorityDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardAuthorityTableHandle<'ctx> {
    type Row = AuthorityLimitRow;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = AuthorityLimitRow> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardAuthorityTableHandle<'ctx> {
    type Row = AuthorityLimitRow;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = AuthorityLimitRow> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardAuthorityInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardAuthorityInsertCallbackId {
        BoardAuthorityInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardAuthorityInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardAuthorityDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardAuthorityDeleteCallbackId {
        BoardAuthorityDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardAuthorityDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardAuthorityTableHandle<'ctx> {
    type InsertCallbackId = BoardAuthorityInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardAuthorityInsertCallbackId {
        BoardAuthorityInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardAuthorityInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardAuthorityTableHandle<'ctx> {
    type DeleteCallbackId = BoardAuthorityDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardAuthorityDeleteCallbackId {
        BoardAuthorityDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardAuthorityDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct BoardAuthorityUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for BoardAuthorityTableHandle<'ctx> {
    type UpdateCallbackId = BoardAuthorityUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BoardAuthorityUpdateCallbackId {
        BoardAuthorityUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BoardAuthorityUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for BoardAuthorityTableHandle<'ctx> {
    type UpdateCallbackId = BoardAuthorityUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BoardAuthorityUpdateCallbackId {
        BoardAuthorityUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BoardAuthorityUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct BoardAuthorityRoleUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<AuthorityLimitRow, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> BoardAuthorityTableHandle<'ctx> {
    pub fn role(&self) -> BoardAuthorityRoleUnique<'ctx> {
        BoardAuthorityRoleUnique {
            imp: self.imp.get_unique_constraint::<String>("role"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> BoardAuthorityRoleUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<AuthorityLimitRow> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<AuthorityLimitRow>("board_authority");
    _table.add_unique_constraint::<String>("role", |row| &row.role);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<AuthorityLimitRow>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<AuthorityLimitRow>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_authorityQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_authority(&self) -> __sdk::__query_builder::Table<AuthorityLimitRow>;
}

impl board_authorityQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_authority(&self) -> __sdk::__query_builder::Table<AuthorityLimitRow> {
        __sdk::__query_builder::Table::new("board_authority")
    }
}
