//! One temporary Agent Builder image attachment. Kibana's Files API requires
//! readAgentBuilder to create/upload and files:manageFiles to delete. The current
//! Files endpoints are internal APIs, so requests include its origin header.
//! The image is never added to the searchable policy/document corpus.

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use reqwest::Method;
use serde_json::{Value, json};

use crate::Kibana;

pub const WORKFLOW: &str = "bandit-read-image";
pub const AGENT: &str = "bandit-image-reader";
pub const ANSWER_STEP: &str = "answer";
pub const MAX_IMAGE_BYTES: usize = 7 * 1024 * 1024 / 2;
const FILES: &str = "api/files/files/chat-attachment-images";
const AGENT_JSON: &str = include_str!("../elastic/agents/bandit-image-reader.json");
const WORKFLOW_YAML: &str = include_str!("../elastic/workflows/bandit-read-image.yaml");

pub struct ImageData {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

impl ImageData {
    pub fn from_base64(mime_type: &str, encoded: &str) -> Result<Self> {
        if !matches!(mime_type, "image/jpeg" | "image/png") {
            bail!("Elastic image input must be JPEG or PNG");
        }
        if encoded.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
            bail!("Elastic image exceeds 3.5 MiB");
        }
        let bytes = STANDARD.decode(encoded).context("image is not valid base64")?;
        if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
            bail!("Elastic image must be nonempty and at most 3.5 MiB");
        }
        Ok(Self { mime_type: mime_type.to_string(), bytes })
    }
}

/// Owns only the new file created for this request. Normal completion waits
/// for deletion. Cancellation schedules deletion on the current runtime.
pub struct UploadedImage {
    kibana: Kibana,
    id: Option<String>,
}

impl UploadedImage {
    pub fn id(&self) -> &str {
        self.id.as_deref().expect("image has not been deleted")
    }

    pub async fn delete(&mut self) -> Result<()> {
        if let Some(id) = &self.id {
            self.kibana.delete_image(id).await?;
            self.id = None;
        }
        Ok(())
    }
}

impl Drop for UploadedImage {
    fn drop(&mut self) {
        if let Some(id) = self.id.take()
            && let Ok(runtime) = tokio::runtime::Handle::try_current()
        {
            let kibana = self.kibana.clone();
            runtime.spawn(async move {
                if let Err(error) = kibana.delete_image(&id).await {
                    tracing::error!(file_id = %id, error = %error, "temporary Elastic image cleanup failed");
                }
            });
        }
    }
}

impl Kibana {
    pub async fn ensure_images(&self) -> Result<()> {
        self.ensure_asset("api/agent_builder/agents", serde_json::from_str(AGENT_JSON)?).await?;
        self.ensure_private_workflow(WORKFLOW, WORKFLOW_YAML).await
    }

    pub async fn upload_image(&self, image: &ImageData) -> Result<UploadedImage> {
        if !matches!(image.mime_type.as_str(), "image/jpeg" | "image/png") || image.bytes.is_empty() || image.bytes.len() > MAX_IMAGE_BYTES {
            bail!("Elastic image must be nonempty JPEG/PNG and at most 3.5 MiB");
        }
        let created = self.req(Method::POST, FILES)
            .header("x-elastic-internal-origin", "Kibana")
            .json(&json!({"name": "bandit-image", "mimeType": image.mime_type, "meta": {"purpose": "temporary image reading"}}))
            .send().await.context("creating temporary Elastic image")?;
        let status = created.status();
        if !status.is_success() { bail!("creating temporary Elastic image returned {status}"); }
        let created: Value = created.json().await?;
        let id = created["file"]["id"].as_str().context("image create returned no file id")?.to_string();
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
            bail!("image create returned an invalid file id");
        }
        let mut uploaded = UploadedImage { kibana: self.clone(), id: Some(id.clone()) };
        let result: Result<()> = async {
            let response = self.req(Method::PUT, &format!("{FILES}/{id}/blob?selfDestructOnAbort=true"))
                .header("x-elastic-internal-origin", "Kibana")
                .header("Content-Type", &image.mime_type)
                .body(image.bytes.clone()).send().await.context("uploading temporary Elastic image")?;
            let status = response.status();
            if !status.is_success() { bail!("uploading temporary Elastic image returned {status}"); }
            let value: Value = response.json().await?;
            if value["ok"] != true || value["size"].as_u64() != Some(image.bytes.len() as u64) {
                bail!("Elastic image upload did not confirm the complete image");
            }
            Ok(())
        }.await;
        if let Err(error) = result {
            return match uploaded.delete().await {
                Ok(()) => Err(error),
                Err(cleanup) => Err(error.context(format!("temporary image cleanup also failed: {cleanup:#}"))),
            };
        }
        Ok(uploaded)
    }

    async fn delete_image(&self, id: &str) -> Result<()> {
        // This file kind has no per-file DELETE route. Bulk delete accepts an
        // explicit list; this list always contains only our request's new id.
        let response = self.req(Method::DELETE, "api/files/blobs")
            .header("x-elastic-internal-origin", "Kibana")
            .json(&json!({"ids": [id]})).send().await.context("deleting temporary Elastic image")?;
        let status = response.status();
        if !status.is_success() { bail!("deleting temporary Elastic image returned {status}; files:manageFiles privilege is required"); }
        let value: Value = response.json().await?;
        if !value["succeeded"].as_array().is_some_and(|ids| ids.iter().any(|v| v == id)) {
            bail!("Elastic did not confirm deletion of temporary image {id}");
        }
        Ok(())
    }
}

