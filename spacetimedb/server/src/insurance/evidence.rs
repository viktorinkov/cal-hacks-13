//! The evidence engine: reads the rows the bands, the safety watch, the venue
//! import, the vision stub and the record reader already wrote, and builds a
//! hashed, versioned evidence pack with its code checks. Nothing here senses
//! anything new.

use super::*;
use super::{micros, timestamp};
use crate::roles::*;
use crate::safety::*;
use crate::tables::*;
use crate::venue::*;
use crate::vision::*;
use hyphenate_core::evidence::*;
use hyphenate_core::{Check, CoverKind, Fact};
use spacetimedb::{ReducerContext, Table};

/// How far back the subject band's zone history is read.
const PRESENCE_WINDOW_MICROS: i64 = 15 * 60 * 1_000_000;

pub fn kind_of(claim: &Claim) -> hyphenate_core::IncidentKind {
    hyphenate_core::IncidentKind::parse(&claim.incident_kind).unwrap_or(hyphenate_core::IncidentKind::Property)
}

pub fn cover_of(claim: &Claim) -> CoverKind {
    CoverKind::parse(&claim.cover_kind).unwrap_or(CoverKind::Property)
}

pub fn policy_rule(ctx: &ReducerContext, policy_id: u64, cover: CoverKind) -> Option<CoverageRuleRow> {
    ctx.db.coverage_rule().policy_id().filter(policy_id).find(|r| r.cover_kind == cover.as_str())
}

pub fn core_rule(r: &CoverageRuleRow) -> hyphenate_core::coverage::CoverageRule {
    hyphenate_core::coverage::CoverageRule {
        cover_kind: CoverKind::parse(&r.cover_kind).unwrap_or(CoverKind::Property),
        incident_kinds: r.incident_kinds.iter().filter_map(|k| hyphenate_core::IncidentKind::parse(k)).collect(),
        per_claim_limit_cents: r.per_claim_limit_cents,
        aggregate_limit_cents: r.aggregate_limit_cents,
        deductible_cents: r.deductible_cents,
        service_window_days: r.service_window_days,
        active: r.active,
    }
}

pub fn aggregate_used(policy: &InsurancePolicy, cover: CoverKind) -> u64 {
    match cover {
        CoverKind::MedicalPayments => policy.medical_used_cents,
        CoverKind::Property => policy.property_used_cents,
    }
}

pub fn extracted_record(ctx: &ReducerContext, claim_id: u64) -> Option<MedicalRecord> {
    ctx.db.medical_record().claim_id().filter(claim_id).filter(|r| r.status == "extracted").max_by_key(|r| r.id)
}

