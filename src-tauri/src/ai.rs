//! The two things asked of a model: the next words while typing (Gemini, over HTTPS) and a
//! figure drawn as SVG (the claude command line tool). Both off the window's thread.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

use regex::{Captures, Regex};
use serde_json::{json, Value};

use crate::theme::home;
use crate::Event;

pub const AI_MODEL: &str = "gemini-3.5-flash-lite";
const AI_HOST: &str = "generativelanguage.googleapis.com";
const AI_SYSTEM: &str = "You are the autocomplete of a note-taking app. The user's note is given with the caret \
marked as <caret/>. Reply with the text that continues at the caret and nothing else: at \
most twelve words, finishing the current clause or sentence, in the language of the note, \
in its tone. Do not repeat text that is already there, do not add quotes or explanations. \
If the note uses Markdown or LaTeX there, continue in it; inside a formula ($…$ or $$…$$) \
reply with LaTeX only, inside a code span or a fenced code block with code in its \
language only. If nothing sensible follows, reply with nothing.";

const GRAPHIC_SYSTEM: &str = r##"You draw technical illustrations as SVG. Reply with one complete SVG document and nothing else — no prose, no code fence.

Style (always):
- Clean, calm line drawing in the manner of a well-typeset textbook. One stroke width (1.6) for everything that is drawn, 1 for hairlines such as dimension or grid lines; round line caps and joins.
- Geometry on an 8-unit grid; wires horizontal or vertical with right angles; symbols aligned; generous, even spacing. Nothing overlaps; labels never touch lines.
- Colour: strokes and text use currentColor. At most one accent colour (#0a84ff) for the one thing the figure is about, and its 12 % tint for fills. No gradients, no shadows, no backgrounds.
- Text: font-family "Inter", system-ui, sans-serif; 13 px for labels, 11 px for secondary text; variables in italics; text-anchor chosen so labels sit centred on or next to what they name. Labels in the language of the request.
- Standard symbols: circuits use IEC symbols (resistor as a rectangle, capacitor as two plates, ground, sources as circles), junction dots where wires join; logic uses the distinctive-shape gates (AND, OR, NOT bubble, XOR) with inputs left and outputs right; RTL and block diagrams use rounded rectangles for modules, trapezoids for multiplexers, a triangle marker for clocked registers, buses as thicker lines with a slash and width; arrows have small filled heads.
- The <svg> has xmlns, a viewBox that fits the drawing with 16 units of margin, width and height attributes equal to the viewBox size, and this first child, exactly:
  <style>:root{color:#1d1d1f}@media (prefers-color-scheme:dark){:root{color:#f5f5f7}}text{font-family:Inter,system-ui,sans-serif;fill:currentColor}</style>
- No scripts, no external references, no images, no foreignObject."##;

pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME").filter(|d| !d.is_empty()).map(PathBuf::from);
    #[cfg(windows)]
    let base = base.or_else(|| std::env::var_os("APPDATA").map(PathBuf::from));
    base.unwrap_or_else(|| home().join(".config")).join("mdview")
}

fn env_file() -> PathBuf {
    config_dir().join(".env")
}

/// The key for the model: GEMINI_API_KEY from the environment or ~/.config/mdview/.env.
fn ai_key() -> Option<String> {
    if let Some(key) = std::env::var("GEMINI_API_KEY").ok().filter(|k| !k.is_empty()) {
        return Some(key.trim().to_string());
    }
    let text = fs::read_to_string(env_file()).ok()?;
    text.lines().find_map(|line| {
        let value = line.trim().strip_prefix("GEMINI_API_KEY=")?;
        Some(value.trim().trim_matches(['\'', '"']).to_string())
    })
}

/// What the settings show of the key: whether there is one, its last four signs, and whether
/// it comes from the environment (then the file's is not used). Never the key itself.
pub fn ai_key_state() -> Value {
    let env = std::env::var("GEMINI_API_KEY").unwrap_or_default().trim().to_string();
    let key = if env.is_empty() { ai_key().unwrap_or_default() } else { env.clone() };
    let chars: Vec<char> = key.chars().collect();
    let tail: String = if chars.len() > 8 { chars[chars.len() - 4..].iter().collect() } else { String::new() };
    json!({ "set": !key.is_empty(), "tail": tail, "env": !env.is_empty() })
}

/// Writes GEMINI_API_KEY into ~/.config/mdview/.env (only the user may read it), or takes it
/// out; the file's other lines stay.
pub fn store_ai_key(key: &str) -> std::io::Result<()> {
    let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let file = env_file();
    let mut lines: Vec<String> = fs::read_to_string(&file)
        .map(|t| t.lines().filter(|l| !l.trim().starts_with("GEMINI_API_KEY=")).map(String::from).collect())
        .unwrap_or_default();
    if !key.is_empty() {
        lines.push(format!("GEMINI_API_KEY={key}"));
    }
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let text = if lines.is_empty() { String::new() } else { lines.join("\n") + "\n" };
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&file)?;
        f.write_all(text.as_bytes())?;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    fs::write(&file, text)?;
    Ok(())
}

