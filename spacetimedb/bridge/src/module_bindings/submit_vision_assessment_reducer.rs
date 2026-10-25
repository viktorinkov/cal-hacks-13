#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct SubmitVisionAssessmentArgs {
    pub incident_id: u64,
    pub trigger: String,
    pub confirmed: bool,
    pub confidence: f32,
    pub description: String,
    pub recommended_action: String,
    pub incident_description: String,
    pub camera_id: u64,
    pub frame_hashes: Vec<String>,
    pub frame_times: Vec<__sdk::Timestamp>,
    pub model_call_id: u64,
}

impl From<SubmitVisionAssessmentArgs> for super::Reducer {
    fn from(args: SubmitVisionAssessmentArgs) -> Self {
        Self::SubmitVisionAssessment {
            incident_id: args.incident_id,
            trigger: args.trigger,
            confirmed: args.confirmed,
            confidence: args.confidence,
            description: args.description,
            recommended_action: args.recommended_action,
            incident_description: args.incident_description,
            camera_id: args.camera_id,
            frame_hashes: args.frame_hashes,
            frame_times: args.frame_times,
            model_call_id: args.model_call_id,
        }
    }
}

impl __sdk::InModule for SubmitVisionAssessmentArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait submit_vision_assessment {
    fn submit_vision_assessment(
        &self,
        incident_id: u64,
        trigger: String,
        confirmed: bool,
        confidence: f32,
        description: String,
        recommended_action: String,
        incident_description: String,
        camera_id: u64,
        frame_hashes: Vec<String>,
        frame_times: Vec<__sdk::Timestamp>,
        model_call_id: u64,
    ) -> __sdk::Result<()> {
        self.submit_vision_assessment_then(
            incident_id,
            trigger,
            confirmed,
            confidence,
            description,
            recommended_action,
            incident_description,
            camera_id,
            frame_hashes,
            frame_times,
            model_call_id,
            |_, _| {},
        )
    }

    fn submit_vision_assessment_then(
        &self,
        incident_id: u64,
        trigger: String,
        confirmed: bool,
        confidence: f32,
        description: String,
        recommended_action: String,
        incident_description: String,
        camera_id: u64,
        frame_hashes: Vec<String>,
        frame_times: Vec<__sdk::Timestamp>,
        model_call_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl submit_vision_assessment for super::RemoteReducers {
    fn submit_vision_assessment_then(
        &self,
        incident_id: u64,
        trigger: String,
        confirmed: bool,
        confidence: f32,
        description: String,
        recommended_action: String,
        incident_description: String,
        camera_id: u64,
        frame_hashes: Vec<String>,
        frame_times: Vec<__sdk::Timestamp>,
        model_call_id: u64,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            SubmitVisionAssessmentArgs {
                incident_id,
                trigger,
                confirmed,
                confidence,
                description,
                recommended_action,
                incident_description,
                camera_id,
                frame_hashes,
                frame_times,
                model_call_id,
            },
            callback,
        )
    }
}
