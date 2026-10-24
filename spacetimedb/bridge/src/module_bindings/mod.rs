#![allow(unused, clippy::all)]
use spacetimedb_sdk::__codegen::{self as __sdk, __lib, __sats, __ws};

pub mod band_beacon_type;
pub mod band_table;
pub mod band_type;
pub mod bridge_type;
pub mod clear_reducer;
pub mod command_sent_reducer;
pub mod command_table;
pub mod command_type;
pub mod complete_payment_reducer;
pub mod decline_payment_reducer;
pub mod encounter_table;
pub mod encounter_type;
pub mod event_kind_type;
pub mod event_table;
pub mod event_type;
pub mod force_state_reducer;
pub mod gateway_table;
pub mod gateway_type;
pub mod gateway_up_reducer;
pub mod haptic_reducer;
pub mod heard_entry_type;
pub mod ingest_band_reducer;
pub mod ingest_heard_reducer;
pub mod ingest_station_reducer;
pub mod link_table;
pub mod link_type;
pub mod owner_type;
pub mod payment_status_type;
pub mod payment_table;
pub mod payment_type;
pub mod register_bridge_reducer;
pub mod request_payment_reducer;
pub mod reset_bridge_reducer;
pub mod send_command_reducer;
pub mod set_exit_reducer;
pub mod set_low_vis_reducer;
pub mod set_override_reducer;
pub mod set_rssi_reducer;
pub mod set_thresholds_reducer;
pub mod settings_table;
pub mod settings_type;
pub mod sleep_bands_reducer;
pub mod start_find_reducer;
pub mod station_table;
pub mod station_type;
pub mod stop_find_reducer;
pub mod sweep_timer_type;
pub mod zone_visit_table;
pub mod zone_visit_type;

pub use band_beacon_type::BandBeacon;
pub use band_table::*;
pub use band_type::Band;
pub use bridge_type::Bridge;
pub use clear_reducer::clear;
pub use command_sent_reducer::command_sent;
pub use command_table::*;
pub use command_type::Command;
pub use complete_payment_reducer::complete_payment;
pub use decline_payment_reducer::decline_payment;
pub use encounter_table::*;
pub use encounter_type::Encounter;
pub use event_kind_type::EventKind;
pub use event_table::*;
pub use event_type::Event;
pub use force_state_reducer::force_state;
pub use gateway_table::*;
pub use gateway_type::Gateway;
pub use gateway_up_reducer::gateway_up;
pub use haptic_reducer::haptic;
pub use heard_entry_type::HeardEntry;
pub use ingest_band_reducer::ingest_band;
pub use ingest_heard_reducer::ingest_heard;
pub use ingest_station_reducer::ingest_station;
pub use link_table::*;
pub use link_type::Link;
pub use owner_type::Owner;
pub use payment_status_type::PaymentStatus;
pub use payment_table::*;
pub use payment_type::Payment;
pub use register_bridge_reducer::register_bridge;
pub use request_payment_reducer::request_payment;
pub use reset_bridge_reducer::reset_bridge;
pub use send_command_reducer::send_command;
pub use set_exit_reducer::set_exit;
pub use set_low_vis_reducer::set_low_vis;
pub use set_override_reducer::set_override;
pub use set_rssi_reducer::set_rssi;
pub use set_thresholds_reducer::set_thresholds;
pub use settings_table::*;
pub use settings_type::Settings;
pub use sleep_bands_reducer::sleep_bands;
pub use start_find_reducer::start_find;
pub use station_table::*;
pub use station_type::Station;
pub use stop_find_reducer::stop_find;
pub use sweep_timer_type::SweepTimer;
pub use zone_visit_table::*;
pub use zone_visit_type::ZoneVisit;

#[derive(Clone, PartialEq, Debug)]

