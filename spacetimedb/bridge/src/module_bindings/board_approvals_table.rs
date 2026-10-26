#![allow(unused, clippy::all)]
use super::approval_type::Approval;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardApprovalsTableHandle<'ctx> {
    imp: __sdk::TableHandle<Approval>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardApprovalsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardApprovalsTableAccessor {
    type Row = Approval;
    type Handle<'db> = BoardApprovalsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_approvals()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardApprovalsTableAccess {
    #[allow(non_snake_case)]
    fn board_approvals(&self) -> BoardApprovalsTableHandle<'_>;
}

impl BoardApprovalsTableAccess for super::RemoteTables {
    fn board_approvals(&self) -> BoardApprovalsTableHandle<'_> {
        BoardApprovalsTableHandle {
            imp: self.imp.get_table::<Approval>("board_approvals"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardApprovalsInsertCallbackId(__sdk::CallbackId);
pub struct BoardApprovalsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardApprovalsTableHandle<'ctx> {
    type Row = Approval;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Approval> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardApprovalsTableHandle<'ctx> {
    type Row = Approval;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Approval> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardApprovalsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardApprovalsInsertCallbackId {
        BoardApprovalsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardApprovalsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardApprovalsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardApprovalsDeleteCallbackId {
        BoardApprovalsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardApprovalsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardApprovalsTableHandle<'ctx> {
    type InsertCallbackId = BoardApprovalsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardApprovalsInsertCallbackId {
        BoardApprovalsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardApprovalsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardApprovalsTableHandle<'ctx> {
    type DeleteCallbackId = BoardApprovalsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardApprovalsDeleteCallbackId {
        BoardApprovalsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardApprovalsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Approval>("board_approvals");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Approval>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Approval>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_approvalsQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_approvals(&self) -> __sdk::__query_builder::Table<Approval>;
}

impl board_approvalsQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_approvals(&self) -> __sdk::__query_builder::Table<Approval> {
        __sdk::__query_builder::Table::new("board_approvals")
    }
}
