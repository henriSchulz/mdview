//! Updates of an install that was downloaded: the AppImage and the Windows installer update
//! themselves (tauri-plugin-updater: the release's latest.json read, the new file downloaded, its
//! signature checked against the key in tauri.conf.json, put in place); a .deb or an .rpm is the
//! system's to update, so it is only told, quietly, that a newer one is on the download page; and a
//! program that runs out of a checkout (bin/mdview, bin/mdview-install — Henri's own) is never
//! updated and never told anything: it is what the checkout builds.
//!
//! What the shell does with it (when to look, the notice, the restart): shell/app.rs, `on_update`.
//! The release's files and its latest.json: .github/workflows/build.yml, packaging/latest-json.mjs.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::mpsc::Sender;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use crate::Event;

/// Where the newest release says what it is (the static format of Tauri's updater).
pub const ENDPOINT: &str = "https://github.com/henriSchulz/mdview/releases/latest/download/latest.json";
/// Where a .deb or an .rpm is downloaded anew.
pub const DOWNLOAD_PAGE: &str = "https://md.henrischulz.com/download";
/// This program's version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// What this program was installed as — which says what it may do about a newer version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Install {
    /// an AppImage (the runtime names the file in APPIMAGE): replaced by the new one, and started again
    AppImage,
    /// the Windows installer's program: the new installer is run, and starts it again
    Windows,
    /// a .deb or an .rpm: the system's package manager owns the files — told, never replaced
    Package,
    /// built in a checkout, or a test: nothing at all
    Checkout,
}

impl Install {
    /// The new version is put in place by the app itself.
    pub fn updates_itself(self) -> bool {
        matches!(self, Install::AppImage | Install::Windows)
    }
    /// What the settings call it.
    pub fn name(self) -> &'static str {
        match self {
            Install::AppImage => "appimage",
            Install::Windows => "windows",
            Install::Package => "package",
            Install::Checkout => "checkout",
        }
    }
}

/// The decision, from what it rests on: the AppImage runtime's variable, the system, the program's
/// own path, a build for development, and whether updates were turned off from outside
/// (MDVIEW_NO_UPDATE). A program in a cargo `target` folder is a checkout's,
/// on any system; a debug build always.
pub fn kind_of(appimage: Option<&OsStr>, windows: bool, exe: &Path, debug: bool, off: bool) -> Install {
    let path = exe.to_string_lossy().replace('\\', "/");
    let in_target = path.contains("/target/release/") || path.contains("/target/debug/");
    if debug || off || in_target {
        return Install::Checkout;
    }
    if appimage.is_some_and(|a| !a.is_empty()) && !windows {
        return Install::AppImage;
    }
    if windows {
        return Install::Windows;
    }
    // (.deb and .rpm put the program at /usr/bin/mdview)
    if exe.starts_with("/usr") {
        return Install::Package;
    }
    Install::Checkout
}

