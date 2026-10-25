//! Reading claims back: the list, the full record of one claim, a short
//! summary, the letters, the pack hash check and waiting on a status.

use crate::app::*;
use anyhow::{Result, bail};
use bandit_bindings::*;
use spacetimedb_sdk::Table;
use std::collections::BTreeMap;

pub fn claims(app: &App) -> Result<()> {
    let db = app.db()?;
    let mut all: Vec<Claim> = db.db.claim().iter().collect();
    all.sort_by_key(|c| c.id);
    if all.is_empty() {
        println!("no claims yet");
        return Ok(());
    }
    println!("{:>3}  {:<16} {:<9} {:<13} {:<15} {:>10}  {:<14} note", "id", "claimant", "kind", "zone", "status", "payout", "routed to");
    for c in all {
        println!(
            "{:>3}  {:<16} {:<9} {:<13} {:<15} {:>10}  {:<14} {}",
            c.id,
            clip(if c.claimant_name.is_empty() { "the venue" } else { &c.claimant_name }, 16),
            c.incident_kind,
            clip(&c.zone_name, 13),
            status_name(c.status),
            money(c.payout_cents),
            clip(if c.routed_to_name.is_empty() { "-" } else { &c.routed_to_name }, 14),
            clip(&c.status_note, 110)
        );
    }
    Ok(())
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { s.chars().take(n - 1).collect::<String>() + "." }
}

fn when(app: &App, t: Option<spacetimedb_sdk::Timestamp>) -> String {
    t.map(|t| app.hms(t)).unwrap_or_else(|| "-".into())
}

