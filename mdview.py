#!/usr/bin/env python3
"""Markdown Notes (mdview) — notes in plain Markdown: read, write, formulas, PDFs (GTK 3 + WebKit).

Renders CommonMark/GFM plus Obsidian syntax (wikilinks, embeds, callouts,
properties, ==highlight==, %%comments%%, #tags), KaTeX math, Mermaid and
highlighted code. Works on any file, no vault needed. Stays resident for a
while after the last window closes so reopening is instant.

Ctrl+E switches between reading and editing the source in place; edits are
saved automatically (the page sends the text, this side writes the file).
Ctrl+V with an image on the clipboard saves it as a file and embeds it: at the
caret while editing, at the end of the note while reading.

Opened on a folder (or started without arguments, which reopens the last
folder) the window gets a sidebar listing the folder's notes, by file name or
by title (first H1), and can create, rename and trash them.

Assets live next to the real path of this script; bin/mdview is a thin
launcher that hands files to a running instance over D-Bus.
Colors follow the Omarchy theme, motion follows ~/.local/share/henri-ui, the
sizes of sidebar and menus ~/.local/share/apple-ui.
"""

import base64
import html
import http.client
import shutil
import tempfile
import threading
import json
import os
import re
import secrets
import subprocess
import sys
import time
import tomllib
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2  # noqa: E402

APP_ID = "dev.henri.MdView"
HOME = Path.home()
SOURCE = Path(os.path.realpath(__file__))
ASSETS = SOURCE.parent
SOURCE_STAMP = SOURCE.stat().st_mtime_ns
THEME_DIR = Path(os.environ.get("MDVIEW_THEME_DIR") or HOME / ".local/state/omarchy/current")  # (the override: for tests)
MOTION_CSS = HOME / ".local/share/henri-ui/motion.css"
APPLE_CSS = HOME / ".local/share/apple-ui/apple.css"   # sizes and radii measured on macOS (sidebar, menus)
# The context and "/" menus wear the Things rebuild's dark popover: its tokens, where its launcher
# looks for them too. Without the file the values written in viewer.css hold.
OPENED_LIMIT = 3000   # notes whose last opening is remembered
SF_SYMBOLS = ".SF Symbols Fallback"   # the font the app's signs are set in, where it is installed (viewer.js)
THINGS_TOKENS = "replica/design/tokens.json"
THINGS_DIRS = [Path(d) for d in (os.environ.get("THINGS_DIR"), HOME / ".local/share/things-clone",
                                 HOME / "Projects/things-clone") if d]
STATE_FILE = Path(GLib.get_user_state_dir()) / "mdview" / "state.json"
DEBUG = bool(os.environ.get("MDVIEW_DEBUG"))
# Development: a script evaluated in every page once it has rendered; what it
# posts as {"type": "probe", "name": …, "text": …} is written into the directory
# MDVIEW_PROBE_OUT as <file name>.<name>.json. See dev/rig.sh.
PROBE = os.environ.get("MDVIEW_PROBE")
PROBE_OUT = os.environ.get("MDVIEW_PROBE_OUT")
RESIDENT_MS = 15 * 60 * 1000

MD_EXT = {".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdx"}
IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico"}
AUDIO_EXT = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".opus", ".webm"}
VIDEO_EXT = {".mp4", ".mkv", ".mov", ".ogv"}
# clipboard formats kept as they are when pasted; anything else is saved as PNG
PASTE_MIME = (("image/png", ".png"), ("image/jpeg", ".jpg"), ("image/webp", ".webp"),
              ("image/gif", ".gif"), ("image/avif", ".avif"), ("image/svg+xml", ".svg"))
SKIP_DIRS = {"node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"}
WIKI_RE = re.compile(r"!?\[\[([^\[\]\n]+?)\]\]")
EMBED_LIMIT = 256 * 1024
EDIT_LIMIT = 2 * 1024 * 1024
TITLE_SCAN = 16 * 1024    # a note's title (first H1) is looked for this far in
NOTE_LIMIT = 5000         # notes listed in the sidebar at most
PREVIEW_BYTES = 2400      # of a note's beginning, for its tile in the overview
PREVIEW_BATCH = 60        # notes read per request for the overview
WATCH_LIMIT = 400         # directories watched below an open folder
SIDEBAR_WIDTH = 260       # extra default width of a folder window; matches --sb-w
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
H1_RE = re.compile(r"^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$")

# Settings of the active mode (state.json "active"), with what they are when nothing is set.
PREFS = {
    "lang": "en",           # the active mode's own texts: "en" | "de"
    "startMode": "last",    # a new window: "last" (the mode used last) | "read" | "active" | "edit"
    "bar": True,            # the formatting bar over a selection
    "slash": True,          # "/" at the start of an empty line opens the insert menu
    "syntax": False,        # the Markdown of the formatting at the caret shows
    "quotes": False,        # typed quotes become typographic ones
    "wrap": 0,              # paragraphs written anew are wrapped at this many characters (0: not)
    "images": "beside",     # pasted and dropped pictures: "beside" the note | "assets" | a folder relative to the note
    "style": "auto",        # new Markdown: "auto" (as the document does it) | "fixed" (the choices below)
    "bullet": "-", "emphasis": "*", "strongMark": "**", "ordered": ".",
    "dialogWidth": 0, "dialogHeight": 0,  # a dialog's size, once one was pulled to another (0: its own)
    # the formula editor (LaTeX Suite): snippets, "/" makes a fraction, matrix keys, Tab leaves
    # brackets, brackets grow around sums, bracket pairs coloured, "mk" / "dm" in the text
    "latexSnippets": True, "latexFraction": True, "latexMatrix": True, "latexTabout": True,
    "latexEnlarge": True, "latexBrackets": True, "latexText": True,
    # the PDF viewer: what a link to a selection is copied as ("callout" | "quote" | "link" |
    # "embed"), and whether selecting text copies at once
    "pdfFormat": "callout", "pdfAuto": False,
    # what the folder sidebar lists beside the notes: PDFs, pictures, sound and film, everything else
    "sidebarPdf": True, "sidebarImages": False, "sidebarMedia": False, "sidebarOther": False,
    "sidebarSort": "opened",  # the notes of a folder, in the sidebar and the tiles: "opened" (last opened first) | "name" | "modified"
    # a continuation suggested while typing (the text around the caret goes to the model's maker)
    "aiComplete": False,
    "panel": False, "panelTab": "insert",   # the panel at the window's right (insert, format): open, and its tab
    "ovScope": "all", "ovLayout": "tiles",  # all notes: "all" | "folders" (one at a time), as "tiles" | "list"
    "measure": "normal",      # the text column's width: "narrow" | "normal" | "wide" | "full"
    "docZoom": 100,           # the note's text, in percent (Ctrl + and −)
    "hinting": False,         # text drawn on whole pixels (sharper on a screen of ordinary resolution); at the next start
    "aiModel": "",            # the model asked for suggestions ("": AI_MODEL)
}
# snippets of one's own for the formula editor, as Obsidian LaTeX Suite reads them
# ("export default [ … ]"); they take the place of the built-in ones
SNIPPETS_FILE = Path(GLib.get_user_config_dir()) / "mdview" / "snippets.js"


AI_ENV = Path(GLib.get_user_config_dir()) / "mdview" / ".env"
AI_MODEL = "gemini-3.5-flash-lite"
AI_HOST = "generativelanguage.googleapis.com"
AI_SYSTEM = (
    "You are the autocomplete of a note-taking app. The user's note is given with the caret "
    "marked as <caret/>. Reply with the text that continues at the caret and nothing else: at "
    "most twelve words, finishing the current clause or sentence, in the language of the note, "
    "in its tone. Do not repeat text that is already there, do not add quotes or explanations. "
    "If the note uses Markdown or LaTeX there, continue in it; inside a formula ($…$ or $$…$$) "
    "reply with LaTeX only, inside a code span or a fenced code block with code in its "
    "language only. If nothing sensible follows, reply with nothing.")


def ai_key_state():
    """What the settings show of the key: whether there is one, its last four signs, and whether
    it comes from the environment (then the file's is not used). Never the key itself."""
    env = os.environ.get("GEMINI_API_KEY", "").strip()
    key = env or ai_key() or ""
    return {"set": bool(key), "tail": key[-4:] if len(key) > 8 else "", "env": bool(env)}


def store_ai_key(key):
    """Writes GEMINI_API_KEY into ~/.config/mdview/.env (only the user may read it), or takes it
    out; the file's other lines stay."""
    key = re.sub(r"\s", "", key or "")
    try:
        lines = [l for l in AI_ENV.read_text(encoding="utf-8").splitlines() if not l.strip().startswith("GEMINI_API_KEY=")]
    except OSError:
        lines = []
    if key:
        lines.append(f"GEMINI_API_KEY={key}")
    AI_ENV.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(AI_ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + ("\n" if lines else ""))
    os.chmod(AI_ENV, 0o600)


def ai_model():
    """The model asked: the settings' own, if it reads like a model's name, else AI_MODEL."""
    app = Gio.Application.get_default()
    name = app.prefs().get("aiModel", "") if app else ""
    return name if re.fullmatch(r"[A-Za-z0-9._-]{3,80}", name or "") else AI_MODEL


def app_version():
    try:
        out = subprocess.run(["git", "-C", str(SOURCE.parent), "log", "-1", "--format=%h · %cs"], capture_output=True, text=True, timeout=2)
        return out.stdout.strip() or "?"
    except (OSError, subprocess.SubprocessError):
        return "?"


def ai_key():
    """The key for the model: GEMINI_API_KEY from the environment or ~/.config/mdview/.env."""
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()
    try:
        for line in AI_ENV.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    except OSError:
        pass
    return None


