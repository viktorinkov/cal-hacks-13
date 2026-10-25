//! The evidence engine's pure half: the module reads rows the safety system,
//! the venue tables, the vision stub and the record reader already wrote, fills
//! an `EvidenceInput`, and this file turns it into ordered facts.

use crate::time::local_hms;
use crate::{Cents, CoverKind, Fact, IncidentKind, Micros, Reader, Source};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IncidentInfo {
    pub incident_id: u64,
    pub kind: IncidentKind,
    /// `band`, `ops`, `medic` or `vision`.
    pub opened_by: String,
    pub opened_at: Micros,
    pub resolved_at: Micros,
    /// The zone the incident was opened in; 0 when unzoned.
    pub zone_id: u64,
    /// The subject band; 0 for property incidents.
    pub band_id: u32,
}

/// The subject band's report as frozen at incident open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SubjectBand {
    pub band_id: u32,
    pub state: u8,
    pub flags: u8,
    pub neigh: u8,
    pub station_id: u8,
    pub battery: u8,
    pub reported_at: Micros,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub snapshot_id: u64,
    pub taken_at: Micros,
    /// Online bands in the incident zone at open, ascending.
    pub bands_present: Vec<u32>,
    /// Mean neighbour count of those bands: how crowded it was.
    pub neigh_mean: f32,
    /// Bands showing the light circle (state 4) at open, ascending.
    pub circle_bands: Vec<u32>,
    pub subject: Option<SubjectBand>,
}

/// A light-circle band recorded while the incident was open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Witness {
    pub band_id: u32,
    /// The witness band's zone when first seen in the circle; 0 when unzoned.
    pub zone_id: u64,
    /// Signal from the subject band as the witness heard it; 0 when unknown.
    pub rssi: i8,
    pub first_seen_at: Micros,
    pub last_seen_at: Micros,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StaffNote {
    pub note_id: u64,
    /// The author's staff role, for example `medic` or `ops`.
    pub author_role: String,
    pub text: String,
    /// Set on a cost note: the repair or treatment cost the staff member logged.
    pub cost_cents: Option<Cents>,
    pub created_at: Micros,
}

/// Location and zone context for the incident zone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ZoneContext {
    pub zone_id: u64,
    pub name: String,
    pub kind: String,
    pub area_m2: f32,
    pub capacity: u32,
    /// Names of booths in the zone, ascending.
    pub booths: Vec<String>,
    /// The schedule slot running in the zone at incident open, if any.
    pub schedule_now: Option<String>,
}

/// One stay of the subject band in a zone before the incident.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ZoneStay {
    pub zone_id: u64,
    pub zone_name: String,
    pub entered_at: Micros,
    /// Empty while the band is still in the zone.
    pub left_at: Option<Micros>,
}

/// The vision stub's assessment of the incident (TBD -- LEO).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VisionInfo {
    pub assessment_id: u64,
    pub confirmed: bool,
    pub confidence: f32,
    pub description: String,
    pub camera_id: u64,
    /// The zone the camera covers, from its `camera` row.
    pub camera_zone_id: u64,
    /// One SHA-256 per frame, paired with `frame_times`.
    pub frame_shas: Vec<String>,
    pub frame_times: Vec<Micros>,
    pub model_call_id: u64,
    pub created_at: Micros,
}

/// The medical record after the model read it and code validated and covered it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecordSummary {
    pub record_id: u64,
    pub sha256: String,
    pub patient_name: String,
    pub provider_name: String,
    pub date_of_service: String,
    /// `code description`, one per diagnosis.
    pub diagnoses: Vec<String>,
    pub billed_cents: Cents,
    /// Sum of covered service lines, computed by code.
    pub covered_cents: Cents,
    /// The encounter's date and time, as the record states it.
    pub observed_at: Micros,
    pub model_call_id: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PolicyInfo {
    pub policy_id: u64,
    pub policy_number: String,
    pub insurer_name: String,
    pub cover_kind: CoverKind,
    pub per_claim_limit_cents: Cents,
    pub aggregate_limit_cents: Cents,
    pub aggregate_used_cents: Cents,
    pub deductible_cents: Cents,
    pub read_at: Micros,
}

