#![allow(unused, clippy::all)]
use super::claim_review_type::ClaimReview;
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub struct ClaimReviewsTableHandle<'ctx> {
    imp: __sdk::TableHandle<ClaimReview>,
    ctx: std::marker::PhantomData<&'ctx super::RemoteTables>,
}

pub struct ClaimReviewsTableAccessor;

impl __sdk::TableAccessor<super::RemoteTables> for ClaimReviewsTableAccessor {
    type Row = ClaimReview;
    type Handle<'db> = ClaimReviewsTableHandle<'db>;

    fn get<'db>(db: &'db super::RemoteTables) -> Self::Handle<'db> {
        db.claim_reviews()
    }
}

#[allow(non_camel_case_types)]
pub trait ClaimReviewsTableAccess {
    #[allow(non_snake_case)]
    fn claim_reviews(&self) -> ClaimReviewsTableHandle<'_>;
}

impl ClaimReviewsTableAccess for super::RemoteTables {
    fn claim_reviews(&self) -> ClaimReviewsTableHandle<'_> {
        ClaimReviewsTableHandle {
            imp: self.imp.get_table::<ClaimReview>("claim_reviews"),
            ctx: std::marker::PhantomData,
        }
    }
}

pub struct ClaimReviewsInsertCallbackId(__sdk::CallbackId);
pub struct ClaimReviewsDeleteCallbackId(__sdk::CallbackId);

impl<'ctx> __sdk::TableLike for ClaimReviewsTableHandle<'ctx> {
    type Row = ClaimReview;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimReview> + '_ {
        self.imp.iter()
    }
}

impl<'ctx> __sdk::Table for ClaimReviewsTableHandle<'ctx> {
    type Row = ClaimReview;
    type EventContext = super::EventContext;

    fn count(&self) -> u64 {
        self.imp.count()
    }
    fn iter(&self) -> impl Iterator<Item = ClaimReview> + '_ {
        self.imp.iter()
    }

    type InsertCallbackId = ClaimReviewsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimReviewsInsertCallbackId {
        ClaimReviewsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimReviewsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }

    type DeleteCallbackId = ClaimReviewsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimReviewsDeleteCallbackId {
        ClaimReviewsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimReviewsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

impl<'ctx> __sdk::WithInsert for ClaimReviewsTableHandle<'ctx> {
    type InsertCallbackId = ClaimReviewsInsertCallbackId;

    fn on_insert(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimReviewsInsertCallbackId {
        ClaimReviewsInsertCallbackId(self.imp.on_insert(Box::new(callback)))
    }

    fn remove_on_insert(&self, callback: ClaimReviewsInsertCallbackId) {
        self.imp.remove_on_insert(callback.0)
    }
}

impl<'ctx> __sdk::WithDelete for ClaimReviewsTableHandle<'ctx> {
    type DeleteCallbackId = ClaimReviewsDeleteCallbackId;

    fn on_delete(
        &self,
        callback: impl FnMut(&Self::EventContext, &Self::Row) + Send + 'static,
    ) -> ClaimReviewsDeleteCallbackId {
        ClaimReviewsDeleteCallbackId(self.imp.on_delete(Box::new(callback)))
    }

    fn remove_on_delete(&self, callback: ClaimReviewsDeleteCallbackId) {
        self.imp.remove_on_delete(callback.0)
    }
}

#[doc(hidden)]
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<ClaimReview>("claim_reviews");
}

#[doc(hidden)]
pub(super) fn parse_table_update(
    raw_updates: __ws::v2::TableUpdate,
) -> __sdk::Result<__sdk::TableUpdate<ClaimReview>> {
    __sdk::TableUpdate::parse_table_update(raw_updates).map_err(|e| {
        __sdk::InternalError::failed_parse("TableUpdate<ClaimReview>", "TableUpdate")
            .with_cause(e)
            .into()
    })
}

#[allow(non_camel_case_types)]
pub trait claim_reviewsQueryTableAccess {
    #[allow(non_snake_case)]
    fn claim_reviews(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<ClaimReview>;
}

impl claim_reviewsQueryTableAccess for __sdk::QueryTableAccessor {
    fn claim_reviews(&self, claim_id: u64) -> __sdk::__query_builder::ViewCall<ClaimReview> {
        __sdk::__query_builder::ViewCall::new(
            "claim_reviews",
            [__sdk::__query_builder::SqlLiteral::to_sql_literal(claim_id)],
        )
    }
}
