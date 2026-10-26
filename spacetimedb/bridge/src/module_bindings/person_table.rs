#![allow(unused, clippy::all)]
use super::person_type::Person;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct PersonTableHandle<'ctx> {
    imp: __sdk::TableHandle<Person>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct PersonTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for PersonTableAccessor {
    type Row = Person;
    type Handle<'db> = PersonTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.person()
    }
}

#[allow(non_camel_case_types)]
pub trait PersonTableAccess {
    #[allow(non_snake_case)]
    fn person(&self) -> PersonTableHandle<'_>;
}

impl PersonTableAccess for super::RemoteTables {
    fn person(&self) -> PersonTableHandle<'_> {
        PersonTableHandle {
            imp: self.imp.get_table::<Person>("person"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct PersonInsertCallbackId(__sdk::CallbackId);
pub struct PersonDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for PersonTableHandle<'ctx> {
    type Row = Person;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Person> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for PersonTableHandle<'ctx> {
    type Row = Person;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = Person> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = PersonInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PersonInsertCallbackId {
        PersonInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: PersonInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = PersonDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PersonDeleteCallbackId {
        PersonDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: PersonDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for PersonTableHandle<'ctx> {
    type InsertCallbackId = PersonInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PersonInsertCallbackId {
        PersonInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: PersonInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for PersonTableHandle<'ctx> {
    type DeleteCallbackId = PersonDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> PersonDeleteCallbackId {
        PersonDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: PersonDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

pub struct PersonUpdateCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableWithPrimaryKey for PersonTableHandle<'ctx> {
    type UpdateCallbackId = PersonUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> PersonUpdateCallbackId {
        PersonUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: PersonUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

impl<'ctx> __sdk::WithUpdate for PersonTableHandle<'ctx> {
    type UpdateCallbackId = PersonUpdateCallbackId;

    fn on_update(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row, &Self::Row) + Send + 'static,
    ) -> PersonUpdateCallbackId {
        PersonUpdateCallbackId(self.imp.on_update(Box::new(callback)))
    }

    fn remove_on_update(&self, callback: PersonUpdateCallbackId) {
        self.imp.remove_on_update(callback.0)
    }
}

pub struct PersonIdUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Person, u64>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> PersonTableHandle<'ctx> {
    pub fn id(&self) -> PersonIdUnique<'ctx> {
        PersonIdUnique {
            imp: self.imp.get_unique_constraint::<u64>("id"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> PersonIdUnique<'ctx> {
    pub fn find(&self, col_val: &u64) -> Option<Person> {
        self.imp.find(col_val)
    }
}

pub struct PersonSourceKeyUnique<'ctx> {
    imp: __sdk::UniqueConstraintHandle<Person, String>,
    phantom: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

impl<'ctx> PersonTableHandle<'ctx> {
    pub fn source_key(&self) -> PersonSourceKeyUnique<'ctx> {
        PersonSourceKeyUnique {
            imp: self.imp.get_unique_constraint::<String>("source_key"),
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'ctx> PersonSourceKeyUnique<'ctx> {
    pub fn find(&self, col_val: &String) -> Option<Person> {
        self.imp.find(col_val)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<Person>("person");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
    _table.add_unique_constraint::<String>("source_key", |row| &row.source_key);
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<Person>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<Person>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait personQueryTableAccess {
    #[allow(non_snake_case)]
    fn person(&self) -> __sdk::__query_builder::Table<Person>;
}

impl personQueryTableAccess for __sdk::QueryTableAccessor {
    fn person(&self) -> __sdk::__query_builder::Table<Person> {
        __sdk::__query_builder::Table::new("person")
    }
}