class Completer:
    """Asks the model for a continuation, off the main thread — the way GitHub Copilot asks:
    a few questions may be under way at once, each over its own connection that is kept
    open, so that an answer on its way never holds up a newer question. When all are busy,
    only the newest question waits (the page drops answers that no longer fit)."""

    WORKERS = 3

    def __init__(self):
        self.pending = None
        self.cond = threading.Condition()
        self.thinking = True  # (thinkingLevel "minimal": a model that does not know it is asked without)
        for _ in range(self.WORKERS):
            threading.Thread(target=self.run, daemon=True).start()

    def ask(self, reply, ident, before, after):
        with self.cond:
            self.pending = (reply, ident, before, after)
            self.cond.notify()

    def run(self):
        conn = [None]
        while True:
            with self.cond:
                while self.pending is None:
                    self.cond.wait()
                reply, ident, before, after = self.pending
                self.pending = None
            text, error = self.complete(conn, before, after)
            GLib.idle_add(reply, ident, text, error)

    def complete(self, conn, before, after):
        fake = os.environ.get("MDVIEW_AI_FAKE")
        if fake is not None:  # (tests: no network, a known answer)
            time.sleep(0.05)
            return fake, None
        key = ai_key()
        if not key:
            return None, f"No GEMINI_API_KEY in {AI_ENV}"
        for attempt in (0, 1, 2):  # (a connection kept open may have been closed by the other side)
            config = {"maxOutputTokens": 40, "temperature": 0.2, "stopSequences": ["\n"]}
            if self.thinking:
                config["thinkingConfig"] = {"thinkingLevel": "minimal"}
            body = json.dumps({
                "systemInstruction": {"parts": [{"text": AI_SYSTEM}]},
                "contents": [{"role": "user", "parts": [{"text": before + "<caret/>" + after}]}],
                "generationConfig": config,
            })
            try:
                if conn[0] is None:
                    conn[0] = http.client.HTTPSConnection(AI_HOST, timeout=8)
                conn[0].request("POST", f"/v1beta/models/{ai_model()}:generateContent", body,
                                {"Content-Type": "application/json", "x-goog-api-key": key})
                res = conn[0].getresponse()
                data = json.loads(res.read().decode("utf-8", "replace") or "{}")
                if res.status != 200:
                    message = str((data.get("error") or {}).get("message") or res.status)
                    if res.status == 400 and self.thinking and "hinking" in message:
                        self.thinking = False  # (this model is asked without the setting)
                        continue
                    return None, "Suggestions: " + message[:160]
                parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                return "".join(p.get("text", "") for p in parts), None
            except (OSError, http.client.HTTPException, ValueError) as e:
                conn[0] = None
                if attempt == 2:
                    return None, f"Suggestions: {e}"
        return None, None


GRAPHIC_SYSTEM = """You draw technical illustrations as SVG. Reply with one complete SVG document and nothing else — no prose, no code fence.

Style (always):
- Clean, calm line drawing in the manner of a well-typeset textbook. One stroke width (1.6) for everything that is drawn, 1 for hairlines such as dimension or grid lines; round line caps and joins.
- Geometry on an 8-unit grid; wires horizontal or vertical with right angles; symbols aligned; generous, even spacing. Nothing overlaps; labels never touch lines.
- Colour: strokes and text use currentColor. At most one accent colour (#0a84ff) for the one thing the figure is about, and its 12 % tint for fills. No gradients, no shadows, no backgrounds.
- Text: font-family "Inter", system-ui, sans-serif; 13 px for labels, 11 px for secondary text; variables in italics; text-anchor chosen so labels sit centred on or next to what they name. Labels in the language of the request.
- Standard symbols: circuits use IEC symbols (resistor as a rectangle, capacitor as two plates, ground, sources as circles), junction dots where wires join; logic uses the distinctive-shape gates (AND, OR, NOT bubble, XOR) with inputs left and outputs right; RTL and block diagrams use rounded rectangles for modules, trapezoids for multiplexers, a triangle marker for clocked registers, buses as thicker lines with a slash and width; arrows have small filled heads.
- The <svg> has xmlns, a viewBox that fits the drawing with 16 units of margin, width and height attributes equal to the viewBox size, and this first child, exactly:
  <style>:root{color:#1d1d1f}@media (prefers-color-scheme:dark){:root{color:#f5f5f7}}text{font-family:Inter,system-ui,sans-serif;fill:currentColor}</style>
- No scripts, no external references, no images, no foreignObject."""


def find_claude():
    """The claude command line tool: on the PATH, or where its installers put it (an app started
    from the desktop does not always have the shell's PATH)."""
    hit = shutil.which("claude")
    if hit:
        return hit
    for p in ("~/.local/share/mise/installs/claude/latest/claude", "~/.local/bin/claude",
              "~/.claude/local/claude", "~/.local/share/mise/shims/claude"):
        p = Path(p).expanduser()
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    return None


def clean_svg(text):
    """The SVG in the model's answer, without anything that could run or load: or None."""
    m = re.search(r"<svg\b.*</svg>", text or "", re.S | re.I)
    if not m:
        return None
    svg = m.group(0)
    svg = re.sub(r"<script\b.*?</script\s*>|<foreignObject\b.*?</foreignObject\s*>", "", svg, flags=re.S | re.I)
    svg = re.sub(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*')", "", svg, flags=re.I)
    svg = re.sub(r"(\s(?:xlink:)?href\s*=\s*)(\"(?!#)[^\"]*\"|'(?!#)[^']*')", r'\1"#"', svg, flags=re.I)
    if "xmlns=" not in svg.split(">", 1)[0]:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg


class Illustrator:
    """Has Claude draw a figure (the claude command line tool, without its tools — only reading
    the reference picture, when there is one). One at a time; a new request or stop ends the old."""

    def __init__(self):
        self.proc = None
        self.lock = threading.Lock()

    def stop(self):
        with self.lock:
            proc, self.proc = self.proc, None
        if proc and proc.poll() is None:
            proc.kill()

    def draw(self, reply, ident, text, image, previous, change):
        self.stop()
        threading.Thread(target=self.run, args=(reply, ident, text, image, previous, change), daemon=True).start()

    def run(self, reply, ident, text, image, previous, change):
        fake = os.environ.get("MDVIEW_GRAPHIC_FAKE")
        if fake is not None:  # (tests: no model, a known figure)
            time.sleep(0.4)
            tag = "changed" if change else ("ref" if image else "new")
            GLib.idle_add(reply, ident, fake.replace("TAG", tag), None)
            return
        exe = find_claude()
        if not exe:
            GLib.idle_add(reply, ident, None, "The claude command was not found")
            return
        work = tempfile.mkdtemp(prefix="mdview-graphic-")
        try:
            tools = ["--tools", ""]
            if previous and change:
                prompt = ("Here is the figure you drew:\n\n" + previous + "\n\nChange it as follows and reply with the "
                          "complete new SVG: " + change)
            else:
                prompt = "Draw: " + text if text else ""
                if image:
                    ref = Path(work) / ("reference" + (Path(image).suffix.lower() or ".png"))
                    shutil.copyfile(image, ref)
                    tools = ["--tools", "Read", "--allowedTools", "Read", "--add-dir", work]
                    prompt = (f"A reference picture is at {ref} — read it first. Redraw what it shows as a clean "
                              "figure in your style" + (", following this description: " + text if text else "."))
            args = [exe, "-p", prompt, "--system-prompt", GRAPHIC_SYSTEM, *tools, "--strict-mcp-config",
                    "--disable-slash-commands", "--no-session-persistence", "--output-format", "text"]
            proc = subprocess.Popen(args, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, start_new_session=True)
            with self.lock:
                self.proc = proc
            try:
                out, err = proc.communicate(timeout=300)
            except subprocess.TimeoutExpired:
                proc.kill()
                out, err = "", "It took longer than five minutes"
            with self.lock:
                stopped = self.proc is not proc
                if not stopped:
                    self.proc = None
            if stopped:
                return
            svg = clean_svg(out)
            if svg:
                GLib.idle_add(reply, ident, svg, None)
            else:
                said = (err or out or "").strip().splitlines()
                GLib.idle_add(reply, ident, None, "Claude: " + (said[-1][:200] if said else "no figure came back"))
        except OSError as e:
            GLib.idle_add(reply, ident, None, f"Couldn't run claude: {e.strerror or e}")
        finally:
            shutil.rmtree(work, ignore_errors=True)


def user_snippets():
    """The snippets file as a function the page can call, or "" (it is the user's own JavaScript,
    run in the page like the plugin runs it)."""
    try:
        source = SNIPPETS_FILE.read_text(encoding="utf-8")
    except OSError:
        return ""
    if not source.strip():
        return ""
    body, n = re.subn(r"export\s+default", "return ", source, count=1)
    if not n:
        body = "return (" + source.rstrip().rstrip(";") + "\n)"
    return "window.MdSnippets = function (require) {\n" + body.replace("</", "<\\/") + "\n};"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp"}

SCRIPTS = [
    "vendor/markdown-it.min.js",
    "vendor/footnote.min.js",
    "vendor/deflist.min.js",
    "vendor/mark.min.js",
    "vendor/sub.min.js",
    "vendor/sup.min.js",
    "vendor/abbr.min.js",
    "vendor/emoji.min.js",
    "vendor/js-yaml.min.js",
    "vendor/highlight.min.js",
    "vendor/highlight-extra.min.js",
    "vendor/katex/katex.min.js",
    "strings.js",
    "viewer.js",
    "overview.js",
]
THEME_KEYS = (
    "background", "foreground", "accent", "muted", "selection",
    "red", "green", "yellow", "orange", "blue", "cyan", "magenta", "brown",
    "bright_red", "bright_green", "bright_yellow", "bright_blue",
    "bright_magenta", "bright_cyan",
)
LIGHT_FALLBACK = {"background": "#ffffff", "foreground": "#1d1d1f", "accent": "#0071e3",
                  "muted": "#8e8e93", "selection": "#b4d5fe"}


# ---------------------------------------------------------------- helpers

def luminance(hex_color):
    h = hex_color.lstrip("#")[:6]
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return 1.0
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def load_theme():
    try:
        data = tomllib.loads((THEME_DIR / "theme/colors.toml").read_text())
    except (OSError, tomllib.TOMLDecodeError):
        data = {}
    colors = dict(LIGHT_FALLBACK)
    colors.update({k: data[k] for k in THEME_KEYS if isinstance(data.get(k), str)})
    mode = data.get("mode")
    if mode not in ("light", "dark"):
        mode = "light" if luminance(colors["background"]) > 0.5 else "dark"
    return {"mode": mode, "colors": colors}


def things_tokens_path():
    for folder in THINGS_DIRS:
        if (folder / THINGS_TOKENS).exists():
            return folder / THINGS_TOKENS
    return None


def things_css():
    """What the menus need of the Things tokens, as --things-* (lengths are its points, as px)."""
    path = things_tokens_path()
    try:
        t = json.loads(path.read_text())
        color, body = t["color"], t["type"]["body"]
        out = [f"--things-{k}:{color[k]}" for k in ("popover", "popover-text", "popover-muted", "popover-selection",
                                                    "popover-button", "on-accent", "danger")]
        out += [f"--things-radius-popover:{t['radius']['popover']}px", f"--things-radius-sm:{t['radius']['sm']}px",
                f"--things-shadow-pop:{t['shadow']['pop']}", f"--things-popover-row:{t['layout']['popover']['row']}px",
                f"--things-type-body-size:{body['size']}px", f"--things-type-body-weight:{body['weight']}"]
        return ";" + ";".join(out)
    except (AttributeError, OSError, ValueError, KeyError, TypeError):
        return ""


def has_font(family):
    try:
        gi.require_version("PangoCairo", "1.0")
        from gi.repository import PangoCairo
        return any(f.get_name() == family for f in PangoCairo.font_map_get_default().list_families())
    except (ValueError, ImportError):
        return False


def theme_css(theme):
    body = ";".join(f"--c-{k.replace('_', '-')}:{v}" for k, v in theme["colors"].items()) + things_css()
    return f":root{{{body};color-scheme:{theme['mode']}}}"


def read_text(path, limit=None):
    with open(path, "rb") as f:
        raw = f.read(limit) if limit else f.read()
    return raw.decode("utf-8", errors="replace")


def readonly_reason(path, raw):
    """Why the file can't be edited in place, or None if it can."""
    if raw is None:
        return None if os.access(path.parent, os.W_OK) else "folder is read-only"
    if not os.access(path, os.W_OK):
        return "file is read-only"
    if len(raw) > EDIT_LIMIT:
        return "file is too large"
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        return "file is not UTF-8"
    return None


def note_title(path):
    """First H1 of a note (frontmatter and code blocks skipped), or None."""
    try:
        lines = read_text(path, TITLE_SCAN).splitlines()
    except OSError:
        return None
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() in ("---", "..."):
                start = i + 1
                break
    fence = None
    for line in lines[start:]:
        m = FENCE_RE.match(line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not m.group(2).strip():
                fence = None
            continue
        if m:
            fence = m.group(1)
            continue
        m = H1_RE.match(line)
        if m:
            t = re.sub(r"!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", m.group(1))
            t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
            t = re.sub(r"(\*\*|__|~~|==|[*`])", "", t).strip()
            return t or None
    return None


def clean_name(name):
    """A typed note name as a safe file name stem part (no path, not hidden)."""
    return re.sub(r"[/\\\x00-\x1f]", " ", str(name or "")).strip().lstrip(". ")


def natural_key(name):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name.lower())]


