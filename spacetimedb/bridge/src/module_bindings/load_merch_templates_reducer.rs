#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

use super::merch_template_in_type::MerchTemplateIn;

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct LoadMerchTemplatesArgs {
    pub templates: Vec<MerchTemplateIn>,
}

impl From<LoadMerchTemplatesArgs> for super::Reducer {
    fn from(args: LoadMerchTemplatesArgs) -> Self {
        Self::LoadMerchTemplates {
            templates: args.templates,
        }
    }
}

impl __sdk::InModule for LoadMerchTemplatesArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait load_merch_templates {
    fn load_merch_templates(&self, templates: Vec<MerchTemplateIn>) -> __sdk::Result<()> {
        self.load_merch_templates_then(templates, |_, _| {})
    }

    fn load_merch_templates_then(
        &self,
        templates: Vec<MerchTemplateIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl load_merch_templates for super::RemoteReducers {
    fn load_merch_templates_then(
        &self,
        templates: Vec<MerchTemplateIn>,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp
            .invoke_reducer_with_callback(LoadMerchTemplatesArgs { templates }, callback)
    }
}
