#![allow(unused, clippy::all)]
use super::merch_template_type::MerchTemplate;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct MerchTemplateTableHandle<'ctx> {
    imp: __sdk::TableHandle<MerchTemplate>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct MerchTemplateTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for MerchTemplateTableAccessor {
    type Row = MerchTemplate;
    type Handle<'db> = MerchTemplateTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.merch_template()
    }
}

#[allow(non_camel_case_types)]
pub trait MerchTemplateTableAccess {
    #[allow(non_snake_case)]
    fn merch_template(&self) -> MerchTemplateTableHandle<'_>;
}

impl MerchTemplateTableAccess for super::RemoteTables {
    fn merch_template(&self) -> MerchTemplateTableHandle<'_> {
        MerchTemplateTableHandle {
            imp: self.imp.get_table::<MerchTemplate>("merch_template"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct MerchTemplateInsertCallbackId(__sdk::CallbackId);
pub struct MerchTemplateDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for MerchTemplateTableHandle<'ctx> {
    type Row = MerchTemplate;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MerchTemplate> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for MerchTemplateTableHandle<'ctx> {
    type Row = MerchTemplate;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = MerchTemplate> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = MerchTemplateInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MerchTemplateInsertCallbackId {
        MerchTemplateInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MerchTemplateInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = MerchTemplateDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MerchTemplateDeleteCallbackId {
        MerchTemplateDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MerchTemplateDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for MerchTemplateTableHandle<'ctx> {
    type InsertCallbackId = MerchTemplateInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MerchTemplateInsertCallbackId {
        MerchTemplateInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: MerchTemplateInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for MerchTemplateTableHandle<'ctx> {
    type DeleteCallbackId = MerchTemplateDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> MerchTemplateDeleteCallbackId {
        MerchTemplateDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: MerchTemplateDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct MerchTemplateUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for MerchTemplateTableHandle<'ctx> {
    type UpdateCallbackId = MerchTemplateUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> MerchTemplateUpdateCallbackId {
        MerchTemplateUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: MerchTemplateUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for MerchTemplateTableHandle<'ctx> {
    type UpdateCallbackId = MerchTemplateUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> MerchTemplateUpdateCallbackId {
        MerchTemplateUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: MerchTemplateUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct MerchTemplateIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<MerchTemplate, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> MerchTemplateTableHandle<'ctx> {
    pub fn id(&self) -> MerchTemplateIdUnique<'ctx> {
        MerchTemplateIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> MerchTemplateIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<MerchTemplate> {
        self.imp.find(col_val)
    }
}

pub struct MerchTemplateNameUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<MerchTemplate, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> MerchTemplateTableHandle<'ctx> {
    pub fn name(&self) -> MerchTemplateNameUnique<'ctx> {
        MerchTemplateNameUnique {
            imp: self.imp.get_unique_constraint::<String>("name"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> MerchTemplateNameUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<MerchTemplate> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<MerchTemplate>("merch_template");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("name", |row| &row.name);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<MerchTemplate>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<MerchTemplate>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait merch_templateQueryTableAccess {
    #[allow(non_snake_case)]
    fn merch_template(&self) -> __sdk::__query_builder::Table<MerchTemplate>;
}

impl merch_templateQueryTableAccess for __sdk::QueryTableAccessor {
    fn merch_template(&self) -> __sdk::__query_builder::Table<MerchTemplate> {
        __sdk::__query_builder::Table::new("merch_template")
    }
}
