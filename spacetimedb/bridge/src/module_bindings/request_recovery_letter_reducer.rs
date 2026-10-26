#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct RequestRecoveryLetterArgs {
    pub claim_id: u64,
    pub counterparty_name: String,
    pub counterparty_contact: String,
}

impl From<RequestRecoveryLetterArgs> for super::Reducer {
    fn from(args: RequestRecoveryLetterArgs) -> Self {
        Self::RequestRecoveryLetter {
            claim_id: args.claim_id,
            counterparty_name: args.counterparty_name,
            counterparty_contact: args.counterparty_contact,
        }
    }
}

impl __sdk::InModule for RequestRecoveryLetterArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait request_recovery_letter {
    fn request_recovery_letter(
        &self,
        claim_id: u64,
        counterparty_name: String,
        counterparty_contact: String,
    ) -> __sdk::Result<()> {
        self.request_recovery_letter_then(
            claim_id,
            counterparty_name,
            counterparty_contact,
            |_, _| {},
        )
    }

    fn request_recovery_letter_then(
        &self,
        claim_id: u64,
        counterparty_name: String,
        counterparty_contact: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl request_recovery_letter for super::RemoteReducers {
    fn request_recovery_letter_then(
        &self,
        claim_id: u64,
        counterparty_name: String,
        counterparty_contact: String,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            RequestRecoveryLetterArgs {
                claim_id,
                counterparty_name,
                counterparty_contact,
            },
            callback,
        )
    }
}