/// The model asked: the settings' own, if it reads like a model's name, else AI_MODEL.
pub fn ai_model(name: &str) -> String {
    let ok = (3..=80).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    if ok { name.to_string() } else { AI_MODEL.to_string() }
}

struct Question {
    label: String,
    id: Value,
    before: String,
    after: String,
    model: String,
}

/// Asks the model for a continuation, off the main thread — the way GitHub Copilot asks:
/// a few questions may be under way at once, each over its own connection that is kept
/// open, so that an answer on its way never holds up a newer question. When all are busy,
/// only the newest question waits (the page drops answers that no longer fit).
pub struct Completer {
    slot: Arc<(Mutex<Option<Question>>, Condvar)>,
}

impl Completer {
    const WORKERS: usize = 3;

    pub fn new(tx: Sender<Event>) -> Self {
        let slot = Arc::new((Mutex::new(None::<Question>), Condvar::new()));
        // (thinkingLevel "minimal": a model that does not know it is asked without)
        let thinking = Arc::new(AtomicBool::new(true));
        for _ in 0..Self::WORKERS {
            let (slot, tx, thinking) = (slot.clone(), tx.clone(), thinking.clone());
            std::thread::spawn(move || {
                let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).build();
                loop {
                    let q = {
                        let mut pending = slot.0.lock().unwrap();
                        loop {
                            match pending.take() {
                                Some(q) => break q,
                                None => pending = slot.1.wait(pending).unwrap(),
                            }
                        }
                    };
                    let (text, error) = complete(&agent, &thinking, &q);
                    if tx.send(Event::Completion { label: q.label, id: q.id, text, error }).is_err() {
                        return;
                    }
                }
            });
        }
        Completer { slot }
    }

    pub fn ask(&self, label: &str, id: Value, before: String, after: String, model: String) {
        *self.slot.0.lock().unwrap() = Some(Question { label: label.to_string(), id, before, after, model });
        self.slot.1.notify_one();
    }
}

fn complete(agent: &ureq::Agent, thinking: &AtomicBool, q: &Question) -> (Option<String>, Option<String>) {
    if let Ok(fake) = std::env::var("MDVIEW_AI_FAKE") {
        // (tests: no network, a known answer)
        std::thread::sleep(Duration::from_millis(50));
        return (Some(fake), None);
    }
    let Some(key) = ai_key() else {
        return (None, Some(format!("No GEMINI_API_KEY in {}", env_file().display())));
    };
    for attempt in 0..3 {
        // (a connection kept open may have been closed by the other side)
        let mut config = json!({ "maxOutputTokens": 40, "temperature": 0.2, "stopSequences": ["\n"] });
        if thinking.load(Ordering::Relaxed) {
            config["thinkingConfig"] = json!({ "thinkingLevel": "minimal" });
        }
        let body = json!({
            "systemInstruction": { "parts": [{ "text": AI_SYSTEM }] },
            "contents": [{ "role": "user", "parts": [{ "text": format!("{}<caret/>{}", q.before, q.after) }] }],
            "generationConfig": config,
        });
        let url = format!("https://{AI_HOST}/v1beta/models/{}:generateContent", q.model);
        let sent = agent.post(&url).set("Content-Type", "application/json").set("x-goog-api-key", &key).send_string(&body.to_string());
        let parse = |res: ureq::Response| -> Value { res.into_string().ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null) };
        match sent {
            Ok(res) => {
                let data = parse(res);
                let parts = data["candidates"][0]["content"]["parts"].as_array().cloned().unwrap_or_default();
                return (Some(parts.iter().filter_map(|p| p["text"].as_str()).collect()), None);
            }
            Err(ureq::Error::Status(status, res)) => {
                let data = parse(res);
                let message = data["error"]["message"].as_str().map(String::from).unwrap_or_else(|| status.to_string());
                if status == 400 && thinking.load(Ordering::Relaxed) && message.contains("hinking") {
                    thinking.store(false, Ordering::Relaxed); // (this model is asked without the setting)
                    continue;
                }
                return (None, Some(format!("Suggestions: {}", message.chars().take(160).collect::<String>())));
            }
            Err(e) => {
                if attempt == 2 {
                    return (None, Some(format!("Suggestions: {e}")));
                }
            }
        }
    }
    (None, None)
}

