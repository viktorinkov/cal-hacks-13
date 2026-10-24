#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct UpsertInsurancePolicyArgs {
    pub policy_number: String,
    pub insurer_name: String,
    pub fnol_contact: String,
    pub period_start: __sdk::Timestamp,
    pub period_end: __sdk::Timestamp,
}

impl From<UpsertInsurancePolicyArgs> for super::Reducer {
    fn from(args: UpsertInsurancePolicyArgs) -> Self {
        Self::UpsertInsurancePolicy {
            policy_number: args.policy_number,
            insurer_name: args.insurer_name,
            fnol_contact: args.fnol_contact,
            period_start: args.period_start,
            period_end: args.period_end,
        }
    }
}

impl __sdk::InModule for UpsertInsurancePolicyArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait upsert_insurance_policy {
    fn upsert_insurance_policy(
        &self,
        policy_number: String,
        insurer_name: String,
        fnol_contact: String,
        period_start: __sdk::Timestamp,
        period_end: __sdk::Timestamp,
    ) -> __sdk::Result<()> {
        self.upsert_insurance_policy_then(
            policy_number,
            insurer_name,
            fnol_contact,
            period_start,
            period_end,
            |_, _| {},
        )
    }

    fn upsert_insurance_policy_then(
        &self,
        policy_number: String,
        insurer_name: String,
        fnol_contact: String,
        period_start: __sdk::Timestamp,
        period_end: __sdk::Timestamp,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl upsert_insurance_policy for super::RemoteReducers {
    fn upsert_insurance_policy_then(
        &self,
        policy_number: String,
        insurer_name: String,
        fnol_contact: String,
        period_start: __sdk::Timestamp,
        period_end: __sdk::Timestamp,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            UpsertInsurancePolicyArgs {
                policy_number,
                insurer_name,
                fnol_contact,
                period_start,
                period_end,
            },
            callback,
        )
    }
}