pub fn answer(output: &Value) -> Result<Value> {
    output.get("structured_output").filter(|v| v.is_object()).cloned().context("image agent returned no structured object")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_supported_bounded_image_data() {
        assert_eq!(ImageData::from_base64("image/jpeg", "YWJj").unwrap().bytes, b"abc");
        for (mime, data) in [("application/pdf", "YWJj"), ("image/png", ""), ("image/png", "!invalid")] {
            assert!(ImageData::from_base64(mime, data).is_err());
        }
        assert!(ImageData::from_base64("image/png", &"A".repeat(MAX_IMAGE_BYTES.div_ceil(3) * 4 + 1)).is_err());
    }

    #[test]
    fn image_agent_is_private_and_does_not_have_search_or_write_tools() {
        let agent: Value = serde_json::from_str(AGENT_JSON).unwrap();
        assert_eq!(agent["id"], AGENT);
        assert_eq!(agent["access_control"]["access_mode"], "private");
        assert_eq!(agent["configuration"]["tools"], json!([]));
        assert_eq!(agent["configuration"]["enable_elastic_capabilities"], false);
        assert!(WORKFLOW_YAML.contains("ephemeral: true"));
        assert!(WORKFLOW_YAML.contains("create-conversation: false"));
        assert!(!WORKFLOW_YAML.contains("elasticsearch.index"));
        assert!(WORKFLOW_YAML.contains("type: image"));
    }

    #[test]
    fn malformed_image_answers_cannot_become_success() {
        assert_eq!(answer(&json!({"structured_output": {"people_count": 0}})).unwrap(), json!({"people_count": 0}));
        for value in [json!({}), json!({"structured_output": null}), json!({"structured_output": "text"})] {
            assert!(answer(&value).is_err());
        }
    }

    fn file_server(upload_status: u16) -> (Kibana, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let responses = [
                (200, json!({"file": {"id": "owned-image-1"}})),
                (upload_status, json!({"ok": upload_status == 200, "size": 3})),
                (200, json!({"succeeded": ["owned-image-1"]})),
            ];
            for (status, body) in responses {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(5)),
                        Err(error) => panic!("expected a file request: {error}"),
                    }
                };
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0_u8; 4096];
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                        let len = headers.lines().find_map(|line| line.strip_prefix("content-length:").map(|n| n.trim().parse::<usize>().unwrap())).unwrap_or(0);
                        if bytes.len() >= end + 4 + len { break; }
                    }
                }
                let request = String::from_utf8(bytes).unwrap();
                assert!(request.to_ascii_lowercase().contains("x-elastic-internal-origin: kibana"));
                requests.push(request);
                let body = body.to_string();
                write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (Kibana::new(&url, "test-key").unwrap(), thread)
    }

    #[tokio::test]
    async fn failed_upload_deletes_only_the_file_it_created() {
        let (kibana, server) = file_server(500);
        let image = ImageData { mime_type: "image/jpeg".into(), bytes: b"abc".to_vec() };
        let error = kibana.upload_image(&image).await.err().unwrap();
        assert!(error.to_string().contains("500"));
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("POST /api/files/files/chat-attachment-images "));
        assert!(requests[1].starts_with("PUT /api/files/files/chat-attachment-images/owned-image-1/blob?selfDestructOnAbort=true "));
        assert!(requests[2].starts_with("DELETE /api/files/blobs "));
        assert!(requests[2].ends_with("{\"ids\":[\"owned-image-1\"]}"));
    }

    #[tokio::test]
    async fn completed_upload_has_explicit_confirmed_cleanup() {
        let (kibana, server) = file_server(200);
        let image = ImageData { mime_type: "image/jpeg".into(), bytes: b"abc".to_vec() };
        let mut upload = kibana.upload_image(&image).await.unwrap();
        assert_eq!(upload.id(), "owned-image-1");
        upload.delete().await.unwrap();
        upload.delete().await.unwrap();
        assert_eq!(server.join().unwrap().len(), 3);
    }

}
