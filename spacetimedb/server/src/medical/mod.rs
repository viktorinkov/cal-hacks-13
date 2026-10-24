//! Medical-ID: at sign-up the attendee uploads a medical history PDF and their health insurance card.
//! `medical_extract` has Claude read each into the attendee's `medical_card`, which the attendee
//! confirms. A medic sees a card only by tapping the band of someone with an open SOS or fall
//! incident, and every tap is written to `medical_access_log`.

use crate::jobs::{self, *};
use crate::roles::*;
use crate::safety::*;
use crate::tables::*;
use crate::social::tables::*;
use serde::{Deserialize, Serialize};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext};

pub const KIND: &str = "medical_extract";
/// The two documents an attendee uploads.
pub const HISTORY: &str = "history";
pub const INSURANCE: &str = "insurance";

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = medical_document)]
pub struct MedicalDocument {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub attendee: Identity,
    /// `history` or `insurance`.
    pub kind: String,
    pub file_hash: String,
    pub page_count: u32,
    /// `reading`, `read` or `failed`.
    pub status: String,
    pub job_id: u64,
    pub model_call_id: u64,
    /// Items Claude returned without a page on the document, so code dropped them.
    pub dropped: Vec<String>,
    pub uploaded_at: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = medical_card)]
pub struct MedicalCard {
    #[primary_key]
    pub attendee: Identity,
    pub blood_type: String,
    /// One line per item, each ending with the page it came from, such as "Penicillin: hives (p. 1)".
    pub allergies: Vec<String>,
    pub conditions: Vec<String>,
    pub medications: Vec<String>,
    pub emergency_contact: String,
    pub insurer: String,
    pub plan: String,
    pub member_id: String,
    pub group_number: String,
    pub insurer_phone: String,
    pub notes: String,
    /// `extracted` until the attendee confirms it, then `confirmed`.
    pub status: String,
    pub updated_at: Timestamp,
}

#[derive(Clone, Debug)]
#[spacetimedb::table(accessor = medical_access_log)]
pub struct MedicalAccessLog {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub reader: Identity,
    pub attendee: Identity,
    pub band_id: u8,
    pub incident_id: u64,
    pub granted: bool,
    pub reason: String,
    pub read_at: Timestamp,
}

#[derive(Serialize, Deserialize)]
struct ExtractPayload {
    document_id: u64,
    kind: String,
    file_hash: String,
    page_count: u32,
}

/// What `bandit-workers` sends back, already checked against the page count.
#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ExtractedCard {
    pub blood_type: String,
    pub allergies: Vec<String>,
    pub conditions: Vec<String>,
    pub medications: Vec<String>,
    pub emergency_contact: String,
    pub insurer: String,
    pub plan: String,
    pub member_id: String,
    pub group_number: String,
    pub insurer_phone: String,
    pub notes: String,
    pub dropped: Vec<String>,
}

fn empty_card(who: Identity, now: Timestamp) -> MedicalCard {
    MedicalCard {
        attendee: who,
        blood_type: String::new(),
        allergies: Vec::new(),
        conditions: Vec::new(),
        medications: Vec::new(),
        emergency_contact: String::new(),
        insurer: String::new(),
        plan: String::new(),
        member_id: String::new(),
        group_number: String::new(),
        insurer_phone: String::new(),
        notes: String::new(),
        status: "extracted".into(),
        updated_at: now,
    }
}

/// Files a PDF the caller uploaded through bandit-api and queues Claude to read it.
#[spacetimedb::reducer]
pub fn submit_medical_document(ctx: &ReducerContext, kind: String, file_hash: String, page_count: u32) -> Result<(), String> {
    let me = ctx.sender();
    if kind != HISTORY && kind != INSURANCE {
        return Err("kind is history or insurance".into());
    }
    if ctx.db.band_owner().owner().find(me).is_none() {
        return Err("claim your band first".into());
    }
    let blob = ctx.db.blob_ref().hash().find(file_hash.to_lowercase()).ok_or("upload the PDF first")?;
    // Files are stored by content, so two people may file the same PDF; it only has to have come in
    // as an attendee's own medical document.
    if blob.purpose != HISTORY && blob.purpose != INSURANCE {
        return Err("upload the PDF as your own medical document".into());
    }
    let doc = ctx.db.medical_document().insert(MedicalDocument {
        id: 0,
        attendee: me,
        kind: kind.clone(),
        file_hash: blob.hash.clone(),
        page_count: page_count.max(1),
        status: "reading".into(),
        job_id: 0,
        model_call_id: 0,
        dropped: Vec::new(),
        uploaded_at: ctx.timestamp,
    });
    let payload = serde_json::to_string(&ExtractPayload { document_id: doc.id, kind, file_hash: blob.hash, page_count: doc.page_count })
        .map_err(|e| e.to_string())?;
    let job_id = jobs::enqueue(ctx, KIND, payload, "medical_document", doc.id);
    ctx.db.medical_document().id().update(MedicalDocument { job_id, ..doc });
    Ok(())
}