pub enum Reducer {
    Clear {
        target: u8,
    },
    CommandSent {
        id: u64,
        error: Option<String>,
    },
    CompletePayment {
        payment_id: u64,
        purchase_ref: String,
    },
    DeclinePayment {
        payment_id: u64,
    },
    ForceState {
        target: u8,
        state: u8,
        tenths: u8,
    },
    GatewayUp {
        mac: String,
        fw: String,
    },
    Haptic {
        target: u8,
        pattern: u8,
    },
    IngestBand {
        beacon: BandBeacon,
    },
    IngestHeard {
        id: u8,
        heard: Vec<HeardEntry>,
    },
    IngestStation {
        id: u8,
        exit_colour: u8,
        rssi: i8,
    },
    RegisterBridge,
    RequestPayment {
        band_id: u8,
        amount_cents: u32,
        merchant: String,
    },
    ResetBridge,
    SendCommand {
        target: u8,
        name: String,
        arg: u8,
        arg_2: u8,
    },
    SetExit {
        target: u8,
        colour: u8,
    },
    SetLowVis {
        on: bool,
    },
    SetOverride {
        on: bool,
    },
    SetRssi {
        neigh_rssi: i8,
        circle_rssi: i8,
    },
    SetThresholds {
        yellow: u8,
        red: u8,
    },
    SleepBands {
        target: u8,
        minutes: u8,
    },
    StartFind {
        seeker: u8,
        friend: u8,
        colour: u8,
    },
    StopFind {
        seeker: u8,
    },
}

impl __sdk::InModule for Reducer {
    type Module = RemoteModule;
}

impl __sdk::Reducer for Reducer {
    fn reducer_name(&self) -> &'static str {
        match self {
            Reducer::Clear { .. } => "clear",
            Reducer::CommandSent { .. } => "command_sent",
            Reducer::CompletePayment { .. } => "complete_payment",
            Reducer::DeclinePayment { .. } => "decline_payment",
            Reducer::ForceState { .. } => "force_state",
            Reducer::GatewayUp { .. } => "gateway_up",
            Reducer::Haptic { .. } => "haptic",
            Reducer::IngestBand { .. } => "ingest_band",
            Reducer::IngestHeard { .. } => "ingest_heard",
            Reducer::IngestStation { .. } => "ingest_station",
            Reducer::RegisterBridge => "register_bridge",
            Reducer::RequestPayment { .. } => "request_payment",
            Reducer::ResetBridge => "reset_bridge",
            Reducer::SendCommand { .. } => "send_command",
            Reducer::SetExit { .. } => "set_exit",
            Reducer::SetLowVis { .. } => "set_low_vis",
            Reducer::SetOverride { .. } => "set_override",
            Reducer::SetRssi { .. } => "set_rssi",
            Reducer::SetThresholds { .. } => "set_thresholds",
            Reducer::SleepBands { .. } => "sleep_bands",
            Reducer::StartFind { .. } => "start_find",
            Reducer::StopFind { .. } => "stop_find",
            _ => unreachable!(),
        }
    }
    #[allow(clippy::clone_on_copy)]
    fn args_bsatn(&self) -> Result<Vec<u8>, __sats::bsatn::EncodeError> {
        match self {
            Reducer::Clear { target } => __sats::bsatn::to_vec(&clear_reducer::ClearArgs {
                target: target.clone(),
            }),
            Reducer::CommandSent { id, error } => {
                __sats::bsatn::to_vec(&command_sent_reducer::CommandSentArgs {
                    id: id.clone(),
                    error: error.clone(),
                })
            }
            Reducer::CompletePayment {
                payment_id,
                purchase_ref,
            } => __sats::bsatn::to_vec(&complete_payment_reducer::CompletePaymentArgs {
                payment_id: payment_id.clone(),
                purchase_ref: purchase_ref.clone(),
            }),
            Reducer::DeclinePayment { payment_id } => {
                __sats::bsatn::to_vec(&decline_payment_reducer::DeclinePaymentArgs {
                    payment_id: payment_id.clone(),
                })
            }
            Reducer::ForceState {
                target,
                state,
                tenths,
            } => __sats::bsatn::to_vec(&force_state_reducer::ForceStateArgs {
                target: target.clone(),
                state: state.clone(),
                tenths: tenths.clone(),
            }),
            Reducer::GatewayUp { mac, fw } => {
                __sats::bsatn::to_vec(&gateway_up_reducer::GatewayUpArgs {
                    mac: mac.clone(),
                    fw: fw.clone(),
                })
            }
            Reducer::Haptic { target, pattern } => {
                __sats::bsatn::to_vec(&haptic_reducer::HapticArgs {
                    target: target.clone(),
                    pattern: pattern.clone(),
                })
            }
            Reducer::IngestBand { beacon } => {
                __sats::bsatn::to_vec(&ingest_band_reducer::IngestBandArgs {
                    beacon: beacon.clone(),
                })
            }
            Reducer::IngestHeard { id, heard } => {
                __sats::bsatn::to_vec(&ingest_heard_reducer::IngestHeardArgs {
                    id: id.clone(),
                    heard: heard.clone(),
                })
            }
            Reducer::IngestStation {
                id,
                exit_colour,
                rssi,
            } => __sats::bsatn::to_vec(&ingest_station_reducer::IngestStationArgs {
                id: id.clone(),
                exit_colour: exit_colour.clone(),
                rssi: rssi.clone(),
            }),
            Reducer::RegisterBridge => {
                __sats::bsatn::to_vec(&register_bridge_reducer::RegisterBridgeArgs {})
            }
            Reducer::RequestPayment {
                band_id,
                amount_cents,
                merchant,
            } => __sats::bsatn::to_vec(&request_payment_reducer::RequestPaymentArgs {
                band_id: band_id.clone(),
                amount_cents: amount_cents.clone(),
                merchant: merchant.clone(),
            }),
            Reducer::ResetBridge => {
                __sats::bsatn::to_vec(&reset_bridge_reducer::ResetBridgeArgs {})
            }
            Reducer::SendCommand {
                target,
                name,
                arg,
                arg_2,
            } => __sats::bsatn::to_vec(&send_command_reducer::SendCommandArgs {
                target: target.clone(),
                name: name.clone(),
                arg: arg.clone(),
                arg_2: arg_2.clone(),
            }),
            Reducer::SetExit { target, colour } => {
                __sats::bsatn::to_vec(&set_exit_reducer::SetExitArgs {
                    target: target.clone(),
                    colour: colour.clone(),
                })
            }
            Reducer::SetLowVis { on } => {
                __sats::bsatn::to_vec(&set_low_vis_reducer::SetLowVisArgs { on: on.clone() })
            }
            Reducer::SetOverride { on } => {
                __sats::bsatn::to_vec(&set_override_reducer::SetOverrideArgs { on: on.clone() })
            }
            Reducer::SetRssi {
                neigh_rssi,
                circle_rssi,
            } => __sats::bsatn::to_vec(&set_rssi_reducer::SetRssiArgs {
                neigh_rssi: neigh_rssi.clone(),
                circle_rssi: circle_rssi.clone(),
            }),
            Reducer::SetThresholds { yellow, red } => {
                __sats::bsatn::to_vec(&set_thresholds_reducer::SetThresholdsArgs {
                    yellow: yellow.clone(),
                    red: red.clone(),
                })
            }
            Reducer::SleepBands { target, minutes } => {
                __sats::bsatn::to_vec(&sleep_bands_reducer::SleepBandsArgs {
                    target: target.clone(),
                    minutes: minutes.clone(),
                })
            }
            Reducer::StartFind {
                seeker,
                friend,
                colour,
            } => __sats::bsatn::to_vec(&start_find_reducer::StartFindArgs {
                seeker: seeker.clone(),
                friend: friend.clone(),
                colour: colour.clone(),
            }),
            Reducer::StopFind { seeker } => {
                __sats::bsatn::to_vec(&stop_find_reducer::StopFindArgs {
                    seeker: seeker.clone(),
                })
            }
            _ => unreachable!(),
        }
    }
}

