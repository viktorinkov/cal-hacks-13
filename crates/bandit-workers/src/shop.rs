//! `merch_picks`: the shopping agent. When an attendee's night ends (they leave early or the event ends),
//! an Elastic Workflow picks the three products they would most want from their night: which template, which of their
//! photos (the ones with the people they met first) and a short line printed under the photo, with one
//! sentence on why. The task uses photo captions and ids, not pixels or open-ended tools. Code checks
//! every id and length, and the module keeps the prices and the wallet.

use std::collections::HashSet;

use bandit_bindings::MerchPickIn;
use claude_client::{Effort, MessageRequest};
use serde_json::{Value, json};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::prompts::escape;
use crate::sink::Finish;

pub const KIND: &str = "merch_picks";
const PICKS: usize = 3;
const LINE_CHARS: usize = 36;
const REASON_CHARS: usize = 200;

const SYSTEM: &str = "You are BandIt's shopping agent. One attendee's night at an event has just ended, because the event closed \
or because they left early. From what the wristbands \
measured about their night, pick the three products they would most want to keep as a memory, each with one of \
their own photos and a short line printed under the photo.\n\
Rules:\n\
- Pick three different products from `products` by `template_id`, and for each one photo from `photos` by `photo_id`. \
A photo may be used for more than one product.\n\
- Prefer products of the sponsors whose booths the attendee spent the most time at. A photo whose caption or zone \
matches a sponsor's booth suits that sponsor's product, and photos with the people they met come first.\n\
- The line is printed on the product: at most 36 characters, plain words, no emoji, no hashtags and no prices. Name \
only people listed in that photo's `people_you_met_in_it`.\n\
- The reason speaks to the attendee in one sentence of at most 25 words, using only facts from the data, for example \
the booth, the minutes or the people in the photo.\n\
- Use only this attendee's supplied data. The photos are described by captions and tags; you cannot inspect their pixels.\n\
- Never invent people, booths, times or events.";

fn prompt(night: &Value) -> String {
    let data = serde_json::to_string_pretty(night).unwrap_or_default();
    format!("<night>\n{}\n</night>\n\nPick the three products.", escape(&data))
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "picks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "template_id": {"type": "integer"},
                        "photo_id": {"type": "integer"},
                        "line": {"type": "string"},
                        "reason": {"type": "string"}
                    },
                    "required": ["template_id", "photo_id", "line", "reason"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["picks"],
        "additionalProperties": false
    })
}

fn ids(night: &Value, list: &str, key: &str) -> HashSet<u64> {
    night[list].as_array().into_iter().flatten().filter_map(|x| x[key].as_u64()).collect()
}

/// The picks, or what is wrong with them.
fn check(v: &Value, night: &Value) -> Result<Vec<MerchPickIn>, Vec<String>> {
    let products = ids(night, "products", "template_id");
    let photos = ids(night, "photos", "photo_id");
    let want = PICKS.min(products.len());
    let mut problems = Vec::new();
    let mut seen = HashSet::new();
    let mut picks = Vec::new();
    for (i, p) in v["picks"].as_array().into_iter().flatten().enumerate() {
        let n = i + 1;
        let template_id = p["template_id"].as_u64().unwrap_or(0);
        let photo_id = p["photo_id"].as_u64().unwrap_or(0);
        let line = p["line"].as_str().unwrap_or("").trim().to_string();
        let reason = p["reason"].as_str().unwrap_or("").trim().to_string();
        if !products.contains(&template_id) {
            problems.push(format!("pick {n}: template_id {template_id} is not in products"));
        } else if !seen.insert(template_id) {
            problems.push(format!("pick {n}: template_id {template_id} is picked twice"));
        }
        if !photos.contains(&photo_id) {
            problems.push(format!("pick {n}: photo_id {photo_id} is not in photos"));
        }
        if line.chars().count() > LINE_CHARS || line.contains('#') {
            problems.push(format!("pick {n}: the line must be at most {LINE_CHARS} characters with no hashtags"));
        }
        if reason.is_empty() || reason.chars().count() > REASON_CHARS {
            problems.push(format!("pick {n}: the reason must be one sentence of at most {REASON_CHARS} characters"));
        }
        picks.push(MerchPickIn { template_id, photo_id, line, reason });
    }
    if picks.len() != want {
        problems.push(format!("there must be exactly {want} picks, not {}", picks.len()));
    }
    if problems.is_empty() { Ok(picks) } else { Err(problems) }
}

pub async fn pick<M: Model>(model: &M, night: &Value) -> Result<Tries<Vec<MerchPickIn>>, JobError> {
    let request = || MessageRequest::new().system(SYSTEM).text(prompt(night)).json_schema(schema());
    ask_twice(model, KIND, Effort::Medium, request, |v| check(v, night)).await
}