/// The claude command line tool: on the PATH, or where its installers put it (an app started
/// from the desktop does not always have the shell's PATH).
fn find_claude() -> Option<PathBuf> {
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    let runs = |p: &Path| -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        }
        #[cfg(not(unix))]
        {
            p.is_file()
        }
    };
    if let Some(hit) = std::env::var_os("PATH").and_then(|path| std::env::split_paths(&path).map(|d| d.join(name)).find(|p| runs(p))) {
        return Some(hit);
    }
    [".local/share/mise/installs/claude/latest/claude", ".local/bin/claude", ".claude/local/claude", ".local/share/mise/shims/claude"]
        .iter()
        .map(|p| home().join(p))
        .find(|p| runs(p))
}

static SVG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<svg\b.*</svg>").unwrap());
static SVG_ACTIVE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<script\b.*?</script\s*>|<foreignObject\b.*?</foreignObject\s*>").unwrap());
static SVG_ON_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\son\w+\s*=\s*("[^"]*"|'[^']*')"#).unwrap());
static SVG_HREF_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)(\s(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*')"#).unwrap());

/// The SVG in the model's answer, without anything that could run or load: or None.
pub fn clean_svg(text: &str) -> Option<String> {
    let svg = SVG_RE.find(text)?.as_str();
    let svg = SVG_ACTIVE_RE.replace_all(svg, "");
    let svg = SVG_ON_RE.replace_all(&svg, "");
    // (a reference inside the figure stays; anything that points out of it does not)
    let svg = SVG_HREF_RE.replace_all(&svg, |c: &Captures| if c[2][1..].starts_with('#') { c[0].to_string() } else { format!("{}\"#\"", &c[1]) });
    let mut svg = svg.into_owned();
    if !svg.split('>').next().unwrap_or("").contains("xmlns=") {
        svg = svg.replacen("<svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"", 1);
    }
    Some(svg)
}

pub struct Drawing {
    pub label: String,
    pub id: Value,
    pub text: String,
    pub image: Option<String>,
    pub previous: Option<String>,
    pub change: Option<String>,
}

/// Has Claude draw a figure (the claude command line tool, without its tools — only reading
/// the reference picture, when there is one). One at a time; a new request or stop ends the old.
pub struct Illustrator {
    tx: Sender<Event>,
    turn: Arc<AtomicU64>,          // which request is the one whose answer counts
    pid: Arc<Mutex<Option<u32>>>,  // the process drawing now
}

impl Illustrator {
    pub fn new(tx: Sender<Event>) -> Self {
        Illustrator { tx, turn: Arc::new(AtomicU64::new(0)), pid: Arc::new(Mutex::new(None)) }
    }

    pub fn stop(&self) {
        self.turn.fetch_add(1, Ordering::SeqCst);
        if let Some(pid) = self.pid.lock().unwrap().take() {
            kill(pid);
        }
    }

    pub fn draw(&self, d: Drawing) {
        self.stop();
        let mine = self.turn.load(Ordering::SeqCst);
        let (tx, turn, pid) = (self.tx.clone(), self.turn.clone(), self.pid.clone());
        std::thread::spawn(move || {
            let (label, id) = (d.label.clone(), d.id.clone());
            if let Some((svg, error)) = run(d, mine, &turn, &pid) {
                let _ = tx.send(Event::Graphic { label, id, svg, error });
            }
        });
    }
}

fn kill(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    #[cfg(not(unix))]
    {
        let _ = Command::new("taskkill").args(["/F", "/T", "/PID", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

/// (svg, error) for the page, or None when the request was stopped meanwhile.
fn run(d: Drawing, mine: u64, turn: &AtomicU64, pid: &Mutex<Option<u32>>) -> Option<(Option<String>, Option<String>)> {
    if let Ok(fake) = std::env::var("MDVIEW_GRAPHIC_FAKE") {
        // (tests: no model, a known figure)
        std::thread::sleep(Duration::from_millis(400));
        let tag = if d.change.is_some() { "changed" } else if d.image.is_some() { "ref" } else { "new" };
        return (turn.load(Ordering::SeqCst) == mine).then(|| (clean_svg(&fake.replace("TAG", tag)), None)); // (cleaned as a model's answer is: the page may put it into the note as it comes)
    }
    let Some(exe) = find_claude() else {
        return Some((None, Some("The claude command was not found".into())));
    };
    let work = std::env::temp_dir().join(format!("mdview-graphic-{}-{mine}", std::process::id()));
    let result = (|| -> std::io::Result<Option<(Option<String>, Option<String>)>> {
        fs::create_dir_all(&work)?;
        let mut tools: Vec<String> = vec!["--tools".into(), "".into()];
        let prompt = match (&d.previous, &d.change) {
            (Some(previous), Some(change)) if !previous.is_empty() => {
                format!("Here is the figure you drew:\n\n{previous}\n\nChange it as follows and reply with the complete new SVG: {change}")
            }
            _ => match &d.image {
                Some(image) => {
                    let ext = Path::new(image).extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_else(|| ".png".into());
                    let reference = work.join(format!("reference{ext}"));
                    fs::copy(image, &reference)?;
                    tools = ["--tools", "Read", "--allowedTools", "Read", "--add-dir"].iter().map(|s| s.to_string()).collect();
                    tools.push(work.to_string_lossy().into_owned());
                    let how = if d.text.is_empty() { ".".to_string() } else { format!(", following this description: {}", d.text) };
                    format!("A reference picture is at {} — read it first. Redraw what it shows as a clean figure in your style{how}", reference.display())
                }
                None if d.text.is_empty() => String::new(),
                None => format!("Draw: {}", d.text),
            },
        };
        let mut cmd = Command::new(exe);
        cmd.arg("-p").arg(prompt).arg("--system-prompt").arg(GRAPHIC_SYSTEM).args(&tools);
        cmd.args(["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--output-format", "text"]);
        cmd.current_dir(&work).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd.spawn()?;
        *pid.lock().unwrap() = Some(child.id());
        let read = |pipe: Option<Box<dyn Read + Send>>| {
            std::thread::spawn(move || {
                let mut text = String::new();
                if let Some(mut p) = pipe {
                    let mut raw = Vec::new();
                    let _ = p.read_to_end(&mut raw);
                    text = String::from_utf8_lossy(&raw).into_owned();
                }
                text
            })
        };
        let out = read(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
        let err = read(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
        let deadline = Instant::now() + Duration::from_secs(300);
        let mut late = false;
        loop {
            if child.try_wait()?.is_some() {
                break;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                late = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let (out, mut err) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
        if late {
            err = "It took longer than five minutes".into();
        }
        if turn.load(Ordering::SeqCst) != mine {
            return Ok(None); // stopped: whoever stopped it has taken the process
        }
        *pid.lock().unwrap() = None;
        Ok(Some(match clean_svg(if late { "" } else { &out }) {
            Some(svg) => (Some(svg), None),
            None => {
                let said = if err.trim().is_empty() { out } else { err };
                let last = said.trim().lines().last().map(|l| l.chars().take(200).collect::<String>());
                (None, Some(format!("Claude: {}", last.unwrap_or_else(|| "no figure came back".into()))))
            }
        }))
    })();
    let _ = fs::remove_dir_all(&work);
    match result {
        Ok(r) => r,
        Err(e) => Some((None, Some(format!("Couldn't run claude: {e}")))),
    }
}
