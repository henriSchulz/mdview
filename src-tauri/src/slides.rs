//! A presentation (PowerPoint, Impress) shown as the PDF LibreOffice makes of it: made once, in a
//! thread of its own, and kept in the cache under the file's path, size and time — the PDF viewer
//! shows it, read only. Without LibreOffice (`soffice`) the viewer says that it is needed.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use sha2::{Digest, Sha256};

/// The endings shown as slides.
pub const SLIDES_EXT: &[&str] = &["pptx", "ppt", "pps", "ppsx", "odp"];
/// (longer, and it is given up: a presentation LibreOffice cannot finish)
const AT_MOST: Duration = Duration::from_secs(180);

pub enum Ready {
    Pdf(PathBuf),
    Failed(String),
    /// not made yet (or being made)
    Not,
}

/// what failed, by the key of the file as it was then (tried again only when the file changed or the app started anew)
static FAILED: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// what is being made now, and who waits for it
type Waiting = Vec<Box<dyn FnOnce() + Send>>;
static MAKING: LazyLock<Mutex<HashMap<String, Waiting>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// (one LibreOffice at a time: two on one profile get in each other's way)
static ONE: Mutex<()> = Mutex::new(());

fn dir() -> PathBuf {
    std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| crate::theme::home().join(".cache")).join("mdview").join("slides")
}

/// The file as it is now: its path, size and time, made short.
fn key(src: &Path) -> Option<String> {
    let m = fs::metadata(src).ok()?;
    let t = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    let real = fs::canonicalize(src).unwrap_or_else(|_| src.to_path_buf());
    let mut h = Sha256::new();
    h.update(real.to_string_lossy().as_bytes());
    h.update(format!("\0{}\0{t}", m.len()).as_bytes());
    Some(h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect())
}

pub fn ready(src: &Path) -> Ready {
    let Some(key) = key(src) else { return Ready::Failed("Can't read the presentation".into()) };
    if let Some(e) = FAILED.lock().unwrap().get(&key) {
        return Ready::Failed(e.clone());
    }
    let pdf = dir().join(format!("{key}.pdf"));
    if pdf.is_file() { Ready::Pdf(pdf) } else { Ready::Not }
}

/// Makes the PDF of src in a thread of its own — or waits for the one making it already; done
/// (made or failed) is called then, in that thread. → whether it was started now
pub fn make(src: &Path, done: impl FnOnce() + Send + 'static) -> bool {
    let Some(key) = key(src) else { return false };
    {
        let mut making = MAKING.lock().unwrap();
        if let Some(waiting) = making.get_mut(&key) {
            waiting.push(Box::new(done));
            return false;
        }
        making.insert(key.clone(), vec![Box::new(done)]);
    }
    let src = src.to_path_buf();
    std::thread::spawn(move || {
        if let Err(e) = convert(&src, &key) {
            FAILED.lock().unwrap().insert(key.clone(), e);
        }
        let waiting = MAKING.lock().unwrap().remove(&key).unwrap_or_default();
        for done in waiting {
            done();
        }
    });
    true
}

fn convert(src: &Path, key: &str) -> Result<(), String> {
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let dir = dir();
    let out = dir.join(format!("making-{key}"));
    let _ = fs::remove_dir_all(&out);
    fs::create_dir_all(&out).map_err(|e| format!("Can't make the cache: {e}"))?;
    // (a profile of its own: a LibreOffice the user has open is left alone, and is not handed the work)
    let profile = format!("file://{}", dir.join("profile").to_string_lossy());
    let mut child = Command::new("soffice")
        .arg(format!("-env:UserInstallation={profile}"))
        .args(["--headless", "--norestore", "--convert-to", "pdf", "--outdir"])
        .arg(&out)
        .arg(src)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "LibreOffice is needed to show presentations (soffice was not found)".to_string() } else { format!("Couldn't start LibreOffice: {e}") })?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > AT_MOST => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_dir_all(&out);
                return Err("LibreOffice took too long for this presentation".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("LibreOffice: {e}")),
        }
    }
    let made = fs::read_dir(&out).ok().and_then(|d| d.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("pdf"))));
    let result = match made {
        Some(pdf) => fs::rename(&pdf, dir.join(format!("{key}.pdf"))).map_err(|e| format!("Can't keep the PDF: {e}")),
        None => Err("LibreOffice could not read this presentation".into()),
    };
    let _ = fs::remove_dir_all(&out);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_presentation_changed_is_another_key() {
        let d = std::env::temp_dir().join(format!("mdview-slides-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let f = d.join("deck.pptx");
        fs::write(&f, b"one").unwrap();
        let a = key(&f).unwrap();
        assert_eq!(key(&f).unwrap(), a);
        fs::write(&f, b"other").unwrap();
        assert_ne!(key(&f).unwrap(), a);
        let _ = fs::remove_dir_all(&d);
    }
}
