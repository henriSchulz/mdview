//! Markdown Notes (mdview) — notes in plain Markdown: read, write, formulas, PDFs.
//!
//! This is the shell: windows, files, the folder scan, tabs and history, the theme. The
//! surface is the page (viewer.js and friends), unchanged in a web view; it is told things by
//! MdView.render(payload) and friends and talks back through MdHost.post (JSON strings).
//!
//! The page and everything it shows come over one protocol of the app's own:
//!
//!   md://localhost/shell/<window>/<n>   the window's page, written here
//!   md://localhost/app/<file>           the page's scripts and styles (the checkout, or the bundle)
//!   md://localhost/file/<path>          files on disk: pictures, sound, film beside a note
//!
//! Everything a window does happens on one thread of its own (shell.rs), so reading a large
//! folder never holds up the window.

#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

mod ai;
mod history;
mod host;
mod scan;
mod shell;
mod sync;
mod theme;

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{LazyLock, Mutex};

use serde_json::Value;
use tauri::http::{header, Response, StatusCode};

/// What the shell's thread is told, one after the other.
pub enum Event {
    /// started, or started again while running: files and folders to open (none: the last folder)
    Open { args: Vec<String>, cwd: String },
    /// the page said something
    Msg { label: String, json: String },
    Loaded { label: String, url: String },
    /// the page was about to go somewhere else
    Link { label: String, href: String },
    Fs { label: String, paths: Vec<PathBuf> },
    Reload { label: String, turn: u64 },
    Rescan { label: String, turn: u64 },
    CloseNow { label: String, turn: u64 },
    CloseRequested { label: String },
    Closed { label: String },
    Crashed { label: String },
    Picked { label: String, what: Pick, path: Option<PathBuf> },
    Completion { label: String, id: Value, text: Option<String>, error: Option<String> },
    Graphic { label: String, id: Value, svg: Option<String>, error: Option<String> },
    ThemeChanged,
    ApplyTheme { turn: u64 },
    MotionChanged,
    Idle { turn: u64 },
    /// a project has been quiet since it was last touched: time for its snapshot
    Snapshot { root: PathBuf, turn: u64 },
    /// asked: the page's doing (projects taken in), so what went wrong is said, and the folder told anew
    Snapshotted { root: PathBuf, kept: bool, skipped: Vec<String>, error: Option<String>, asked: bool },
}

#[derive(Clone, Copy)]
pub enum Pick {
    File,
    Folder,
    Reference,
}

#[cfg(not(windows))]
pub const ORIGIN: &str = "md://localhost";
#[cfg(windows)]
pub const ORIGIN: &str = "http://md.localhost";

/// What the protocol's side and the shell's thread both see.
pub struct Shared {
    pub pages: Mutex<HashMap<String, String>>, // window -> its page
    pub blank: Mutex<String>,                  // a window that has no page yet
    pub assets: PathBuf,
}

pub static SHARED: LazyLock<Shared> = LazyLock::new(|| Shared { pages: Mutex::default(), blank: Mutex::default(), assets: find_assets() });

/// Where the page's files are: named (tests), the checkout this was built from (so a change to
/// the page needs no build), or beside the program, where a bundle puts them.
fn find_assets() -> PathBuf {
    let has = |d: &Path| d.join("viewer.js").is_file();
    if let Some(d) = std::env::var_os("MDVIEW_ASSETS").map(PathBuf::from).filter(|d| has(d)) {
        return d;
    }
    let exe = std::env::current_exe().ok().and_then(|p| std::fs::canonicalize(p).ok());
    let beside = exe.as_deref().and_then(Path::parent).map(Path::to_path_buf).unwrap_or_default();
    let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf).unwrap_or_default();
    let found = [checkout.clone(), beside.clone(), beside.join("../lib/mdview"), beside.join("../lib/Markdown Notes"), beside.join("../Resources")].into_iter().find(|d| has(d));
    found.map(|d| std::fs::canonicalize(&d).unwrap_or(d)).unwrap_or(checkout)
}

fn mime(path: &Path) -> &'static str {
    match scan::ext_of(path).as_str() {
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "md" | "markdown" | "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).unwrap()
}

fn html(text: String) -> Response<Vec<u8>> {
    Response::builder().header(header::CONTENT_TYPE, "text/html; charset=utf-8").header(header::CACHE_CONTROL, "no-store").body(text.into_bytes()).unwrap()
}

