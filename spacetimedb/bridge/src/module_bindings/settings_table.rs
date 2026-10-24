#![allow(unused, clippy::all)]
use super::settings_type::Settings;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct SettingsTableHandle<'ctx> {
    imp: __sdk::TableHandle<Settings>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct SettingsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for SettingsTableAccessor {
    type Row = Settings;
    type Handle<'db> = SettingsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.settings()
    }
}

#[allow(non_camel_case_types)]
pub trait SettingsTableAccess {
    #[allow(non_snake_case)]
    fn settings(&self) -> SettingsTableHandle<'_>;
}

impl SettingsTableAccess for super::RemoteTables {
    fn settings(&self) -> SettingsTableHandle<'_> {
        SettingsTableHandle {
            imp: self.imp.get_table::<Settings>("settings"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct SettingsInsertCallbackId(__sdk::CallbackId);
pub struct SettingsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for SettingsTableHandle<'ctx> {
    type Row = Settings;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Settings> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for SettingsTableHandle<'ctx> {
    type Row = Settings;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Settings> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = SettingsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SettingsInsertCallbackId {
        SettingsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SettingsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = SettingsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SettingsDeleteCallbackId {
        SettingsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SettingsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for SettingsTableHandle<'ctx> {
    type InsertCallbackId = SettingsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SettingsInsertCallbackId {
        SettingsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: SettingsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for SettingsTableHandle<'ctx> {
    type DeleteCallbackId = SettingsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> SettingsDeleteCallbackId {
        SettingsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: SettingsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct SettingsUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for SettingsTableHandle<'ctx> {
    type UpdateCallbackId = SettingsUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> SettingsUpdateCallbackId {
        SettingsUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: SettingsUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for SettingsTableHandle<'ctx> {
    type UpdateCallbackId = SettingsUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> SettingsUpdateCallbackId {
        SettingsUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: SettingsUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct SettingsIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Settings, u8>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> SettingsTableHandle<'ctx> {
    pub fn id(&self) -> SettingsIdUnique<'ctx> {
        SettingsIdUnique {
            imp: self.imp.get_unique_constraint::<u8>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> SettingsIdUnique<'ctx> {
    pub fn find(&self, col_val: &u8) -> Option<Settings> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Settings>("settings");
    _table.add_unique_constraint::<u8>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Settings>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Settings>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait settingsQueryTableAccess {
    #[allow(non_snake_case)]
    fn settings(&self) -> __sdk::__query_builder::Table<Settings>;
}

impl settingsQueryTableAccess for __sdk::QueryTableAccessor {
    fn settings(&self) -> __sdk::__query_builder::Table<Settings> {
        __sdk::__query_builder::Table::new("settings")
    }
}
