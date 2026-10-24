#![allow(unused, clippy::all)]
use super::payment_status_type::PaymentStatus;
use super::payment_type::Payment;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct PaymentTableHandle<'ctx> {
    imp: __sdk::TableHandle<Payment>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct PaymentTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for PaymentTableAccessor {
    type Row = Payment;
    type Handle<'db> = PaymentTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.payment()
    }
}

#[allow(non_camel_case_types)]
pub trait PaymentTableAccess {
    #[allow(non_snake_case)]
    fn payment(&self) -> PaymentTableHandle<'_>;
}

impl PaymentTableAccess for super::RemoteTables {
    fn payment(&self) -> PaymentTableHandle<'_> {
        PaymentTableHandle {
            imp: self.imp.get_table::<Payment>("payment"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct PaymentInsertCallbackId(__sdk::CallbackId);
pub struct PaymentDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for PaymentTableHandle<'ctx> {
    type Row = Payment;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Payment> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for PaymentTableHandle<'ctx> {
    type Row = Payment;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Payment> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = PaymentInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PaymentInsertCallbackId {
        PaymentInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: PaymentInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = PaymentDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PaymentDeleteCallbackId {
        PaymentDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: PaymentDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for PaymentTableHandle<'ctx> {
    type InsertCallbackId = PaymentInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PaymentInsertCallbackId {
        PaymentInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: PaymentInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for PaymentTableHandle<'ctx> {
    type DeleteCallbackId = PaymentDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PaymentDeleteCallbackId {
        PaymentDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: PaymentDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct PaymentUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for PaymentTableHandle<'ctx> {
    type UpdateCallbackId = PaymentUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> PaymentUpdateCallbackId {
        PaymentUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: PaymentUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for PaymentTableHandle<'ctx> {
    type UpdateCallbackId = PaymentUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> PaymentUpdateCallbackId {
        PaymentUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: PaymentUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct PaymentIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Payment, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> PaymentTableHandle<'ctx> {
    pub fn id(&self) -> PaymentIdUnique<'ctx> {
        PaymentIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> PaymentIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Payment> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Payment>("payment");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Payment>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Payment>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait paymentQueryTableAccess {
    #[allow(non_snake_case)]
    fn payment(&self) -> __sdk::__query_builder::Table<Payment>;
}

impl paymentQueryTableAccess for __sdk::QueryTableAccessor {
    fn payment(&self) -> __sdk::__query_builder::Table<Payment> {
        __sdk::__query_builder::Table::new("payment")
    }
}
