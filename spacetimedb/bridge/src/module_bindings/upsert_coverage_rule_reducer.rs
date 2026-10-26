#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct UpsertCoverageRuleArgs {
    pub policy_number: String,
    pub cover_kind: String,
    pub incident_kinds: Vec<String>,
    pub per_claim_limit_cents: u64,
    pub aggregate_limit_cents: u64,
    pub deductible_cents: u64,
    pub service_window_days: u32,
    pub active: bool,
}

impl From<UpsertCoverageRuleArgs> for super::Reducer {
    fn from(args: UpsertCoverageRuleArgs) -> Self {
        Self::UpsertCoverageRule {
            policy_number: args.policy_number,
            cover_kind: args.cover_kind,
            incident_kinds: args.incident_kinds,
            per_claim_limit_cents: args.per_claim_limit_cents,
            aggregate_limit_cents: args.aggregate_limit_cents,
            deductible_cents: args.deductible_cents,
            service_window_days: args.service_window_days,
            active: args.active,
        }
    }
}

impl __sdk::InModule for UpsertCoverageRuleArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait upsert_coverage_rule {
    fn upsert_coverage_rule(
        &self,
        policy_number: String,
        cover_kind: String,
        incident_kinds: Vec<String>,
        per_claim_limit_cents: u64,
        aggregate_limit_cents: u64,
        deductible_cents: u64,
        service_window_days: u32,
        active: bool,
    ) -> __sdk::Result<()> {
        self.upsert_coverage_rule_then(
            policy_number,
            cover_kind,
            incident_kinds,
            per_claim_limit_cents,
            aggregate_limit_cents,
            deductible_cents,
            service_window_days,
            active,
            |_, _| {},
        )
    }

    fn upsert_coverage_rule_then(
        &self,
        policy_number: String,
        cover_kind: String,
        incident_kinds: Vec<String>,
        per_claim_limit_cents: u64,
        aggregate_limit_cents: u64,
        deductible_cents: u64,
        service_window_days: u32,
        active: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl upsert_coverage_rule for super::RemoteReducers {
    fn upsert_coverage_rule_then(
        &self,
        policy_number: String,
        cover_kind: String,
        incident_kinds: Vec<String>,
        per_claim_limit_cents: u64,
        aggregate_limit_cents: u64,
        deductible_cents: u64,
        service_window_days: u32,
        active: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            UpsertCoverageRuleArgs {
                policy_number,
                cover_kind,
                incident_kinds,
                per_claim_limit_cents,
                aggregate_limit_cents,
                deductible_cents,
                service_window_days,
                active,
            },
            callback,
        )
    }
}