/// Everything the engine reads for one claim.
pub fn gather(ctx: &ReducerContext, claim: &Claim) -> EvidenceInput {
    let inc = ctx.db.incident().id().find(claim.incident_id).expect("claim without incident");
    let opened_at = micros(inc.opened_at);
    let incident = IncidentInfo {
        incident_id: inc.id,
        kind: inc.kind.core(),
        opened_by: inc.opened_by.clone(),
        opened_at,
        resolved_at: inc.resolved_at.map(micros).unwrap_or(micros(ctx.timestamp)),
        zone_id: inc.zone_id,
        band_id: inc.subject_band,
    };

    let snapshot = ctx.db.incident_snapshot().incident_id().find(inc.id).map(|s| SnapshotInfo {
        snapshot_id: s.id,
        taken_at: micros(s.taken_at),
        bands_present: s.bands_present.clone(),
        neigh_mean: s.neigh_mean,
        circle_bands: s.circle_bands.clone(),
        subject: (inc.subject_band != 0).then(|| SubjectBand {
            band_id: inc.subject_band,
            state: s.band_state,
            flags: s.band_flags,
            neigh: s.band_neigh,
            station_id: s.station_id,
            battery: s.band_battery,
            reported_at: micros(s.band_seen_at),
        }),
    });

    let mut witnesses: Vec<Witness> = ctx
        .db
        .incident_band()
        .incident_id()
        .filter(inc.id)
        .filter(|r| r.role == "witness")
        .map(|r| Witness {
            band_id: r.band_id,
            zone_id: r.zone_id,
            rssi: r.rssi,
            first_seen_at: micros(r.first_seen_at),
            last_seen_at: micros(r.last_seen_at),
        })
        .collect();
    witnesses.sort_by_key(|w| w.band_id);

    let mut notes: Vec<StaffNote> = ctx
        .db
        .incident_note()
        .incident_id()
        .filter(inc.id)
        .map(|n| StaffNote {
            note_id: n.id,
            author_role: n.author_role.clone(),
            text: n.text.clone(),
            cost_cents: n.cost_cents,
            created_at: micros(n.created_at),
        })
        .collect();
    notes.sort_by_key(|n| n.note_id);

    let zone = ctx.db.zone().id().find(inc.zone_id).map(|z| {
        let mut booths: Vec<String> = booths_in_zone(ctx, z.id).into_iter().map(|b| b.name).collect();
        booths.sort();
        let schedule_now = ctx
            .db
            .schedule_slot()
            .zone_id()
            .filter(z.id)
            .find(|s| s.starts_at <= inc.opened_at && s.ends_at.is_none_or(|e| e >= inc.opened_at))
            .map(|s| s.title);
        ZoneContext {
            zone_id: z.id,
            name: z.name.clone(),
            kind: z.kind.clone(),
            area_m2: z.area_sq_m,
            capacity: z.capacity,
            booths,
            schedule_now,
        }
    });

    let mut presence: Vec<ZoneStay> = if inc.subject_band == 0 {
        Vec::new()
    } else {
        ctx.db
            .zone_visit()
            .band_id()
            .filter(inc.subject_band)
            .filter(|v| micros(v.entered) <= opened_at && v.left.is_none_or(|l| micros(l) >= opened_at - PRESENCE_WINDOW_MICROS))
            .map(|v| {
                let z = zone_for_station(ctx, v.zone);
                ZoneStay {
                    zone_id: z.as_ref().map(|z| z.id).unwrap_or(0),
                    zone_name: z.map(|z| z.name).unwrap_or_else(|| format!("station {}", v.zone)),
                    entered_at: micros(v.entered),
                    left_at: v.left.map(micros),
                }
            })
            .collect()
    };
    presence.sort_by_key(|s| s.entered_at);

    let vision = ctx.db.vision_assessment().incident_id().filter(inc.id).max_by_key(|a| a.id).map(|a| VisionInfo {
        assessment_id: a.id,
        confirmed: a.confirmed,
        confidence: a.confidence,
        description: a.description.clone(),
        camera_id: a.camera_id,
        camera_zone_id: ctx.db.camera().id().find(a.camera_id).map(|c| c.zone_id).unwrap_or(0),
        frame_shas: a.frame_hashes.clone(),
        frame_times: a.frame_times.iter().map(|t| micros(*t)).collect(),
        model_call_id: a.model_call_id,
        created_at: micros(a.created_at),
    });

    let record = extracted_record(ctx, claim.id).map(|r| RecordSummary {
        record_id: r.id,
        sha256: r.file_hash.clone(),
        patient_name: r.patient_name.clone(),
        provider_name: r.provider_name.clone(),
        date_of_service: r.date_of_service.clone(),
        diagnoses: r.diagnoses.clone(),
        billed_cents: r.billed_cents,
        covered_cents: r.covered_cents,
        observed_at: encounter_micros(&r, settings(ctx).tz_offset_minutes).unwrap_or(micros(r.submitted_at)),
        model_call_id: r.model_call_id,
    });

    let cover = cover_of(claim);
    let policy = ctx.db.insurance_policy().id().find(claim.policy_id).and_then(|p| {
        policy_rule(ctx, p.id, cover).map(|r| PolicyInfo {
            policy_id: p.id,
            policy_number: p.policy_number.clone(),
            insurer_name: p.insurer_name.clone(),
            cover_kind: cover,
            per_claim_limit_cents: r.per_claim_limit_cents,
            aggregate_limit_cents: r.aggregate_limit_cents,
            aggregate_used_cents: aggregate_used(&p, cover),
            deductible_cents: r.deductible_cents,
            read_at: micros(ctx.timestamp),
        })
    });

    EvidenceInput { incident, snapshot, witnesses, notes, zone, presence, vision, record, policy }
}

/// The record's encounter as a timestamp: its date and time of service in
/// venue time, noon when the record gives no time.
fn encounter_micros(r: &MedicalRecord, tz_offset_minutes: i32) -> Option<i64> {
    let record: hyphenate_core::medical::ExtractedRecord = serde_json::from_str(&r.record_json).ok()?;
    let days = hyphenate_core::time::parse_date(&record.encounter.date_of_service)?;
    let (h, m) = record
        .encounter
        .time
        .split_once(':')
        .and_then(|(h, m)| Some((h.trim().parse::<i64>().ok()?, m.trim().parse::<i64>().ok()?)))
        .unwrap_or((12, 0));
    let (y, mo, d) = hyphenate_core::time::civil_from_days(days);
    Some(hyphenate_core::time::micros_at(y, mo, d, h, m, 0, tz_offset_minutes))
}

