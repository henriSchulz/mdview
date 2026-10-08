//! Colours follow the Omarchy theme. Where there is none (another desktop, another system)
//! the light fallback holds. Motion and sizes are the app's own (motion.css, viewer.css).

use std::fs;
use std::path::PathBuf;


const THEME_KEYS: &[&str] = &[
    "background", "foreground", "accent", "muted", "selection", "red", "green", "yellow", "orange", "blue", "cyan",
    "magenta", "brown", "bright_red", "bright_green", "bright_yellow", "bright_blue", "bright_magenta", "bright_cyan",
];
/// Without a theme of the desktop's (another desktop, another system) the app has two of its own,
/// the web app's: a light one and a dark one of the same hues — the one the system asks for.
const LIGHT_FALLBACK: &[(&str, &str)] = &[
    ("background", "#f5f5f7"), ("foreground", "#1d1d1f"), ("accent", "#0071e3"), ("muted", "#a1a1a6"), ("selection", "#b4d5fe"),
    ("red", "#d70015"), ("green", "#248a3d"), ("yellow", "#a05a00"), ("orange", "#c93400"), ("blue", "#0071e3"), ("cyan", "#0071a4"),
    ("magenta", "#8944ab"), ("brown", "#7f6545"), ("bright_red", "#ff3b30"), ("bright_green", "#34c759"), ("bright_yellow", "#d18b00"),
    ("bright_blue", "#0a84ff"), ("bright_magenta", "#af52de"), ("bright_cyan", "#30b0c7"),
];
const DARK_FALLBACK: &[(&str, &str)] = &[
    ("background", "#1e1e20"), ("foreground", "#f5f5f7"), ("accent", "#0a84ff"), ("muted", "#6e6e73"), ("selection", "#3a5f8f"),
    ("red", "#ff453a"), ("green", "#32d74b"), ("yellow", "#ffd60a"), ("orange", "#ff9f0a"), ("blue", "#0a84ff"), ("cyan", "#64d2ff"),
    ("magenta", "#bf5af2"), ("brown", "#ac8e68"), ("bright_red", "#ff6961"), ("bright_green", "#4cd964"), ("bright_yellow", "#ffe066"),
    ("bright_blue", "#409cff"), ("bright_magenta", "#da8fff"), ("bright_cyan", "#70d7ff"),
];

/// Whether the system is set to a dark appearance — asked where there is no theme to say so.
fn system_dark() -> bool {
    use std::process::Command;
    let said = |cmd: &str, args: &[&str]| Command::new(cmd).args(args).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase()).unwrap_or_default();
    if cfg!(target_os = "macos") {
        said("defaults", &["read", "-g", "AppleInterfaceStyle"]).contains("dark")
    } else if cfg!(windows) {
        // (AppsUseLightTheme: 0x0 is dark)
        said("reg", &["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "/v", "AppsUseLightTheme"]).contains("0x0")
    } else {
        said("gsettings", &["get", "org.gnome.desktop.interface", "color-scheme"]).contains("dark")
    }
}
pub struct Theme {
    pub mode: String,
    pub colors: Vec<(String, String)>,
}

impl Theme {
    pub fn color(&self, key: &str) -> &str {
        self.colors.iter().find(|(k, _)| k == key).map_or("#ffffff", |(_, v)| v.as_str())
    }

    /// The window's own colour, as (r, g, b).
    pub fn background(&self) -> (u8, u8, u8) {
        rgb(self.color("background")).unwrap_or((255, 255, 255))
    }
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

pub fn theme_dir() -> PathBuf {
    // (the override: for tests)
    std::env::var_os("MDVIEW_THEME_DIR").filter(|d| !d.is_empty()).map(PathBuf::from).unwrap_or_else(|| home().join(".local/state/omarchy/current"))
}

fn rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.trim_start_matches('#');
    let part = |i: usize| h.get(i..i + 2).and_then(|x| u8::from_str_radix(x, 16).ok());
    Some((part(0)?, part(2)?, part(4)?))
}

fn luminance(hex: &str) -> f64 {
    match rgb(hex) {
        Some((r, g, b)) => 0.2126 * (r as f64 / 255.0) + 0.7152 * (g as f64 / 255.0) + 0.0722 * (b as f64 / 255.0),
        None => 1.0,
    }
}

pub fn load_theme() -> Theme {
    let data: toml::Table = fs::read_to_string(theme_dir().join("theme/colors.toml")).ok().and_then(|t| t.parse().ok()).unwrap_or_default();
    // (what the theme does not name is the fallback's: the dark one under a dark ground, or — no theme at all — a dark system)
    let dark = match data.get("mode").and_then(|m| m.as_str()) {
        Some("dark") => true,
        Some("light") => false,
        _ => match data.get("background").and_then(|v| v.as_str()) {
            Some(bg) => luminance(bg) <= 0.5,
            None => system_dark(),
        },
    };
    let mut colors: Vec<(String, String)> = if dark { DARK_FALLBACK } else { LIGHT_FALLBACK }.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    for key in THEME_KEYS {
        if let Some(v) = data.get(*key).and_then(|v| v.as_str()) {
            match colors.iter_mut().find(|(k, _)| k == key) {
                Some(slot) => slot.1 = v.to_string(),
                None => colors.push((key.to_string(), v.to_string())),
            }
        }
    }
    let mut theme = Theme { mode: String::new(), colors };
    theme.mode = match data.get("mode").and_then(|m| m.as_str()) {
        Some(m @ ("light" | "dark")) => m.to_string(),
        _ => if luminance(theme.color("background")) > 0.5 { "light" } else { "dark" }.to_string(),
    };
    theme
}

pub fn theme_css(theme: &Theme) -> String {
    let body: Vec<String> = theme.colors.iter().map(|(k, v)| format!("--c-{}:{v}", k.replace('_', "-"))).collect();
    format!(":root{{{};color-scheme:{}}}", body.join(";"), theme.mode)
}
