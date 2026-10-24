use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use sha2::{Digest, Sha256};

/// Content-addressed blob store over `<data_dir>/blobs`; files are named by SHA-256.
#[derive(Debug, Clone)]
pub struct BlobStore {
    dir: PathBuf,
}

/// A stored blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlobInfo {
    /// Lowercase hex SHA-256 of the content.
    pub sha256: String,
    pub size_bytes: u64,
    pub path: PathBuf,
}

impl BlobStore {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            dir: data_dir.as_ref().join("blobs"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Store `bytes`. Idempotent: an existing blob is not rewritten.
    pub fn put(&self, bytes: &[u8]) -> io::Result<BlobInfo> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let sha256 = sha256_hex(bytes);
        let path = self.dir.join(&sha256);
        if !path.is_file() {
            fs::create_dir_all(&self.dir)?;
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let tmp = self
                .dir
                .join(format!(".{sha256}.{}.{n}.tmp", std::process::id()));
            fs::write(&tmp, bytes)?;
            fs::rename(&tmp, &path)?;
        }
        Ok(BlobInfo {
            sha256,
            size_bytes: bytes.len() as u64,
            path,
        })
    }

    /// Read a blob. `NotFound` if absent, `InvalidInput` if `sha256` is not a hex digest.
    pub fn get(&self, sha256: &str) -> io::Result<Vec<u8>> {
        fs::read(self.path(sha256)?)
    }

    /// Path of a blob (it may not exist). Rejects anything but a 64-char hex digest.
    pub fn path(&self, sha256: &str) -> io::Result<PathBuf> {
        let sha256 = sha256.to_ascii_lowercase();
        if sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            Ok(self.dir.join(sha256))
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "not a SHA-256 hex digest",
            ))
        }
    }
}

/// Lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELLO_SHA256: &str = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    #[test]
    fn put_get_and_idempotence() {
        let data = tempfile::tempdir().unwrap();
        let store = BlobStore::new(data.path());
        let info = store.put(b"hello").unwrap();
        assert_eq!(info.sha256, HELLO_SHA256);
        assert_eq!(info.size_bytes, 5);
        assert_eq!(info.path, data.path().join("blobs").join(HELLO_SHA256));
        assert_eq!(store.put(b"hello").unwrap(), info);
        assert_eq!(store.get(HELLO_SHA256).unwrap(), b"hello");
        assert_eq!(store.get(&HELLO_SHA256.to_uppercase()).unwrap(), b"hello");
        assert_eq!(store.path(HELLO_SHA256).unwrap(), info.path);
        let files = fs::read_dir(store.dir()).unwrap().count();
        assert_eq!(files, 1, "no temp files left behind");
    }

    #[test]
    fn missing_and_invalid_digests() {
        let data = tempfile::tempdir().unwrap();
        let store = BlobStore::new(data.path());
        assert_eq!(
            store.get(&"0".repeat(64)).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
        for bad in ["", "../../etc/passwd", &"g".repeat(64), &"a".repeat(63)] {
            assert_eq!(
                store.get(bad).unwrap_err().kind(),
                io::ErrorKind::InvalidInput,
                "{bad}"
            );
        }
    }
}
