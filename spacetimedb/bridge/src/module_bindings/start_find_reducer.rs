#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

#[derive(__lib::ser::Serialize, __lib::de::Deserialize, Clone, PartialEq, Debug)]
#[sats(crate = __lib)]
pub(super) struct StartFindArgs {
    pub seeker: u8,
    pub friend: u8,
    pub colour: u8,
}

impl From<StartFindArgs> for super::Reducer {
    fn from(args: StartFindArgs) -> Self {
        Self::StartFind {
            seeker: args.seeker,
            friend: args.friend,
            colour: args.colour,
        }
    }
}

impl __sdk::InModule for StartFindArgs {
    type Module = super::RemoteModule;
}

#[allow(non_camel_case_types)]
pub trait start_find {
    fn start_find(&self, seeker: u8, friend: u8, colour: u8) -> __sdk::Result<()> {
        self.start_find_then(seeker, friend, colour, |_, _| {})
    }

    fn start_find_then(
        &self,
        seeker: u8,
        friend: u8,
        colour: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()>;
}

impl start_find for super::RemoteReducers {
    fn start_find_then(
        &self,
        seeker: u8,
        friend: u8,
        colour: u8,

        callback: impl FnOnce(&super::ReducerEventContext, Result<Result<(), String>, __sdk::InternalError>)
            + Send
            + 'static,
    ) -> __sdk::Result<()> {
        self.imp.invoke_reducer_with_callback(
            StartFindArgs {
                seeker,
                friend,
                colour,
            },
            callback,
        )
    }
}