/// The attendee staff named as having broken or taken it, and code's checks of that band.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResponsibleInfo {
    pub charge_id: u64,
    pub band_id: u32,
    pub name: String,
    /// The staff role that named them, `ops` or `medic`.
    pub named_by_role: String,
    /// What staff wrote when they named them.
    pub note: String,
    pub named_at: Micros,
    /// The band was in the incident's zone at the time.
    pub in_zone: bool,
    /// The band was one of the bands at the spot when the incident opened, within 10 m.
    pub at_spot: bool,
}

/// Everything the evidence engine gathered for one claim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EvidenceInput {
    pub incident: IncidentInfo,
    pub snapshot: Option<SnapshotInfo>,
    pub witnesses: Vec<Witness>,
    pub notes: Vec<StaffNote>,
    pub zone: Option<ZoneContext>,
    pub presence: Vec<ZoneStay>,
    pub vision: Option<VisionInfo>,
    pub record: Option<RecordSummary>,
    pub policy: Option<PolicyInfo>,
    #[serde(default)]
    pub responsible: Option<ResponsibleInfo>,
}

impl EvidenceInput {
    /// Sum of `cost_cents` over the staff notes.
    pub fn noted_cost_cents(&self) -> Cents {
        self.notes.iter().filter_map(|n| n.cost_cents).sum()
    }
}

