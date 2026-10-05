//! Colours follow the Omarchy theme. Where there is none (another desktop, another system)
//! the light fallback holds. Motion and sizes are the app's own (motion.css, viewer.css).

use std::fs;
use std::path::PathBuf;


const THEME_KEYS: &[&str] = &[
    "background", "foreground", "accent", "muted", "selection", "red", "green", "yellow", "orange", "blue", "cyan",
    "magenta", "brown", "bright_red", "bright_green", "bright_yellow", "bright_blue", "bright_magenta", "bright_cyan",
];
const LIGHT_FALLBACK: &[(&str, &str)] =
    &[("background", "#ffffff"), ("foreground", "#1d1d1f"), ("accent", "#0071e3"), ("muted", "#8e8e93"), ("selection", "#b4d5fe")];
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
    let mut colors: Vec<(String, String)> = LIGHT_FALLBACK.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
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