/// Everything about one claim.
pub fn show(app: &App, id: u64) -> Result<()> {
    let db = app.db()?;
    let c = app.claim(id)?;
    let v = c.pack_version;
    header(&c);
    println!(
        "  times    opened {}  decided {}  settled {}  reconciled {}",
        app.hms(c.opened_at),
        when(app, c.decided_at),
        when(app, c.settled_at),
        when(app, c.reconciled_at)
    );

    let pack = db.db.evidence_pack().iter().find(|p| p.claim_id == id && p.version == v);
    println!("\npack v{v}  {}  {}", c.pack_hash, c.corroboration);
    if let Some(p) = &pack {
        println!("  {} facts, built {}", p.fact_count, app.hms(p.built_at));
    }
    println!("facts");
    let mut facts: Vec<EvidenceFact> = db.db.evidence_fact().iter().filter(|f| f.claim_id == id && f.pack_version == v).collect();
    facts.sort_by_key(|f| f.seq);
    for f in &facts {
        println!("  [{}] {} {} = {} ({})", f.seq, f.source, f.key, f.value, f.reader);
    }

    println!("checks (v{v})");
    let mut checks: Vec<ClaimCheck> = db.db.claim_check().iter().filter(|k| k.claim_id == id && k.pack_version == v).collect();
    checks.sort_by_key(|k| k.id);
    for reader in ["code", "elastic", "model"] {
        let mine: Vec<&ClaimCheck> = checks.iter().filter(|k| k.reader == reader).collect();
        println!("  {reader}{}", if mine.is_empty() { ": none" } else { "" });
        for k in mine {
            println!("    {:<4} {}: {}", k.result, k.name, k.detail);
        }
    }

    let records: Vec<MedicalRecord> = db.db.medical_record().iter().filter(|r| r.claim_id == id).collect();
    for r in &records {
        println!("\nmedical record {}  {} pages  {}  sha {}", r.id, r.page_count, r.status, r.file_hash);
        if r.status == "extracted" {
            println!("  {} at {}, {}, {} ({})", r.patient_name, r.provider_name, r.date_of_service, r.invoice_number, r.document_kind);
            println!("  reason   {}", r.reason_for_visit);
            println!("  history  {}", r.history);
            println!("  diagnoses {}", r.diagnoses.join("; "));
        }
        for d in &r.dropped {
            println!("  dropped  {d}");
        }
    }
    let mut lines: Vec<ClaimLine> = db.db.claim_line().iter().filter(|l| l.claim_id == id).collect();
    lines.sort_by_key(|l| l.line_no);
    if !lines.is_empty() {
        println!("lines");
        for l in &lines {
            println!(
                "  {} {:<6} {:<40} billed {:>9}  covered {:>9}  {}: {}",
                l.line_no,
                l.code,
                clip(&l.description, 40),
                money(l.billed_cents),
                money(l.covered_cents),
                l.outcome,
                l.reason
            );
        }
        let billed: u64 = lines.iter().map(|l| l.billed_cents).sum();
        let covered: u64 = lines.iter().map(|l| l.covered_cents).sum();
        println!("  billed {}  covered {}", money(billed), money(covered));
    }

    let mut history: Vec<Decision> = db.db.decision().iter().filter(|d| d.claim_id == id).collect();
    history.sort_by_key(|d| d.id);
    if !history.is_empty() {
        println!("\nhow it was decided");
        for d in &history {
            println!("  {:<16} {}", d.actor, d.what);
            if !d.why.is_empty() {
                println!("  {:<16}   {}", "", d.why);
            }
        }
    }

    for r in db.db.claim_review().iter().filter(|r| r.claim_id == id && r.pack_version == v) {
        println!("\nClaude's decision (v{v})  {}  causation {}", r.verdict, if r.causation.is_empty() { "-" } else { &r.causation });
        if !r.summary.is_empty() {
            println!("  summary  {}", r.summary);
        }
        for x in &r.concerns {
            println!("  concern  {x}");
        }
        for x in &r.innocent_explanations {
            println!("  innocent {x}");
        }
        for x in &r.missing_evidence {
            println!("  missing  {x}");
        }
        if !r.cited_fact_ids.is_empty() {
            println!("  cites    {}", r.cited_fact_ids.iter().map(|n| format!("[{n}]")).collect::<Vec<_>>().join(" "));
        }
        for x in &r.rejected {
            println!("  rejected by code: {x}");
        }
    }

    let mut precedents: Vec<ClaimPrecedent> = db.db.claim_precedent().iter().filter(|p| p.claim_id == id && p.pack_version == v).collect();
    precedents.sort_by(|a, b| b.score.total_cmp(&a.score));
    if !precedents.is_empty() {
        println!("\nprecedents from Elastic (v{v})");
        for p in precedents {
            println!("  {:.2}  {}  {}  {}  {}", p.score, p.reference, p.outcome, money(p.payout_cents), p.narrative);
        }
    }

    println!(
        "\nroute    {}",
        if c.routed_to_name.is_empty() { "-".to_string() } else { format!("{} ({})", c.routed_to_name, c.routed_to_role) }
    );
    let mut approvals: Vec<Approval> = db.db.approval().iter().filter(|a| a.claim_id == id).collect();
    approvals.sort_by_key(|a| a.id);
    for a in &approvals {
        println!(
            "approval {}  {} ({}) {}  saw {} on {}{}",
            app.hms(a.decided_at),
            a.approver_name,
            a.approver_role,
            a.decision,
            money(a.amount_seen_cents),
            short_hash(&a.pack_hash_seen),
            if a.reason.is_empty() { String::new() } else { format!(", reason: {}", a.reason) }
        );
    }
    for p in db.db.rule_proposal().iter().filter(|p| p.claim_ids.contains(&id)) {
        println!("proposal {}  {}  from claims {:?}  {}", p.id, p.status, p.claim_ids, p.rule);
    }
    if matches!(c.decided_by.as_str(), "rule" | "claude")
        && c.settlement_rule_id != 0
        && let Some(r) = db.db.settlement_rule().id().find(&c.settlement_rule_id)
    {
        println!("settled under {}", rule_line(app, &r));
    }

    ledger(app, id, true)?;

    println!("\nletters");
    let blobs = app.blobs();
    for (name, hash) in letter_hashes(&c) {
        if hash.is_empty() {
            println!("  {name:<13} -");
        } else {
            let path = blobs.path(hash).map(|p| p.display().to_string()).unwrap_or_default();
            println!("  {name:<13} {}  {path}", short_hash(hash));
        }
    }
    let account = c.claimant.and_then(|who| db.db.claimant_account().identity().find(&who));
    println!(
        "\npayout   {}{}",
        if c.payout_reference.is_empty() { "-" } else { &c.payout_reference },
        account.map(|a| format!(" (Nessie customer {}, account {})", a.customer_id, a.account_id)).unwrap_or_default()
    );
    Ok(())
}