/// Code checks on the filed medical record: patient, dates, injury code,
/// totals, covered lines, and whether the same file was filed on another claim.
pub fn record_checks(ctx: &ReducerContext, claim: &Claim, input: &EvidenceInput) -> Vec<Check> {
    let Some(rec) = extracted_record(ctx, claim.id) else {
        return Vec::new();
    };
    let s = settings(ctx);
    let window = policy_rule(ctx, claim.policy_id, cover_of(claim)).map(|r| r.service_window_days).unwrap_or(0);
    let incident_date = hyphenate_core::time::local_date(input.incident.opened_at, s.tz_offset_minutes);
    let mut checks = Vec::new();
    if let Ok(record) = serde_json::from_str::<hyphenate_core::medical::ExtractedRecord>(&rec.record_json) {
        let valid = hyphenate_core::medical::ValidRecord { record, dropped: rec.dropped.clone() };
        checks.extend(hyphenate_core::medical::record_checks(&valid, &claim.claimant_name, &incident_date, window));
        let lines = hyphenate_core::fee_schedule::cover_lines(&valid, &incident_date, window);
        checks.push(hyphenate_core::fee_schedule::lines_check(&lines));
    }
    checks.push(duplicate_check(ctx, claim, &rec));
    checks
}

/// The same bill filed on another claim: the same file, the same provider and
/// invoice number, or the same patient, service date and total.
fn duplicate_check(ctx: &ReducerContext, claim: &Claim, rec: &MedicalRecord) -> Check {
    if let Some(other) = ctx.db.medical_record().file_hash().filter(&rec.file_hash).find(|r| r.claim_id != claim.id) {
        return Check::fail("record_duplicate", format!("the same file is filed on claim {}", other.claim_id));
    }
    let norm = |s: &str| s.trim().to_lowercase();
    for other in ctx.db.medical_record().iter().filter(|r| r.claim_id != claim.id && r.status == "extracted") {
        if !rec.invoice_number.is_empty() && norm(&other.invoice_number) == norm(&rec.invoice_number) && norm(&other.provider_name) == norm(&rec.provider_name) {
            return Check::fail("record_duplicate", format!("invoice {} from {} is already filed on claim {}", rec.invoice_number, rec.provider_name, other.claim_id));
        }
        if norm(&other.patient_name) == norm(&rec.patient_name) && other.date_of_service == rec.date_of_service && other.billed_cents == rec.billed_cents {
            return Check::fail(
                "record_duplicate",
                format!("{} on {} for {} is already filed on claim {}", rec.patient_name, rec.date_of_service, hyphenate_core::money::format_cents(rec.billed_cents), other.claim_id),
            );
        }
    }
    Check::pass("record_duplicate", "no other claim has this file, invoice, or patient, date and total")
}

/// Medical-payments cover excludes the venue's own staff.
fn claimant_check(ctx: &ReducerContext, claim: &Claim) -> Option<Check> {
    if cover_of(claim) != CoverKind::MedicalPayments {
        return None;
    }
    let claimant = claim.claimant?;
    let role = ctx.db.staff_role().identity().filter(claimant).next().map(|r| r.role);
    Some(match role {
        Some(role) => Check::fail("claimant_not_staff", format!("{} holds the staff role {role}", claim.claimant_name)),
        None => Check::pass("claimant_not_staff", format!("{} holds no staff role", claim.claimant_name)),
    })
}

/// Injury incidents in the same zone within this many microseconds count as one occurrence.
const OCCURRENCE_MICROS: i64 = 5 * 60 * 1_000_000;

/// The injury incidents of the same occurrence as this one, itself included.
pub fn occurrence(ctx: &ReducerContext, incident_id: u64) -> Vec<Incident> {
    let Some(inc) = ctx.db.incident().id().find(incident_id) else {
        return Vec::new();
    };
    if inc.kind == IncidentKind::Property || inc.zone_id == 0 {
        return vec![inc];
    }
    let at = micros(inc.opened_at);
    let mut all: Vec<Incident> = ctx
        .db
        .incident()
        .iter()
        .filter(|i| i.kind != IncidentKind::Property && i.zone_id == inc.zone_id && (micros(i.opened_at) - at).abs() <= OCCURRENCE_MICROS)
        .collect();
    all.sort_by_key(|i| i.id);
    all
}

