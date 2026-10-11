//! What the page asks of Claude: a graphic drawn, the chat and Transform with AI, the words that
//! may come next (ai.rs does the asking).

use super::*;

impl Win {
    /// The messages for a graphic, the chat and a continuation (messages.rs hands them over).
    pub(super) fn on_claude_message(&mut self, app: &mut App, msg: &Value) {
        let text_of = |key: &str| msg[key].as_str().unwrap_or("");
        match text_of("type") {
            "graphic" => app.illustrator.draw(Drawing {
                label: self.label.clone(),
                id: msg["id"].clone(),
                text: take(text_of("text"), 6000),
                image: msg["image"].as_str().filter(|i| !i.is_empty()).map(String::from),
                previous: msg["previous"].as_str().filter(|p| !p.is_empty()).map(String::from),
                change: Some(take(text_of("change"), 3000)).filter(|c| !c.is_empty()),
            }),
            "graphic-cancel" => app.illustrator.stop(),
            // Claude asked about a part of the note (transform) or the whole of it (chat): its answer comes in pieces
            // (MdView.aiDelta) and ends (MdView.aiDone). Not where AI is turned off in the settings.
            "ai-ask" => {
                let prefs = app.prefs();
                let (channel, id) = (text_of("channel").to_string(), msg["id"].clone());
                if prefs.get("aiOn") == Some(&Value::Bool(false)) || !matches!(channel.as_str(), "transform" | "chat") {
                    return self.js("MdView.aiDone", &[id, Value::Null, json!("AI is turned off in the settings")]);
                }
                let model = prefs.get("aiClaude").and_then(Value::as_str).filter(|m| (2..=60).contains(&m.len()) && m.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))).unwrap_or("").to_string();
                let (name, note) = (take(text_of("name"), 200), take(text_of("note"), 120_000));
                let whole = if note.trim().is_empty() { String::new() } else { format!("The note{}:\n<note>\n{note}\n</note>\n\n", if name.is_empty() { String::new() } else { format!(" “{name}”") }) };
                let (system, prompt) = if channel == "transform" {
                    (ai::TRANSFORM_SYSTEM, format!("{whole}The selected part of the note:\n<selection>\n{}\n</selection>\n\nWhat to do with the selected part: {}\n\nReply with the Markdown that takes its place, and nothing else.", take(text_of("selection"), 60_000), take(text_of("instruction"), 4000)))
                } else {
                    let said: Vec<String> = msg["messages"].as_array().map(Vec::as_slice).unwrap_or_default().iter().rev().take(30).rev()
                        .filter_map(|m| Some(format!("{}: {}", if m["role"] == "assistant" { "Assistant" } else { "User" }, take(m["text"].as_str()?, 20_000))))
                        .collect();
                    let chosen = take(text_of("selection"), 20_000);
                    let chosen = if chosen.trim().is_empty() { String::new() } else { format!("What the user has selected in the note right now:\n<selection>\n{chosen}\n</selection>\n\n") };
                    let at = take(text_of("where"), 400);
                    let at = if at.trim().is_empty() { String::new() } else { format!("The user is looking at the page “{}” of the note right now: “this page”, “the subpage”, “here” mean that page.\n\n", at.trim()) };
                    (if truthy(&msg["edit"]) { ai::CHAT_EDIT_SYSTEM } else { ai::CHAT_SYSTEM }, format!("{whole}{at}{chosen}The conversation so far:\n\n{}\n\nReply as the assistant to the user's last message.", said.join("\n\n")))
                };
                // what else the chat was given to read: other notes of the folder, the whole folder, files chosen in the system's window
                let (mut more, mut attach) = (String::new(), Vec::new());
                if channel == "chat" {
                    let mut room = 400_000usize; // (letters of other documents, all told: what fits a question)
                    let put = |more: &mut String, path: &Path, room: &mut usize| -> bool {
                        let Ok(text) = scan::read_text(path, Some(2_000_000)) else { return false };
                        let text = take(&text, 80_000);
                        if text.len() > *room {
                            return false;
                        }
                        *room -= text.len();
                        more.push_str(&format!("<document name=\"{}\">\n{text}\n</document>\n\n", name_of(path).replace('"', "'")));
                        true
                    };
                    for c in msg["context"].as_array().map(Vec::as_slice).unwrap_or_default().iter().take(40) {
                        let path = c["path"].as_str().map(PathBuf::from).unwrap_or_default();
                        match c["kind"].as_str() {
                            // (a note: one of the folder's, as the sidebar lists them)
                            Some("note") if self.note_paths.contains(&s(&path)) => {
                                put(&mut more, &path, &mut room);
                            }
                            Some("folder") => {
                                let mut notes: Vec<PathBuf> = self.note_paths.iter().map(PathBuf::from).filter(|p| scan::is_md(p) && Some(p) != self.path.as_ref()).collect();
                                notes.sort_by(|a, b| mtime(b).unwrap_or(0.0).total_cmp(&mtime(a).unwrap_or(0.0))); // (what was written last first: it is what fits when not all does)
                                let left: Vec<String> = notes.iter().filter(|p| !put(&mut more, p, &mut room)).map(|p| name_of(p)).collect();
                                if !left.is_empty() {
                                    more.push_str(&format!("(Notes of the folder that are not given here, for their length: {}.)\n\n", take(&left.join(", "), 4000)));
                                }
                            }
                            // (a file from elsewhere: only one that was chosen in the system's window — text as text, anything else for Claude to read)
                            Some("file") if self.ai_files.contains(&path) && path.is_file() => {
                                let texty = !scan::IMAGE_EXT.contains(&scan::ext_of(&path).as_str()) && !is_pdf(&path) && fs::metadata(&path).is_ok_and(|m| m.len() <= 2_000_000) && fs::read(&path).is_ok_and(|b| std::str::from_utf8(&b).is_ok());
                                if !(texty && put(&mut more, &path, &mut room)) && fs::metadata(&path).is_ok_and(|m| m.len() <= 30_000_000) {
                                    attach.push(path);
                                }
                            }
                            _ => {}
                        }
                    }
                    if !more.is_empty() {
                        more = format!("Other documents the user gave you to read:\n\n{more}");
                    }
                }
                app.talker.ask(Talk { label: self.label.clone(), id, channel, system, prompt: format!("{more}{prompt}"), model, attach });
            }
            // files for Claude to read, chosen in the system's own window; what was chosen comes back as "ai-picked", with this window's word
            "ai-pick" => {
                let Some(window) = &self.window else { return };
                let (tx, label, token) = (app.tx.clone(), self.label.clone(), self.ai_token.clone());
                app.handle.dialog().file().set_parent(window).set_title("Add to the Conversation").pick_files(move |paths| {
                    let paths: Vec<String> = paths.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).map(|p| s(&p)).collect();
                    let _ = tx.send(Event::Msg { label, json: json!({ "type": "ai-picked", "token": token, "paths": paths }).to_string() });
                });
            }
            "ai-picked" if text_of("token") == self.ai_token => {
                let mut list = Vec::new();
                for p in msg["paths"].as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).map(|p| resolve(Path::new(p))).filter(|p| p.is_file()).take(12) {
                    list.push(json!({ "path": s(&p), "name": name_of(&p) }));
                    self.ai_files.insert(p);
                }
                self.js("MdView.aiPicked", &[json!(list)]);
            }
            "ai-stop" => app.talker.stop(text_of("channel")),
            "graphic-image" => self.graphic_image(app, text_of("how"), text_of("data")),
            "graphic-save" => self.save_graphic(app, text_of("svg"), text_of("name")),
            "complete" => {
                // the next words for what is being written (active/ghost.js); only when switched on
                let prefs = app.prefs();
                if truthy(&prefs["aiComplete"]) && truthy(&prefs["aiOn"]) {
                    let before: Vec<char> = text_of("before").chars().collect();
                    let before: String = before[before.len().saturating_sub(6000)..].iter().collect();
                    let model = ai::ai_model(prefs["aiModel"].as_str().unwrap_or(""));
                    let tx = app.tx.clone();
                    app.completer.get_or_insert_with(|| Completer::new(tx)).ask(&self.label, msg["id"].clone(), before, take(text_of("after"), 1000), model);
                }
            }
            _ => {}
        }
    }
}