fn header(c: &Claim) {
    println!(
        "claim {}  {}  {} / {}  {}  band {}  incident {}",
        c.id,
        if c.claimant_name.is_empty() { "the venue" } else { &c.claimant_name },
        c.incident_kind,
        c.cover_kind,
        c.zone_name,
        c.band_id,
        c.incident_id
    );
    println!("  status   {}: {}", status_name(c.status), c.status_note);
    println!(
        "  amounts  cost {}  payout {}  recoverable {}  venue cost {}",
        money(c.cost_cents),
        money(c.payout_cents),
        money(c.recoverable_cents),
        money(c.venue_cost_cents)
    );
}

fn rule_line(app: &App, r: &SettlementRuleRow) -> String {
    let zone = if r.zone_id == 0 { "any zone".to_string() } else { app.zone_name(r.zone_id) };
    format!(
        "rule v{} ({}): {} / {} in {zone} up to {}, approved by {} ({}), {}",
        r.version,
        r.id,
        r.incident_kind,
        r.cover_kind,
        money(r.ceiling_cents),
        r.approver_name,
        r.approver_role,
        r.status
    )
}

fn letter_hashes(c: &Claim) -> [(&'static str, &str); 4] {
    [("fnol", &c.fnol_hash), ("summary", &c.summary_hash), ("determination", &c.determination_hash), ("recovery", &c.recovery_hash)]
}

/// Journals with debits, credits and each account's running balance.
fn ledger(app: &App, id: u64, verbose: bool) -> Result<()> {
    let db = app.db()?;
    let mut rows: Vec<LedgerEntry> = db.db.ledger_entry().iter().filter(|e| e.claim_id == id).collect();
    rows.sort_by_key(|e| e.id);
    println!("\nledger{}", if rows.is_empty() { " (nothing posted)" } else { "" });
    let mut balance: BTreeMap<String, i128> = BTreeMap::new();
    let mut journal = 0;
    for e in &rows {
        if e.journal_id != journal {
            journal = e.journal_id;
            if verbose {
                println!("  {} (journal {}, {}, {})", e.journal, e.journal_id, app.hms(e.posted_at), e.posted_by);
            }
        }
        let b = balance.entry(e.account.clone()).or_default();
        *b += e.debit_cents as i128 - e.credit_cents as i128;
        if verbose {
            let side = |label: &str, c: u64| if c == 0 { String::new() } else { format!("{label} {}", money(c)) };
            println!("    {:<19} {:>13} {:>13}   balance {}", e.account, side("Dr", e.debit_cents), side("Cr", e.credit_cents), signed(*b));
        }
    }
    if !rows.is_empty() {
        let end: Vec<String> = balance.iter().map(|(a, b)| format!("{a} {}", signed(*b))).collect();
        println!("  balances {}", end.join(", "));
    }
    Ok(())
}

fn signed(b: i128) -> String {
    match b {
        0 => "$0.00".into(),
        b if b > 0 => format!("Dr {}", money(b as u64)),
        b => format!("Cr {}", money((-b) as u64)),
    }
}

/// A few lines per claim, for the story's end states.
pub fn summary(app: &App, id: u64) -> Result<()> {
    let db = app.db()?;
    let c = app.claim(id)?;
    let v = c.pack_version;
    println!("  ---");
    header(&c);
    let checks: Vec<ClaimCheck> = db.db.claim_check().iter().filter(|k| k.claim_id == id && k.pack_version == v).collect();
    let n = |r: &str| checks.iter().filter(|k| k.result == r).count();
    println!(
        "  pack     v{v} {} {}, checks {} pass, {} fail, {} info",
        short_hash(&c.pack_hash),
        c.corroboration,
        n("pass"),
        n("fail"),
        n("info")
    );
    for k in checks.iter().filter(|k| k.result != "info") {
        println!("    {:<4} {} ({}): {}", k.result, k.name, k.reader, k.detail);
    }
    if let Some(r) = db.db.medical_record().iter().filter(|r| r.claim_id == id && r.status == "extracted").max_by_key(|r| r.id) {
        let lines: Vec<ClaimLine> = db.db.claim_line().iter().filter(|l| l.claim_id == id && l.record_id == r.id).collect();
        let count = |o: &str| lines.iter().filter(|l| l.outcome == o).count();
        println!(
            "  record   {} {}, {}: billed {}, covered {} ({} covered, {} reduced, {} excluded)",
            r.provider_name,
            r.invoice_number,
            r.date_of_service,
            money(r.billed_cents),
            money(r.covered_cents),
            count("covered"),
            count("reduced"),
            count("excluded")
        );
        for l in lines.iter().filter(|l| l.outcome != "covered") {
            println!("    line {} {} {} -> {}: {}", l.line_no, l.code, money(l.billed_cents), money(l.covered_cents), l.reason);
        }
    }
    if let Some(r) = db.db.claim_review().iter().filter(|r| r.claim_id == id && r.pack_version == v).max_by_key(|r| r.id) {
        println!("  Claude   {} (causation {}): {}", r.verdict, r.causation, r.summary);
        for x in &r.concerns {
            println!("    concern {x}");
        }
    }
    let approvals: Vec<Approval> = db.db.approval().iter().filter(|a| a.claim_id == id).collect();
    for a in &approvals {
        println!(
            "  {}  {} ({}) saw {} on {}",
            a.decision,
            a.approver_name,
            a.approver_role,
            money(a.amount_seen_cents),
            short_hash(&a.pack_hash_seen)
        );
    }
    for p in db.db.rule_proposal().iter().filter(|p| p.claim_ids.contains(&id)) {
        println!("  proposal {} {} from claims {:?}: {}", p.id, p.status, p.claim_ids, p.rule);
    }
    if matches!(c.decided_by.as_str(), "rule" | "claude")
        && c.settlement_rule_id != 0
        && let Some(r) = db.db.settlement_rule().id().find(&c.settlement_rule_id)
    {
        println!("  under    {}", rule_line(app, &r));
    }
    if !c.payout_reference.is_empty() {
        println!("  paid     {} via {}", money(c.payout_cents), c.payout_reference);
    }
    ledger(app, id, false)?;
    Ok(())
}

/// Prints the letters the worker drafted, from the blob store.
pub fn letters(app: &App, id: u64) -> Result<()> {
    let c = app.claim(id)?;
    let blobs = app.blobs();
    let mut any = false;
    for (name, hash) in letter_hashes(&c) {
        if hash.is_empty() {
            continue;
        }
        any = true;
        let path = blobs.path(hash)?;
        println!("==== {name}  sha {}  {}", short_hash(hash), path.display());
        match blobs.get(hash) {
            Ok(bytes) if bytes.starts_with(b"%PDF") => println!("(a PDF; open the file above)"),
            Ok(bytes) => println!("{}", String::from_utf8_lossy(&bytes).trim_end()),
            Err(e) => println!("(not in this blob store: {e})"),
        }
        println!();
    }
    if !any {
        println!("claim {id} has no letters yet (the worker drafts them after settlement)");
    }
    Ok(())
}

pub fn letters_ready(c: &Claim) -> bool {
    !c.fnol_hash.is_empty() && !c.summary_hash.is_empty() && !c.determination_hash.is_empty()
}

/// Recomputes each pack version's hash from its `evidence_fact` rows.
pub fn verify_pack(app: &App, id: u64, print_lines: bool) -> Result<bool> {
    let db = app.db()?;
    let c = app.claim(id)?;
    let mut packs: Vec<EvidencePack> = db.db.evidence_pack().iter().filter(|p| p.claim_id == id).collect();
    packs.sort_by_key(|p| p.version);
    let mut ok = true;
    for p in &packs {
        let facts = core_facts(app, id, p.version)?;
        let hash = bandit_insurance::pack::pack_sha256(&facts);
        let same = hash == p.hash && (p.version != c.pack_version || hash == c.pack_hash);
        ok &= same;
        println!(
            "v{}  {} facts  recomputed {}  stored {}  {}{}",
            p.version,
            facts.len(),
            short_hash(&hash),
            short_hash(&p.hash),
            if same { "match" } else { "MISMATCH" },
            if p.version == c.pack_version { "  (current)" } else { "" }
        );
        if print_lines && p.version == c.pack_version {
            for f in &facts {
                println!("    {}", bandit_insurance::pack::canonical_line(f));
            }
        }
    }
    if packs.is_empty() {
        bail!("claim {id} has no evidence pack");
    }
    println!(
        "{}",
        if ok {
            format!("claim {id}: every pack hash recomputes from its facts ({})", c.pack_hash)
        } else {
            format!("claim {id}: a pack hash does not match its facts")
        }
    );
    Ok(ok)
}

fn core_facts(app: &App, id: u64, version: u32) -> Result<Vec<bandit_insurance::Fact>> {
    use bandit_insurance::{Reader, Source};
    let db = app.db()?;
    let sources = [
        Source::BandReport,
        Source::IncidentSnapshot,
        Source::LightCircle,
        Source::StaffNote,
        Source::ZoneContext,
        Source::Presence,
        Source::VisionAssessment,
        Source::MedicalRecord,
        Source::Policy,
    ];
    let mut out = Vec::new();
    for f in db.db.evidence_fact().iter().filter(|f| f.claim_id == id && f.pack_version == version) {
        let Some(source) = sources.iter().copied().find(|s| s.as_str() == f.source) else {
            bail!("fact {} has unknown source {}", f.id, f.source)
        };
        let reader = match f.reader.as_str() {
            "code" => Reader::Code,
            "model" => Reader::Model,
            "elastic" => Reader::Elastic,
            other => bail!("fact {} has unknown reader {other}", f.id),
        };
        out.push(bandit_insurance::Fact {
            seq: f.seq,
            source,
            key: f.key,
            value: f.value,
            observed_at: micros(f.observed_at),
            reader,
            reference: f.reference,
        });
    }
    out.sort_by_key(|f| f.seq);
    Ok(out)
}

/// Blocks until `done(claim)` or `secs` pass, printing each status change.
pub fn wait_for(app: &App, id: u64, secs: u64, done: impl Fn(&Claim) -> bool) -> Result<Claim> {
    let start = std::time::Instant::now();
    let mut last: Option<(ClaimStatus, String)> = None;
    let mut hinted = false;
    loop {
        let c = app.claim(id)?;
        if last.as_ref() != Some(&(c.status, c.status_note.clone())) {
            say!(app, "  {}  claim {id}  {:<15} {}", app.hms(c.updated_at), status_name(c.status), c.status_note);
            last = Some((c.status, c.status_note.clone()));
        }
        if done(&c) {
            return Ok(c);
        }
        let waited = start.elapsed().as_secs();
        if waited >= secs {
            bail!("claim {id} is still {} after {secs} s", status_name(c.status));
        }
        if !hinted && waited >= 40 && in_pipeline(c.status) && !app.worker_active() {
            say!(app, "  ({})", app.worker_hint());
            hinted = true;
        }
        sleep_ms(250);
    }
}

/// `wait N --status S`: stops at S, at any later status, or at refused.
pub fn wait(app: &App, id: u64, target: ClaimStatus, secs: u64) -> Result<Claim> {
    let rank = |s: ClaimStatus| match s {
        ClaimStatus::AwaitingRecord => 0,
        ClaimStatus::ReadingRecord => 1,
        ClaimStatus::Verifying => 2,
        ClaimStatus::Reviewing => 3,
        ClaimStatus::Routed => 4,
        ClaimStatus::Paying => 5,
        ClaimStatus::Settled => 6,
        ClaimStatus::Reconciled => 7,
        ClaimStatus::Refused => 8,
    };
    let c = wait_for(app, id, secs, |c| {
        c.status == target || c.status == ClaimStatus::Refused || (target != ClaimStatus::Refused && rank(c.status) > rank(target))
    })?;
    if c.status != target {
        println!("claim {id} is {} (waited for {})", status_name(c.status), status_name(target));
    }
    Ok(c)
}