pub async fn run(ctx: &Ctx, job: &JobIn, night: Value) -> Result<(), JobError> {
    if ids(&night, "photos", "photo_id").is_empty() {
        return Err(JobError::msg("the attendee is in no photo"));
    }
    let model = ctx.elastic_model().await?;
    let tries = pick(&model, &night).await?;
    let picks = match tries.checked {
        Ok(picks) => picks,
        Err(problems) => return Err(JobError { error: problems.join("; "), calls: tries.calls }),
    };
    tracing::info!(job_id = job.id, attendee = %night["attendee"], picks = picks.len(), "merch picked");
    ctx.sink.finish(job.id, Finish::MerchPicks { picks }, tries.calls).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;

    fn night() -> Value {
        json!({
            "attendee": "Maya Chen",
            "event": "Cal Hacks 13.0",
            "places": [{"zone": "Sponsor row", "minutes": 40, "booths_in_zone": ["Elastic", "SpacetimeDB"], "minutes_at_booths": []}],
            "people_met": [{"name": "Jordan Alvarez", "minutes": 20}],
            "photos": [{"photo_id": 4, "zone": "Sponsor row", "caption": "Two hackers at the Elastic booth", "people_in_photo": 2, "people_you_met_in_it": ["Jordan Alvarez"], "others_tagged": 0}],
            "products": [
                {"template_id": 1, "title": "Elastic mug", "kind": "mug", "price_cents": 1800, "sponsors": ["Elastic"]},
                {"template_id": 2, "title": "SpacetimeDB tee", "kind": "tee", "price_cents": 2500, "sponsors": ["SpacetimeDB"]},
                {"template_id": 3, "title": "Cal Hacks 13.0 poster", "kind": "poster", "price_cents": 1500, "sponsors": []}
            ]
        })
    }

    fn answer(picks: &[(u64, u64, &str)]) -> Value {
        json!({"picks": picks.iter().map(|(t, p, line)| json!({"template_id": t, "photo_id": p, "line": line, "reason": "You spent 40 minutes at the sponsor row with Jordan."})).collect::<Vec<_>>()})
    }

    #[tokio::test]
    async fn unknown_ids_and_repeats_are_asked_again() {
        let model = FakeModel::new(vec![
            Ok(answer(&[(1, 4, "Elastic crew with Jordan"), (1, 4, "again"), (9, 5, "no such thing")])),
            Ok(answer(&[(1, 4, "Elastic crew with Jordan"), (2, 4, "Sponsor row nights"), (3, 4, "with Jordan Alvarez")])),
        ]);
        let tries = pick(&model, &night()).await.ok().unwrap();
        let picks = tries.checked.unwrap();
        assert_eq!(picks.iter().map(|p| p.template_id).collect::<Vec<_>>(), [1, 2, 3]);
        assert_eq!(model.calls(), 2);
        let retry = model.text_of(1);
        assert!(retry.contains("template_id 1 is picked twice") && retry.contains("photo_id 5 is not in photos"), "{retry}");
        assert!(model.text_of(0).contains("Two hackers at the Elastic booth"));
    }

    #[tokio::test]
    async fn valid_picks_keep_the_attendee_scope_and_need_one_call() {
        let model = FakeModel::new(vec![Ok(answer(&[(1, 4, "Elastic crew with Jordan"), (2, 4, "Sponsor row nights"), (3, 4, "with Jordan Alvarez")]))]);
        let tries = pick(&model, &night()).await.ok().unwrap();
        assert_eq!(tries.checked.unwrap().len(), 3);
        assert_eq!(model.calls(), 1);
        let body = model.body(0);
        let content = body["messages"][0]["content"].as_array().unwrap();
        assert!(content.iter().all(|block| block["type"] == "text"), "merch uses captions and ids, not pixels");
        assert!(model.text_of(0).contains("Maya Chen"));
        assert_eq!(body["output_config"]["format"]["schema"]["properties"]["picks"]["items"]["additionalProperties"], false);
        assert!(body["output_config"]["format"]["schema"]["properties"]["picks"]["items"]["properties"].get("price_cents").is_none(), "the module owns prices");
    }

    #[tokio::test]
    async fn another_attendees_photo_stays_invalid_after_one_retry() {
        let wrong = answer(&[(1, 99, "another photo"), (2, 4, "ok"), (3, 4, "ok")]);
        let model = FakeModel::new(vec![Ok(wrong.clone()), Ok(wrong)]);
        let tries = pick(&model, &night()).await.ok().unwrap();
        assert!(tries.checked.unwrap_err().iter().any(|p| p.contains("photo_id 99 is not in photos")));
        assert_eq!(model.calls(), 2);
        assert_eq!(tries.calls.len(), 2);
        assert_eq!(tries.calls[1].kind, "merch_picks_retry");
    }

    #[tokio::test]
    async fn a_failed_correction_keeps_both_call_records() {
        let model = FakeModel::new(vec![
            Ok(answer(&[(1, 99, "another photo"), (2, 4, "ok"), (3, 4, "ok")])),
            Err("workflow execution failed".into()),
        ]);
        let error = pick(&model, &night()).await.err().unwrap();
        assert_eq!(error.calls.len(), 2);
        assert_eq!(error.calls[1].status, "error");
        assert!(error.error.contains("workflow execution failed"));
    }

    #[test]
    fn the_catalog_limits_the_number_of_picks() {
        let mut small = night();
        small["products"].as_array_mut().unwrap().truncate(2);
        assert_eq!(check(&answer(&[(1, 4, "one"), (2, 4, "two")]), &small).unwrap().len(), 2);
        let problems = check(&answer(&[(1, 4, "one")]), &small).unwrap_err();
        assert!(problems.iter().any(|p| p.contains("exactly 2 picks")));
    }

    #[test]
    fn long_lines_are_rejected() {
        let v = answer(&[(1, 4, "a line that is far too long to print under a photo"), (2, 4, "ok"), (3, 4, "ok")]);
        let problems = check(&v, &night()).unwrap_err();
        assert!(problems[0].contains("at most 36 characters"), "{problems:?}");
    }
}
