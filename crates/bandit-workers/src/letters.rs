//! `claim_draft` and `recovery_letter`: Claude drafts, code checks every
//! figure, fact id and heading, and a template stands in for any letter that
//! still fails after one retry.

use bandit_bindings::ModelCallIn;
use claude_client::{Effort, MessageRequest};
use hyphenate_core::Cents;
use hyphenate_core::letters::*;
use hyphenate_core::payloads::{DraftPayload, RecoveryPayload};
use hyphenate_core::schemas::{ClaimLetters, RecoveryLetter, claim_letters_schema, recovery_letter_schema};
use serde_json::Value;

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, ask_twice};
use crate::prompts;
use crate::sink::Finish;

/// The three claim letters and where each came from.
#[derive(Debug)]
pub struct Letters {
    pub fnol: String,
    pub summary: String,
    pub determination: String,
    /// fnol, summary, determination: true when the model's text was kept.
    pub from_model: [bool; 3],
    pub calls: Vec<ModelCallIn>,
}

impl Letters {
    fn templates(d: &LetterData, calls: Vec<ModelCallIn>) -> Self {
        Self { fnol: fnol_template(d), summary: summary_template(d), determination: determination_template(d), from_model: [false; 3], calls }
    }
}

pub async fn run_draft(ctx: &Ctx, job: &JobIn, p: DraftPayload) -> Result<(), JobError> {
    let letters = match draft_letters(&ctx.claude, &p.letter).await {
        Ok(l) => l,
        Err(e) if job.last_attempt() => {
            tracing::warn!(job_id = job.id, error = %e.error, "Claude unavailable on the last attempt, using the templates");
            Letters::templates(&p.letter, e.calls)
        }
        Err(e) => return Err(e),
    };
    tracing::info!(
        job_id = job.id,
        from_model = ?letters.from_model,
        fnol = first_line(&letters.fnol),
        summary = first_line(&letters.summary),
        determination = first_line(&letters.determination),
        "letters drafted"
    );
    let fnol_hash = store(ctx, &letters.fnol).await?;
    let summary_hash = store(ctx, &letters.summary).await?;
    let determination_hash = store(ctx, &letters.determination).await?;
    ctx.sink.finish(job.id, Finish::ClaimLetters { fnol_hash, summary_hash, determination_hash }, letters.calls).await?;
    let outcome = async {
        let es = ctx.elastic().await.map_err(|e| anyhow::anyhow!(e.error))?;
        es.set_outcome(p.claim_id as i64, p.pack_version as i32, &p.outcome, p.letter.amounts.payout_cents).await
    };
    if let Err(e) = outcome.await {
        tracing::warn!(job_id = job.id, claim_id = p.claim_id, error = %format!("{e:#}"), "could not record the outcome in Elastic");
    }
    Ok(())
}

pub async fn run_recovery(ctx: &Ctx, job: &JobIn, p: RecoveryPayload) -> Result<(), JobError> {
    let (text, from_model, calls) = match recovery_letter(&ctx.claude, &p.letter).await {
        Ok(r) => r,
        Err(e) if job.last_attempt() => {
            tracing::warn!(job_id = job.id, error = %e.error, "Claude unavailable on the last attempt, using the template");
            (recovery_template(&p.letter), false, e.calls)
        }
        Err(e) => return Err(e),
    };
    tracing::info!(job_id = job.id, from_model, first_line = first_line(&text), "recovery letter drafted");
    let hash = store(ctx, &text).await?;
    ctx.sink.finish(job.id, Finish::RecoveryLetter { hash }, calls).await?;
    Ok(())
}

/// Stores a letter as a UTF-8 text blob and registers it with the module.
async fn store(ctx: &Ctx, text: &str) -> Result<String, JobError> {
    let blob = ctx.blobs.put(text.as_bytes()).map_err(|e| JobError::msg(format!("storing a letter: {e}")))?;
    ctx.sink.register_letter(&blob).await?;
    Ok(blob.sha256)
}

fn first_line(s: &str) -> &str {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or("")
}

/// Fact seqs of the pack: the numbers in `[seq] key = value`.
pub fn fact_seqs(d: &LetterData) -> Vec<u32> {
    d.fact_lines.iter().filter_map(|l| l.strip_prefix('[')?.split_once(']')?.0.parse().ok()).collect()
}

/// Section headings of the FNOL skeleton: its all-capital lines.
pub fn headings(skeleton: &str) -> Vec<&str> {
    skeleton
        .lines()
        .map(str::trim)
        .filter(|l| l.chars().any(|c| c.is_ascii_uppercase()) && l.chars().all(|c| c.is_ascii_uppercase() || c == ' ' || c == '/'))
        .collect()
}

fn figure_problems(name: &str, text: &str, allowed: &[Cents]) -> Vec<String> {
    let mut out = Vec::new();
    if text.trim().is_empty() {
        out.push(format!("{name} is empty"));
    }
    out.extend(unknown_figures(text, allowed).into_iter().map(|f| format!("{name}: {f} is not one of the claim's amounts")));
    out
}