/// This program's kind, decided once. (MDVIEW_UPDATE_TEST=package: the rig, to see the notice of a
/// .deb against an address of its own — MDVIEW_UPDATE_ENDPOINT.)
pub static KIND: LazyLock<Install> = LazyLock::new(|| {
    if std::env::var("MDVIEW_UPDATE_TEST").as_deref() == Ok("package") {
        return Install::Package;
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let off = std::env::var_os("MDVIEW_NO_UPDATE").is_some();
    kind_of(std::env::var_os("APPIMAGE").as_deref(), cfg!(windows), &exe, cfg!(debug_assertions), off)
});

/// Where to look: the release's, or one named for a test (the rig).
pub fn endpoint() -> String {
    std::env::var("MDVIEW_UPDATE_ENDPOINT").ok().filter(|e| !e.is_empty()).unwrap_or_else(|| ENDPOINT.to_string())
}

/// Whether `latest` is a newer version than `current`: numbers compared as numbers, a leading "v"
/// left out, and a version with a pre-release part ("0.2.0-beta.1") older than the same without.
pub fn newer(latest: &str, current: &str) -> bool {
    fn parts(v: &str) -> Option<(Vec<u64>, bool)> {
        let v = v.trim().trim_start_matches('v');
        let (core, pre) = match v.split_once(['-', '+']) {
            Some((core, rest)) => (core, v.as_bytes()[core.len()] == b'-' && !rest.is_empty()),
            None => (v, false),
        };
        let mut nums = core.split('.').map(|n| n.parse::<u64>().ok()).collect::<Option<Vec<_>>>()?;
        nums.resize(3.max(nums.len()), 0);
        Some((nums, pre))
    }
    match (parts(latest), parts(current)) {
        (Some((a, a_pre)), Some((b, b_pre))) => a > b || (a == b && b_pre && !a_pre),
        _ => false,
    }
}

/// The page of a release, for "What's new".
pub fn notes_url(version: &str) -> String {
    format!("https://github.com/henriSchulz/mdview/releases/tag/v{}", version.trim_start_matches('v'))
}

/// What a look for a newer version found. `asked`: the user pressed Check Now (said in the
/// settings, errors too); else the look of its own (said only when there is something new).
pub enum News {
    /// nothing newer than this
    Current { asked: bool },
    /// downloaded, its signature checked: ready to be put in place at a restart
    Ready { version: String, asked: bool },
    /// a newer version is on the download page (a .deb or an .rpm)
    Available { version: String, asked: bool },
    Failed { why: String, asked: bool },
}

/// The update downloaded and checked, until the restart puts it in place.
#[cfg(any(target_os = "linux", windows))]
static READY: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = Mutex::new(None);
static LOOKING: Mutex<bool> = Mutex::new(false);

/// Looks, in a thread of its own: the window is never held up. One look at a time.
pub fn check(handle: &tauri::AppHandle, tx: Sender<Event>, asked: bool) {
    {
        let mut busy = LOOKING.lock().unwrap();
        if *busy {
            return;
        }
        *busy = true;
    }
    let handle = handle.clone();
    let _ = std::thread::Builder::new().name("update".into()).spawn(move || {
        let news = match *KIND {
            Install::Checkout => None,
            Install::Package => Some(look_package(asked)),
            Install::AppImage | Install::Windows => Some(look_self(&handle, asked)),
        };
        *LOOKING.lock().unwrap() = false;
        if let Some(news) = news {
            let _ = tx.send(Event::Update(news));
        }
    });
}

/// A .deb or an .rpm: latest.json read, its version compared with this one.
fn look_package(asked: bool) -> News {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build();
    let read = agent.get(&endpoint()).call().map_err(|e| e.to_string()).and_then(|r| r.into_string().map_err(|e| e.to_string())).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).map_err(|e| e.to_string()));
    match read {
        Ok(json) => match json["version"].as_str() {
            Some(v) if newer(v, VERSION) => News::Available { version: v.trim_start_matches('v').to_string(), asked },
            Some(_) => News::Current { asked },
            None => News::Failed { why: "the release says no version".into(), asked },
        },
        Err(why) => News::Failed { why, asked },
    }
}

