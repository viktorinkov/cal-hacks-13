#![allow(unused, clippy::all)]
use super::command_type::Command;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct CommandTableHandle<'ctx> {
    imp: __sdk::TableHandle<Command>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct CommandTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for CommandTableAccessor {
    type Row = Command;
    type Handle<'db> = CommandTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.command()
    }
}

#[allow(non_camel_case_types)]
pub trait CommandTableAccess {
    #[allow(non_snake_case)]
    fn command(&self) -> CommandTableHandle<'_>;
}

impl CommandTableAccess for super::RemoteTables {
    fn command(&self) -> CommandTableHandle<'_> {
        CommandTableHandle {
            imp: self.imp.get_table::<Command>("command"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct CommandInsertCallbackId(__sdk::CallbackId);
pub struct CommandDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for CommandTableHandle<'ctx> {
    type Row = Command;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Command> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for CommandTableHandle<'ctx> {
    type Row = Command;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Command> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = CommandInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CommandInsertCallbackId {
        CommandInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: CommandInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = CommandDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CommandDeleteCallbackId {
        CommandDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: CommandDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for CommandTableHandle<'ctx> {
    type InsertCallbackId = CommandInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CommandInsertCallbackId {
        CommandInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: CommandInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for CommandTableHandle<'ctx> {
    type DeleteCallbackId = CommandDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CommandDeleteCallbackId {
        CommandDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: CommandDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct CommandUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for CommandTableHandle<'ctx> {
    type UpdateCallbackId = CommandUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> CommandUpdateCallbackId {
        CommandUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: CommandUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for CommandTableHandle<'ctx> {
    type UpdateCallbackId = CommandUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> CommandUpdateCallbackId {
        CommandUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: CommandUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct CommandIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Command, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> CommandTableHandle<'ctx> {
    pub fn id(&self) -> CommandIdUnique<'ctx> {
        CommandIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> CommandIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Command> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Command>("command");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Command>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Command>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait commandQueryTableAccess {
    #[allow(non_snake_case)]
    fn command(&self) -> __sdk::__query_builder::Table<Command>;
}

impl commandQueryTableAccess for __sdk::QueryTableAccessor {
    fn command(&self) -> __sdk::__query_builder::Table<Command> {
        __sdk::__query_builder::Table::new("command")
    }
}
