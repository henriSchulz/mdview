//! What the shell asks of the system it runs on: the clipboard, the web view's own settings,
//! other applications. Linux (GTK + WebKitGTK) has all of it; elsewhere the parts that have
//! no portable form yet say so by doing nothing.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;
use tauri::{AppHandle, WebviewWindow};

/// Runs f on the window system's thread and hands back what it returns.
pub fn on_main<R: Send + 'static>(handle: &AppHandle, f: impl FnOnce() -> R + Send + 'static) -> Option<R> {
    let (tx, rx) = std::sync::mpsc::channel();
    handle.run_on_main_thread(move || { let _ = tx.send(f()); }).ok()?;
    rx.recv().ok()
}

fn spawn(cmd: &str, args: &[&str]) -> bool {
    let mut c = Command::new(cmd);
    c.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    c.spawn().is_ok()
}

/// The file in the editor the desktop has for it.
pub fn open_in_editor(path: &Path) {
    let p = path.to_string_lossy();
    if cfg!(target_os = "linux") && spawn("omarchy-launch-editor", &[&p]) {
        return;
    }
    launch_path(path);
}

#[cfg(not(target_os = "linux"))]
pub fn launch_uri(uri: &str) {
    if cfg!(target_os = "macos") {
        spawn("open", &[uri]);
    } else {
        // (not through the command line's own interpreter: an address is text from a note, and
        // "&" in it would be the next command — the shell's handler takes it as one argument)
        spawn("rundll32", &["url.dll,FileProtocolHandler", uri]);
    }
}

#[cfg(not(target_os = "linux"))]
pub fn launch_path(path: &Path) {
    if cfg!(target_os = "macos") {
        spawn("open", &[&path.to_string_lossy()]);
    } else {
        spawn("explorer", &[&path.to_string_lossy()]);
    }
}