fn cited_problems(ids: &[u32], d: &LetterData) -> Vec<String> {
    let seqs = fact_seqs(d);
    let mut unknown: Vec<u32> = ids.iter().copied().filter(|id| !seqs.contains(id)).collect();
    unknown.dedup();
    unknown.into_iter().map(|id| format!("cited fact {id} is not in the pack")).collect()
}

/// Problems per letter (fnol, summary, determination), then problems with the cited ids.
fn letter_problems(l: &ClaimLetters, d: &LetterData, skeleton: &str) -> ([Vec<String>; 3], Vec<String>) {
    let allowed = d.amounts.figures();
    let mut fnol = figure_problems("fnol", &l.fnol, &allowed);
    let kept: Vec<&str> = l.fnol.lines().map(str::trim).collect();
    fnol.extend(headings(skeleton).into_iter().filter(|h| !kept.contains(h)).map(|h| format!("fnol: heading \"{h}\" is missing")));
    let summary = figure_problems("summary", &l.summary, &allowed);
    let determination = figure_problems("determination", &l.determination, &allowed);
    ([fnol, summary, determination], cited_problems(&l.cited_fact_ids, d))
}

fn parse<T: serde::de::DeserializeOwned>(v: &Value, what: &str) -> Result<T, Vec<String>> {
    serde_json::from_value(v.clone()).map_err(|e| vec![format!("not {what}: {e}")])
}

/// Drafts the three claim letters: one retry with the problems, then a
/// template for each letter that still fails (all three when a cited fact id
/// is unknown, since it cannot be pinned to one letter).
pub async fn draft_letters<M: Model>(model: &M, d: &LetterData) -> Result<Letters, JobError> {
    let skeleton = fnol_template(d);
    let prompt = prompts::letters_prompt(d, &skeleton);
    let request = || MessageRequest::new().system(prompts::LETTERS_SYSTEM).text(prompt.clone()).json_schema(claim_letters_schema());
    let check = |v: &Value| {
        let l: ClaimLetters = parse(v, "the three letters")?;
        let (per_letter, cited) = letter_problems(&l, d, &skeleton);
        let all: Vec<String> = per_letter.into_iter().flatten().chain(cited).collect();
        if all.is_empty() { Ok(l) } else { Err(all) }
    };
    let tries = ask_twice(model, "claim_draft", Effort::Medium, request, check).await?;
    let letters = match tries.checked {
        Ok(l) => Letters { fnol: l.fnol, summary: l.summary, determination: l.determination, from_model: [true; 3], calls: tries.calls },
        Err(problems) => {
            tracing::warn!(problems = %problems.join("; "), "letters still fail the guardrails");
            let mut out = Letters::templates(d, tries.calls);
            if let Ok(l) = parse::<ClaimLetters>(&tries.json, "letters") {
                let (per_letter, cited) = letter_problems(&l, d, &skeleton);
                if cited.is_empty() {
                    let texts = [l.fnol, l.summary, l.determination];
                    let slots = [&mut out.fnol, &mut out.summary, &mut out.determination];
                    for (i, (text, slot)) in texts.into_iter().zip(slots).enumerate() {
                        if per_letter[i].is_empty() {
                            *slot = text;
                            out.from_model[i] = true;
                        }
                    }
                }
            }
            out
        }
    };
    Ok(letters)
}

/// Problems with a recovery letter: stance, fault phrases, figures, cited ids.
fn recovery_problems(r: &RecoveryLetter, d: &LetterData) -> Vec<String> {
    let mut out = Vec::new();
    if r.stance != "query" {
        out.push(format!("stance is {:?}, must be \"query\"", r.stance));
    }
    let text = format!("{}\n{}", r.subject, r.body);
    out.extend(fault_phrases_in(&text).into_iter().map(|p| format!("the letter assigns fault: \"{p}\"")));
    out.extend(figure_problems("letter", &r.body, &d.amounts.figures()));
    out.extend(unknown_figures(&r.subject, &d.amounts.figures()).into_iter().map(|f| format!("subject: {f} is not one of the claim's amounts")));
    out.extend(cited_problems(&r.cited_fact_ids, d));
    out
}