/// The worker's result: Claude's reading, checked in code, merged into the attendee's card.
#[spacetimedb::reducer]
pub fn apply_medical_extract(ctx: &ReducerContext, job_id: u64, card_json: String, call: ModelCallIn) -> Result<(), String> {
    require_role(ctx, &["worker"])?;
    let job = jobs::leased_by_caller(ctx, job_id)?;
    let p: ExtractPayload = serde_json::from_str(&job.payload).map_err(|e| e.to_string())?;
    let call_id = jobs::record_call(ctx, job_id, &call);
    let doc = ctx.db.medical_document().id().find(p.document_id).ok_or("no such document")?;
    let read: ExtractedCard = match serde_json::from_str(&card_json) {
        Ok(c) => c,
        Err(e) => {
            ctx.db.medical_document().id().update(MedicalDocument { status: "failed".into(), model_call_id: call_id, ..doc });
            jobs::finish(ctx, job, format!("unreadable card: {e}"));
            return Ok(());
        }
    };
    let old = ctx.db.medical_card().attendee().find(doc.attendee);
    let base = old.clone().unwrap_or_else(|| empty_card(doc.attendee, ctx.timestamp));
    let card = if doc.kind == HISTORY {
        MedicalCard {
            blood_type: if read.blood_type.is_empty() { "unknown".into() } else { read.blood_type },
            allergies: read.allergies,
            conditions: read.conditions,
            medications: read.medications,
            emergency_contact: read.emergency_contact,
            notes: read.notes,
            ..base
        }
    } else {
        MedicalCard {
            insurer: read.insurer,
            plan: read.plan,
            member_id: read.member_id,
            group_number: read.group_number,
            insurer_phone: read.insurer_phone,
            ..base
        }
    };
    // A new reading needs the wearer's look again.
    let card = MedicalCard { status: "extracted".into(), updated_at: ctx.timestamp, ..card };
    if old.is_some() {
        ctx.db.medical_card().attendee().update(card);
    } else {
        ctx.db.medical_card().insert(card);
    }
    ctx.db.medical_document().id().update(MedicalDocument { status: "read".into(), model_call_id: call_id, dropped: read.dropped, ..doc });
    jobs::finish(ctx, job, "card updated");
    Ok(())
}

/// The wearer checked what Claude read.
#[spacetimedb::reducer]
pub fn confirm_medical_card(ctx: &ReducerContext) -> Result<(), String> {
    let card = ctx.db.medical_card().attendee().find(ctx.sender()).ok_or("no medical card yet")?;
    ctx.db.medical_card().attendee().update(MedicalCard { status: "confirmed".into(), updated_at: ctx.timestamp, ..card });
    Ok(())
}

/// A medic taps a band. The card shows only while that band has an open SOS or fall incident.
#[spacetimedb::reducer]
pub fn request_medical_card(ctx: &ReducerContext, band_id: u8) -> Result<(), String> {
    require_role(ctx, &["medic"])?;
    let owner = ctx.db.band_owner().band_id().find(band_id).ok_or("nobody wears that band")?;
    let open = ctx
        .db
        .incident()
        .subject_band()
        .filter(band_id)
        .find(|i| !i.resolved && matches!(i.kind, IncidentKind::Sos | IncidentKind::Fall));
    let (granted, reason, incident_id) = match &open {
        Some(i) => (true, format!("open {:?} incident {}", i.kind, i.id).to_lowercase(), i.id),
        None => (false, "no open SOS or fall incident for this band".to_string(), 0),
    };
    ctx.db.medical_access_log().insert(MedicalAccessLog {
        id: 0,
        reader: ctx.sender(),
        attendee: owner.owner,
        band_id,
        incident_id,
        granted,
        reason: reason.clone(),
        read_at: ctx.timestamp,
    });
    if granted { Ok(()) } else { Err(reason) }
}

#[spacetimedb::view(accessor = my_medical_card, public)]
pub fn my_medical_card(ctx: &ViewContext) -> Option<MedicalCard> {
    ctx.db.medical_card().attendee().find(ctx.sender())
}

#[spacetimedb::view(accessor = my_medical_documents, public)]
pub fn my_medical_documents(ctx: &ViewContext) -> Vec<MedicalDocument> {
    ctx.db.medical_document().attendee().filter(ctx.sender()).collect()
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct MedicCard {
    pub incident_id: u64,
    pub band_id: u8,
    pub name: String,
    pub card: MedicalCard,
}

/// The cards this medic tapped for, while the incident is still open.
#[spacetimedb::view(accessor = medic_medical_cards, public)]
pub fn medic_medical_cards(ctx: &ViewContext) -> Vec<MedicCard> {
    let mut out: Vec<MedicCard> = Vec::new();
    for log in ctx.db.medical_access_log().reader().filter(ctx.sender()).filter(|l| l.granted) {
        let open = ctx.db.incident().id().find(log.incident_id).is_some_and(|i| !i.resolved);
        if !open || out.iter().any(|c| c.incident_id == log.incident_id) {
            continue;
        }
        if let Some(card) = ctx.db.medical_card().attendee().find(log.attendee) {
            let name = ctx.db.attendee().identity().find(log.attendee).map(|a| a.display_name).unwrap_or_default();
            out.push(MedicCard { incident_id: log.incident_id, band_id: log.band_id, name, card });
        }
    }
    out
}

/// Every tap, granted or not, for the host portal.
#[spacetimedb::view(accessor = board_medical_access, public)]
pub fn board_medical_access(ctx: &ViewContext) -> Vec<MedicalAccessLog> {
    let staff = ctx.db.owner().identity().find(ctx.sender()).is_some()
        || ctx.db.staff_role().identity().filter(ctx.sender()).any(|r| ["ops", "medic"].contains(&r.role.as_str()));
    if staff { ctx.db.medical_access_log().reader().filter(Identity::ZERO..).collect() } else { Vec::new() }
}