pub struct Pack {
    pub version: u32,
    pub hash: String,
    pub facts: Vec<Fact>,
    pub corroboration: hyphenate_core::Corroboration,
    pub checks: Vec<Check>,
    pub input: EvidenceInput,
}

/// Builds pack version n+1 for the claim: facts, hash, corroboration and code
/// checks, all stored. The claim row itself is updated by the caller.
pub fn build_pack(ctx: &ReducerContext, claim: &Claim) -> Pack {
    let input = gather(ctx, claim);
    let s = settings(ctx);
    let facts = build_facts(&input);
    let hash = hyphenate_core::pack::pack_sha256(&facts);
    let (corroboration, mut checks) = hyphenate_core::corroboration::corroborate(&input, &config(&s));
    checks.extend(record_checks(ctx, claim, &input));
    checks.extend(claimant_check(ctx, claim));
    let version = claim.pack_version + 1;
    for f in &facts {
        ctx.db.evidence_fact().insert(EvidenceFact {
            id: 0,
            claim_id: claim.id,
            pack_version: version,
            seq: f.seq,
            source: f.source.as_str().into(),
            key: f.key.clone(),
            value: f.value.clone(),
            observed_at: timestamp(f.observed_at),
            read_at: ctx.timestamp,
            reader: f.reader.as_str().into(),
            reference: f.reference.clone(),
        });
    }
    for c in &checks {
        store_check(ctx, claim.id, version, c);
    }
    ctx.db.evidence_pack().insert(EvidencePack {
        id: 0,
        claim_id: claim.id,
        version,
        fact_count: facts.len() as u32,
        hash: hash.clone(),
        built_at: ctx.timestamp,
        corroboration: corroboration.as_str().into(),
        checks: checks.iter().map(Check::line).collect::<Vec<_>>().join("\n"),
    });
    Pack { version, hash, facts, corroboration, checks, input }
}

pub fn store_check(ctx: &ReducerContext, claim_id: u64, pack_version: u32, c: &Check) {
    ctx.db.claim_check().insert(ClaimCheck {
        id: 0,
        claim_id,
        pack_version,
        name: c.name.clone(),
        result: c.result.as_str().into(),
        detail: c.detail.clone(),
        reader: c.reader.as_str().into(),
        created_at: ctx.timestamp,
    });
}

/// The stored facts of one pack version, as core facts, in seq order.
pub fn pack_facts(ctx: &ReducerContext, claim_id: u64, version: u32) -> Vec<Fact> {
    let mut facts: Vec<Fact> = ctx
        .db
        .evidence_fact()
        .claim_id()
        .filter(claim_id)
        .filter(|f| f.pack_version == version)
        .map(|f| Fact {
            seq: f.seq,
            source: source_of(&f.source),
            key: f.key,
            value: f.value,
            observed_at: micros(f.observed_at),
            reader: reader_of(&f.reader),
            reference: f.reference,
        })
        .collect();
    facts.sort_by_key(|f| f.seq);
    facts
}

/// The stored checks of one pack version, in insertion order.
pub fn pack_checks(ctx: &ReducerContext, claim_id: u64, version: u32) -> Vec<Check> {
    let mut rows: Vec<ClaimCheck> = ctx.db.claim_check().claim_id().filter(claim_id).filter(|c| c.pack_version == version).collect();
    rows.sort_by_key(|c| c.id);
    rows.into_iter()
        .map(|c| Check {
            name: c.name,
            result: match c.result.as_str() {
                "pass" => hyphenate_core::CheckResult::Pass,
                "fail" => hyphenate_core::CheckResult::Fail,
                _ => hyphenate_core::CheckResult::Info,
            },
            detail: c.detail,
            reader: reader_of(&c.reader),
        })
        .collect()
}

fn reader_of(s: &str) -> hyphenate_core::Reader {
    match s {
        "model" => hyphenate_core::Reader::Model,
        "elastic" => hyphenate_core::Reader::Elastic,
        _ => hyphenate_core::Reader::Code,
    }
}

fn source_of(s: &str) -> hyphenate_core::Source {
    use hyphenate_core::Source::*;
    [BandReport, IncidentSnapshot, LightCircle, StaffNote, ZoneContext, Presence, VisionAssessment, MedicalRecord, Policy]
        .into_iter()
        .find(|src| src.as_str() == s)
        .unwrap_or(IncidentSnapshot)
}