#[cfg(any(target_os = "linux", windows))]
fn look_self(handle: &tauri::AppHandle, asked: bool) -> News {
    use tauri_plugin_updater::UpdaterExt;
    let fail = |e: &dyn std::fmt::Display| News::Failed { why: e.to_string(), asked };
    let Ok(url) = endpoint().parse() else { return fail(&"no address to look at") };
    let updater = match handle.updater_builder().endpoints(vec![url]).and_then(|b| b.timeout(Duration::from_secs(60)).build()) {
        Ok(u) => u,
        Err(e) => return fail(&e),
    };
    let found = match tauri::async_runtime::block_on(updater.check()) {
        Ok(found) => found,
        Err(e) => return fail(&e),
    };
    let Some(update) = found else { return News::Current { asked } };
    let version = update.version.clone();
    // (downloaded once: a look later that finds the same version has it already)
    if READY.lock().unwrap().as_ref().is_some_and(|(u, _)| u.version == version) {
        return News::Ready { version, asked };
    }
    match tauri::async_runtime::block_on(update.download(|_, _| {}, || {})) {
        Ok(bytes) => {
            *READY.lock().unwrap() = Some((update, bytes));
            News::Ready { version, asked }
        }
        Err(e) => fail(&e),
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
fn look_self(_handle: &tauri::AppHandle, asked: bool) -> News {
    News::Failed { why: "not on this system".into(), asked }
}

/// The downloaded version put in place. On Linux the AppImage file is replaced (the running
/// program goes on from its own mount) and the app is started again by the shell; on Windows the
/// installer is started and this process ends here, with the installer starting the new one.
#[cfg(any(target_os = "linux", windows))]
pub fn install() -> Result<(), String> {
    let ready = READY.lock().unwrap().take();
    let Some((update, bytes)) = ready else { return Err("nothing downloaded".into()) };
    update.install(&bytes).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn install() -> Result<(), String> {
    Err("not on this system".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn an_appimage_and_windows_update_themselves() {
        let image = OsString::from("/home/a/Apps/MarkdownNotes-0.1.4-linux-x64.AppImage");
        assert_eq!(kind_of(Some(&image), false, Path::new("/tmp/.mount_Markdo1/usr/bin/mdview"), false, false), Install::AppImage);
        assert_eq!(kind_of(None, true, Path::new(r"C:\Users\a\AppData\Local\Markdown Notes\mdview.exe"), false, false), Install::Windows);
        assert!(Install::AppImage.updates_itself() && Install::Windows.updates_itself());
    }

    #[test]
    fn a_checkout_never_updates_nor_is_told() {
        // Henri's install: bin/mdview runs the checkout's build — no APPIMAGE, not Windows
        let exe = Path::new("/home/henri/Projects/mdview/src-tauri/target/release/mdview");
        assert_eq!(kind_of(None, false, exe, false, false), Install::Checkout);
        // … not even with an APPIMAGE left in the environment by something started from an AppImage
        assert_eq!(kind_of(Some(OsStr::new("/x/Other.AppImage")), false, exe, false, false), Install::Checkout);
        // a build on Windows, in its target folder; a debug build anywhere; updates turned off
        assert_eq!(kind_of(None, true, Path::new(r"C:\src\mdview\src-tauri\target\release\mdview.exe"), false, false), Install::Checkout);
        assert_eq!(kind_of(None, true, Path::new(r"C:\Program Files\Markdown Notes\mdview.exe"), true, false), Install::Checkout);
        assert_eq!(kind_of(Some(OsStr::new("/a/M.AppImage")), false, Path::new("/tmp/.mount_x/usr/bin/mdview"), false, true), Install::Checkout);
        // an empty APPIMAGE is none
        assert_eq!(kind_of(Some(OsStr::new("")), false, Path::new("/opt/mdview/mdview"), false, false), Install::Checkout);
        assert!(!Install::Checkout.updates_itself() && !Install::Package.updates_itself());
    }

    #[test]
    fn a_deb_or_rpm_is_only_told() {
        assert_eq!(kind_of(None, false, Path::new("/usr/bin/mdview"), false, false), Install::Package);
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert!(newer("0.1.5", "0.1.4"));
        assert!(newer("v0.2.0", "0.1.9"));
        assert!(newer("0.1.10", "0.1.9"));
        assert!(newer("1.0", "0.9.9"));
        assert!(newer("0.2.0", "0.2.0-beta.1"));
        assert!(!newer("0.1.4", "0.1.4"));
        assert!(!newer("0.1.3", "0.1.4"));
        assert!(!newer("0.2.0-beta.1", "0.2.0"));
        assert!(!newer("garbage", "0.1.4"));
        assert!(!newer("", "0.1.4"));
    }

    #[test]
    fn whats_new_is_the_release_page() {
        assert_eq!(notes_url("0.1.5"), "https://github.com/henriSchulz/mdview/releases/tag/v0.1.5");
    }
}