/// Turns gathered rows into facts, numbered `seq` 1..n in this fixed order:
///
/// 1. `incident_snapshot` (observed at `incident.opened_at`, reference
///    `incident:{incident_id}`): `incident_kind`, `opened_by`, `zone_id`.
/// 2. `band_report` from `snapshot.subject` (observed at `reported_at`,
///    reference `incident_snapshot:{snapshot_id}`): `band_id`, `fall_flag`
///    (`1`/`0` from flags bit 2), `sos_flag` (bit 1), `band_state`, `neigh`, `station_id`.
/// 3. `incident_snapshot` (observed at `taken_at`, same reference):
///    `bands_present` (comma list, `none` when empty), `band_count`,
///    `neigh_mean` (one decimal), `circle_bands` (comma list or `none`).
/// 4. `light_circle`, one fact per witness in band id order (observed at
///    `first_seen_at`, reference `incident_band:{incident_id}:{band_id}`):
///    key `witness`, value `band {id} zone {zone_id} rssi {rssi}`.
/// 5. `staff_note`, per note in `note_id` order (observed at `created_at`,
///    reference `incident_note:{note_id}`): key `note`, value
///    `{author_role}: {text}`; then, for a cost note, key `cost_cents`, value the cents.
/// 6. `zone_context` (observed at `opened_at`, reference `zone:{zone_id}`):
///    `zone_name`, `zone_kind`, `zone_area_m2` (one decimal), `zone_capacity`,
///    `nearby_booths` (comma list or `none`), `schedule_now` (title or `none`).
/// 7. `presence`, per stay in `entered_at` order (observed at `entered_at`,
///    reference `zone_visit:{band_id}`): key `zone_stay`, value
///    `{zone_name} {HH:MM:SS}-{HH:MM:SS or now}` in UTC-7 local time.
/// 8. `vision_assessment` (observed at `created_at`, reference
///    `vision_assessment:{assessment_id}`): `vision_confirmed` (`yes`/`no`,
///    reader model), `vision_confidence` (two decimals, reader model),
///    `vision_description` (reader model), `camera_zone_id` (reader code);
///    then per frame, key `frame`, value the SHA-256, observed at the frame
///    time, reference `blob:{sha}`, reader code.
/// 9. `medical_record` (observed at the encounter's `observed_at`, reference `blob:{sha256}`):
///    `record_patient`, `record_provider`, `record_date_of_service`,
///    `record_diagnoses` (joined with `; `), `record_billed_cents` (all reader
///    model), then `record_covered_cents` and `record_sha256` (reader code).
/// 10. `policy` (observed at `read_at`, reference `insurance_policy:{policy_id}`,
///     `attendee_policy:{policy_id}` for the attendee's own):
///     `policy_number`, `insurer`, `cover_kind`, `per_claim_limit_cents`,
///     `deductible_cents`, `aggregate_remaining_cents` (limit minus used, floored at 0).
/// 11. `responsible_party` (observed at `named_at`, reference `charge:{charge_id}`):
///     `responsible_band`, `responsible_name`, `named_by`, `naming_note`,
///     `band_in_zone` and `band_at_spot` (`yes`/`no`).
///
/// Missing optional inputs simply contribute no facts. Every fact not listed
/// as model-read has reader `Code`.
pub fn build_facts(input: &EvidenceInput) -> Vec<Fact> {
    let inc = &input.incident;
    let mut f = Facts::default();

    f.group(Source::IncidentSnapshot, inc.opened_at, format!("incident:{}", inc.incident_id));
    f.code("incident_kind", inc.kind.as_str());
    f.code("opened_by", &inc.opened_by);
    f.code("zone_id", inc.zone_id);

    if let Some(s) = &input.snapshot {
        let reference = format!("incident_snapshot:{}", s.snapshot_id);
        if let Some(b) = &s.subject {
            f.group(Source::BandReport, b.reported_at, reference.clone());
            f.code("band_id", b.band_id);
            f.code("fall_flag", u8::from(b.flags & FLAG_FALL != 0));
            f.code("sos_flag", u8::from(b.flags & FLAG_SOS != 0));
            f.code("band_state", b.state);
            f.code("neigh", b.neigh);
            f.code("station_id", b.station_id);
        }
        f.group(Source::IncidentSnapshot, s.taken_at, reference);
        f.code("bands_present", comma_list(&s.bands_present));
        f.code("band_count", s.bands_present.len());
        f.code("neigh_mean", format!("{:.1}", s.neigh_mean));
        f.code("circle_bands", comma_list(&s.circle_bands));
    }

    let mut witnesses: Vec<&Witness> = input.witnesses.iter().collect();
    witnesses.sort_by_key(|w| w.band_id);
    for w in witnesses {
        f.group(Source::LightCircle, w.first_seen_at, format!("incident_band:{}:{}", inc.incident_id, w.band_id));
        f.code("witness", format!("band {} zone {} rssi {}", w.band_id, w.zone_id, w.rssi));
    }

    let mut notes: Vec<&StaffNote> = input.notes.iter().collect();
    notes.sort_by_key(|n| n.note_id);
    for n in notes {
        f.group(Source::StaffNote, n.created_at, format!("incident_note:{}", n.note_id));
        f.code("note", format!("{}: {}", n.author_role, n.text));
        if let Some(cost) = n.cost_cents {
            f.code("cost_cents", cost);
        }
    }

    if let Some(z) = &input.zone {
        f.group(Source::ZoneContext, inc.opened_at, format!("zone:{}", z.zone_id));
        f.code("zone_name", &z.name);
        f.code("zone_kind", &z.kind);
        f.code("zone_area_m2", format!("{:.1}", z.area_m2));
        f.code("zone_capacity", z.capacity);
        f.code("nearby_booths", comma_list(&z.booths));
        f.code("schedule_now", z.schedule_now.as_deref().unwrap_or("none"));
    }

    let mut stays: Vec<&ZoneStay> = input.presence.iter().collect();
    stays.sort_by_key(|s| s.entered_at);
    for s in stays {
        let left = s.left_at.map_or("now".to_string(), |t| local_hms(t, PRESENCE_TZ_OFFSET_MINUTES));
        f.group(Source::Presence, s.entered_at, format!("zone_visit:{}", inc.band_id));
        f.code("zone_stay", format!("{} {}-{}", s.zone_name, local_hms(s.entered_at, PRESENCE_TZ_OFFSET_MINUTES), left));
    }

    if let Some(v) = &input.vision {
        f.group(Source::VisionAssessment, v.created_at, format!("vision_assessment:{}", v.assessment_id));
        f.model("vision_confirmed", if v.confirmed { "yes" } else { "no" });
        f.model("vision_confidence", format!("{:.2}", v.confidence));
        f.model("vision_description", &v.description);
        f.code("camera_zone_id", v.camera_zone_id);
        for (i, sha) in v.frame_shas.iter().enumerate() {
            let at = v.frame_times.get(i).copied().unwrap_or(v.created_at);
            f.group(Source::VisionAssessment, at, format!("blob:{sha}"));
            f.code("frame", sha);
        }
    }

    if let Some(r) = &input.record {
        f.group(Source::MedicalRecord, r.observed_at, format!("blob:{}", r.sha256));
        f.model("record_patient", &r.patient_name);
        f.model("record_provider", &r.provider_name);
        f.model("record_date_of_service", &r.date_of_service);
        f.model("record_diagnoses", r.diagnoses.join("; "));
        f.model("record_billed_cents", r.billed_cents);
        f.code("record_covered_cents", r.covered_cents);
        f.code("record_sha256", &r.sha256);
    }

    if let Some(p) = &input.policy {
        let table = if p.cover_kind.is_attendee_policy() { "attendee_policy" } else { "insurance_policy" };
        f.group(Source::Policy, p.read_at, format!("{table}:{}", p.policy_id));
        f.code("policy_number", &p.policy_number);
        f.code("insurer", &p.insurer_name);
        f.code("cover_kind", p.cover_kind.as_str());
        f.code("per_claim_limit_cents", p.per_claim_limit_cents);
        f.code("deductible_cents", p.deductible_cents);
        f.code("aggregate_remaining_cents", p.aggregate_limit_cents.saturating_sub(p.aggregate_used_cents));
    }

    if let Some(r) = &input.responsible {
        let yes = |b: bool| if b { "yes" } else { "no" };
        f.group(Source::ResponsibleParty, r.named_at, format!("charge:{}", r.charge_id));
        f.code("responsible_band", r.band_id);
        f.code("responsible_name", &r.name);
        f.code("named_by", &r.named_by_role);
        f.code("naming_note", &r.note);
        f.code("band_in_zone", yes(r.in_zone));
        f.code("band_at_spot", yes(r.at_spot));
    }

    f.out
}