/// A file, or the part of it that was asked for (sound and film are read in pieces).
fn file(path: &Path, range: Option<&str>) -> Response<Vec<u8>> {
    let Ok(mut f) = std::fs::File::open(path) else { return plain(StatusCode::NOT_FOUND) };
    let Ok(meta) = f.metadata() else { return plain(StatusCode::NOT_FOUND) };
    if !meta.is_file() {
        return plain(StatusCode::NOT_FOUND);
    }
    let size = meta.len();
    let res = Response::builder().header(header::CONTENT_TYPE, mime(path)).header(header::CACHE_CONTROL, "no-store").header(header::ACCEPT_RANGES, "bytes");
    let asked = range.and_then(|r| r.strip_prefix("bytes=")).and_then(|r| r.split_once('-')).and_then(|(a, b)| {
        let last = size.checked_sub(1)?;
        match (a.trim().parse::<u64>().ok(), b.trim().parse::<u64>().ok()) {
            (Some(a), b) if a <= last => Some((a, b.unwrap_or(last).min(last))),
            (None, Some(n)) if n > 0 => Some((size.saturating_sub(n), last)), // (the last n bytes)
            _ => None,
        }
    });
    let mut body = Vec::new();
    match asked {
        Some((a, b)) if a <= b => {
            if f.seek(SeekFrom::Start(a)).is_err() || f.take(b - a + 1).read_to_end(&mut body).is_err() {
                return plain(StatusCode::INTERNAL_SERVER_ERROR);
            }
            res.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, format!("bytes {a}-{b}/{size}")).body(body).unwrap()
        }
        _ => match f.read_to_end(&mut body) {
            Ok(_) => res.body(body).unwrap(),
            Err(_) => plain(StatusCode::INTERNAL_SERVER_ERROR),
        },
    }
}

fn serve(path: &str, range: Option<&str>) -> Response<Vec<u8>> {
    if let Some(rest) = path.strip_prefix("/shell/") {
        let label = rest.split('/').next().unwrap_or("");
        let page = SHARED.pages.lock().unwrap().get(label).cloned();
        return html(page.unwrap_or_else(|| SHARED.blank.lock().unwrap().clone()));
    }
    if let Some(rel) = path.strip_prefix("/app/") {
        let rel = Path::new(rel);
        if rel.components().all(|c| matches!(c, Component::Normal(_))) {
            return file(&SHARED.assets.join(rel), range);
        }
        return plain(StatusCode::FORBIDDEN);
    }
    if let Some(rest) = path.strip_prefix("/file") {
        return file(Path::new(if cfg!(windows) { rest.trim_start_matches('/') } else { rest }), range);
    }
    plain(StatusCode::NOT_FOUND)
}

#[tauri::command]
fn msg(window: tauri::WebviewWindow, tx: tauri::State<'_, Sender<Event>>, json: String) {
    let _ = tx.send(Event::Msg { label: window.label().to_string(), json });
}

fn main() {
    let (tx, rx) = std::sync::mpsc::channel::<Event>();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().map(|d| scan::s(&d)).unwrap_or_default();
    let _ = tx.send(Event::Open { args, cwd });

    // (what the desktop knows the app's windows by: the desktop entry's StartupWMClass)
    #[cfg(target_os = "linux")]
    gtk::glib::set_prgname(Some("dev.henri.MdView"));

    let again = tx.clone();
    let events = tx.clone();
    let start = Mutex::new(Some((tx.clone(), rx)));
    let app = tauri::Builder::default()
        // (first of all: a second start hands its files to the running one and is gone)
        .plugin(tauri_plugin_single_instance::init(move |_app, argv, cwd| {
            let _ = again.send(Event::Open { args: argv.into_iter().skip(1).collect(), cwd });
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(tx)
        .invoke_handler(tauri::generate_handler![msg])
        .register_asynchronous_uri_scheme_protocol("md", |_ctx, request, responder| {
            let path = scan::unquote(request.uri().path());
            let range = request.headers().get(header::RANGE).and_then(|r| r.to_str().ok()).map(String::from);
            if path.starts_with("/shell/") {
                responder.respond(serve(&path, None));
            } else {
                std::thread::spawn(move || responder.respond(serve(&path, range.as_deref())));
            }
        })
        .on_window_event(move |window, event| {
            let label = window.label().to_string();
            match event {
                // (whether it may go is the shell's to say: the page may have text to hand over)
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = events.send(Event::CloseRequested { label });
                }
                tauri::WindowEvent::Destroyed => {
                    let _ = events.send(Event::Closed { label });
                }
                _ => {}
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Some((tx, rx)) = start.lock().unwrap().take() {
                std::thread::spawn(move || shell::run(handle, tx, rx));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("mdview could not start");
    app.run(|_app, event| {
        // Stays resident for a while after the last window closes, so reopening is instant;
        // the shell ends the process itself (Event::Idle).
        if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