#[cfg(target_os = "linux")]
pub use linux::*;
#[cfg(not(target_os = "linux"))]
pub use other::*;

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use gtk::prelude::*;
    use gtk::{gdk, gio, glib};
    use webkit2gtk::{CacheModel, ContextMenuAction, ContextMenuExt, ContextMenuItemExt, LoadEvent, SettingsExt, SnapshotOptions, SnapshotRegion, WebContextExt, WebViewExt};

    // clipboard formats kept as they are when pasted; anything else is saved as PNG
    const PASTE_MIME: &[(&str, &str)] =
        &[("image/png", ".png"), ("image/jpeg", ".jpg"), ("image/webp", ".webp"), ("image/gif", ".gif"), ("image/avif", ".avif"), ("image/svg+xml", ".svg")];

    fn clipboard() -> gtk::Clipboard {
        gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD)
    }

    /// The web view as the app wants it: its fonts, no gestures of its own, the page's menu
    /// instead of the toolkit's, and two fingers pulled apart handed to the page.
    pub fn setup(window: &WebviewWindow, debug: bool, crashed: impl Fn() + 'static + Send) {
        let page = window.clone();
        let _ = window.with_webview(move |pw| {
            let wv: webkit2gtk::WebView = pw.inner();
            if let Some(s) = WebViewExt::settings(&wv) {
                s.set_enable_smooth_scrolling(true);
                s.set_enable_developer_extras(debug);
                s.set_enable_write_console_messages_to_stdout(debug);
                s.set_javascript_can_open_windows_automatically(false);
                s.set_enable_page_cache(false);
                s.set_enable_back_forward_navigation_gestures(false);
                s.set_default_font_family("Inter");
                s.set_sans_serif_font_family("Inter");
                s.set_monospace_font_family("JetBrainsMono Nerd Font");
                s.set_default_font_size(16);
                s.set_default_monospace_font_size(14);
            }
            if let Some(ctx) = wv.context() {
                ctx.set_cache_model(CacheModel::DocumentViewer);
            }
            // Two fingers pulled apart on a touchpad are the PDF viewer's (pdfview.js pinch): the
            // page as a whole has one size. Taken here, before the web view makes a zoom of its
            // own of them.
            wv.add_events(gdk::EventMask::TOUCHPAD_GESTURE_MASK);
            let pinch = gtk::GestureZoom::new(&wv);
            pinch.set_propagation_phase(gtk::PropagationPhase::Capture);
            let to = page.clone();
            pinch.connect_begin(move |g, _| {
                g.set_state(gtk::EventSequenceState::Claimed);
                let _ = to.eval("MdView.pinch(\"begin\",1)");
            });
            let to = page.clone();
            pinch.connect_scale_changed(move |_, scale| {
                let _ = to.eval(format!("MdView.pinch(\"move\",{scale})"));
            });
            std::mem::forget(pinch); // (lives as long as the window; nothing else holds it)
            wv.connect_context_menu(move |_wv, menu, event, _hit| {
                let mut keep = vec![
                    ContextMenuAction::Copy,
                    ContextMenuAction::CopyLinkToClipboard,
                    ContextMenuAction::CopyImageToClipboard,
                    ContextMenuAction::CopyImageUrlToClipboard,
                    ContextMenuAction::SelectAll,
                    ContextMenuAction::Cut,
                    ContextMenuAction::Paste,
                ];
                if debug {
                    keep.push(ContextMenuAction::InspectElement);
                }
                for item in menu.items() {
                    if !keep.contains(&item.stock_action()) {
                        menu.remove(&item);
                    }
                }
                // The page shows a menu of its own for text (viewer.js, #textmenu); the toolkit's
                // is only for a test build's Inspect, with Shift held.
                let shift = debug && event.state().is_some_and(|s| s.contains(gdk::ModifierType::SHIFT_MASK));
                !shift || menu.n_items() == 0
            });
            wv.connect_web_process_terminated(move |_, _| crashed());
            // Until its first page is drawn, the web view is not: the window shows its own colour.
            // What the GPU path hands over before the page has painted is a buffer nobody wrote
            // to — on some drivers a magenta one, for as long as the page takes. The page says
            // when it is drawn (show_view); one that says nothing is shown a moment after loading.
            wv.set_opacity(0.0);
            wv.connect_load_changed(move |wv, ev| {
                if ev == LoadEvent::Finished {
                    let wv = wv.clone();
                    glib::timeout_add_local_once(std::time::Duration::from_millis(500), move || wv.set_opacity(1.0));
                }
            });
        });
    }

    /// The web view drawn again: its page has painted (see setup).
    pub fn show_view(window: &WebviewWindow) {
        let _ = window.with_webview(|pw| pw.inner().set_opacity(1.0));
    }

    /// Cut, Copy, Paste, SelectAll: run where the focus is, as the key would.
    pub fn edit_command(window: &WebviewWindow, cmd: &str) {
        let cmd = cmd.to_string();
        let _ = window.with_webview(move |pw| pw.inner().execute_editing_command(&cmd));
    }

    pub fn copy_text(handle: &AppHandle, text: String) {
        on_main(handle, move || {
            let cb = clipboard();
            cb.set_text(&text);
            cb.store();
        });
    }

    pub fn clipboard_text(handle: &AppHandle) -> Option<String> {
        on_main(handle, || clipboard().wait_for_text().map(|t| t.to_string())).flatten().filter(|t| !t.is_empty())
    }

    pub fn clipboard_html(handle: &AppHandle) -> String {
        on_main(handle, || {
            let data = clipboard().wait_for_contents(&gdk::Atom::intern("text/html")).map(|sel| sel.data()).unwrap_or_default();
            match data.get(..2) {
                Some([0xff, 0xfe]) => String::from_utf16_lossy(&data[2..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>()),
                Some([0xfe, 0xff]) => String::from_utf16_lossy(&data[2..].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<_>>()),
                _ => String::from_utf8_lossy(&data).into_owned(),
            }
        })
        .unwrap_or_default()
    }

    /// The image on the clipboard as (bytes, file extension), or None.
    pub fn clipboard_image(handle: &AppHandle) -> Option<(Vec<u8>, &'static str)> {
        on_main(handle, || {
            let cb = clipboard();
            let have: Vec<String> = cb.wait_for_targets().unwrap_or_default().iter().map(|a| a.name().to_string()).collect();
            for (mime, ext) in PASTE_MIME {
                if have.iter().any(|h| h == mime) {
                    let data = cb.wait_for_contents(&gdk::Atom::intern(mime)).map(|sel| sel.data()).unwrap_or_default();
                    if !data.is_empty() {
                        return Some((data, *ext));
                    }
                }
            }
            if cb.wait_is_image_available() {
                if let Some(data) = cb.wait_for_image().and_then(|px| px.save_to_bufferv("png", &[]).ok()) {
                    return Some((data, ".png"));
                }
            }
            None
        })
        .flatten()
    }

    /// A picture, by its file, onto the clipboard.
    pub fn copy_image_file(handle: &AppHandle, path: &Path) -> bool {
        let path = path.to_path_buf();
        on_main(handle, move || match gdk::gdk_pixbuf::Pixbuf::from_file(&path) {
            Ok(px) => {
                let cb = clipboard();
                cb.set_image(&px);
                cb.store();
                true
            }
            Err(_) => false,
        })
        .unwrap_or(false)
    }

    /// A part of the page (page coordinates of what is on screen) as a picture on the
    /// clipboard: a formula copied as a picture. The page is told how it went.
    pub fn snapshot(window: &WebviewWindow, rect: [f64; 4], said: String, keep: Option<std::path::PathBuf>) {
        let page = window.clone();
        let _ = window.with_webview(move |pw| {
            let wv = pw.inner();
            let zoom = wv.zoom_level();
            let toast = move |text: &str| {
                let _ = page.eval(format!("MdView.toast({})", Value::from(text)));
            };
            wv.snapshot(SnapshotRegion::Visible, SnapshotOptions::NONE, None::<&gio::Cancellable>, move |res| {
                let [x, y, w, h] = rect;
                let pad = 6.0;
                let px = res.ok().and_then(|surface| {
                    gdk::pixbuf_get_from_surface(
                        &surface,
                        (((x - pad) * zoom) as i32).max(0),
                        (((y - pad) * zoom) as i32).max(0),
                        ((w + 2.0 * pad) * zoom) as i32,
                        ((h + 2.0 * pad) * zoom) as i32,
                    )
                });
                let Some(px) = px else { return toast("Couldn't copy the picture") };
                clipboard().set_image(&px);
                if let Some(dir) = keep {
                    let _ = px.savev(dir.join("snapshot.png"), "png", &[]);
                }
                toast(&said);
            });
        });
    }

    /// (tests) a real pointer event at page coordinates: what a click does that script cannot do
    pub fn pointer(window: &WebviewWindow, msg: &Value) {
        let kind = match msg["kind"].as_str() {
            Some("down") => gdk::ffi::GDK_BUTTON_PRESS,
            Some("up") => gdk::ffi::GDK_BUTTON_RELEASE,
            Some("move") => gdk::ffi::GDK_MOTION_NOTIFY,
            _ => return,
        };
        let (x, y) = (msg["x"].as_f64().unwrap_or(0.0), msg["y"].as_f64().unwrap_or(0.0));
        let button = msg["button"].as_u64().unwrap_or(1) as u32;
        let truthy = |v: &Value| !matches!(v, Value::Null | Value::Bool(false));
        let (held, ctrl) = (truthy(&msg["held"]), truthy(&msg["ctrl"]));
        let _ = window.with_webview(move |pw| {
            let wv = pw.inner();
            let Some(win) = wv.window() else { return };
            let zoom = wv.zoom_level();
            let (x, y) = (x * zoom, y * zoom);
            let (ox, oy) = win.root_coords(x as i32, y as i32);
            let time = match gtk::current_event_time() {
                0 => (glib::monotonic_time() / 1000) as u32,
                t => t,
            };
            let mut state = 0;
            if ctrl {
                state |= gdk::ffi::GDK_CONTROL_MASK; // (with Ctrl held)
            }
            unsafe {
                let ev = gdk::ffi::gdk_event_new(kind);
                let win_ptr: *mut gdk::ffi::GdkWindow = glib::translate::ToGlibPtr::to_glib_full(&win);
                if kind == gdk::ffi::GDK_MOTION_NOTIFY {
                    let m = ev as *mut gdk::ffi::GdkEventMotion;
                    (*m).window = win_ptr;
                    (*m).send_event = 1;
                    (*m).time = time;
                    (*m).x = x;
                    (*m).y = y;
                    (*m).x_root = ox as f64;
                    (*m).y_root = oy as f64;
                    if held {
                        state |= gdk::ffi::GDK_BUTTON1_MASK; // (the pointer moved with its button down: a drag)
                    }
                    (*m).state = state;
                } else {
                    let b = ev as *mut gdk::ffi::GdkEventButton;
                    (*b).window = win_ptr;
                    (*b).send_event = 1;
                    (*b).time = time;
                    (*b).x = x;
                    (*b).y = y;
                    (*b).x_root = ox as f64;
                    (*b).y_root = oy as f64;
                    (*b).button = button;
                    (*b).state = state;
                }
                if let Some(device) = gdk::Display::default().and_then(|d| d.default_seat()).and_then(|s| s.pointer()) {
                    gdk::ffi::gdk_event_set_device(ev, glib::translate::ToGlibPtr::to_glib_none(&device).0);
                }
                gtk::ffi::gtk_widget_event(glib::translate::ToGlibPtr::to_glib_none(wv.upcast_ref::<gtk::Widget>()).0, ev);
                gdk::ffi::gdk_event_free(ev);
            }
        });
    }

    pub fn launch_uri(uri: &str) {
        if gio::AppInfo::launch_default_for_uri(uri, None::<&gio::AppLaunchContext>).is_err() {
            spawn("xdg-open", &[uri]);
        }
    }

    pub fn launch_path(path: &Path) {
        launch_uri(&gio::File::for_path(path).uri());
    }

    /// Ask xdg-desktop-portal which application should open the file (OpenURI with ask): the
    /// desktop's own chooser answers — Finder's — and launches the choice itself. False when
    /// there is no portal.
    pub fn open_with(path: &Path) -> bool {
        let call = || -> Result<(), glib::Error> {
            let bus = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>)?;
            let file = std::fs::File::open(path).map_err(|e| glib::Error::new(gio::IOErrorEnum::Failed, &e.to_string()))?;
            let fds = gio::UnixFDList::new();
            let index = fds.append(file)?;
            let args = glib::Variant::parse(None, &format!("('', handle {index}, {{'ask': <true>}})"))?;
            bus.call_with_unix_fd_list_sync(
                Some("org.freedesktop.portal.Desktop"),
                "/org/freedesktop/portal/desktop",
                "org.freedesktop.portal.OpenURI",
                "OpenFile",
                Some(&args),
                None,
                gio::DBusCallFlags::NONE,
                5000,
                Some(&fds),
                None::<&gio::Cancellable>,
            )?;
            Ok(())
        };
        call().is_ok()
    }

    /// Show the file in the file manager (org.freedesktop.FileManager1 — Finder here). On the
    /// session's own bus; a test instance has a bus of its own, so the user's is tried too.
    pub fn reveal(path: &Path) {
        let file = gio::File::for_path(path);
        let args = (vec![file.uri().to_string()], "").to_variant();
        let mut buses = Vec::new();
        if let Ok(bus) = gio::bus_get_sync(gio::BusType::Session, None::<&gio::Cancellable>) {
            buses.push(bus);
        }
        let socket = format!("/run/user/{}/bus", unsafe { libc::getuid() });
        let user_bus = format!("unix:path={socket}");
        let own = std::env::var("DBUS_SESSION_BUS_ADDRESS").unwrap_or_default();
        if own.split(',').next() != Some(user_bus.as_str()) && Path::new(&socket).exists() {
            let flags = gio::DBusConnectionFlags::AUTHENTICATION_CLIENT | gio::DBusConnectionFlags::MESSAGE_BUS_CONNECTION;
            if let Ok(bus) = gio::DBusConnection::for_address_sync(&user_bus, flags, None::<&gio::DBusAuthObserver>, None::<&gio::Cancellable>) {
                buses.insert(0, bus);
            }
        }
        for bus in buses {
            let shown = bus.call_sync(
                Some("org.freedesktop.FileManager1"),
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1",
                "ShowItems",
                Some(&args),
                None,
                gio::DBusCallFlags::NONE,
                5000,
                None::<&gio::Cancellable>,
            );
            if shown.is_ok() {
                return;
            }
        }
        // (no file manager answers: its folder, at least)
        if let Some(parent) = path.parent() {
            launch_path(parent);
        }
    }

    /// Whether the font the app's signs are set in is installed.
    pub fn has_font(family: &str) -> bool {
        Command::new("fc-list").args([":", "family"]).output().is_ok_and(|out| String::from_utf8_lossy(&out.stdout).lines().any(|l| l.split(',').any(|f| f.trim() == family)))
    }

    /// Text drawn on whole pixels: the app's own choice, not the desktop's.
    pub fn hinting(handle: &AppHandle) {
        on_main(handle, || {
            if let Some(s) = gtk::Settings::default() {
                s.set_property("gtk-xft-hintstyle", "hintfull");
            }
        });
    }
}

