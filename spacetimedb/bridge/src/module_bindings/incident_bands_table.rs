#![allow(unused, clippy::all)]
use super::incident_band_type::IncidentBand;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct IncidentBandsTableHandle<'ctx> {
    imp: __sdk::TableHandle<IncidentBand>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct IncidentBandsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for IncidentBandsTableAccessor {
    type Row = IncidentBand;
    type Handle<'db> = IncidentBandsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.incident_bands()
    }
}

#[allow(non_camel_case_types)]
pub trait IncidentBandsTableAccess {
    #[allow(non_snake_case)]
    fn incident_bands(&self) -> IncidentBandsTableHandle<'_>;
}

impl IncidentBandsTableAccess for super::RemoteTables {
    fn incident_bands(&self) -> IncidentBandsTableHandle<'_> {
        IncidentBandsTableHandle {
            imp: self.imp.get_table::<IncidentBand>("incident_bands"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct IncidentBandsInsertCallbackId(__sdk::CallbackId);
pub struct IncidentBandsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for IncidentBandsTableHandle<'ctx> {
    type Row = IncidentBand;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = IncidentBand> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for IncidentBandsTableHandle<'ctx> {
    type Row = IncidentBand;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = IncidentBand> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = IncidentBandsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> IncidentBandsInsertCallbackId {
        IncidentBandsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: IncidentBandsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = IncidentBandsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> IncidentBandsDeleteCallbackId {
        IncidentBandsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: IncidentBandsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for IncidentBandsTableHandle<'ctx> {
    type InsertCallbackId = IncidentBandsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> IncidentBandsInsertCallbackId {
        IncidentBandsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: IncidentBandsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for IncidentBandsTableHandle<'ctx> {
    type DeleteCallbackId = IncidentBandsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> IncidentBandsDeleteCallbackId {
        IncidentBandsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: IncidentBandsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<IncidentBand>("incident_bands");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<IncidentBand>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<IncidentBand>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait incident_bandsQueryTableAccess {
    #[allow(non_snake_case)]
    fn incident_bands(&self, incident_id: u64) -> __sdk::__query_builder::ViewCall<IncidentBand>;
}

impl incident_bandsQueryTableAccess for __sdk::QueryTableAccessor {
    fn incident_bands(&self, incident_id: u64) -> __sdk::__query_builder::ViewCall<IncidentBand> {
        __sdk::__query_builder::ViewCall::new(
            "incident_bands",
            [__sdk::__query_builder::SqlLiteral::to_sql_literal(
                incident_id,
            )],
        )
    }
}
