#![allow(unused, clippy::all)]
use super::camera_type::Camera;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct CameraTableHandle<'ctx> {
    imp: __sdk::TableHandle<Camera>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct CameraTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for CameraTableAccessor {
    type Row = Camera;
    type Handle<'db> = CameraTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.camera()
    }
}

#[allow(non_camel_case_types)]
pub trait CameraTableAccess {
    #[allow(non_snake_case)]
    fn camera(&self) -> CameraTableHandle<'_>;
}

impl CameraTableAccess for super::RemoteTables {
    fn camera(&self) -> CameraTableHandle<'_> {
        CameraTableHandle {
            imp: self.imp.get_table::<Camera>("camera"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct CameraInsertCallbackId(__sdk::CallbackId);
pub struct CameraDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for CameraTableHandle<'ctx> {
    type Row = Camera;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Camera> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for CameraTableHandle<'ctx> {
    type Row = Camera;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Camera> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = CameraInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CameraInsertCallbackId {
        CameraInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: CameraInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = CameraDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CameraDeleteCallbackId {
        CameraDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: CameraDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for CameraTableHandle<'ctx> {
    type InsertCallbackId = CameraInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CameraInsertCallbackId {
        CameraInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: CameraInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for CameraTableHandle<'ctx> {
    type DeleteCallbackId = CameraDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> CameraDeleteCallbackId {
        CameraDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: CameraDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct CameraUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for CameraTableHandle<'ctx> {
    type UpdateCallbackId = CameraUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> CameraUpdateCallbackId {
        CameraUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: CameraUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for CameraTableHandle<'ctx> {
    type UpdateCallbackId = CameraUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> CameraUpdateCallbackId {
        CameraUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: CameraUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct CameraIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Camera, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> CameraTableHandle<'ctx> {
    pub fn id(&self) -> CameraIdUnique<'ctx> {
        CameraIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> CameraIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Camera> {
        self.imp.find(col_val)
    }
}

pub struct CameraNameUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Camera, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> CameraTableHandle<'ctx> {
    pub fn name(&self) -> CameraNameUnique<'ctx> {
        CameraNameUnique {
            imp: self.imp.get_unique_constraint::<String>("name"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> CameraNameUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<Camera> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Camera>("camera");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("name", |row| &row.name);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Camera>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Camera>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait cameraQueryTableAccess {
    #[allow(non_snake_case)]
    fn camera(&self) -> __sdk::__query_builder::Table<Camera>;
}

impl cameraQueryTableAccess for __sdk::QueryTableAccessor {
    fn camera(&self) -> __sdk::__query_builder::Table<Camera> {
        __sdk::__query_builder::Table::new("camera")
    }
}