#[derive(Default, Debug)]
#[allow(non_snake_case)]
#[doc(hidden)]
pub struct DbUpdate {
    band: __sdk::TableUpdate<Band>,
    command: __sdk::TableUpdate<Command>,
    encounter: __sdk::TableUpdate<Encounter>,
    event: __sdk::TableUpdate<Event>,
    gateway: __sdk::TableUpdate<Gateway>,
    link: __sdk::TableUpdate<Link>,
    payment: __sdk::TableUpdate<Payment>,
    settings: __sdk::TableUpdate<Settings>,
    station: __sdk::TableUpdate<Station>,
    zone_visit: __sdk::TableUpdate<ZoneVisit>,
}

impl TryFrom<__ws::v2::TransactionUpdate> for DbUpdate {
    type Error = __sdk::Error;
    fn try_from(raw: __ws::v2::TransactionUpdate) -> Result<Self, Self::Error> {
        let mut db_update = DbUpdate::default();
        for table_update in __sdk::transaction_update_iter_table_updates(raw) {
            match &table_update.table_name[..] {
                "band" => db_update
                    .band
                    .append(band_table::parse_table_update(table_update)?),
                "command" => db_update
                    .command
                    .append(command_table::parse_table_update(table_update)?),
                "encounter" => db_update
                    .encounter
                    .append(encounter_table::parse_table_update(table_update)?),
                "event" => db_update
                    .event
                    .append(event_table::parse_table_update(table_update)?),
                "gateway" => db_update
                    .gateway
                    .append(gateway_table::parse_table_update(table_update)?),
                "link" => db_update
                    .link
                    .append(link_table::parse_table_update(table_update)?),
                "payment" => db_update
                    .payment
                    .append(payment_table::parse_table_update(table_update)?),
                "settings" => db_update
                    .settings
                    .append(settings_table::parse_table_update(table_update)?),
                "station" => db_update
                    .station
                    .append(station_table::parse_table_update(table_update)?),
                "zone_visit" => db_update
                    .zone_visit
                    .append(zone_visit_table::parse_table_update(table_update)?),

                unknown => {
                    return Err(__sdk::InternalError::unknown_name(
                        "table",
                        unknown,
                        "DatabaseUpdate",
                    )
                    .into());
                }
            }
        }
        Ok(db_update)
    }
}

