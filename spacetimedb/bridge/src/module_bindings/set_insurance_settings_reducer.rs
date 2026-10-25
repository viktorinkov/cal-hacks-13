#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SetInsuranceSettingsArgs {
    pub venue_name: String,
    pub photo_window_secs: i64,
    pub note_window_secs: i64,
    pub min_witnesses: u32,
    pub tz_offset_minutes: i32,
    pub review_required: bool,
}

impl From<SetInsuranceSettingsArgs> for super::Reducer {
    fn from(args: SetInsuranceSettingsArgs) -> Self {
        Self::SetInsuranceSettings {
            venue_name: args.venue_name,
            photo_window_secs: args.photo_window_secs,
            note_window_secs: args.note_window_secs,
            min_witnesses: args.min_witnesses,
            tz_offset_minutes: args.tz_offset_minutes,
            review_required: args.review_required,
        }
    }
}

impl __sdk::InModule for SetInsuranceSettingsArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait set_insurance_settings {
    fn set_insurance_settings(
        &self,
        venue_name: String,
        photo_window_secs: i64,
        note_window_secs: i64,
        min_witnesses: u32,
        tz_offset_minutes: i32,
        review_required: bool,
    ) -> __sdk::Result<()> {
        self.set_insurance_settings_then(
            venue_name,
            photo_window_secs,
            note_window_secs,
            min_witnesses,
            tz_offset_minutes,
            review_required,
            |_, _| {},
        )
    }

    fn set_insurance_settings_then(
        &self,
        venue_name: String,
        photo_window_secs: i64,
        note_window_secs: i64,
        min_witnesses: u32,
        tz_offset_minutes: i32,
        review_required: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl set_insurance_settings for super::RemoteReducers {
    fn set_insurance_settings_then(
        &self,
        venue_name: String,
        photo_window_secs: i64,
        note_window_secs: i64,
        min_witnesses: u32,
        tz_offset_minutes: i32,
        review_required: bool,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SetInsuranceSettingsArgs {
                venue_name,
                photo_window_secs,
                note_window_secs,
                min_witnesses,
                tz_offset_minutes,
                review_required,
            },
            callback,
        )
    }
}