#[cfg(not(target_os = "linux"))]
mod other {
    use super::*;

    pub fn setup(_window: &WebviewWindow, _debug: bool, _crashed: impl Fn() + 'static + Send) {}

    pub fn show_view(_window: &WebviewWindow) {}

    pub fn edit_command(window: &WebviewWindow, cmd: &str) {
        let name = match cmd {
            "SelectAll" => "selectAll".to_string(),
            c => c.to_lowercase(),
        };
        let _ = window.eval(format!("document.execCommand({})", Value::from(name)));
    }

    pub fn copy_text(_handle: &AppHandle, text: String) {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.set_text(text);
        }
    }

    pub fn clipboard_text(_handle: &AppHandle) -> Option<String> {
        arboard::Clipboard::new().ok()?.get_text().ok().filter(|t| !t.is_empty())
    }

    pub fn clipboard_html(_handle: &AppHandle) -> String {
        String::new()
    }

    pub fn clipboard_image(_handle: &AppHandle) -> Option<(Vec<u8>, &'static str)> {
        None
    }

    pub fn copy_image_file(_handle: &AppHandle, _path: &Path) -> bool {
        false
    }

    pub fn snapshot(window: &WebviewWindow, _rect: [f64; 4], _said: String, _keep: Option<std::path::PathBuf>) {
        let _ = window.eval("MdView.toast(\"Couldn't copy the picture\")");
    }

    pub fn pointer(_window: &WebviewWindow, _msg: &Value) {}

    pub fn open_with(_path: &Path) -> bool {
        false
    }

    pub fn reveal(path: &Path) {
        let p = path.to_string_lossy();
        if cfg!(target_os = "macos") {
            spawn("open", &["-R", &p]);
        } else {
            spawn("explorer", &[&format!("/select,{p}")]);
        }
    }

    pub fn has_font(_family: &str) -> bool {
        false
    }

    pub fn hinting(_handle: &AppHandle) {}
}