impl __sdk::InModule for DbUpdate {
    type Module = RemoteModule;
}

impl __sdk::DbUpdate for DbUpdate {
    fn apply_to_client_cache(
        &self,
        cache: &mut __sdk::ClientCache<RemoteModule>,
    ) -> AppliedDiff<'_> {
        let mut diff = AppliedDiff::default();

        diff.band = cache
            .apply_diff_to_table::<Band>("band", &self.band)
            .with_updates_by_pk(|row| &row.id);
        diff.command = cache
            .apply_diff_to_table::<Command>("command", &self.command)
            .with_updates_by_pk(|row| &row.id);
        diff.encounter = cache
            .apply_diff_to_table::<Encounter>("encounter", &self.encounter)
            .with_updates_by_pk(|row| &row.key);
        diff.event = cache
            .apply_diff_to_table::<Event>("event", &self.event)
            .with_updates_by_pk(|row| &row.id);
        diff.gateway = cache
            .apply_diff_to_table::<Gateway>("gateway", &self.gateway)
            .with_updates_by_pk(|row| &row.id);
        diff.link = cache
            .apply_diff_to_table::<Link>("link", &self.link)
            .with_updates_by_pk(|row| &row.key);
        diff.payment = cache
            .apply_diff_to_table::<Payment>("payment", &self.payment)
            .with_updates_by_pk(|row| &row.id);
        diff.settings = cache
            .apply_diff_to_table::<Settings>("settings", &self.settings)
            .with_updates_by_pk(|row| &row.id);
        diff.station = cache
            .apply_diff_to_table::<Station>("station", &self.station)
            .with_updates_by_pk(|row| &row.id);
        diff.zone_visit = cache
            .apply_diff_to_table::<ZoneVisit>("zone_visit", &self.zone_visit)
            .with_updates_by_pk(|row| &row.id);

        diff
    }
    fn parse_initial_rows(raw: __ws::v2::QueryRows) -> __sdk::Result<Self> {
        let mut db_update = DbUpdate::default();
        for table_rows in raw.tables {
            match &table_rows.table[..] {
                "band" => db_update
                    .band
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "command" => db_update
                    .command
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "encounter" => db_update
                    .encounter
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "event" => db_update
                    .event
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "gateway" => db_update
                    .gateway
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "link" => db_update
                    .link
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "payment" => db_update
                    .payment
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "settings" => db_update
                    .settings
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "station" => db_update
                    .station
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                "zone_visit" => db_update
                    .zone_visit
                    .append(__sdk::parse_row_list_as_inserts(table_rows.rows)?),
                unknown => {
                    return Err(
                        __sdk::InternalError::unknown_name("table", unknown, "QueryRows").into(),
                    );
                }
            }
        }
        Ok(db_update)
    }
    fn parse_unsubscribe_rows(raw: __ws::v2::QueryRows) -> __sdk::Result<Self> {
        let mut db_update = DbUpdate::default();
        for table_rows in raw.tables {
            match &table_rows.table[..] {
                "band" => db_update
                    .band
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "command" => db_update
                    .command
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "encounter" => db_update
                    .encounter
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "event" => db_update
                    .event
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "gateway" => db_update
                    .gateway
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "link" => db_update
                    .link
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "payment" => db_update
                    .payment
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "settings" => db_update
                    .settings
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "station" => db_update
                    .station
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                "zone_visit" => db_update
                    .zone_visit
                    .append(__sdk::parse_row_list_as_deletes(table_rows.rows)?),
                unknown => {
                    return Err(
                        __sdk::InternalError::unknown_name("table", unknown, "QueryRows").into(),
                    );
                }
            }
        }
        Ok(db_update)
    }
}

