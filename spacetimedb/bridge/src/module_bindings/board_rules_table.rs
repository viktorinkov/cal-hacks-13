#![allow(unused, clippy::all)]
use super::settlement_rule_row_type::SettlementRuleRow;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct BoardRulesTableHandle<'ctx> {
    imp: __sdk::TableHandle<SettlementRuleRow>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct BoardRulesTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for BoardRulesTableAccessor {
    type Row = SettlementRuleRow;
    type Handle<'db> = BoardRulesTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.board_rules()
    }
}

#[allow(non_camel_case_types)]
pub trait BoardRulesTableAccess {
    #[allow(non_snake_case)]
    fn board_rules(&self) -> BoardRulesTableHandle<'_>;
}

impl BoardRulesTableAccess for super::RemoteTables {
    fn board_rules(&self) -> BoardRulesTableHandle<'_> {
        BoardRulesTableHandle {
            imp: self.imp.get_table::<SettlementRuleRow>("board_rules"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct BoardRulesInsertCallbackId(__sdk::CallbackId);
pub struct BoardRulesDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for BoardRulesTableHandle<'ctx> {
    type Row = SettlementRuleRow;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SettlementRuleRow> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for BoardRulesTableHandle<'ctx> {
    type Row = SettlementRuleRow;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = SettlementRuleRow> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = BoardRulesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRulesInsertCallbackId {
        BoardRulesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardRulesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = BoardRulesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRulesDeleteCallbackId {
        BoardRulesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardRulesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for BoardRulesTableHandle<'ctx> {
    type InsertCallbackId = BoardRulesInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRulesInsertCallbackId {
        BoardRulesInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: BoardRulesInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for BoardRulesTableHandle<'ctx> {
    type DeleteCallbackId = BoardRulesDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> BoardRulesDeleteCallbackId {
        BoardRulesDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: BoardRulesDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct BoardRulesUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for BoardRulesTableHandle<'ctx> {
    type UpdateCallbackId = BoardRulesUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BoardRulesUpdateCallbackId {
        BoardRulesUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BoardRulesUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for BoardRulesTableHandle<'ctx> {
    type UpdateCallbackId = BoardRulesUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> BoardRulesUpdateCallbackId {
        BoardRulesUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: BoardRulesUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct BoardRulesIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<SettlementRuleRow, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> BoardRulesTableHandle<'ctx> {
    pub fn id(&self) -> BoardRulesIdUnique<'ctx> {
        BoardRulesIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> BoardRulesIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<SettlementRuleRow> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<SettlementRuleRow>("board_rules");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<SettlementRuleRow>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<SettlementRuleRow>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait board_rulesQueryTableAccess {
    #[allow(non_snake_case)]
    fn board_rules(&self) -> __sdk::__query_builder::Table<SettlementRuleRow>;
}

impl board_rulesQueryTableAccess for __sdk::QueryTableAccessor {
    fn board_rules(&self) -> __sdk::__query_builder::Table<SettlementRuleRow> {
        __sdk::__query_builder::Table::new("board_rules")
    }
}