/// Drafts the recovery letter; returns its text, whether the model's text
/// was kept, and the calls.
pub async fn recovery_letter<M: Model>(model: &M, d: &LetterData) -> Result<(String, bool, Vec<ModelCallIn>), JobError> {
    let system = prompts::recovery_system();
    let prompt = prompts::recovery_prompt(d);
    let request = || MessageRequest::new().system(system.clone()).text(prompt.clone()).json_schema(recovery_letter_schema());
    let check = |v: &Value| {
        let r: RecoveryLetter = parse(v, "a recovery letter")?;
        let problems = recovery_problems(&r, d);
        if problems.is_empty() { Ok(r) } else { Err(problems) }
    };
    let tries = ask_twice(model, "recovery_letter", Effort::Medium, request, check).await?;
    Ok(match tries.checked {
        Ok(r) => (format!("Subject: {}\n\n{}\n", r.subject.trim(), r.body.trim()), true, tries.calls),
        Err(problems) => {
            tracing::warn!(problems = %problems.join("; "), "recovery letter still fails the guardrails, using the template");
            (recovery_template(d), false, tries.calls)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;
    use crate::testdata;
    use serde_json::json;

    fn good(d: &LetterData) -> Value {
        json!({
            "fnol": fnol_template(d).replace("Description:", "Description: a guest fell in a crowd surge;"),
            "summary": "Claim 900101: Jordan Alvarez, fall at Main stage; the claimant receives $895.00.",
            "determination": "Dear Jordan Alvarez,\n\nYou will be paid $895.00.\n\nCal Hacks 13.0",
            "cited_fact_ids": [1, 17]
        })
    }

    #[test]
    fn fnol_headings_and_fact_seqs() {
        let d = testdata::letter_data();
        let skeleton = fnol_template(&d);
        let h = headings(&skeleton);
        assert_eq!(h, ["CARRIER", "POLICY", "INSURED", "OCCURRENCE", "INJURED / PROPERTY DAMAGED", "WITNESSES", "OTHER INJURED IN THIS OCCURRENCE", "REMARKS", "EVIDENCE FACTS"]);
        let seqs = fact_seqs(&d);
        assert_eq!(seqs.len(), d.fact_lines.len());
        assert_eq!(seqs[..3], [1, 2, 3]);
    }

    #[tokio::test]
    async fn good_letters_are_kept() {
        let d = testdata::letter_data();
        let model = FakeModel::new(vec![Ok(good(&d))]);
        let l = draft_letters(&model, &d).await.unwrap();
        assert_eq!(l.from_model, [true; 3]);
        assert_eq!(l.calls.len(), 1);
        assert!(l.summary.contains("$895.00"));
    }

    #[tokio::test]
    async fn a_bad_letter_falls_back_alone_after_one_retry() {
        let d = testdata::letter_data();
        let mut bad = good(&d);
        bad["determination"] = json!("Dear Jordan, the X-ray alone was $215.00; you get $895.00.");
        bad["fnol"] = json!(bad["fnol"].as_str().unwrap().replace("WITNESSES\n", ""));
        let model = FakeModel::new(vec![Ok(bad.clone()), Ok(bad)]);
        let l = draft_letters(&model, &d).await.unwrap();
        assert_eq!(model.calls(), 2);
        let retry = model.text_of(1);
        assert!(retry.contains("determination: $215.00 is not one of the claim's amounts"), "{retry}");
        assert!(retry.contains("fnol: heading \"WITNESSES\" is missing"), "{retry}");
        assert_eq!(l.from_model, [false, true, false]);
        assert_eq!(l.fnol, fnol_template(&d));
        assert_eq!(l.determination, determination_template(&d));
        assert_eq!(l.calls.len(), 2);
    }

    #[tokio::test]
    async fn unknown_fact_ids_fall_back_everywhere() {
        let d = testdata::letter_data();
        let mut bad = good(&d);
        bad["cited_fact_ids"] = json!([1, 404]);
        let model = FakeModel::new(vec![Ok(bad.clone()), Ok(bad)]);
        let l = draft_letters(&model, &d).await.unwrap();
        assert_eq!(l.from_model, [false; 3]);
        assert!(model.text_of(1).contains("cited fact 404 is not in the pack"));
    }

    #[tokio::test]
    async fn recovery_letter_must_be_a_question() {
        let d = testdata::recovery_data();
        let accusing = json!({"stance": "query", "subject": "Your crew", "body": "Your crew damaged our speaker and you are liable for $2,400.00 plus $50.00.", "cited_fact_ids": [1]});
        let asking = json!({"stance": "query", "subject": "A question about claim 900104", "body": "Was anyone from your team at Stage B? The repair is $2,400.00.", "cited_fact_ids": [1]});
        let model = FakeModel::new(vec![Ok(accusing), Ok(asking)]);
        let (text, from_model, calls) = recovery_letter(&model, &d).await.unwrap();
        assert!(from_model && text.starts_with("Subject: A question about claim 900104\n\n"));
        assert_eq!(calls.len(), 2);
        let retry = model.text_of(1);
        assert!(retry.contains("liable for") && retry.contains("$50.00 is not one of the claim's amounts"), "{retry}");

        let wrong = json!({"stance": "demand", "subject": "s", "body": "This was negligent.", "cited_fact_ids": []});
        let model = FakeModel::new(vec![Ok(wrong.clone()), Ok(wrong)]);
        let (text, from_model, _) = recovery_letter(&model, &d).await.unwrap();
        assert!(!from_model);
        assert_eq!(text, recovery_template(&d));
    }
}