def scan_folder(root, cache, titles, keep=(), show=("pdf",)):
    """The notes below root as a tree, plus every directory walked (to watch).
    Hidden entries and SKIP_DIRS are left out, as are folders without notes.
    Titles are only read when asked for; cache maps path -> (stat key, title)."""
    walked, count = [], 0
    deadline = time.monotonic() + 1.5

    def walk(d, depth):
        nonlocal count
        node = {"name": d.name, "path": str(d), "dirs": [], "notes": []}
        walked.append(d)
        try:
            entries = sorted(os.scandir(d), key=lambda e: natural_key(e.name))
        except OSError:
            return node
        for e in entries:
            if e.name.startswith("."):
                continue
            try:
                if e.is_dir(follow_symlinks=False):
                    if e.name in SKIP_DIRS or depth >= 12 or count >= NOTE_LIMIT \
                            or time.monotonic() > deadline:
                        continue
                    sub = walk(Path(e.path), depth + 1)
                    if sub["dirs"] or sub["notes"] or e.path in keep:  # (keep: folders made here, still empty)
                        node["dirs"].append(sub)
                elif os.path.splitext(e.name)[1].lower() in MD_EXT and e.is_file() \
                        and count < NOTE_LIMIT:
                    title = None
                    st = e.stat()
                    if titles:
                        key = (st.st_mtime_ns, st.st_size)
                        hit = cache.get(e.path)
                        if not hit or hit[0] != key:
                            hit = cache[e.path] = (key, note_title(e.path))
                        title = hit[1]
                    node["notes"].append({"name": os.path.splitext(e.name)[0], "path": e.path,
                                          "real": os.path.realpath(e.path), "title": title,
                                          "mtime": int(st.st_mtime)})
                    count += 1
                elif count < NOTE_LIMIT and e.is_file():
                    # what the settings ask for beside the notes — with its ending, to tell it
                    # from a note. (PDFs open in the window; the rest in its own application.)
                    kind = file_kind(Path(e.name))
                    group = {"pdf": "pdf", "image": "image", "audio": "media", "video": "media"}.get(kind, "other")
                    if group in show:
                        node["notes"].append({"name": e.name, "path": e.path, "real": os.path.realpath(e.path),
                                              "title": None, "pdf": True, "kind": kind})
                        count += 1
            except OSError:
                continue
        return node

    return walk(root, 0), walked


def tree_notes(node):
    for n in node["notes"]:
        yield n
    for d in node["dirs"]:
        yield from tree_notes(d)


def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state))
    except OSError:
        pass


def file_kind(path):
    ext = path.suffix.lower()
    if ext in MD_EXT:
        return "md"
    if ext in IMG_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    if ext == ".pdf":
        return "pdf"
    return "file"


PDF_LINK_RE = re.compile(r"!?\[\[([^\]\[|#]+\.pdf)(?:#([^\]\[|]*))?(?:\|[^\]\[]*)?\]\]|\]\(<?([^)\s#>]+\.pdf)(?:#([^)\s>]*))?>?\)", re.I)


def pdf_backlinks(pdf, root):
    """The links to this PDF in the notes below root: [{path, name, line, frag, text}] — what the
    PDF viewer shows as highlights (a link to a selection is the annotation)."""
    name = pdf.name.lower()
    out, seen, deadline = [], 0, time.monotonic() + 1.5
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS]
        for f in filenames:
            if Path(f).suffix.lower() not in MD_EXT:
                continue
            seen += 1
            if seen > 5000 or time.monotonic() > deadline or len(out) >= 2000:
                return out
            p = os.path.join(dirpath, f)
            try:
                text = read_text(p, 2_000_000)
            except OSError:
                continue
            if name not in text.lower() and quote(pdf.name).lower() not in text.lower():
                continue
            lines = text.split("\n")
            for n, line in enumerate(lines):
                for m in PDF_LINK_RE.finditer(line):
                    target, frag = (m.group(1), m.group(2)) if m.group(1) else (unquote(m.group(3)), unquote(m.group(4) or ""))
                    if Path(target.strip()).name.lower() != name or not frag:
                        continue
                    shown = re.sub(r"\s*!?\[\[[^\]]*\]\]", "", line)
                    shown = re.sub(r"^\s*(?:>\s*)*(?:\[![^\]]*\]\s*)?", "", shown).strip()
                    if not shown:  # the quote of a callout stands in the line below its link
                        nxt = lines[n + 1] if n + 1 < len(lines) else ""
                        shown = re.sub(r"^\s*(?:>\s*)*", "", nxt).strip()
                    out.append({"path": p, "name": f, "line": n, "frag": frag, "text": shown[:240]})
    return out


def clipboard_image():
    """The image on the clipboard as (bytes, file extension), or None."""
    cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    ok, atoms = cb.wait_for_targets()
    have = {a.name() for a in atoms} if ok else set()
    for mime, ext in PASTE_MIME:
        if mime in have:
            sel = cb.wait_for_contents(Gdk.Atom.intern(mime, False))
            data = sel.get_data() if sel else None
            if data:
                return bytes(data), ext
    pixbuf = cb.wait_for_image() if cb.wait_is_image_available() else None
    if pixbuf:
        ok, data = pixbuf.save_to_bufferv("png", [], [])
        if ok:
            return bytes(data), ".png"
    return None


def launch_uri(uri):
    try:
        Gio.AppInfo.launch_default_for_uri(uri, None)
    except GLib.Error:
        subprocess.Popen(["xdg-open", uri], start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Resolver:
    """Resolves Obsidian wikilink targets like Obsidian does: next to the
    note, at the vault root, then anywhere below the root by file name.
    The root is the nearest ancestor holding .obsidian, else the note's dir."""

    def __init__(self, note_dir):
        self.note_dir = note_dir
        self.vault = None
        for p in (note_dir, *note_dir.parents):
            if (p / ".obsidian").is_dir():
                self.vault = p
                break
            if p == HOME:
                break
        self._index = None

    def index(self):
        if self._index is None:
            idx, count = {}, 0
            deadline = time.monotonic() + 0.3
            for dirpath, dirnames, filenames in os.walk(self.vault or self.note_dir):
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS]
                for f in filenames:
                    idx.setdefault(f.lower(), []).append(os.path.join(dirpath, f))
                count += len(filenames)
                if count > 60000 or time.monotonic() > deadline:
                    break
            self._index = idx
        return self._index

    def resolve(self, target):
        name = re.split(r"[#^]", target, maxsplit=1)[0].strip()
        if not name:
            return None
        cands = [name] if Path(name).suffix.lower() in MD_EXT else [name + ".md", name]
        bases = [self.note_dir] + ([self.vault] if self.vault else [])
        for c in cands:
            for b in bases:
                p = b / c
                if p.is_file():
                    return p.resolve()
        idx = self.index()
        here = str(self.note_dir)
        for c in cands:
            hits = idx.get(Path(c).name.lower())
            if not hits:
                continue
            if "/" in c:
                hits = [h for h in hits if h.lower().endswith("/" + c.lower())] or hits
            best = min(hits, key=lambda h: (not h.startswith(here), h.count(os.sep), h))
            return Path(best)
        return None


# ---------------------------------------------------------------- window