#[derive(Default)]
#[allow(non_snake_case)]
#[doc(hidden)]
pub struct AppliedDiff<'r> {
    band: __sdk::TableAppliedDiff<'r, Band>,
    command: __sdk::TableAppliedDiff<'r, Command>,
    encounter: __sdk::TableAppliedDiff<'r, Encounter>,
    event: __sdk::TableAppliedDiff<'r, Event>,
    gateway: __sdk::TableAppliedDiff<'r, Gateway>,
    link: __sdk::TableAppliedDiff<'r, Link>,
    payment: __sdk::TableAppliedDiff<'r, Payment>,
    settings: __sdk::TableAppliedDiff<'r, Settings>,
    station: __sdk::TableAppliedDiff<'r, Station>,
    zone_visit: __sdk::TableAppliedDiff<'r, ZoneVisit>,
    __unused: std::marker::PhantomData<&'r ()>,
}

impl __sdk::InModule for AppliedDiff<'_> {
    type Module = RemoteModule;
}

impl<'r> __sdk::AppliedDiff<'r> for AppliedDiff<'r> {
    fn invoke_row_callbacks(
        &self,
        event: &EventContext,
        callbacks: &mut __sdk::DbCallbacks<RemoteModule>,
    ) {
        callbacks.invoke_table_row_callbacks::<Band>("band", &self.band, event);
        callbacks.invoke_table_row_callbacks::<Command>("command", &self.command, event);
        callbacks.invoke_table_row_callbacks::<Encounter>("encounter", &self.encounter, event);
        callbacks.invoke_table_row_callbacks::<Event>("event", &self.event, event);
        callbacks.invoke_table_row_callbacks::<Gateway>("gateway", &self.gateway, event);
        callbacks.invoke_table_row_callbacks::<Link>("link", &self.link, event);
        callbacks.invoke_table_row_callbacks::<Payment>("payment", &self.payment, event);
        callbacks.invoke_table_row_callbacks::<Settings>("settings", &self.settings, event);
        callbacks.invoke_table_row_callbacks::<Station>("station", &self.station, event);
        callbacks.invoke_table_row_callbacks::<ZoneVisit>("zone_visit", &self.zone_visit, event);
    }
}

#[doc(hidden)]
#[derive(Debug)]
pub struct RemoteModule;

impl __sdk::InModule for RemoteModule {
    type Module = Self;
}

pub struct RemoteReducers {
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::InModule for RemoteReducers {
    type Module = RemoteModule;
}

pub struct RemoteProcedures {
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::InModule for RemoteProcedures {
    type Module = RemoteModule;
}

pub struct RemoteTables {
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::InModule for RemoteTables {
    type Module = RemoteModule;
}

#[cfg_attr(not(target_arch = "wasm32"), doc = "- [`DbConnection::run_threaded`].")]
#[cfg_attr(
    target_arch = "wasm32",
    doc = "- [`DbConnection::run_background_task`]."
)]
#[cfg_attr(
    not(target_arch = "wasm32"),
    doc = "- [`DbConnection::advance_one_message_blocking`]."
)]
pub struct DbConnection {
    pub db: RemoteTables,
    pub reducers: RemoteReducers,
    #[doc(hidden)]

    pub procedures: RemoteProcedures,

    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::InModule for DbConnection {
    type Module = RemoteModule;
}

impl __sdk::DbContext for DbConnection {
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;

    fn db(&self) -> &Self::DbView {
        &self.db
    }
    fn reducers(&self) -> &Self::Reducers {
        &self.reducers
    }
    fn procedures(&self) -> &Self::Procedures {
        &self.procedures
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn disconnect(&self) -> __sdk::Result<()> {
        self.imp.disconnect()
    }

    type SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>;

    fn subscription_builder(&self) -> Self::SubscriptionBuilder {
        __sdk::SubscriptionBuilder::new(&self.imp)
    }

    fn try_identity(&self) -> Option<__sdk::Identity> {
        self.imp.try_identity()
    }
    fn connection_id(&self) -> __sdk::ConnectionId {
        self.imp.connection_id()
    }
    fn try_connection_id(&self) -> Option<__sdk::ConnectionId> {
        self.imp.try_connection_id()
    }
}

impl DbConnection {
    pub fn builder() -> __sdk::DbConnectionBuilder<RemoteModule> {
        __sdk::DbConnectionBuilder::new()
    }

