use serde::{Deserialize, Serialize};

/// Microseconds since the Unix epoch, the unit SpacetimeDB timestamps use.
pub type Micros = i64;

/// US cents. Every amount in BandIt is an integer number of cents.
pub type Cents = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IncidentKind {
    Sos,
    Fall,
    Property,
}

impl IncidentKind {
    pub fn as_str(self) -> &'static str {
        match self {
            IncidentKind::Sos => "sos",
            IncidentKind::Fall => "fall",
            IncidentKind::Property => "property",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "sos" => Some(IncidentKind::Sos),
            "fall" => Some(IncidentKind::Fall),
            "property" => Some(IncidentKind::Property),
            _ => None,
        }
    }

    /// `sos` and `fall` are injuries paid from medical-payments cover.
    pub fn is_injury(self) -> bool {
        matches!(self, IncidentKind::Sos | IncidentKind::Fall)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverKind {
    MedicalPayments,
    Property,
}

impl CoverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CoverKind::MedicalPayments => "medical_payments",
            CoverKind::Property => "property",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "medical_payments" => Some(CoverKind::MedicalPayments),
            "property" => Some(CoverKind::Property),
            _ => None,
        }
    }

    /// The venue's general liability policy pays injuries from medical-payments
    /// cover and the venue's own equipment from property cover.
    pub fn for_incident(kind: IncidentKind) -> Self {
        if kind.is_injury() { CoverKind::MedicalPayments } else { CoverKind::Property }
    }
}

/// Where an evidence fact came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    BandReport,
    IncidentSnapshot,
    LightCircle,
    StaffNote,
    ZoneContext,
    Presence,
    VisionAssessment,
    MedicalRecord,
    Policy,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::BandReport => "band_report",
            Source::IncidentSnapshot => "incident_snapshot",
            Source::LightCircle => "light_circle",
            Source::StaffNote => "staff_note",
            Source::ZoneContext => "zone_context",
            Source::Presence => "presence",
            Source::VisionAssessment => "vision_assessment",
            Source::MedicalRecord => "medical_record",
            Source::Policy => "policy",
        }
    }
}

/// Who read a fact or made a check. Money and routing use only `Code` facts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reader {
    Code,
    Model,
    Elastic,
}

impl Reader {
    pub fn as_str(self) -> &'static str {
        match self {
            Reader::Code => "code",
            Reader::Model => "model",
            Reader::Elastic => "elastic",
        }
    }
}

/// One fact in an evidence pack.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fact {
    /// 1-based position in the pack. It is the id the agent cites and the
    /// order the pack hash uses.
    pub seq: u32,
    pub source: Source,
    pub key: String,
    pub value: String,
    /// The time the fact is about: the beacon, the note, the frame.
    pub observed_at: Micros,
    pub reader: Reader,
    /// How to fetch it again: `table:row_id` or `blob:<sha256>`.
    pub reference: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckResult {
    Pass,
    Fail,
    Info,
}

impl CheckResult {
    pub fn as_str(self) -> &'static str {
        match self {
            CheckResult::Pass => "pass",
            CheckResult::Fail => "fail",
            CheckResult::Info => "info",
        }
    }
}

/// One comparison made while verifying a claim, with both values in `detail`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Check {
    pub name: String,
    pub result: CheckResult,
    pub detail: String,
    pub reader: Reader,
}

impl Check {
    pub fn pass(name: &str, detail: impl Into<String>) -> Self {
        Self { name: name.to_string(), result: CheckResult::Pass, detail: detail.into(), reader: Reader::Code }
    }

    pub fn fail(name: &str, detail: impl Into<String>) -> Self {
        Self { name: name.to_string(), result: CheckResult::Fail, detail: detail.into(), reader: Reader::Code }
    }

    pub fn info(name: &str, detail: impl Into<String>) -> Self {
        Self { name: name.to_string(), result: CheckResult::Info, detail: detail.into(), reader: Reader::Code }
    }

    pub fn by(mut self, reader: Reader) -> Self {
        self.reader = reader;
        self
    }

    /// `name: result: detail`, the line shown to approvers and stored in the pack.
    pub fn line(&self) -> String {
        format!("{}: {}: {}", self.name, self.result.as_str(), self.detail)
    }
}

/// Whether two independent sources agree on time and zone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Corroboration {
    /// Both agree. Eligible for auto-settle.
    Corroborated,
    /// No second source. Routed to a person, never auto-settled.
    Uncorroborated,
    /// A second source disagrees. Refused, with every comparison listed.
    Disputed,
}

impl Corroboration {
    pub fn as_str(self) -> &'static str {
        match self {
            Corroboration::Corroborated => "corroborated",
            Corroboration::Uncorroborated => "uncorroborated",
            Corroboration::Disputed => "disputed",
        }
    }
}

/// The claims agent's overall judgment of a claim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// The story hangs together; nothing for a person to look at.
    Consistent,
    /// Something needs a person's eyes before money moves.
    NeedsHuman,
    /// The evidence contradicts the claim.
    Inconsistent,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Consistent => "consistent",
            Verdict::NeedsHuman => "needs_human",
            Verdict::Inconsistent => "inconsistent",
        }
    }
}

/// Whether the treated injury plausibly follows from the incident.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Causation {
    Supported,
    Unsupported,
    Unclear,
}

impl Causation {
    pub fn as_str(self) -> &'static str {
        match self {
            Causation::Supported => "supported",
            Causation::Unsupported => "unsupported",
            Causation::Unclear => "unclear",
        }
    }
}