/// Beacon flag bits, as `F_SOS` and `F_FALL` in the module.
const FLAG_SOS: u8 = 1;
const FLAG_FALL: u8 = 2;

/// `build_facts` takes no `Config`, so presence times print in UTC-7.
const PRESENCE_TZ_OFFSET_MINUTES: i32 = -7 * 60;

/// Facts being numbered, with the source, time and reference of the current group.
struct Facts {
    out: Vec<Fact>,
    source: Source,
    at: Micros,
    reference: String,
}

impl Default for Facts {
    fn default() -> Self {
        Self { out: Vec::new(), source: Source::IncidentSnapshot, at: 0, reference: String::new() }
    }
}

impl Facts {
    fn group(&mut self, source: Source, at: Micros, reference: String) {
        self.source = source;
        self.at = at;
        self.reference = reference;
    }

    fn push(&mut self, reader: Reader, key: &str, value: impl ToString) {
        self.out.push(Fact {
            seq: self.out.len() as u32 + 1,
            source: self.source,
            key: key.to_string(),
            value: value.to_string(),
            observed_at: self.at,
            reader,
            reference: self.reference.clone(),
        });
    }

    fn code(&mut self, key: &str, value: impl ToString) {
        self.push(Reader::Code, key, value);
    }

    fn model(&mut self, key: &str, value: impl ToString) {
        self.push(Reader::Model, key, value);
    }
}