    pub fn advance_one_message(&self) -> __sdk::Result<bool> {
        self.imp.advance_one_message()
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn advance_one_message_blocking(&self) -> __sdk::Result<()> {
        self.imp.advance_one_message_blocking()
    }

    pub async fn advance_one_message_async(&self) -> __sdk::Result<()> {
        self.imp.advance_one_message_async().await
    }

    pub fn frame_tick(&self) -> __sdk::Result<()> {
        self.imp.frame_tick()
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn run_threaded(&self) -> std::thread::JoinHandle<()> {
        self.imp.run_threaded()
    }

    #[cfg(target_arch = "wasm32")]
    pub fn run_background_task(&self) {
        self.imp.run_background_task()
    }

    pub async fn run_async(&self) -> __sdk::Result<()> {
        self.imp.run_async().await
    }
}

impl __sdk::DbConnection for DbConnection {
    fn new(imp: __sdk::DbContextImpl<RemoteModule>) -> Self {
        Self {
            db: RemoteTables { imp: imp.clone() },
            reducers: RemoteReducers { imp: imp.clone() },
            procedures: RemoteProcedures { imp: imp.clone() },
            imp,
        }
    }
}

#[derive(Clone)]
pub struct SubscriptionHandle {
    imp: __sdk::SubscriptionHandleImpl<RemoteModule>,
}

impl __sdk::InModule for SubscriptionHandle {
    type Module = RemoteModule;
}

impl __sdk::SubscriptionHandle for SubscriptionHandle {
    fn new(imp: __sdk::SubscriptionHandleImpl<RemoteModule>) -> Self {
        Self { imp }
    }

    fn is_ended(&self) -> bool {
        self.imp.is_ended()
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn unsubscribe_then(self, on_end: __sdk::OnEndedCallback<RemoteModule>) -> __sdk::Result<()> {
        self.imp.unsubscribe_then(Some(on_end))
    }

    fn unsubscribe(self) -> __sdk::Result<()> {
        self.imp.unsubscribe_then(None)
    }
}

pub trait RemoteDbContext:
    __sdk::DbContext<
    DbView = RemoteTables,
    Reducers = RemoteReducers,
    SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>,
>
{
}
impl<
        Ctx: __sdk::DbContext<
            DbView = RemoteTables,
            Reducers = RemoteReducers,
            SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>,
        >,
    > RemoteDbContext for Ctx
{
}

pub struct EventContext {
    pub db: RemoteTables,
    pub reducers: RemoteReducers,
    pub procedures: RemoteProcedures,
    pub event: __sdk::Event<Reducer>,
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::AbstractEventContext for EventContext {
    type Event = __sdk::Event<Reducer>;
    fn event(&self) -> &Self::Event {
        &self.event
    }
    fn new(imp: __sdk::DbContextImpl<RemoteModule>, event: Self::Event) -> Self {
        Self {
            db: RemoteTables { imp: imp.clone() },
            reducers: RemoteReducers { imp: imp.clone() },
            procedures: RemoteProcedures { imp: imp.clone() },
            event,
            imp,
        }
    }
}

impl __sdk::InModule for EventContext {
    type Module = RemoteModule;
}

impl __sdk::DbContext for EventContext {
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;

    fn db(&self) -> &Self::DbView {
        &self.db
    }
    fn reducers(&self) -> &Self::Reducers {
        &self.reducers
    }
    fn procedures(&self) -> &Self::Procedures {
        &self.procedures
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn disconnect(&self) -> __sdk::Result<()> {
        self.imp.disconnect()
    }

    type SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>;

    fn subscription_builder(&self) -> Self::SubscriptionBuilder {
        __sdk::SubscriptionBuilder::new(&self.imp)
    }

    fn try_identity(&self) -> Option<__sdk::Identity> {
        self.imp.try_identity()
    }
    fn connection_id(&self) -> __sdk::ConnectionId {
        self.imp.connection_id()
    }
    fn try_connection_id(&self) -> Option<__sdk::ConnectionId> {
        self.imp.try_connection_id()
    }
}

impl __sdk::EventContext for EventContext {}

pub struct ReducerEventContext {
    pub db: RemoteTables,
    pub reducers: RemoteReducers,
    pub procedures: RemoteProcedures,
    pub event: __sdk::ReducerEvent<Reducer>,
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::AbstractEventContext for ReducerEventContext {
    type Event = __sdk::ReducerEvent<Reducer>;
    fn event(&self) -> &Self::Event {
        &self.event
    }
    fn new(imp: __sdk::DbContextImpl<RemoteModule>, event: Self::Event) -> Self {
        Self {
            db: RemoteTables { imp: imp.clone() },
            reducers: RemoteReducers { imp: imp.clone() },
            procedures: RemoteProcedures { imp: imp.clone() },
            event,
            imp,
        }
    }
}

impl __sdk::InModule for ReducerEventContext {
    type Module = RemoteModule;
}

impl __sdk::DbContext for ReducerEventContext {
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;

    fn db(&self) -> &Self::DbView {
        &self.db
    }
    fn reducers(&self) -> &Self::Reducers {
        &self.reducers
    }
    fn procedures(&self) -> &Self::Procedures {
        &self.procedures
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn disconnect(&self) -> __sdk::Result<()> {
        self.imp.disconnect()
    }

    type SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>;

    fn subscription_builder(&self) -> Self::SubscriptionBuilder {
        __sdk::SubscriptionBuilder::new(&self.imp)
    }

    fn try_identity(&self) -> Option<__sdk::Identity> {
        self.imp.try_identity()
    }
    fn connection_id(&self) -> __sdk::ConnectionId {
        self.imp.connection_id()
    }
    fn try_connection_id(&self) -> Option<__sdk::ConnectionId> {
        self.imp.try_connection_id()
    }
}

impl __sdk::ReducerEventContext for ReducerEventContext {}

pub struct ProcedureEventContext {
    pub db: RemoteTables,
    pub reducers: RemoteReducers,
    pub procedures: RemoteProcedures,
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::AbstractEventContext for ProcedureEventContext {
    type Event = ();
    fn event(&self) -> &Self::Event {
        &()
    }
    fn new(imp: __sdk::DbContextImpl<RemoteModule>, _event: Self::Event) -> Self {
        Self {
            db: RemoteTables { imp: imp.clone() },
            reducers: RemoteReducers { imp: imp.clone() },
            procedures: RemoteProcedures { imp: imp.clone() },
            imp,
        }
    }
}

impl __sdk::InModule for ProcedureEventContext {
    type Module = RemoteModule;
}

impl __sdk::DbContext for ProcedureEventContext {
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;

    fn db(&self) -> &Self::DbView {
        &self.db
    }
    fn reducers(&self) -> &Self::Reducers {
        &self.reducers
    }
    fn procedures(&self) -> &Self::Procedures {
        &self.procedures
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn disconnect(&self) -> __sdk::Result<()> {
        self.imp.disconnect()
    }

    type SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>;

    fn subscription_builder(&self) -> Self::SubscriptionBuilder {
        __sdk::SubscriptionBuilder::new(&self.imp)
    }

    fn try_identity(&self) -> Option<__sdk::Identity> {
        self.imp.try_identity()
    }
    fn connection_id(&self) -> __sdk::ConnectionId {
        self.imp.connection_id()
    }
    fn try_connection_id(&self) -> Option<__sdk::ConnectionId> {
        self.imp.try_connection_id()
    }
}

impl __sdk::ProcedureEventContext for ProcedureEventContext {}

pub struct SubscriptionEventContext {
    pub db: RemoteTables,
    pub reducers: RemoteReducers,
    pub procedures: RemoteProcedures,
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::AbstractEventContext for SubscriptionEventContext {
    type Event = ();
    fn event(&self) -> &Self::Event {
        &()
    }
    fn new(imp: __sdk::DbContextImpl<RemoteModule>, _event: Self::Event) -> Self {
        Self {
            db: RemoteTables { imp: imp.clone() },
            reducers: RemoteReducers { imp: imp.clone() },
            procedures: RemoteProcedures { imp: imp.clone() },
            imp,
        }
    }
}

impl __sdk::InModule for SubscriptionEventContext {
    type Module = RemoteModule;
}

impl __sdk::DbContext for SubscriptionEventContext {
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;

    fn db(&self) -> &Self::DbView {
        &self.db
    }
    fn reducers(&self) -> &Self::Reducers {
        &self.reducers
    }
    fn procedures(&self) -> &Self::Procedures {
        &self.procedures
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn disconnect(&self) -> __sdk::Result<()> {
        self.imp.disconnect()
    }

    type SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>;

    fn subscription_builder(&self) -> Self::SubscriptionBuilder {
        __sdk::SubscriptionBuilder::new(&self.imp)
    }

    fn try_identity(&self) -> Option<__sdk::Identity> {
        self.imp.try_identity()
    }
    fn connection_id(&self) -> __sdk::ConnectionId {
        self.imp.connection_id()
    }
    fn try_connection_id(&self) -> Option<__sdk::ConnectionId> {
        self.imp.try_connection_id()
    }
}

impl __sdk::SubscriptionEventContext for SubscriptionEventContext {}

pub struct ErrorContext {
    pub db: RemoteTables,
    pub reducers: RemoteReducers,
    pub procedures: RemoteProcedures,
    pub event: Option<__sdk::Error>,
    imp: __sdk::DbContextImpl<RemoteModule>,
}

impl __sdk::AbstractEventContext for ErrorContext {
    type Event = Option<__sdk::Error>;
    fn event(&self) -> &Self::Event {
        &self.event
    }
    fn new(imp: __sdk::DbContextImpl<RemoteModule>, event: Self::Event) -> Self {
        Self {
            db: RemoteTables { imp: imp.clone() },
            reducers: RemoteReducers { imp: imp.clone() },
            procedures: RemoteProcedures { imp: imp.clone() },
            event,
            imp,
        }
    }
}

impl __sdk::InModule for ErrorContext {
    type Module = RemoteModule;
}

impl __sdk::DbContext for ErrorContext {
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;

    fn db(&self) -> &Self::DbView {
        &self.db
    }
    fn reducers(&self) -> &Self::Reducers {
        &self.reducers
    }
    fn procedures(&self) -> &Self::Procedures {
        &self.procedures
    }

    fn is_active(&self) -> bool {
        self.imp.is_active()
    }

    fn disconnect(&self) -> __sdk::Result<()> {
        self.imp.disconnect()
    }

    type SubscriptionBuilder = __sdk::SubscriptionBuilder<RemoteModule>;

    fn subscription_builder(&self) -> Self::SubscriptionBuilder {
        __sdk::SubscriptionBuilder::new(&self.imp)
    }

    fn try_identity(&self) -> Option<__sdk::Identity> {
        self.imp.try_identity()
    }
    fn connection_id(&self) -> __sdk::ConnectionId {
        self.imp.connection_id()
    }
    fn try_connection_id(&self) -> Option<__sdk::ConnectionId> {
        self.imp.try_connection_id()
    }
}

impl __sdk::ErrorContext for ErrorContext {}

impl __sdk::SpacetimeModule for RemoteModule {
    type DbConnection = DbConnection;
    type EventContext = EventContext;
    type ReducerEventContext = ReducerEventContext;
    type ProcedureEventContext = ProcedureEventContext;
    type SubscriptionEventContext = SubscriptionEventContext;
    type ErrorContext = ErrorContext;
    type Reducer = Reducer;
    type DbView = RemoteTables;
    type Reducers = RemoteReducers;
    type Procedures = RemoteProcedures;
    type DbUpdate = DbUpdate;
    type AppliedDiff<'r> = AppliedDiff<'r>;
    type SubscriptionHandle = SubscriptionHandle;
    type QueryBuilder = __sdk::QueryBuilder;

    fn register_tables(client_cache: &mut __sdk::ClientCache<Self>) {
        band_table::register_table(client_cache);
        command_table::register_table(client_cache);
        encounter_table::register_table(client_cache);
        event_table::register_table(client_cache);
        gateway_table::register_table(client_cache);
        link_table::register_table(client_cache);
        payment_table::register_table(client_cache);
        settings_table::register_table(client_cache);
        station_table::register_table(client_cache);
        zone_visit_table::register_table(client_cache);
    }
    const ALL_TABLE_NAMES: &'static [&'static str] = &[
        "band",
        "command",
        "encounter",
        "event",
        "gateway",
        "link",
        "payment",
        "settings",
        "station",
        "zone_visit",
    ];
}
