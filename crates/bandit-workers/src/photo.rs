//! `photo_features`: Elastic runs visual extraction on an event photo and reports a person count and a one-line
//! caption. The module cuts the photo's tags to that many people, the ones the bands put closest together,
//! and uses the caption when the photographer gave none. Who is in the photo always comes from the bands:
//! The model counts people and never says who anyone is.

use claude_client::{Effort, ImageType, MessageRequest};
use image::ImageReader;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::jobs::{Ctx, JobError, JobIn};
use crate::model::{Model, Tries, ask_twice};
use crate::prompts::escape;
use crate::sink::Finish;

pub const KIND: &str = "photo_features";
/// Longest side of the image sent for visual extraction.
const MAX_SIDE: u32 = 1568;
const CAPTION_CHARS: usize = 120;
const MAX_PEOPLE: u64 = 200;

#[derive(Clone, Debug, Deserialize)]
pub struct Payload {
    pub photo_id: u64,
    pub blob_hash: String,
    #[serde(default)]
    pub zone: String,
    #[serde(default)]
    pub zone_description: String,
    #[serde(default)]
    pub booths: Vec<String>,
    #[serde(default)]
    pub caption: String,
}

const SYSTEM: &str = "You look at a photo that an event photographer took at a public event, so the people in it can find \
it in their recap and share it. Count the people who are clearly part of the photo: anyone whose face or body is \
visible in the foreground or middle ground, not a distant blurred crowd. Then write one caption for sharing the photo \
on Instagram: what the people are doing and where, in at most 12 words, in plain words, with no hashtags, no emoji, \
no @ mentions and no names. Never guess who anyone is or describe anyone's looks; the event knows who is in the photo \
from their wristbands.";

fn prompt(p: &Payload) -> String {
    let mut s = String::from("<place>\n");
    s.push_str(&escape(&format!("zone: {}\n", p.zone)));
    if !p.zone_description.is_empty() {
        s.push_str(&escape(&format!("about the zone: {}\n", p.zone_description)));
    }
    if !p.booths.is_empty() {
        s.push_str(&escape(&format!("booths in the zone: {}\n", p.booths.join(", "))));
    }
    if !p.caption.is_empty() {
        s.push_str(&escape(&format!("the photographer's caption: {}\n", p.caption)));
    }
    s.push_str("</place>\n\nCount the people in the photo and write the caption.");
    s
}

fn schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "people_count": {"type": "integer"},
            "caption": {"type": "string"}
        },
        "required": ["people_count", "caption"],
        "additionalProperties": false
    })
}

/// The count and the caption, or what is wrong with the answer.
fn check(v: &Value) -> Result<(u32, String), Vec<String>> {
    let mut problems = Vec::new();
    let count = v["people_count"].as_u64().filter(|n| *n <= MAX_PEOPLE);
    if count.is_none() {
        problems.push(format!("people_count must be a whole number from 0 to {MAX_PEOPLE}"));
    }
    let caption = v["caption"].as_str().unwrap_or("").trim().to_string();
    if caption.is_empty() || caption.chars().count() > CAPTION_CHARS {
        problems.push(format!("caption must be 1 to {CAPTION_CHARS} characters"));
    }
    if caption.contains('#') || caption.contains('@') {
        problems.push("caption must have no hashtags and no @ mentions".into());
    }
    match (count, problems.is_empty()) {
        (Some(n), true) => Ok((n as u32, caption)),
        _ => Err(problems),
    }
}

/// The photo as a JPEG no larger than `MAX_SIDE` on its longest side.
pub fn shrink(bytes: &[u8]) -> Result<Vec<u8>, JobError> {
    let img = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| JobError::msg(format!("reading the photo: {e}")))?
        .decode()
        .map_err(|e| JobError::msg(format!("decoding the photo (JPEG, PNG or WebP): {e}")))?;
    let img = if img.width().max(img.height()) > MAX_SIDE { img.resize(MAX_SIDE, MAX_SIDE, image::imageops::FilterType::Triangle) } else { img };
    let mut out = Vec::new();
    img.to_rgb8()
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Jpeg)
        .map_err(|e| JobError::msg(format!("encoding the photo: {e}")))?;
    Ok(out)
}

pub async fn read<M: Model>(model: &M, jpeg: &[u8], p: &Payload) -> Result<Tries<(u32, String)>, JobError> {
    let request = || MessageRequest::new().system(SYSTEM).image(ImageType::Jpeg, jpeg).text(prompt(p)).json_schema(schema());
    ask_twice(model, KIND, Effort::Low, request, check).await
}

pub async fn run(ctx: &Ctx, job: &JobIn, p: Payload) -> Result<(), JobError> {
    let bytes = ctx.blobs.get(&p.blob_hash).map_err(|e| JobError::msg(format!("reading photo {}: {e}", p.blob_hash)))?;
    let jpeg = shrink(&bytes)?;
    let model = ctx.elastic_image_model().await?;
    let tries = read(&model, &jpeg, &p).await?;
    let (people_count, caption) = tries.checked.map_err(|e| JobError { error: e.join("; "), calls: tries.calls.clone() })?;
    tracing::info!(job_id = job.id, photo_id = p.photo_id, people_count, %caption, "photo read");
    ctx.sink.finish(job.id, Finish::PhotoFeatures { people_count, caption }, tries.calls).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::fake::FakeModel;

    fn payload() -> Payload {
        Payload {
            photo_id: 7,
            blob_hash: "ab".into(),
            zone: "Sponsor row".into(),
            zone_description: String::new(),
            booths: vec!["Elastic".into(), "SpacetimeDB".into()],
            caption: String::new(),
        }
    }

    #[tokio::test]
    async fn a_caption_with_a_hashtag_is_asked_again() {
        let model = FakeModel::new(vec![
            Ok(json!({"people_count": 3, "caption": "Hacking all night #calhacks"})),
            Ok(json!({"people_count": 3, "caption": "Three hackers trading stickers at the sponsor row"})),
        ]);
        let tries = read(&model, &[0xff, 0xd8], &payload()).await.ok().unwrap();
        assert_eq!(tries.checked, Ok((3, "Three hackers trading stickers at the sponsor row".into())));
        assert_eq!(model.calls(), 2);
        let text = model.text_of(0);
        assert!(text.contains("booths in the zone: Elastic, SpacetimeDB"), "{text}");
    }

    #[test]
    fn counts_out_of_range_are_rejected() {
        assert!(check(&json!({"people_count": -1, "caption": "A booth"})).is_err());
        assert!(check(&json!({"people_count": 201, "caption": "A crowd"})).is_err());
        assert_eq!(check(&json!({"people_count": 200, "caption": "A crowd"})), Ok((200, "A crowd".into())));
        assert!(check(&json!({"people_count": 4, "caption": ""})).is_err());
        assert_eq!(check(&json!({"people_count": 0, "caption": "An empty booth"})), Ok((0, "An empty booth".into())));
    }

    #[test]
    fn large_photos_shrink_to_a_jpeg() {
        let img = image::RgbImage::from_pixel(3000, 2000, image::Rgb([200, 30, 30]));
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let jpeg = shrink(&png).unwrap();
        let back = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((back.width(), back.height()), (1568, 1045));
        assert!(shrink(b"not an image").is_err());
    }
}