/// `2, 4, 9`, or `none` when empty.
fn comma_list<T: ToString>(items: &[T]) -> String {
    if items.is_empty() {
        return "none".to_string();
    }
    items.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::micros_at;

    const PDT: i32 = -420;

    fn at(h: i64, m: i64, s: i64) -> Micros {
        micros_at(2026, 10, 24, h, m, s, PDT)
    }

    fn witness(band_id: u32, rssi: i8, s: i64) -> Witness {
        Witness { band_id, zone_id: 102, rssi, first_seen_at: at(22, 14, s), last_seen_at: at(22, 20, 0) }
    }

    fn full_input() -> EvidenceInput {
        EvidenceInput {
            incident: IncidentInfo {
                incident_id: 1,
                kind: IncidentKind::Fall,
                opened_by: "band".into(),
                opened_at: at(22, 14, 5),
                resolved_at: at(22, 31, 0),
                zone_id: 102,
                band_id: 7,
            },
            snapshot: Some(SnapshotInfo {
                snapshot_id: 11,
                taken_at: at(22, 14, 5),
                bands_present: vec![2, 4, 7, 9],
                neigh_mean: 6.33,
                circle_bands: vec![2, 4, 9],
                subject: Some(SubjectBand { band_id: 7, state: 3, flags: FLAG_FALL | 16, neigh: 6, station_id: 3, battery: 80, reported_at: at(22, 14, 5) }),
            }),
            witnesses: vec![witness(9, -60, 7), witness(2, -55, 6), witness(4, -58, 6)],
            notes: vec![StaffNote {
                note_id: 501,
                author_role: "medic".into(),
                text: "cold pack and wrap, first aid".into(),
                cost_cents: Some(18000),
                created_at: at(22, 26, 0),
            }],
            zone: Some(ZoneContext {
                zone_id: 102,
                name: "Main stage left".into(),
                kind: "stage".into(),
                area_m2: 450.0,
                capacity: 900,
                booths: vec!["Merch tent".into(), "Water point".into()],
                schedule_now: Some("Headliner set".into()),
            }),
            presence: vec![
                ZoneStay { zone_id: 102, zone_name: "Main stage left".into(), entered_at: at(22, 5, 12), left_at: None },
                ZoneStay { zone_id: 101, zone_name: "Entrance".into(), entered_at: at(21, 50, 0), left_at: Some(at(22, 5, 12)) },
            ],
            vision: Some(VisionInfo {
                assessment_id: 21,
                confirmed: true,
                confidence: 0.914,
                description: "person falls near the barrier".into(),
                camera_id: 5,
                camera_zone_id: 102,
                frame_shas: vec!["aa11".into(), "bb22".into()],
                frame_times: vec![at(22, 14, 3), at(22, 14, 6)],
                model_call_id: 61,
                created_at: at(22, 14, 20),
            }),
            record: Some(RecordSummary {
                record_id: 31,
                sha256: "cafe".into(),
                patient_name: "Alex Kim".into(),
                provider_name: "Festival Medical Tent".into(),
                date_of_service: "2026-10-24".into(),
                diagnoses: vec!["S63.501A Sprain of right wrist".into(), "W19 Unspecified fall".into()],
                billed_cents: 18000,
                covered_cents: 18000,
                observed_at: at(22, 40, 0),
                model_call_id: 62,
            }),
            policy: Some(PolicyInfo {
                policy_id: 41,
                policy_number: "GL-2026-0042".into(),
                insurer_name: "Harbor Mutual".into(),
                cover_kind: CoverKind::MedicalPayments,
                per_claim_limit_cents: 500000,
                aggregate_limit_cents: 2500000,
                aggregate_used_cents: 120000,
                deductible_cents: 0,
                read_at: at(22, 31, 0),
            }),
            responsible: None,
        }
    }

    fn value<'a>(facts: &'a [Fact], key: &str) -> &'a str {
        &facts.iter().find(|f| f.key == key).unwrap().value
    }

    #[test]
    fn full_input_in_fixed_order() {
        let facts = build_facts(&full_input());
        let keys: Vec<&str> = facts.iter().map(|f| f.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "incident_kind", "opened_by", "zone_id",
                "band_id", "fall_flag", "sos_flag", "band_state", "neigh", "station_id",
                "bands_present", "band_count", "neigh_mean", "circle_bands",
                "witness", "witness", "witness",
                "note", "cost_cents",
                "zone_name", "zone_kind", "zone_area_m2", "zone_capacity", "nearby_booths", "schedule_now",
                "zone_stay", "zone_stay",
                "vision_confirmed", "vision_confidence", "vision_description", "camera_zone_id", "frame", "frame",
                "record_patient", "record_provider", "record_date_of_service", "record_diagnoses",
                "record_billed_cents", "record_covered_cents", "record_sha256",
                "policy_number", "insurer", "cover_kind", "per_claim_limit_cents", "deductible_cents",
                "aggregate_remaining_cents",
            ]
        );
        let seqs: Vec<u32> = facts.iter().map(|f| f.seq).collect();
        assert_eq!(seqs, (1..=45).collect::<Vec<u32>>());
    }

    #[test]
    fn full_input_values_and_references() {
        let facts = build_facts(&full_input());
        assert_eq!(value(&facts, "incident_kind"), "fall");
        assert_eq!(value(&facts, "zone_id"), "102");
        assert_eq!(value(&facts, "fall_flag"), "1");
        assert_eq!(value(&facts, "sos_flag"), "0");
        assert_eq!(value(&facts, "bands_present"), "2, 4, 7, 9");
        assert_eq!(value(&facts, "band_count"), "4");
        assert_eq!(value(&facts, "neigh_mean"), "6.3");
        assert_eq!(value(&facts, "circle_bands"), "2, 4, 9");
        assert_eq!(value(&facts, "note"), "medic: cold pack and wrap, first aid");
        assert_eq!(value(&facts, "cost_cents"), "18000");
        assert_eq!(value(&facts, "zone_name"), "Main stage left");
        assert_eq!(value(&facts, "zone_area_m2"), "450.0");
        assert_eq!(value(&facts, "nearby_booths"), "Merch tent, Water point");
        assert_eq!(value(&facts, "schedule_now"), "Headliner set");
        assert_eq!(value(&facts, "vision_confirmed"), "yes");
        assert_eq!(value(&facts, "vision_confidence"), "0.91");
        assert_eq!(value(&facts, "record_diagnoses"), "S63.501A Sprain of right wrist; W19 Unspecified fall");
        assert_eq!(value(&facts, "cover_kind"), "medical_payments");
        assert_eq!(value(&facts, "aggregate_remaining_cents"), "2380000");

        let witnesses: Vec<&str> = facts.iter().filter(|f| f.key == "witness").map(|f| f.value.as_str()).collect();
        assert_eq!(witnesses, ["band 2 zone 102 rssi -55", "band 4 zone 102 rssi -58", "band 9 zone 102 rssi -60"]);
        let stays: Vec<&str> = facts.iter().filter(|f| f.key == "zone_stay").map(|f| f.value.as_str()).collect();
        assert_eq!(stays, ["Entrance 21:50:00-22:05:12", "Main stage left 22:05:12-now"]);

        let by_seq = |seq: u32| &facts[seq as usize - 1];
        assert_eq!((by_seq(1).source, by_seq(1).reference.as_str(), by_seq(1).observed_at), (Source::IncidentSnapshot, "incident:1", at(22, 14, 5)));
        assert_eq!((by_seq(4).source, by_seq(4).reference.as_str()), (Source::BandReport, "incident_snapshot:11"));
        assert_eq!((by_seq(10).source, by_seq(10).reference.as_str()), (Source::IncidentSnapshot, "incident_snapshot:11"));
        assert_eq!((by_seq(14).source, by_seq(14).reference.as_str(), by_seq(14).observed_at), (Source::LightCircle, "incident_band:1:2", at(22, 14, 6)));
        assert_eq!((by_seq(17).source, by_seq(17).reference.as_str()), (Source::StaffNote, "incident_note:501"));
        assert_eq!((by_seq(18).source, by_seq(18).reference.as_str()), (Source::StaffNote, "incident_note:501"));
        assert_eq!((by_seq(19).source, by_seq(19).reference.as_str()), (Source::ZoneContext, "zone:102"));
        assert_eq!((by_seq(25).source, by_seq(25).reference.as_str(), by_seq(25).observed_at), (Source::Presence, "zone_visit:7", at(21, 50, 0)));
        assert_eq!((by_seq(27).reference.as_str(), by_seq(27).observed_at), ("vision_assessment:21", at(22, 14, 20)));
        assert_eq!((by_seq(31).reference.as_str(), by_seq(31).observed_at, by_seq(31).value.as_str()), ("blob:aa11", at(22, 14, 3), "aa11"));
        assert_eq!((by_seq(33).source, by_seq(33).reference.as_str()), (Source::MedicalRecord, "blob:cafe"));
        assert_eq!((by_seq(40).source, by_seq(40).reference.as_str()), (Source::Policy, "insurance_policy:41"));

        let model: Vec<&str> = facts.iter().filter(|f| f.reader == Reader::Model).map(|f| f.key.as_str()).collect();
        assert_eq!(
            model,
            [
                "vision_confirmed", "vision_confidence", "vision_description",
                "record_patient", "record_provider", "record_date_of_service", "record_diagnoses", "record_billed_cents",
            ]
        );
    }

    #[test]
    fn minimal_property_input() {
        let input = EvidenceInput {
            incident: IncidentInfo {
                incident_id: 2,
                kind: IncidentKind::Property,
                opened_by: "ops".into(),
                opened_at: at(23, 40, 0),
                resolved_at: at(23, 55, 0),
                zone_id: 102,
                band_id: 0,
            },
            snapshot: None,
            witnesses: vec![],
            notes: vec![
                StaffNote { note_id: 9, author_role: "stage_manager".into(), text: "speaker cone torn".into(), cost_cents: Some(240000), created_at: at(23, 45, 0) },
                StaffNote { note_id: 8, author_role: "stage_manager".into(), text: "speaker down at stage B".into(), cost_cents: None, created_at: at(23, 41, 0) },
            ],
            zone: None,
            presence: vec![],
            vision: None,
            record: None,
            policy: None,
            responsible: None,
        };
        let facts = build_facts(&input);
        let lines: Vec<(u32, &str, &str)> = facts.iter().map(|f| (f.seq, f.key.as_str(), f.value.as_str())).collect();
        assert_eq!(
            lines,
            [
                (1, "incident_kind", "property"),
                (2, "opened_by", "ops"),
                (3, "zone_id", "102"),
                (4, "note", "stage_manager: speaker down at stage B"),
                (5, "note", "stage_manager: speaker cone torn"),
                (6, "cost_cents", "240000"),
            ]
        );
        assert!(facts.iter().all(|f| f.reader == Reader::Code));
        assert_eq!(facts[5].reference, "incident_note:9");
        assert_eq!(input.noted_cost_cents(), 240000);
    }

    #[test]
    fn empty_lists_print_none() {
        let mut input = full_input();
        let snap = input.snapshot.as_mut().unwrap();
        snap.bands_present.clear();
        snap.circle_bands.clear();
        snap.subject = None;
        let zone = input.zone.as_mut().unwrap();
        zone.booths.clear();
        zone.schedule_now = None;
        let facts = build_facts(&input);
        assert_eq!(value(&facts, "bands_present"), "none");
        assert_eq!(value(&facts, "band_count"), "0");
        assert_eq!(value(&facts, "circle_bands"), "none");
        assert_eq!(value(&facts, "nearby_booths"), "none");
        assert_eq!(value(&facts, "schedule_now"), "none");
        assert!(facts.iter().all(|f| f.source != Source::BandReport));
        assert_eq!(facts[3].key, "bands_present");
    }

    #[test]
    fn sos_flag_and_floored_aggregate() {
        let mut input = full_input();
        input.snapshot.as_mut().unwrap().subject.as_mut().unwrap().flags = FLAG_SOS;
        input.policy.as_mut().unwrap().aggregate_used_cents = 3_000_000;
        let facts = build_facts(&input);
        assert_eq!(value(&facts, "fall_flag"), "0");
        assert_eq!(value(&facts, "sos_flag"), "1");
        assert_eq!(value(&facts, "aggregate_remaining_cents"), "0");
    }
}
