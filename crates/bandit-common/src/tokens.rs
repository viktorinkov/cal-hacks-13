use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Identity tokens (for example SpacetimeDB tokens) stored one file per name under
/// `<data_dir>/identities`, readable only by the owner (0600 files, 0700 folder on Unix).
#[derive(Debug, Clone)]
pub struct TokenStore {
    dir: PathBuf,
}

impl TokenStore {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            dir: data_dir.as_ref().join("identities"),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The saved token, or `None` if there is none (or it is empty).
    pub fn load(&self, name: &str) -> io::Result<Option<String>> {
        match fs::read_to_string(self.file(name)?) {
            Ok(token) => Ok(Some(token.trim().to_string()).filter(|t| !t.is_empty())),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Save (or replace) the token for `name`.
    pub fn save(&self, name: &str, token: &str) -> io::Result<()> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let path = self.file(name)?;
        fs::create_dir_all(&self.dir)?;
        set_mode(&self.dir, 0o700)?;
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let tmp = self
            .dir
            .join(format!(".{name}.{}.{n}.tmp", std::process::id()));
        write_private(&tmp, token.as_bytes())?;
        fs::rename(&tmp, &path)
    }

    /// Names are limited to ASCII letters, digits, `-`, `_` and `.`, not starting with `.`.
    fn file(&self, name: &str) -> io::Result<PathBuf> {
        let valid = !name.is_empty()
            && !name.starts_with('.')
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b));
        if valid {
            Ok(self.dir.join(name))
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid token name",
            ))
        }
    }
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    set_mode(path, 0o600)?; // in case a stale temp file already existed
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_load_and_replace() {
        let data = tempfile::tempdir().unwrap();
        let store = TokenStore::new(data.path());
        assert_eq!(store.load("worker").unwrap(), None);
        store.save("worker", "token-1").unwrap();
        assert_eq!(store.load("worker").unwrap().as_deref(), Some("token-1"));
        store.save("worker", "token-2").unwrap();
        assert_eq!(store.load("worker").unwrap().as_deref(), Some("token-2"));
        assert_eq!(store.load("other").unwrap(), None);
        assert_eq!(
            fs::read_dir(store.dir()).unwrap().count(),
            1,
            "no temp files left behind"
        );
    }

    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        let store = TokenStore::new(data.path());
        store.save("demo-cli", "secret").unwrap();
        let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&store.dir().join("demo-cli")), 0o600);
        assert_eq!(mode(store.dir()), 0o700);
    }

    #[test]
    fn rejects_bad_names() {
        let data = tempfile::tempdir().unwrap();
        let store = TokenStore::new(data.path());
        for bad in ["", ".hidden", "../escape", "a/b", "sp ace"] {
            assert_eq!(
                store.save(bad, "t").unwrap_err().kind(),
                io::ErrorKind::InvalidInput,
                "{bad}"
            );
            assert_eq!(
                store.load(bad).unwrap_err().kind(),
                io::ErrorKind::InvalidInput,
                "{bad}"
            );
        }
    }
}
