#![allow(unused, clippy::all)]
use super::gateway_type::Gateway;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct GatewayTableHandle<'ctx> {
    imp: __sdk::TableHandle<Gateway>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct GatewayTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for GatewayTableAccessor {
    type Row = Gateway;
    type Handle<'db> = GatewayTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.gateway()
    }
}

#[allow(non_camel_case_types)]
pub trait GatewayTableAccess {
    #[allow(non_snake_case)]
    fn gateway(&self) -> GatewayTableHandle<'_>;
}

impl GatewayTableAccess for super::RemoteTables {
    fn gateway(&self) -> GatewayTableHandle<'_> {
        GatewayTableHandle {
            imp: self.imp.get_table::<Gateway>("gateway"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct GatewayInsertCallbackId(__sdk::CallbackId);
pub struct GatewayDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for GatewayTableHandle<'ctx> {
    type Row = Gateway;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Gateway> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for GatewayTableHandle<'ctx> {
    type Row = Gateway;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Gateway> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = GatewayInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> GatewayInsertCallbackId {
        GatewayInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: GatewayInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = GatewayDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> GatewayDeleteCallbackId {
        GatewayDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: GatewayDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for GatewayTableHandle<'ctx> {
    type InsertCallbackId = GatewayInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> GatewayInsertCallbackId {
        GatewayInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: GatewayInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for GatewayTableHandle<'ctx> {
    type DeleteCallbackId = GatewayDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> GatewayDeleteCallbackId {
        GatewayDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: GatewayDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct GatewayUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for GatewayTableHandle<'ctx> {
    type UpdateCallbackId = GatewayUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> GatewayUpdateCallbackId {
        GatewayUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: GatewayUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for GatewayTableHandle<'ctx> {
    type UpdateCallbackId = GatewayUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> GatewayUpdateCallbackId {
        GatewayUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: GatewayUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct GatewayIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Gateway, u8>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> GatewayTableHandle<'ctx> {
    pub fn id(&self) -> GatewayIdUnique<'ctx> {
        GatewayIdUnique {
            imp: self.imp.get_unique_constraint::<u8>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> GatewayIdUnique<'ctx> {
    pub fn find(&self, col_val: &u8) -> Option<Gateway> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Gateway>("gateway");
    _table.add_unique_constraint::<u8>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Gateway>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Gateway>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait gatewayQueryTableAccess {
    #[allow(non_snake_case)]
    fn gateway(&self) -> __sdk::__query_builder::Table<Gateway>;
}

impl gatewayQueryTableAccess for __sdk::QueryTableAccessor {
    fn gateway(&self) -> __sdk::__query_builder::Table<Gateway> {
        __sdk::__query_builder::Table::new("gateway")
    }
}