class ViewerWindow(Gtk.ApplicationWindow):
    def __init__(self, app, path, folder=None):
        super().__init__(application=app, title="Markdown Notes")
        self.app = app
        self.path = None
        self.folder = None          # set: this window browses a folder (sidebar)
        self.tree = None
        self.tree_json = None
        self.note_paths = set()
        self.kept_dirs = set()      # folders made from the sidebar: shown although nothing is in them yet
        self.title_cache = {}
        self.dir_monitors = []
        self.rescan_id = 0
        self.shell_ready = False
        self.loading_shell = False
        self.pending_fragment = None
        self.back, self.fwd = [], []
        self.monitor = None
        self.reload_id = 0
        self.resolver = None
        self.editing = False
        self.own_text = None
        self.own_write = None       # bytes just written here: the reload for them is skipped
        self.closing = False
        self.mode_given = False  # the page was told which mode the app was last used in
        self.save_seq = 0
        self.close_id = 0

        st = app.state
        if folder:
            self.set_default_size(st.get("folder_width", st.get("width", 900) + SIDEBAR_WIDTH),
                                  st.get("folder_height", st.get("height", 1040)))
        else:
            self.set_default_size(st.get("width", 900), st.get("height", 1040))
        self.set_icon_name("mdview")
        bg = Gdk.RGBA()
        bg.parse(app.theme["colors"]["background"])
        self.override_background_color(Gtk.StateFlags.NORMAL, bg)

        ucm = WebKit2.UserContentManager()
        ucm.register_script_message_handler("mdview")
        ucm.connect("script-message-received::mdview", self.on_message)
        # (A probe's page keeps nothing: what an earlier run left — the place a note was scrolled to,
        # an embed's size — would decide how the next one starts, and would land in the real store.)
        self.view = (WebKit2.WebView(user_content_manager=ucm, web_context=app.probe_context) if PROBE
                     else WebKit2.WebView.new_with_user_content_manager(ucm))
        self.view.set_settings(app.web_settings)
        self.view.set_background_color(bg)
        # Two fingers pulled apart on a touchpad are the PDF viewer's (pdfview.js pinch): the page as a
        # whole has one size. Taken here, before the web view makes a zoom of its own of them.
        self.view.add_events(Gdk.EventMask.TOUCHPAD_GESTURE_MASK)
        self.pinch = Gtk.GestureZoom.new(self.view)
        self.pinch.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        self.pinch.connect("begin", self.on_pinch_begin)
        self.pinch.connect("scale-changed", lambda _g, scale: self.js("MdView.pinch", "move", scale))
        self.view.connect("load-changed", self.on_load_changed)
        self.view.connect("decide-policy", self.on_decide_policy)
        self.view.connect("context-menu", self.on_context_menu)
        self.view.connect("web-process-terminated", lambda *_: self.load_shell(force=True))
        # The web view's very first frame can come out of the GPU unpainted (a magenta flash on
        # this machine): a plain cover in the window's colour lies over it until the page has
        # drawn its content.
        overlay = Gtk.Overlay()
        overlay.add(self.view)
        self.cover = Gtk.DrawingArea()
        self.cover.connect("draw", self.draw_cover)
        overlay.add_overlay(self.cover)
        self.add(overlay)
        overlay.show()
        if PROBE:  # (tests compare this page with older ones, which never say that they are drawn)
            self.uncover()
        else:
            self.cover.show()
            GLib.timeout_add(2500, self.uncover)  # (at the latest)
        self.connect("delete-event", self.on_delete)
        self.view.show()

        if folder:
            self.set_folder(folder)
        elif path:
            self.open_path(path, push=False)
        else:
            GLib.idle_add(self.choose_file)

    # -- loading --------------------------------------------------------

    def load_shell(self, force=False):
        if self.shell_ready and not force:
            self.render()
            return
        # One shell per window. Relative links and images resolve against
        # <base>, which the page points at the directory of the note shown.
        target_dir = self.path.parent if self.path else self.folder or HOME
        self.tree_json = None
        self.shell_ready = False
        self.loading_shell = True
        self.editing = False
        nonce = secrets.token_urlsafe(18)
        a = ASSETS.as_uri()
        csp = ("default-src 'none'; "
               f"script-src 'nonce-{nonce}'; "
               "style-src 'unsafe-inline' file: https:; "
               "img-src file: data: blob: https: http:; "
               "font-src file: data:; media-src file: https: http:")
        prefs = json.dumps(self.app.prefs()).replace("</", "<\\/")
        own = user_snippets()
        scripts = f'<script nonce="{nonce}">window.MdPrefs = {prefs};</script>' + \
            (f'<script nonce="{nonce}">{own}</script>' if own else "") + \
            "".join(f'<script nonce="{nonce}" src="{a}/{s}"></script>' for s in SCRIPTS)
        page = (
            "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            f"<meta http-equiv='Content-Security-Policy' content=\"{csp}\">"
            f"<base href='{html.escape(target_dir.as_uri(), quote=True)}/'>"
            f"<style id='henri-ui'>{self.app.motion_css}</style>"
            f"<style id='theme'>{theme_css(self.app.theme)}</style>"
            f"<link rel='stylesheet' href='{a}/vendor/katex/katex.min.css'>"
            f"<link rel='stylesheet' href='{a}/viewer.css'>"
            f"<link rel='stylesheet' href='{a}/overview.css'>"
            f"</head><body data-mode='{self.app.theme['mode']}'{' data-sf' if self.app.sf_symbols else ''}><main id='content'></main>"
            f"{scripts}</body></html>"
        )
        self.view.load_html(page, target_dir.as_uri() + "/")

    def draw_cover(self, _widget, cr):
        c = Gdk.RGBA()
        c.parse(self.app.theme["colors"]["background"])
        cr.set_source_rgb(c.red, c.green, c.blue)
        cr.paint()
        return True

    def uncover(self):
        if self.cover:
            self.cover.destroy()
            self.cover = None
        return False

    def on_load_changed(self, view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.loading_shell = False
            self.shell_ready = True
            self.send_folder()
            self.render(fragment=self.pending_fragment)
            self.pending_fragment = None
            if PROBE:
                self.view.evaluate_javascript(Path(PROBE).read_text(), -1, None, None, None, None, None)

    def open_path(self, path, fragment=None, push=True):
        path = Path(path).expanduser()
        try:
            path = path.resolve()
        except OSError:
            pass
        if push and self.path and path != self.path:
            self.back.append(self.path)
            self.fwd.clear()
        same = path == self.path
        self.path = path
        self.set_title(path.name)
        self.resolver = Resolver(path.parent)
        if not same:
            self.own_text = None
            self.watch()
            if self.folder and path.is_relative_to(self.folder):
                last = self.app.state.setdefault("last_notes", {})
                last.pop(str(self.folder), None)
                last[str(self.folder)] = str(path)
                for old in list(last)[:-20]:
                    del last[old]
                # when it was opened: what the sidebar sorts by ("opened")
                opened = self.app.state.setdefault("opened", {})
                opened.pop(str(path), None)
                opened[str(path)] = int(time.time())
                for old in list(opened)[:-OPENED_LIMIT]:
                    del opened[old]
                save_state(self.app.state)
                self.send_folder()
        if same and self.shell_ready:
            if fragment and path.suffix.lower() == ".pdf":
                self.render_pdf(fragment)  # (a place in the PDF: the viewer goes there)
            elif fragment:
                self.js("MdView.scrollToFragment", fragment, True)
            return
        self.pending_fragment = fragment
        if self.shell_ready:
            self.render(fragment=fragment)
            self.pending_fragment = None
        else:
            self.load_shell()

    def watch(self):
        if self.monitor:
            self.monitor.cancel()
        try:
            self.monitor = Gio.File.new_for_path(str(self.path)).monitor_file(
                Gio.FileMonitorFlags.WATCH_MOVES, None)
            self.monitor.set_rate_limit(80)
            self.monitor.connect("changed", self.on_file_changed)
        except GLib.Error:
            self.monitor = None

    def on_file_changed(self, _mon, _file, _other, event):
        if event in (Gio.FileMonitorEvent.ATTRIBUTE_CHANGED, Gio.FileMonitorEvent.PRE_UNMOUNT):
            return
        if self.reload_id:
            GLib.source_remove(self.reload_id)
        # Editors save by delete + rename; wait for the dust to settle.
        self.reload_id = GLib.timeout_add(90, self.reload_after_change)

    def reload_after_change(self):
        self.reload_id = 0
        if self.path and self.path.exists():
            own, self.own_write = self.own_write, None
            if own is not None:
                try:
                    with open(self.path, "rb") as f:
                        if f.read() == own:
                            return False  # already on screen
                except OSError:
                    pass
            if self.editing and self.own_text is not None:
                try:
                    if read_text(self.path).replace("\r\n", "\n") == self.own_text:
                        return False  # our own save; the editor already has it
                except OSError:
                    pass
            self.resolver = Resolver(self.path.parent)
            self.render(keep_scroll=True)
        return False

    # -- folder (sidebar) ---------------------------------------------------

    def set_folder(self, folder):
        folder = Path(folder).expanduser()
        try:
            folder = folder.resolve()
        except OSError:
            pass
        self.folder = folder
        self.tree_json = None
        self.title_cache = {}
        self.app.state["folder"] = str(folder)
        save_state(self.app.state)
        self.rescan()
        notes = {n["real"]: n for n in tree_notes(self.tree)}
        last = self.app.state.get("last_notes", {}).get(str(folder))
        first = last if last in notes else next((r for r, n in notes.items() if not n.get("pdf")), None)  # (a note, not a PDF)
        if self.path and str(self.path) in notes:
            return
        if first:
            self.open_path(first, push=bool(self.path))
        else:
            self.show_nothing()

    def show_nothing(self):
        """Nothing to show: an empty folder, or its last note is gone."""
        if self.monitor:
            self.monitor.cancel()
            self.monitor = None
        self.path = None
        self.back.clear()
        self.fwd.clear()
        self.set_title(self.folder.name or str(self.folder))
        if self.shell_ready:
            self.js("MdView.clear")
        else:
            self.load_shell()

    def rescan(self):
        self.rescan_id = 0
        if not self.folder:
            return False
        titles = bool(self.app.state.get("sidebar_titles"))
        prefs = self.app.prefs()
        show = {g for g, key in (("pdf", "sidebarPdf"), ("image", "sidebarImages"), ("media", "sidebarMedia"),
                                 ("other", "sidebarOther")) if prefs.get(key)}
        self.tree, walked = scan_folder(self.folder, self.title_cache, titles, self.kept_dirs, show)
        self.note_paths = {n["path"] for n in tree_notes(self.tree)}
        have = {m.dir for m in self.dir_monitors}
        want = set(walked[:WATCH_LIMIT])
        for mon in [m for m in self.dir_monitors if m.dir not in want]:
            mon.cancel()
            self.dir_monitors.remove(mon)
        for d in want - have:
            try:
                mon = Gio.File.new_for_path(str(d)).monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, None)
            except GLib.Error:
                continue
            mon.dir = d
            mon.connect("changed", self.on_dir_changed)
            self.dir_monitors.append(mon)
        self.send_folder()
        return False

    def on_dir_changed(self, _mon, _file, _other, event):
        if event == Gio.FileMonitorEvent.ATTRIBUTE_CHANGED:
            return
        if self.rescan_id:
            GLib.source_remove(self.rescan_id)
        self.rescan_id = GLib.timeout_add(300, self.rescan)

    def send_folder(self):
        if not self.folder or not self.shell_ready:
            return
        st = self.app.state
        opened = st.get("opened", {})
        for n in tree_notes(self.tree):
            n["opened"] = opened.get(n["real"], 0)
        payload = {
            "root": str(self.folder),
            "name": self.folder.name or str(self.folder),
            "tree": self.tree,
            "titles": bool(st.get("sidebar_titles")),
            "visible": st.get("sidebar", True),
            "width": st.get("sidebar_width", 0),
        }
        blob = json.dumps(payload, sort_keys=True)
        if blob != self.tree_json:
            self.tree_json = blob
            self.js("MdView.setFolder", payload)

    def send_previews(self, paths):
        """The beginning of notes of this folder, for their tiles in the overview."""
        out = {}
        for p in (paths if isinstance(paths, list) else [])[:PREVIEW_BATCH]:
            if not isinstance(p, str) or p not in self.note_paths or file_kind(Path(p)) != "md":
                continue
            try:
                out[p] = {"text": read_text(p, PREVIEW_BYTES), "mtime": os.stat(p).st_mtime}
            except OSError:
                out[p] = {"text": "", "mtime": 0}
        self.js("MdView.setPreviews", out)

    def open_note(self, path):
        if self.folder and path in self.note_paths:
            if file_kind(Path(path)) in ("md", "pdf"):
                self.open_path(path)
            else:  # a picture, a film, any other file: in its own application
                launch_uri(Path(path).as_uri())

    def new_note(self, name, where):
        if not self.folder:
            return
        target = Path(where) if where else self.folder
        try:
            target = target.resolve()
        except OSError:
            target = self.folder
        if not target.is_dir() or not target.is_relative_to(self.folder):
            target = self.folder
        name = clean_name(name) or "Untitled"
        stem = name[:-3].rstrip() if name.lower().endswith(".md") else name
        path = target / f"{stem or 'Untitled'}.md"
        try:
            with open(path, "x", encoding="utf-8") as f:
                f.write(f"# {stem}\n\n")
        except FileExistsError:
            self.js("MdView.toast", f"“{path.name}” already exists")
            if path.is_file():
                self.rescan()
                self.open_path(path)
            return
        except OSError as e:
            self.js("MdView.toast", f"Couldn't create note: {e.strerror}")
            return
        self.rescan_now()
        self.open_path(path)
        self.js("MdView.setMode", "edit", "end")

    def new_folder(self, name, where):
        if not self.folder:
            return
        target = Path(where) if where else self.folder
        try:
            target = target.resolve()
        except OSError:
            target = self.folder
        if not target.is_dir() or not target.is_relative_to(self.folder):
            target = self.folder
        path = target / (clean_name(name) or "New Folder")
        try:
            path.mkdir()
        except FileExistsError:
            self.js("MdView.toast", f"“{path.name}” already exists")
        except OSError as e:
            self.js("MdView.toast", f"Couldn't create folder: {e.strerror}")
            return
        self.kept_dirs.add(str(path))
        self.rescan_now()

    def rescan_now(self):
        if self.rescan_id:
            GLib.source_remove(self.rescan_id)
        self.rescan()

    def rename_note(self, path, name):
        if not self.folder or path not in self.note_paths:
            return
        old = Path(path)
        stem = clean_name(name)
        if stem.lower().endswith(old.suffix.lower()):
            stem = stem[:-len(old.suffix)].rstrip()
        new = old.with_name(stem + old.suffix)
        if not stem or new == old:
            return
        try:
            if os.path.lexists(new) and not os.path.samefile(old, new):
                self.js("MdView.toast", f"“{new.name}” already exists")
                return
            old_real = os.path.realpath(old)
            os.rename(old, new)
        except OSError as e:
            self.js("MdView.toast", f"Couldn't rename: {e.strerror}")
            return
        new_real = os.path.realpath(new)
        swap = lambda p: Path(new_real) if str(p) == old_real else p
        self.back = [swap(p) for p in self.back]
        self.fwd = [swap(p) for p in self.fwd]
        if self.path and str(self.path) == old_real and new_real != old_real:
            # the note on screen: it stays as it is (also mid-edit), under its new name
            self.path = Path(new_real)
            self.set_title(self.path.name)
            self.watch()
            last = self.app.state.setdefault("last_notes", {})
            last[str(self.folder)] = new_real
            save_state(self.app.state)
        self.js("MdView.noteRenamed", {"old": str(old), "path": str(new), "oldReal": old_real,
                                       "real": new_real, "name": Path(new_real).name})
        self.rescan_now()

    def trash_note(self, path):
        if not self.folder or path not in self.note_paths:
            return
        real = os.path.realpath(path)
        nxt = None
        if self.path and str(self.path) == real:
            notes = list(tree_notes(self.tree))
            i = next((k for k, n in enumerate(notes) if n["path"] == path), -1)
            rest = notes[i + 1:i + 2] or notes[max(i - 1, 0):i]
            nxt = rest[0]["real"] if rest else None
        try:
            Gio.File.new_for_path(path).trash(None)
        except GLib.Error as e:
            self.js("MdView.toast", f"Couldn't move to Trash: {e.message}")
            return
        self.back = [p for p in self.back if str(p) != real]
        self.fwd = [p for p in self.fwd if str(p) != real]
        self.js("MdView.toast", f"Moved “{Path(path).name}” to Trash")
        was_current = self.path and str(self.path) == real
        self.rescan_now()
        if was_current:
            if nxt:
                self.open_path(nxt, push=False)
            else:
                self.show_nothing()

    def sidebar_pref(self, msg):
        st = self.app.state
        if "width" in msg:  # pulled to another width: kept, nothing to scan again for
            try:
                st["sidebar_width"] = max(180, min(640, int(msg["width"])))
            except (TypeError, ValueError):
                pass
            if "visible" in msg:
                st["sidebar"] = bool(msg["visible"])
            save_state(st)
            return
        if "visible" in msg:
            st["sidebar"] = bool(msg["visible"])
        if "titles" in msg:
            st["sidebar_titles"] = bool(msg["titles"])
        save_state(st)
        for w in self.app.windows():
            if w.folder:
                w.rescan()

    def choose_folder(self):
        dlg = Gtk.FileChooserNative.new("Open Folder", self, Gtk.FileChooserAction.SELECT_FOLDER,
                                        "Open", "Cancel")
        if self.folder or self.path:
            dlg.set_current_folder(str(self.folder or self.path.parent))
        if dlg.run() == Gtk.ResponseType.ACCEPT:
            self.set_folder(dlg.get_filename())
        dlg.destroy()

    def build_links(self, text):
        links = {}
        seen_texts = [text]
        while seen_texts:
            chunk = seen_texts.pop()
            for m in WIKI_RE.finditer(chunk):
                target = m.group(1).split("|", 1)[0].strip()
                if target in links or target.startswith("#"):
                    continue
                p = self.resolver.resolve(target)
                if not p:
                    links[target] = None
                    continue
                kind = file_kind(p)
                info = {"path": str(p), "url": p.as_uri(), "kind": kind}
                if kind == "md" and m.group(0).startswith("!") and len(links) < 400:
                    try:
                        info["text"] = read_text(p, EMBED_LIMIT)
                        seen_texts.append(info["text"])
                    except OSError:
                        pass
                links[target] = info
        return links

    def render_pdf(self, fragment=None):
        """A PDF in the window: the page gets its name and the links to it; the bytes on request."""
        try:
            mtime, error = self.path.stat().st_mtime, None
        except OSError as e:
            mtime, error = 0, f"Can't read file: {e.strerror}"
        root = (self.resolver.vault if self.resolver and self.resolver.vault else None) or self.folder or self.path.parent
        self.mode_given = True
        self.js("MdView.render", {
            "kind": "pdf", "text": "", "name": self.path.name, "path": str(self.path),
            "base": self.path.parent.as_uri() + "/", "readonly": "a PDF", "vault": False, "links": {},
            "fragment": fragment, "error": error, "canBack": bool(self.back), "mtime": mtime,
            "backlinks": [] if error else pdf_backlinks(self.path, root),
        })

    def send_pdf(self, path, ident):
        """The bytes of a PDF for the page (it may not read files itself), in pieces."""
        try:
            p = Path(path or "").resolve()
            if p.suffix.lower() != ".pdf" or not p.is_file():
                raise OSError("not a PDF file")
            if p.stat().st_size > 300_000_000:
                raise OSError("larger than 300 MB")
            data = p.read_bytes()
        except OSError as e:
            self.js("MdView.pdfChunk", ident, 0, 1, "", str(e.strerror or e))
            return
        size = 3_000_000
        parts = [data[i:i + size] for i in range(0, len(data), size)] or [b""]
        for i, part in enumerate(parts):
            self.js("MdView.pdfChunk", ident, i, len(parts), base64.b64encode(part).decode("ascii"), None)

    def render(self, keep_scroll=False, fragment=None, end=False):
        if not self.shell_ready or not self.path:
            return
        if self.path.suffix.lower() == ".pdf":
            self.render_pdf(fragment)
            return
        raw = None
        try:
            with open(self.path, "rb") as f:
                raw = f.read()
            text, error = raw.decode("utf-8", errors="replace"), None
            readonly = readonly_reason(self.path, raw)
        except FileNotFoundError:
            text, error = "", f"File not found: {self.path}"
            readonly = readonly_reason(self.path, None)
        except OSError as e:
            text, error = "", f"Can't read file: {e.strerror}"
            readonly = "file can't be read"
        payload = {
            "text": text,
            "name": self.path.name,
            "path": str(self.path),
            "base": self.path.parent.as_uri() + "/",
            "readonly": readonly,
            "vault": bool(self.resolver and self.resolver.vault),
            "links": self.build_links(text) if "[[" in text else {},
            "keepScroll": keep_scroll,
            "fragment": fragment,
            "toEnd": end,
            "error": error,
            "canBack": bool(self.back),
            "seq": self.save_seq,  # the last save that was written before the file was read
        }
        if not self.mode_given and (not PROBE or os.environ.get("MDVIEW_PROBE_MODE")):
            start = self.app.prefs()["startMode"]
            payload["startMode"] = self.app.state.get("mode", "read") if start == "last" else start
        self.mode_given = True
        self.js("MdView.render", payload)

    def on_pinch_begin(self, gesture, _sequence):
        gesture.set_state(Gtk.EventSequenceState.CLAIMED)
        self.js("MdView.pinch", "begin", 1)

    def js(self, fn, *args):
        script = f"{fn}({','.join(json.dumps(a, ensure_ascii=False) for a in args)})"
        self.view.evaluate_javascript(script, -1, None, None, None, None, None)

    # -- web view policy --------------------------------------------------

    def on_decide_policy(self, view, decision, kind):
        if kind == WebKit2.PolicyDecisionType.RESPONSE:
            return False
        action = decision.get_navigation_action()
        nav = action.get_navigation_type()
        uri = action.get_request().get_uri()
        if self.loading_shell or nav == WebKit2.NavigationType.RELOAD:
            return False
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and not action.is_user_gesture() \
                and nav == WebKit2.NavigationType.OTHER and uri.startswith("file:") \
                and urlparse(uri).path.endswith("/"):
            return False  # the shell itself (load_html)
        decision.ignore()
        if uri and not uri.startswith("about:"):
            self.handle_link(uri)
        return True

    def on_context_menu(self, view, menu, _event, _hit):
        keep = {
            WebKit2.ContextMenuAction.COPY,
            WebKit2.ContextMenuAction.COPY_LINK_TO_CLIPBOARD,
            WebKit2.ContextMenuAction.COPY_IMAGE_TO_CLIPBOARD,
            WebKit2.ContextMenuAction.COPY_IMAGE_URL_TO_CLIPBOARD,
            WebKit2.ContextMenuAction.SELECT_ALL,
            WebKit2.ContextMenuAction.CUT,
            WebKit2.ContextMenuAction.PASTE,
        }
        if DEBUG:
            keep.add(WebKit2.ContextMenuAction.INSPECT_ELEMENT)
        for item in list(menu.get_items()):
            if item.get_stock_action() not in keep:
                menu.remove(item)
        # The page shows a menu of its own for text (viewer.js, #textmenu); the toolkit's is only
        # for a test build's Inspect, with Shift held.
        shift = bool(_event and _event.get_state()[1] & Gdk.ModifierType.SHIFT_MASK) if DEBUG else False
        return not shift or menu.get_n_items() == 0

    # -- actions -----------------------------------------------------------

    def on_message(self, _ucm, result):
        try:
            value = result.get_js_value() if hasattr(result, "get_js_value") else result
            msg = json.loads(value.to_string())
        except (ValueError, AttributeError):
            return
        t = msg.get("type")
        if t == "link":
            self.handle_link(msg.get("href", ""))
        elif t == "wikilink":
            self.open_wikilink(msg.get("target", ""))
        elif t == "toggle":
            self.toggle_task(int(msg.get("line", -1)), bool(msg.get("checked")))
        elif t == "editcmd":
            # the page's text menu: the command runs where the focus is, as the key would
            if msg.get("cmd") in ("Cut", "Copy", "Paste", "SelectAll"):
                self.view.execute_editing_command(msg["cmd"])
        elif t == "copyimage":
            self.copy_image(str(msg.get("src") or ""))
        elif t == "copy":
            cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            cb.set_text(msg.get("text", ""), -1)
            cb.store()
        elif t == "mode":
            self.editing = bool(msg.get("edit"))
            if msg.get("name") in ("read", "edit", "active") and self.app.state.get("mode") != msg["name"]:
                self.app.state["mode"] = msg["name"]  # the next window starts in it
                save_state(self.app.state)
        elif t == "prefs":
            self.app.set_prefs(msg.get("prefs") or {})
        elif t == "dropfiles":
            self.drop_files(msg.get("uris") or [], msg.get("path"))
        elif t == "closehold":
            # the page has a question to ask before the window may go
            if self.close_id:
                GLib.source_remove(self.close_id)
                self.close_id = 0
            self.closing = False
        elif t == "save":
            # a late autosave must not land in whatever note is open by now
            if msg.get("path") in (None, str(self.path)):
                self.save_seq = msg.get("seq") or self.save_seq
                self.save_text(msg.get("text"), exact=bool(msg.get("exact")))
        elif t == "pasteimage":
            self.paste_image(msg.get("path"), bool(msg.get("append")))
        elif t == "pasteclip":
            cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
            sel = cb.wait_for_contents(Gdk.Atom.intern("text/html", False))
            data = bytes(sel.get_data()) if sel and sel.get_data() else b""
            if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
                html = data.decode("utf-16", "replace")
            else:
                html = data.decode("utf-8", "replace")
            self.js("MdView.pasteClip", {"text": cb.wait_for_text() or "", "html": html})
        elif t == "pastetext":
            text = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()
            if text:
                self.js("MdView.pasteText", {"text": text})
        elif t == "external":
            self.open_external()
        elif t == "note":
            self.open_note(msg.get("path"))
        elif t == "graphic":
            self.app.illustrator().draw(lambda i, svg, err: self.js("MdView.graphic", i, svg, err) and False,
                                        msg.get("id"), str(msg.get("text") or "")[:6000], msg.get("image"),
                                        msg.get("previous"), str(msg.get("change") or "")[:3000] or None)
        elif t == "graphic-cancel":
            self.app.illustrator().stop()
        elif t == "graphic-image":
            self.graphic_image(msg.get("how"))
        elif t == "graphic-save":
            self.save_graphic(msg.get("svg"), msg.get("name"))
        elif t == "complete":
            # the next words for what is being written (active/ghost.js); only when switched on
            if self.app.prefs().get("aiComplete"):
                self.app.completer().ask(lambda i, text, err: self.js("MdView.completion", i, text, err) and False,
                                         msg.get("id"), str(msg.get("before") or "")[-6000:], str(msg.get("after") or "")[:1000])
        elif t == "resolve":
            # a link written after the note was read: where it points
            target = str(msg.get("target") or "")
            p = self.resolver.resolve(target) if self.resolver and target else None
            self.js("MdView.linkResolved", target, {"path": str(p), "url": p.as_uri(), "kind": file_kind(p)} if p else None)
        elif t == "painted":
            # the page's content is drawn; a moment more for the frame to reach the screen
            GLib.timeout_add(int(os.environ.get("MDVIEW_COVER_MS", "120")), self.uncover)
        elif t == "fileop":
            self.file_op(msg.get("op"), msg.get("path"))
        elif t == "pdfdata":
            self.send_pdf(msg.get("path"), str(msg.get("id")))
        elif t == "pdfnote":
            # from a highlight in a PDF to the note it comes from, at the line of its link
            p = Path(msg.get("path") or "")
            if p.is_file() and p.suffix.lower() in MD_EXT:
                self.open_path(p, f"^line={int(msg.get('line') or 0)}")
        elif t == "newnote":
            self.new_note(msg.get("name"), msg.get("dir"))
        elif t == "newfolder":
            self.new_folder(msg.get("name"), msg.get("dir"))
        elif t == "rename":
            self.rename_note(msg.get("path"), msg.get("name"))
        elif t == "trash":
            self.trash_note(msg.get("path"))
        elif t == "sidebar":
            self.sidebar_pref(msg)
        elif t == "previews":
            self.send_previews(msg.get("paths"))
        elif t == "folder":
            self.choose_folder()
        elif t == "open":
            self.choose_file()
        elif t == "reload":
            self.resolver = Resolver(self.path.parent) if self.path else None
            self.render(keep_scroll=True)
        elif t == "zoom" and PROBE:
            # (tests only: the page larger, to see it in a narrow window — the app itself has one size)
            self.view.set_zoom_level(min(2.5, self.view.get_zoom_level() + 0.1 * msg["step"]) if msg.get("step") else 1.0)
        elif t == "settings-info":
            self.settings_info()
        elif t == "aikey":
            try:
                store_ai_key(str(msg.get("key") or ""))
            except OSError as e:
                self.js("MdView.toast", f"Couldn't save the key: {e.strerror}")
            self.settings_info()
        elif t == "help":
            guide = SOURCE.parent / "docs" / "FEATURES.md"
            if guide.is_file():
                self.app.open([Gio.File.new_for_path(str(guide))], "")
        elif t == "print":
            WebKit2.PrintOperation.new(self.view).run_dialog(self)
        elif t == "close":
            self.close()
        elif t == "back":
            self.go(self.back, self.fwd)
        elif t == "forward":
            self.go(self.fwd, self.back)
        elif t == "log" and DEBUG:
            print("[js]", msg.get("text"), file=sys.stderr)
        elif t == "probe" and PROBE_OUT:
            name = f"{self.path.name if self.path else 'none'}.{msg.get('name', 'probe')}.json"
            Path(PROBE_OUT, name).write_text(str(msg.get("text")))
        elif t == "snapshot":
            self.snapshot_to_clipboard(msg)
        elif t == "probe-pointer" and PROBE:
            # (tests) a real pointer event at page coordinates: what a click does that script cannot do
            self.probe_pointer(msg)

    def copy_image(self, src):
        """A picture of the note, by its file, onto the clipboard."""
        u = urlparse(src)
        if u.scheme != "file":
            self.js("MdView.toast", "Only pictures in files can be copied")
            return
        try:
            gi.require_version("GdkPixbuf", "2.0")
            from gi.repository import GdkPixbuf
            px = GdkPixbuf.Pixbuf.new_from_file(unquote(u.path))
        except (GLib.Error, ValueError):
            self.js("MdView.toast", "Couldn't copy the picture")
            return
        cb = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        cb.set_image(px)
        cb.store()

    def snapshot_to_clipboard(self, msg):
        """A part of the page (page coordinates of what is on screen) as a
        picture on the clipboard: a formula copied as a picture."""
        try:
            x, y, w, h = (float(msg[k]) for k in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError):
            return
        zoom = self.view.get_zoom_level()

        def done(view, res):
            try:
                surface = view.get_snapshot_finish(res)
            except GLib.Error:
                self.js("MdView.toast", "Couldn't copy the picture")
                return
            sx, sy = surface.get_device_scale() if hasattr(surface, "get_device_scale") else (1, 1)
            pad = 6
            px = Gdk.pixbuf_get_from_surface(surface, max(0, int((x - pad) * zoom)), max(0, int((y - pad) * zoom)),
                                             int((w + 2 * pad) * zoom), int((h + 2 * pad) * zoom))
            if px is None:
                self.js("MdView.toast", "Couldn't copy the picture")
                return
            Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_image(px)
            if PROBE_OUT:
                px.savev(str(Path(PROBE_OUT, "snapshot.png")), "png", [], [])
            self.js("MdView.toast", msg.get("said") or "Copied")
        self.view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done)

    def probe_pointer(self, msg):
        kinds = {"down": Gdk.EventType.BUTTON_PRESS, "up": Gdk.EventType.BUTTON_RELEASE, "move": Gdk.EventType.MOTION_NOTIFY}
        kind = kinds.get(msg.get("kind"))
        win = self.view.get_window()
        if kind is None or win is None:
            return
        zoom = self.view.get_zoom_level()
        ev = Gdk.Event.new(kind)
        ev.window = win
        ev.send_event = True
        ev.time = Gtk.get_current_event_time() or GLib.get_monotonic_time() // 1000
        ev.x, ev.y = float(msg.get("x", 0)) * zoom, float(msg.get("y", 0)) * zoom
        ox, oy = win.get_root_coords(int(ev.x), int(ev.y))
        ev.x_root, ev.y_root = float(ox), float(oy)
        if kind != Gdk.EventType.MOTION_NOTIFY:
            ev.button = int(msg.get("button", 1))
        elif msg.get("held"):  # (the pointer moved with its button down: a drag)
            ev.state = Gdk.ModifierType.BUTTON1_MASK
        if msg.get("ctrl"):  # (with Ctrl held)
            ev.state = Gdk.ModifierType(int(ev.state) | int(Gdk.ModifierType.CONTROL_MASK))
        ev.set_device(Gdk.Display.get_default().get_default_seat().get_pointer())
        self.view.event(ev)

    def handle_link(self, href):
        u = urlparse(href)
        if u.scheme != "file":
            if u.scheme:
                launch_uri(href)
            return
        p = Path(unquote(u.path))
        frag = unquote(u.fragment) or None
        if not p.exists() and p.suffix.lower() not in MD_EXT:
            alt = p.with_name(p.name + ".md")
            if alt.exists():
                p = alt
        if self.path and p == self.path:
            if frag:
                self.js("MdView.scrollToFragment", frag, True)
            return
        if not p.exists():
            self.js("MdView.toast", f"Not found: {p.name}")
        elif p.is_file() and (p.suffix.lower() in MD_EXT or p.suffix.lower() == ".pdf"):
            self.open_path(p, frag)
        else:
            launch_uri(p.as_uri())

    def open_wikilink(self, target):
        heading = target.split("#", 1)[1] if "#" in target else None
        p = self.resolver.resolve(target) if self.resolver else None
        if not p:
            self.js("MdView.toast", f"Note “{target.split('#')[0]}” doesn't exist")
        elif file_kind(p) in ("md", "pdf"):
            self.open_path(p, heading)
        else:
            launch_uri(p.as_uri())

    def toggle_task(self, line, checked):
        if not self.path or line < 0:
            return
        try:
            text = read_text(self.path)
        except OSError:
            return
        lines = text.split("\n")
        if line >= len(lines):
            return
        m = re.match(r"^([\s>]*(?:[-*+]|\d+[.)])\s+\[)(.)(\])", lines[line])
        if not m:
            self.render(keep_scroll=True)
            return
        lines[line] = m.group(1) + ("x" if checked else " ") + lines[line][m.end(2):]
        try:
            with open(self.path, "w", encoding="utf-8", newline="") as f:
                f.write("\n".join(lines))
        except OSError as e:
            self.js("MdView.toast", f"Couldn't save: {e.strerror}")
            self.render(keep_scroll=True)

    def save_text(self, text, exact=False):
        """exact: the text is the file as it is to be (the active mode keeps
        every line ending as it was); else "\n" throughout, written the way
        the file had it."""
        if self.path and self.path.suffix.lower() == ".pdf":
            return  # (never the text of a note into a PDF)
        if not self.path or not isinstance(text, str):
            return
        if exact:
            try:
                data = text.encode("utf-8")
                with open(self.path, "wb") as f:
                    f.write(data)
                self.own_write = data  # the file monitor will report it: nothing to reload
            except (OSError, UnicodeEncodeError) as e:
                self.js("MdView.saveFailed", getattr(e, "strerror", None) or str(e))
            return
        try:
            try:
                with open(self.path, "rb") as f:
                    old = f.read()
            except FileNotFoundError:
                old = b""
            # Written in place (no temp file + rename), so symlinked files and
            # their permissions stay what they are. Line endings are kept.
            data = (text.replace("\n", "\r\n") if b"\r\n" in old else text).encode("utf-8")
            if data != old:
                with open(self.path, "wb") as f:
                    f.write(data)
            self.own_text = text
        except OSError as e:
            self.js("MdView.saveFailed", e.strerror or str(e))

    # -- pasted images ----------------------------------------------------

    def attachment_dir(self, vault):
        """Where a pasted image goes: next to the note (or where the settings
        say, relative to it), or wherever the Obsidian vault keeps its
        attachments (default: the vault root)."""
        if not vault:
            where = str(self.app.prefs()["images"] or "beside").strip()
            if where in ("", "beside", "."):
                return self.path.parent
            d = Path(os.path.normpath(self.path.parent / ("assets" if where == "assets" else where.lstrip("/"))))
            return d if d.is_relative_to(self.path.parent) else self.path.parent
        try:
            conf = json.loads((vault / ".obsidian/app.json").read_text()).get("attachmentFolderPath")
        except (OSError, ValueError, AttributeError):
            conf = None
        if not isinstance(conf, str) or not conf.strip("/"):
            return vault
        d = self.path.parent / conf[2:] if conf.startswith("./") else vault / conf
        d = Path(os.path.normpath(d))
        return d if d.is_relative_to(vault) else vault

    def paste_image(self, path, append):
        """Save the clipboard image as a file and embed it: the page inserts
        the Markdown at the caret (editing), or it goes to the end of the note
        (reading)."""
        if not self.path or path != str(self.path):
            return
        img = clipboard_image()
        if not img:
            return
        data, ext = img
        old = b""
        if append:
            try:
                with open(self.path, "rb") as f:
                    old = f.read()
            except OSError as e:
                self.js("MdView.toast", f"Couldn't add image: {e.strerror}")
                return
            reason = readonly_reason(self.path, old)
            if reason:
                self.js("MdView.toast", f"Can't edit: {reason}")
                return
        vault = self.resolver.vault if self.resolver else None
        stem = time.strftime("Pasted image %Y%m%d%H%M%S" if vault else "pasted-%Y%m%d-%H%M%S")
        try:
            folder = self.attachment_dir(vault)
            folder.mkdir(parents=True, exist_ok=True)
            for n in range(1, 100):
                target = folder / f"{stem}{'' if n == 1 else f'-{n}'}{ext}"
                try:
                    with open(target, "xb") as f:
                        f.write(data)
                    break
                except FileExistsError:
                    continue
            else:
                raise FileExistsError(17, "File exists")
        except OSError as e:
            self.js("MdView.toast", f"Couldn't save image: {e.strerror}")
            return
        markup = self.image_markup(target, vault)
        if not append:
            self.js("MdView.insertImage", {"path": str(self.path), "markup": markup})
            return
        nl = b"\r\n" if b"\r\n" in old else b"\n"
        body = old.rstrip(b"\r\n")
        new = (body + nl * 2 if body else b"") + markup.encode("utf-8") + nl
        try:
            with open(self.path, "wb") as f:
                f.write(new)
        except OSError as e:
            self.js("MdView.toast", f"Couldn't save: {e.strerror}")
            try:
                target.unlink()
            except OSError:
                pass
            return
        self.own_write = new
        self.resolver = Resolver(self.path.parent)
        self.render(end=True)

    def image_markup(self, target, vault):
        if vault:
            return f"![[{target.name}]]"
        rel = os.path.relpath(target, self.path.parent).replace(os.sep, "/")
        return f"![]({quote(rel)})"

    def drop_files(self, uris, path):
        """Pictures dropped on the document: one inside the note's folder is
        linked where it is, any other is copied where pasted pictures go. The
        page inserts the Markdown where they were dropped (insertDropped)."""
        if not self.path or path != str(self.path):
            return
        vault = self.resolver.vault if self.resolver else None
        markups, skipped = [], 0
        for uri in uris:
            try:
                src = Path(Gio.File.new_for_uri(uri).get_path() or "")
            except (TypeError, GLib.Error):
                src = Path("")
            if not src.name or src.suffix.lower() not in IMAGE_EXT or not src.is_file():
                skipped += 1
                continue
            try:
                inside = src.resolve().is_relative_to(self.path.parent.resolve())
            except OSError:
                inside = False
            if inside:
                markups.append(self.image_markup(src.resolve(), vault))
                continue
            try:
                folder = self.attachment_dir(vault)
                folder.mkdir(parents=True, exist_ok=True)
                for n in range(1, 100):
                    target = folder / (src.name if n == 1 else f"{src.stem}-{n}{src.suffix}")
                    try:
                        with open(target, "xb") as f:
                            f.write(src.read_bytes())
                        break
                    except FileExistsError:
                        continue
                else:
                    raise FileExistsError(17, "File exists")
            except OSError as e:
                self.js("MdView.toast", f"Couldn't copy picture: {e.strerror}")
                continue
            markups.append(self.image_markup(target, vault))
        if skipped and not markups:
            self.js("MdView.toast", "Only pictures can be dropped here")
        if markups:
            self.js("MdView.insertDropped", {"path": str(self.path), "markups": markups})

    def open_external(self):
        if not self.path:
            return
        for cmd in (["omarchy-launch-editor", str(self.path)], ["xdg-open", str(self.path)]):
            try:
                subprocess.Popen(cmd, start_new_session=True,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except FileNotFoundError:
                continue

    def graphic_image(self, how):
        """A reference picture for a figure: chosen from the files, or the one on the clipboard
        (kept in the cache while it is needed). The page gets its path."""
        if how == "paste":
            got = clipboard_image()
            if not got:
                self.js("MdView.graphicImage", None, None, "No picture on the clipboard")
                return
            data, ext = got
            d = Path(GLib.get_user_cache_dir()) / "mdview"
            d.mkdir(parents=True, exist_ok=True)
            p = d / f"reference{ext}"
            p.write_bytes(data)
        else:
            dialog = Gtk.FileChooserNative.new("Reference picture", self, Gtk.FileChooserAction.OPEN, None, None)
            f = Gtk.FileFilter()
            f.set_name("Pictures")
            f.add_mime_type("image/*")
            dialog.add_filter(f)
            ok = dialog.run() == Gtk.ResponseType.ACCEPT
            name = dialog.get_filename() if ok else None
            dialog.destroy()
            if not name:
                return
            p = Path(name)
        self.js("MdView.graphicImage", str(p), p.as_uri() + f"?{int(time.time())}", None)

    def save_graphic(self, svg, name):
        """The figure as a file where the note's pictures go, and its Markdown at the caret."""
        svg = clean_svg(svg or "")
        if not svg or not self.path or self.path.suffix.lower() == ".pdf":
            return
        vault = self.resolver.vault if self.resolver else None
        words = re.findall(r"[\w-]+", clean_name(name or ""))[:5]
        stem = "-".join(words)[:48].strip("-") or "graphic"
        try:
            folder = self.attachment_dir(vault)
            folder.mkdir(parents=True, exist_ok=True)
            for n in range(1, 200):
                target = folder / f"{stem}{'' if n == 1 else f'-{n}'}.svg"
                try:
                    with open(target, "x", encoding="utf-8") as f:
                        f.write(svg + "\n")
                    break
                except FileExistsError:
                    continue
            else:
                raise FileExistsError(17, "File exists")
        except OSError as e:
            self.js("MdView.toast", f"Couldn't save the figure: {e.strerror}")
            return
        self.js("MdView.insertImage", {"path": str(self.path), "markup": self.image_markup(target, vault)})

    def file_op(self, op, path):
        """From a file's menu in the sidebar: open it in its default application, in one chosen
        from the system's list, or show it in the file manager."""
        inside = bool(path) and self.folder and Path(path).is_dir() and Path(path).resolve().is_relative_to(self.folder)
        if not path or not (path in self.note_paths or (op == "reveal" and inside)):
            return
        gfile = Gio.File.new_for_path(path)
        try:
            if op == "default":
                Gio.AppInfo.launch_default_for_uri(gfile.get_uri(), None)
            elif op == "openwith":
                if not self.open_with_portal(path):
                    dialog = Gtk.AppChooserDialog.new(self, Gtk.DialogFlags.MODAL, gfile)
                    if dialog.run() == Gtk.ResponseType.OK:
                        info = dialog.get_app_info()
                        if info:
                            info.launch([gfile], None)
                    dialog.destroy()
            elif op == "reveal":
                self.reveal(gfile)
        except GLib.Error as e:
            self.js("MdView.toast", e.message)

    def open_with_portal(self, path):
        """Ask xdg-desktop-portal which application should open the file (OpenURI with ask):
        the desktop's own chooser answers — Finder's — and launches the choice itself. False
        when there is no portal, so the caller falls back to GTK's dialog."""
        try:
            bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
            fd = os.open(path, os.O_RDONLY)
            try:
                fds = Gio.UnixFDList.new()
                index = fds.append(fd)
            finally:
                os.close(fd)
            bus.call_with_unix_fd_list_sync(
                "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop",
                "org.freedesktop.portal.OpenURI", "OpenFile",
                GLib.Variant("(sha{sv})", ("", index, {"ask": GLib.Variant("b", True)})),
                None, Gio.DBusCallFlags.NONE, 5000, fds, None)
            return True
        except (GLib.Error, OSError):
            return False

    def reveal(self, gfile):
        """Show the file in the file manager (org.freedesktop.FileManager1 — Finder here). On the
        session's own bus; a test instance has a bus of its own, so the user's is tried too."""
        args = GLib.Variant("(ass)", ([gfile.get_uri()], ""))
        buses = []
        try:
            buses.append(Gio.bus_get_sync(Gio.BusType.SESSION, None))
        except GLib.Error:
            pass
        user_bus = f"unix:path=/run/user/{os.getuid()}/bus"
        if os.environ.get("DBUS_SESSION_BUS_ADDRESS", "").split(",")[0] != user_bus and os.path.exists(user_bus[10:]):
            try:
                buses.insert(0, Gio.DBusConnection.new_for_address_sync(
                    user_bus, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
                    None, None))
            except GLib.Error:
                pass
        for bus in buses:
            try:
                bus.call_sync("org.freedesktop.FileManager1", "/org/freedesktop/FileManager1",
                              "org.freedesktop.FileManager1", "ShowItems", args, None,
                              Gio.DBusCallFlags.NONE, 5000, None)
                return
            except GLib.Error:
                continue
        launch_uri(gfile.get_parent().get_uri())  # (no file manager answers: its folder, at least)

    def settings_info(self):
        self.js("MdView.settingsInfo", {"aiKey": ai_key_state(), "aiModel": AI_MODEL,
                                        "version": app_version(), "configDir": str(AI_ENV.parent).replace(str(HOME), "~")})

    def go(self, src, dst):
        if not src:
            return
        if self.path:
            dst.append(self.path)
        self.open_path(src.pop(), push=False)

    def choose_file(self):
        dlg = Gtk.FileChooserNative.new("Open Markdown", self, Gtk.FileChooserAction.OPEN,
                                        "Open", "Cancel")
        flt = Gtk.FileFilter()
        flt.set_name("Markdown")
        flt.add_mime_type("text/markdown")
        for ext in MD_EXT:
            flt.add_pattern("*" + ext)
        dlg.add_filter(flt)
        if self.path:
            dlg.set_current_folder(str(self.path.parent))
        if dlg.run() == Gtk.ResponseType.ACCEPT:
            self.open_path(dlg.get_filename())
        elif not self.path and not self.folder:
            self.close()
        dlg.destroy()
        return False

    def close_now(self):
        self.close_id = 0
        self.close()
        return False

    def on_delete(self, *_):
        if self.editing and self.shell_ready and not self.closing:
            # Let the page hand over unsaved text first; it answers with "close".
            self.closing = True
            self.js("MdView.flush", True)
            self.close_id = GLib.timeout_add(400, self.close_now)
            return True
        if self.close_id:
            GLib.source_remove(self.close_id)
            self.close_id = 0
        if not self.is_maximized():
            w, h = self.get_size()
            if self.folder:
                self.app.state.update(folder_width=w, folder_height=h)
            else:
                self.app.state.update(width=w, height=h)
            save_state(self.app.state)
        if self.monitor:
            self.monitor.cancel()
        for mon in self.dir_monitors:
            mon.cancel()
        if self.rescan_id:
            GLib.source_remove(self.rescan_id)
            self.rescan_id = 0
        return False


# ---------------------------------------------------------------- app

class MdViewApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_OPEN)
        self.state = load_state()
        self.theme = load_theme()
        self.motion_css = self.read_motion()
        self.sf_symbols = has_font(SF_SYMBOLS)
        self.web_settings = None
        self.monitors = []
        self.theme_id = 0

    def illustrator(self):
        if not getattr(self, "_illustrator", None):
            self._illustrator = Illustrator()
        return self._illustrator

    def completer(self):
        if not getattr(self, "_completer", None):
            self._completer = Completer()
        return self._completer

    def prefs(self):
        stored = self.state.get("active")
        return {**PREFS, **{k: v for k, v in (stored if isinstance(stored, dict) else {}).items() if k in PREFS}}

    def set_prefs(self, new):
        prefs = self.prefs()
        for k, v in new.items():
            if k in PREFS and type(v) is type(PREFS[k]):
                prefs[k] = v
        self.state["active"] = {k: v for k, v in prefs.items() if v != PREFS[k]}
        save_state(self.state)
        for w in self.windows():
            w.js("MdView.setPrefs", prefs)
            if w.folder and any(k.startswith("sidebar") for k in new):
                w.rescan()  # (what the sidebar lists may have changed)

    def read_motion(self):
        css = ""
        for path in (MOTION_CSS, APPLE_CSS):
            try:
                css += path.read_text().replace("</", "<\\/") + "\n"
            except OSError:
                pass
        return css

    def do_startup(self):
        Gtk.Application.do_startup(self)
        self.set_inactivity_timeout(RESIDENT_MS)
        ctx = WebKit2.WebContext.get_default()
        ctx.set_cache_model(WebKit2.CacheModel.DOCUMENT_VIEWER)
        self.probe_context = WebKit2.WebContext.new_ephemeral() if PROBE else None
        s = WebKit2.Settings()
        s.set_allow_file_access_from_file_urls(True)
        s.set_allow_universal_access_from_file_urls(False)
        s.set_enable_smooth_scrolling(True)
        s.set_enable_developer_extras(DEBUG)
        s.set_enable_write_console_messages_to_stdout(DEBUG)
        s.set_javascript_can_open_windows_automatically(False)
        s.set_enable_page_cache(False)
        s.set_enable_back_forward_navigation_gestures(False)
        s.set_default_font_family("Inter")
        s.set_sans_serif_font_family("Inter")
        s.set_monospace_font_family("JetBrainsMono Nerd Font")
        s.set_default_font_size(16)
        s.set_default_monospace_font_size(14)
        self.web_settings = s
        if self.prefs().get("hinting"):  # (text on whole pixels: the app's own choice, not the desktop's)
            Gtk.Settings.get_default().set_property("gtk-xft-hintstyle", "hintfull")
        for path, cb in ((THEME_DIR / "theme.name", self.on_theme_changed),
                         (THEME_DIR / "theme/colors.toml", self.on_theme_changed),
                         (things_tokens_path() or HOME / ".local/share/things-clone" / THINGS_TOKENS, self.on_theme_changed),
                         (MOTION_CSS, self.on_motion_changed),
                         (APPLE_CSS, self.on_motion_changed)):
            try:
                mon = Gio.File.new_for_path(str(path)).monitor_file(Gio.FileMonitorFlags.NONE, None)
                mon.connect("changed", cb)
                self.monitors.append(mon)
            except GLib.Error:
                pass

    def windows(self):
        return [w for w in self.get_windows() if isinstance(w, ViewerWindow)]

    def on_theme_changed(self, *_):
        if self.theme_id:
            GLib.source_remove(self.theme_id)
        self.theme_id = GLib.timeout_add(150, self.apply_theme)

    def apply_theme(self):
        self.theme_id = 0
        self.theme = load_theme()
        bg = Gdk.RGBA()
        bg.parse(self.theme["colors"]["background"])
        for w in self.windows():
            w.override_background_color(Gtk.StateFlags.NORMAL, bg)
            w.view.set_background_color(bg)
            w.js("MdView.setTheme", theme_css(self.theme), self.theme["mode"])
        return False

    def on_motion_changed(self, *_):
        self.motion_css = self.read_motion()
        for w in self.windows():
            w.js("MdView.setMotion", self.motion_css)

    def restart_if_stale(self, args):
        """The process stays resident, the page (viewer.js) is read fresh for
        every window: after an update the two would not match. With no window
        open, start over from the new source instead."""
        if self.windows():
            return
        try:
            if SOURCE.stat().st_mtime_ns == SOURCE_STAMP:
                return
        except OSError:
            return
        os.execv(sys.executable, [sys.executable, str(SOURCE), *args])

    def open_folder(self, folder):
        existing = next((w for w in self.windows() if w.folder == folder), None)
        if existing:
            existing.present()
        else:
            ViewerWindow(self, None, folder=folder).show()

    def do_activate(self):
        self.restart_if_stale([])
        # Started bare: back to the folder that was open last, if there was one.
        last = self.state.get("folder")
        if last and Path(last).is_dir():
            self.open_folder(Path(last))
        else:
            ViewerWindow(self, None).show()

    def do_open(self, files, _n, _hint):
        self.restart_if_stale([f.get_path() or f.get_uri() for f in files])
        for f in files:
            path = f.get_path()
            if not path:
                uri = f.get_uri()
                launch_uri(uri)
                continue
            p = Path(path).resolve()
            if p.is_dir():
                self.open_folder(p)
                continue
            existing = next((w for w in self.windows() if w.path == p), None)
            if existing:
                existing.present()
            else:
                ViewerWindow(self, p).show()


def main():
    GLib.set_prgname(APP_ID)
    GLib.set_application_name("Markdown Notes")
    return MdViewApp().run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())
