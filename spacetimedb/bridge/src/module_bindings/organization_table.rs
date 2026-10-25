#![allow(unused, clippy::all)]
use super::organization_type::Organization;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct OrganizationTableHandle<'ctx> {
    imp: __sdk::TableHandle<Organization>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct OrganizationTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for OrganizationTableAccessor {
    type Row = Organization;
    type Handle<'db> = OrganizationTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.organization()
    }
}

#[allow(non_camel_case_types)]
pub trait OrganizationTableAccess {
    #[allow(non_snake_case)]
    fn organization(&self) -> OrganizationTableHandle<'_>;
}

impl OrganizationTableAccess for super::RemoteTables {
    fn organization(&self) -> OrganizationTableHandle<'_> {
        OrganizationTableHandle {
            imp: self.imp.get_table::<Organization>("organization"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct OrganizationInsertCallbackId(__sdk::CallbackId);
pub struct OrganizationDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for OrganizationTableHandle<'ctx> {
    type Row = Organization;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Organization> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for OrganizationTableHandle<'ctx> {
    type Row = Organization;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Organization> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = OrganizationInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OrganizationInsertCallbackId {
        OrganizationInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: OrganizationInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = OrganizationDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OrganizationDeleteCallbackId {
        OrganizationDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: OrganizationDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for OrganizationTableHandle<'ctx> {
    type InsertCallbackId = OrganizationInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OrganizationInsertCallbackId {
        OrganizationInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: OrganizationInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for OrganizationTableHandle<'ctx> {
    type DeleteCallbackId = OrganizationDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> OrganizationDeleteCallbackId {
        OrganizationDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: OrganizationDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct OrganizationUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for OrganizationTableHandle<'ctx> {
    type UpdateCallbackId = OrganizationUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> OrganizationUpdateCallbackId {
        OrganizationUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: OrganizationUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for OrganizationTableHandle<'ctx> {
    type UpdateCallbackId = OrganizationUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> OrganizationUpdateCallbackId {
        OrganizationUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: OrganizationUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct OrganizationIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Organization, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> OrganizationTableHandle<'ctx> {
    pub fn id(&self) -> OrganizationIdUnique<'ctx> {
        OrganizationIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> OrganizationIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Organization> {
        self.imp.find(col_val)
    }
}

pub struct OrganizationSourceKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Organization, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> OrganizationTableHandle<'ctx> {
    pub fn source_key(&self) -> OrganizationSourceKeyUnique<'ctx> {
        OrganizationSourceKeyUnique {
            imp: self.imp.get_unique_constraint::<String>("source_key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> OrganizationSourceKeyUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<Organization> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Organization>("organization");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("source_key", |row| &row.source_key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Organization>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Organization>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait organizationQueryTableAccess {
    #[allow(non_snake_case)]
    fn organization(&self) -> __sdk::__query_builder::Table<Organization>;
}

impl organizationQueryTableAccess for __sdk::QueryTableAccessor {
    fn organization(&self) -> __sdk::__query_builder::Table<Organization> {
        __sdk::__query_builder::Table::new("organization")
    }
}
