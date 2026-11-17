// The AI of the app (area D): the chat, "Transform with AI", the whiteboard's questions, figures drawn by a model,
// suggestions while typing, the key. Rust originals: ai.rs, shell/claude.rs, and graphic_image/save_graphic of
// shell/files.rs. The questions go to the `claude` command line tool (its answer streamed back to the page as it
// comes), the suggestions to Gemini over HTTPS; both off the main thread.
import AppKit
import Foundation
import Security

// MARK: - the state of one window

final class AIState {
    let lock = NSLock()
    /// channel -> (whose answer counts, its process)
    var talks: [String: (turn: Int, pid: Int32?)] = [:]
    var talkTurn = 0
    /// the figure being drawn
    var drawTurn = 0
    var drawPid: Int32?
    /// files chosen in the system's window for Claude to read (the chat's context): only those are handed to it
    var files: Set<String> = []
    /// … and what the answer of that window carries, so that nothing else can name files
    let token = UUID().uuidString.lowercased()
    /// a suggestion under way (the newest waits)
    var pending: AICompletion.Question?
    var busy = 0
}

// MARK: - the key (Keychain; the Rust shell's ~/.config/mdview/.env is read as a fallback)

enum AIKey {
    static let service = "com.henrischulz.mdview"
    static let account = "GEMINI_API_KEY"

    static var configDir: String {
        if let x = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"], !x.isEmpty { return Lib.join(x, "mdview") }
        return Lib.join(Lib.home(), ".config/mdview")
    }
    static var envFile: String { Lib.join(configDir, ".env") }

    private static func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func keychain() -> String? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        let s = String(decoding: d, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? nil : s
    }

    static var fromEnvironment: String { (ProcessInfo.processInfo.environment["GEMINI_API_KEY"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    /// GEMINI_API_KEY from the environment, the Keychain, or ~/.config/mdview/.env.
    static func get() -> String? {
        let env = fromEnvironment
        if !env.isEmpty { return env }
        if let k = keychain() { return k }
        guard let text = Lib.read(envFile) else { return nil }
        for line in text.components(separatedBy: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("GEMINI_API_KEY=") {
                let v = t.dropFirst("GEMINI_API_KEY=".count).trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
                return v.isEmpty ? nil : v
            }
        }
        return nil
    }

    /// What the settings show of the key: whether there is one, its last four signs, and whether it comes from the
    /// environment (then the stored one is not used). Never the key itself.
    static func state() -> [String: Any] {
        let env = fromEnvironment
        let key = env.isEmpty ? (get() ?? "") : env
        let tail = key.count > 8 ? String(key.suffix(4)) : ""
        return ["set": !key.isEmpty, "tail": tail, "env": !env.isEmpty]
    }

    /// Keeps the key in the Keychain, or takes it out (an empty one); the old .env line goes too, or it would come back.
    static func store(_ raw: String) throws {
        let key = raw.filter { !$0.isWhitespace }
        SecItemDelete(query() as CFDictionary)
        if !key.isEmpty {
            var q = query()
            q[kSecValueData as String] = Data(key.utf8)
            q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
            let st = SecItemAdd(q as CFDictionary, nil)
            if st != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(st), userInfo: [NSLocalizedDescriptionKey: (SecCopyErrorMessageString(st, nil) as String?) ?? "Keychain error \(st)"]) }
        }
        if let text = Lib.read(envFile), text.contains("GEMINI_API_KEY=") {
            let kept = text.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("GEMINI_API_KEY=") }
            let joined = kept.joined(separator: "\n").trimmingCharacters(in: .newlines)
            try (joined.isEmpty ? "" : joined + "\n").write(toFile: envFile, atomically: true, encoding: .utf8)
            try? Lib.fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: envFile)
        }
    }
}

// MARK: - the claude command line tool

enum Claude {
    /// A folder of its own for one talk or one figure: its files to read, where claude runs. Named by the window's channel
    /// or turn, two windows shared one — a chat in B deleted the files of A's chat while it ran, and A's end deleted B's
    /// (review 2026-11-17; Rust's are app-wide).
    static func workDir(_ kind: String) -> String {
        NSTemporaryDirectory() + "mdview-\(kind)-\(ProcessInfo.processInfo.processIdentifier)-\(UUID().uuidString)"
    }

    /// The login shell's PATH: an app started from the Dock has the system's own, short one.
    static let loginPath: String = {
        let base = ["\(Lib.home())/.local/bin", "\(Lib.home())/.claude/local", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        var found: [String] = []
        let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { Lib.exists($0) ? $0 : nil } ?? "/bin/zsh"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: shell)
        p.arguments = ["-l", "-c", "printf %s \"$PATH\""]
        let out = Pipe()
        p.standardOutput = out; p.standardError = FileHandle.nullDevice; p.standardInput = FileHandle.nullDevice
        if (try? p.run()) != nil {
            let item = DispatchWorkItem { if p.isRunning { p.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 4, execute: item)
            let d = out.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            item.cancel()
            found = String(decoding: d, as: UTF8.self).split(separator: ":").map(String.init)
        }
        var all: [String] = []
        for d in (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init) + found + base where !d.isEmpty && !all.contains(d) { all.append(d) }
        return all.joined(separator: ":")
    }()

    static func runs(_ p: String) -> Bool { Lib.fm.isExecutableFile(atPath: p) && Lib.isFile(p) }

    private static var cached: String?
    /// The claude command line tool: on the PATH (the login shell's too), or where its installers put it.
    static func find() -> String? {
        if let c = cached, runs(c) { return c }
        for d in loginPath.split(separator: ":") { let p = Lib.join(String(d), "claude"); if runs(p) { cached = p; return p } }
        let home = Lib.home()
        for rel in [".local/share/mise/installs/claude/latest/claude", ".local/bin/claude", ".claude/local/claude", ".local/share/mise/shims/claude"] {
            let p = Lib.join(home, rel)
            if runs(p) { cached = p; return p }
        }
        return nil
    }

    static var environment: [String: String] {
        var e = ProcessInfo.processInfo.environment
        e["PATH"] = loginPath
        return e
    }

    struct Result { var out: String; var err: String; var timedOut: Bool }

    /// Runs the tool; `lines` gets what it writes to stdout a line at a time. `pid` is told the process (and nil when it is done).
    static func run(args: [String], cwd: String, input: Data?, timeout: TimeInterval, pid: (Int32?) -> Void, lines: ((String) -> Void)? = nil) throws -> Result {
        guard let exe = find() else { throw NSError(domain: "claude", code: 1, userInfo: [NSLocalizedDescriptionKey: "The claude command was not found. Install Claude Code, or turn AI off in the settings."]) }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.currentDirectoryURL = URL(fileURLWithPath: cwd)
        p.environment = environment
        let (outP, errP, inP) = (Pipe(), Pipe(), Pipe())
        p.standardOutput = outP; p.standardError = errP
        p.standardInput = input == nil ? FileHandle.nullDevice : inP
        try p.run()
        pid(p.processIdentifier)
        if let input {
            DispatchQueue.global().async { Pipes.feed(inP.fileHandleForWriting, input) }
        }
        var errText = ""
        let errDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            errText = String(decoding: errP.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            errDone.signal()
        }
        var late = false
        let watchdog = DispatchWorkItem { if p.isRunning { late = true; Darwin.kill(p.processIdentifier, SIGKILL) } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: watchdog)
        var all = Data(), buf = Data()
        let h = outP.fileHandleForReading
        while true {
            let d = h.availableData
            if d.isEmpty { break }
            all.append(d)
            if let lines {
                buf.append(d)
                while let nl = buf.firstIndex(of: 10) {
                    lines(String(decoding: buf[buf.startIndex..<nl], as: UTF8.self))
                    buf = Data(buf[(nl + 1)...])
                }
            }
        }
        if let lines, !buf.isEmpty { lines(String(decoding: buf, as: UTF8.self)) }
        p.waitUntilExit()
        watchdog.cancel()
        errDone.wait()
        pid(nil)
        return Result(out: String(decoding: all, as: UTF8.self), err: errText, timedOut: late)
    }

    static func kill(pid: Int32) { Darwin.kill(pid, SIGKILL) }
}

/// The first n letters (a character each), as the Rust shell's `take`.
func aiTake(_ s: String, _ n: Int) -> String { s.count <= n ? s : String(s.prefix(n)) }

// MARK: - the figure's SVG, cleaned

enum AISVG {
    private static let svg = Lib.rx(#"<svg\b.*</svg>"#, [.caseInsensitive, .dotMatchesLineSeparators])
    private static let active = Lib.rx(#"<script\b.*?</script\s*>|<foreignObject\b.*?</foreignObject\s*>"#, [.caseInsensitive, .dotMatchesLineSeparators])
    private static let on = Lib.rx(#"\son\w+\s*=\s*("[^"]*"|'[^']*')"#, [.caseInsensitive])
    private static let href = Lib.rx(#"(\s(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*')"#, [.caseInsensitive])

    /// The SVG in the model's answer, without anything that could run or load: or nil.
    static func clean(_ text: String) -> String? {
        guard let m = svg.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let r = Range(m.range, in: text) else { return nil }
        var s = String(text[r])
        s = Lib.sub(active, s, "")
        s = Lib.sub(on, s, "")
        // (a reference inside the figure stays; anything that points out of it does not)
        var out = "", last = s.startIndex
        for m in href.matches(in: s, range: NSRange(s.startIndex..., in: s)) {
            guard let whole = Range(m.range, in: s), let g1 = Range(m.range(at: 1), in: s), let g2 = Range(m.range(at: 2), in: s) else { continue }
            out += s[last..<whole.lowerBound]
            let value = s[g2]
            out += value.dropFirst().hasPrefix("#") ? String(s[whole]) : "\(s[g1])\"#\""
            last = whole.upperBound
        }
        out += s[last...]
        s = out
        let head = s.split(separator: ">", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        if !head.contains("xmlns=") {
            if let r = s.range(of: "<svg") { s.replaceSubrange(r, with: "<svg xmlns=\"http://www.w3.org/2000/svg\"") }
        }
        return s
    }
}

// MARK: - what the page asks

extension NoteWindow {
    /// What settings_info shows of the AI (area E adds it to MdView.settingsInfo): the key's state, the model, where the config lives.
    func aiSettingsInfo() -> [String: Any] {
        let home = Lib.home()
        let cfg = AIKey.configDir
        let shown = (!home.isEmpty && cfg.hasPrefix(home)) ? "~" + cfg.dropFirst(home.count) : cfg
        return ["aiKey": AIKey.state(), "aiModel": AIPrompts.model, "configDir": shown]
    }

    func handleAssistant(_ type: String, _ msg: [String: Any]) -> Bool {
        let str = { (k: String) in msg[k] as? String ?? "" }
        switch type {
        case "graphic":
            func nonEmpty(_ k: String) -> String? { let v = str(k); return v.isEmpty ? nil : v }
            drawFigure(id: msg["id"] ?? NSNull(), text: aiTake(str("text"), 6000), image: nonEmpty("image"), previous: nonEmpty("previous"),
                       change: nonEmpty("change").map { aiTake($0, 3000) })
        case "graphic-cancel": stopFigure()
        case "ai-ask": aiAsk(msg)
        case "ai-pick": aiPick()
        case "ai-picked": aiPicked(msg)
        case "ai-stop": stopTalk(str("channel"))
        case "graphic-image": graphicImage(how: str("how"), data: str("data"))
        case "graphic-save": saveGraphic(svg: str("svg"), name: str("name"))
        case "complete": aiComplete(msg)
        case "aikey":
            do { try AIKey.store(str("key")) } catch { toast("Couldn't save the key: \(error.localizedDescription)") }
            _ = handleSystem("settings-info", [:])
        default: return false
        }
        return true
    }

    // MARK: chat, Transform, board, Improve

    func stopTalk(_ channel: String) {
        aiS.lock.lock()
        let pid = aiS.talks.removeValue(forKey: channel)?.pid
        aiS.lock.unlock()
        if let pid { Claude.kill(pid: pid) }
    }

    func aiAsk(_ msg: [String: Any]) {
        let str = { (k: String) in msg[k] as? String ?? "" }
        let prefs = store.prefs
        let channel = str("channel"), id = msg["id"] ?? NSNull()
        if (prefs["aiOn"] as? Bool) == false || !["transform", "chat", "board", "improve"].contains(channel) {
            return js("MdView.aiDone", [id, NSNull(), "AI is turned off in the settings"])
        }
        let m = (prefs["aiClaude"] as? String) ?? ""
        let model = (2...60).contains(m.utf8.count) && m.unicodeScalars.allSatisfy { ($0.isASCII && CharacterSet.alphanumerics.contains($0)) || "._-".unicodeScalars.contains($0) } ? m : ""
        let name = aiTake(str("name"), 200), note = aiTake(str("note"), 120_000)
        let whole = note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "The note\(name.isEmpty ? "" : " “\(name)”"):\n<note>\n\(note)\n</note>\n\n"
        // (a whiteboard open: what is on it, as board/claude.js tells it — for the board's own question and for the chat)
        let boardText = aiTake(str("board"), 240_000)
        let board = boardText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "The board:\n<board-now>\n\(boardText)\n</board-now>\n\n"
        let system: String, prompt: String
        if channel == "improve" {
            system = AIPrompts.improve
            prompt = "The strokes chosen:\n<strokes>\n\(aiTake(str("strokes"), 120_000))\n</strokes>"
        } else if channel == "board" {
            system = AIPrompts.boardSystem(chat: false)
            prompt = "\(board)What the user asks: \(aiTake(str("instruction"), 4000))"
        } else if channel == "transform" {
            system = AIPrompts.transform
            prompt = "\(whole)The selected part of the note:\n<selection>\n\(aiTake(str("selection"), 60_000))\n</selection>\n\nWhat to do with the selected part: \(aiTake(str("instruction"), 4000))\n\nReply with the Markdown that takes its place, and nothing else."
        } else {
            let said: [String] = ((msg["messages"] as? [[String: Any]]) ?? []).suffix(30).compactMap { m in
                guard let t = m["text"] as? String else { return nil }
                return "\((m["role"] as? String) == "assistant" ? "Assistant" : "User"): \(aiTake(t, 20_000))"
            }
            let chosenText = aiTake(str("selection"), 20_000)
            let chosen = chosenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "What the user has selected in the note right now:\n<selection>\n\(chosenText)\n</selection>\n\n"
            let atText = aiTake(str("where"), 400)
            let at = atText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "The user is looking at the page “\(atText.trimmingCharacters(in: .whitespacesAndNewlines))” of the note right now: “this page”, “the subpage”, “here” mean that page.\n\n"
            system = !board.isEmpty ? AIPrompts.boardSystem(chat: true) : (truthy(msg["edit"]) ? AIPrompts.chatEdit : AIPrompts.chat)
            prompt = "\(whole)\(board)\(at)\(chosen)The conversation so far:\n\n\(said.joined(separator: "\n\n"))\n\nReply as the assistant to the user's last message."
        }
        // what else the chat was given to read: other notes of the folder, the whole folder, files chosen in the system's window
        var more = "", attach: [String] = []
        // (what the window shows of the board, as a picture the page drew — a PNG that goes with the question)
        var picture: Data?
        if !(board.isEmpty && channel != "improve"), let d = Data(base64Encoded: str("picture")), d.count <= 20_000_000, d.starts(with: [0x89, 0x50, 0x4E, 0x47]) { picture = d }
        if channel == "chat" {
            var room = 400_000   // (letters of other documents, all told: what fits a question)
            func put(_ p: String) -> Bool {
                guard let raw = Lib.read(p, limit: 2_000_000) else { return false }
                let text = aiTake(raw, 80_000)
                if text.utf8.count > room { return false }
                room -= text.utf8.count
                more += "<document name=\"\(Lib.name(p).replacingOccurrences(of: "\"", with: "'"))\">\n\(text)\n</document>\n\n"
                return true
            }
            for c in ((msg["context"] as? [[String: Any]]) ?? []).prefix(40) {
                let p = (c["path"] as? String) ?? ""
                switch c["kind"] as? String {
                case "note" where notePaths.contains(p): _ = put(p)
                case "folder":
                    // (what was written last first: it is what fits when not all does)
                    let notes = notePaths.filter { Lib.isMd($0) && $0 != path }.sorted { Lib.mtime($0) > Lib.mtime($1) }
                    let left = notes.filter { !put($0) }.map(Lib.name)
                    if !left.isEmpty { more += "(Notes of the folder that are not given here, for their length: \(aiTake(left.joined(separator: ", "), 4000)).)\n\n" }
                case "file" where aiS.files.contains(p) && Lib.isFile(p):
                    // (a file from elsewhere: only one chosen in the system's window — text as text, anything else for Claude to read)
                    let size = ((try? Lib.fm.attributesOfItem(atPath: p)[.size]) as? Int) ?? 0
                    let texty = !Lib.imgExt.contains(Lib.ext(p)) && !Lib.isPDF(p) && size <= 2_000_000
                        && (Lib.fm.contents(atPath: p).map { String(data: $0, encoding: .utf8) != nil } ?? false)
                    if !(texty && put(p)) && size <= 30_000_000 { attach.append(p) }
                default: break
                }
            }
            if !more.isEmpty { more = "Other documents the user gave you to read:\n\n\(more)" }
        }
        let effort = (board.isEmpty && channel != "improve") ? "" : "low"   // (a board's answer is watched as it comes: begun soon)
        startTalk(Talk(id: id, channel: channel, system: system, prompt: more + prompt, model: model, attach: attach, picture: picture, effort: effort))
    }

    struct Talk {
        var id: Any, channel: String, system: String, prompt: String, model: String
        var attach: [String], picture: Data?, effort: String
    }

    /// Claude asked through the command line tool, its answer handed on as it comes. One talk for each channel: a new
    /// one, or stop, ends the one before.
    func startTalk(_ t: Talk) {
        stopTalk(t.channel)
        aiS.lock.lock()
        aiS.talkTurn += 1
        let mine = aiS.talkTurn
        aiS.talks[t.channel] = (mine, nil)
        aiS.lock.unlock()
        let state = aiS
        let current: () -> Bool = { state.lock.lock(); defer { state.lock.unlock() }; return state.talks[t.channel]?.turn == mine }
        let setPid: (Int32?) -> Void = { pid in
            state.lock.lock(); defer { state.lock.unlock() }
            if state.talks[t.channel]?.turn == mine { state.talks[t.channel]?.pid = pid }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let piece: (String) -> Void = { text in
                DispatchQueue.main.async { self?.js("MdView.aiDelta", [t.id, text]) }
            }
            var said: String?, error: String?
            do { said = try Self.talk(t, setPid: setPid, current: current, piece: piece) } catch let e { error = e.localizedDescription }
            if !current() { return }   // stopped, or another question took its place
            state.lock.lock(); state.talks[t.channel] = nil; state.lock.unlock()
            DispatchQueue.main.async { self?.js("MdView.aiDone", [t.id, said as Any? ?? NSNull(), error as Any? ?? NSNull()]) }
        }
    }

    /// The talk itself: the answer's pieces go out as they come; → all of it, or what went wrong.
    private static func talk(_ t: Talk, setPid: @escaping (Int32?) -> Void, current: @escaping () -> Bool, piece: @escaping (String) -> Void) throws -> String {
        func fail(_ s: String) -> NSError { NSError(domain: "ai", code: 1, userInfo: [NSLocalizedDescriptionKey: s]) }
        let env = ProcessInfo.processInfo.environment
        if let fake = env["MDVIEW_TALK_FAKE"] {
            // (tests: no model — what is said is given, in two pieces; before "||" for a transform, after it for the chat)
            let both = fake.components(separatedBy: "||")
            let (first, second, third) = (both[0], both.count > 1 ? both[1] : nil, both.count > 2 ? both[2] : nil)
            let board = (t.channel == "board" || t.channel == "improve") ? env[t.channel == "improve" ? "MDVIEW_IMPROVE_FAKE" : "MDVIEW_BOARD_FAKE"] : nil
            var said: String
            if let b = board { said = b }
            else if t.system == AIPrompts.chatEdit { said = third ?? second ?? first }
            else if t.channel == "chat" { said = second ?? first }
            else { said = first }
            said = said.replacingOccurrences(of: "CHANNEL", with: t.channel).replacingOccurrences(of: "PICTURE", with: t.picture != nil ? "with a picture" : "without a picture")
                .replacingOccurrences(of: "SEEN", with: t.prompt.contains("<document name=\"other.md\">\n# Other\n\nother note text") ? "Seen: other note text." : "")
            if t.prompt.contains("please fail") { Thread.sleep(forTimeInterval: 0.15); throw fail("Claude: asked to fail") }
            let chars = Array(said), cut = chars.count / 2
            for part in [String(chars[..<cut]), String(chars[cut...])] {
                Thread.sleep(forTimeInterval: 0.2)
                if !current() { throw fail("stopped") }
                piece(part)
            }
            return said
        }
        guard Claude.find() != nil else { throw fail("The claude command was not found. Install Claude Code, or turn AI off in the settings.") }
        let work = Claude.workDir("talk")
        try? Lib.fm.removeItem(atPath: work)
        do { try Lib.fm.createDirectory(atPath: work, withIntermediateDirectories: true) } catch { throw fail("Couldn't run claude: \(error.localizedDescription)") }
        defer { try? Lib.fm.removeItem(atPath: work) }
        // (files to read: copies in its own folder, the only place its one tool may look)
        var attached: [String] = []
        for (i, src) in t.attach.prefix(12).enumerated() {
            let name = "\(i + 1)-\(Lib.name(src))"
            if (try? Lib.fm.copyItem(atPath: src, toPath: Lib.join(work, name))) != nil { attached.append(name) }
        }
        var prompt = t.prompt
        // (the question on the way in, not as an argument: a note is longer than a command line may be)
        var args = ["-p", "--system-prompt", t.system]
        if attached.isEmpty { args += ["--tools", ""] }
        else {
            args += ["--tools", "Read", "--allowedTools", "Read", "--add-dir", work]
            prompt = "Files the user attached lie in \(work): \(attached.joined(separator: ", ")). Read each of them with the Read tool before you answer.\n\n\(prompt)"
        }
        args += ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--output-format", "stream-json", "--include-partial-messages", "--verbose"]
        args += AIPrompts.settings
        // (a picture with the question: the question as a message of its own, the picture in it)
        if t.picture != nil { args += ["--input-format", "stream-json"] }
        if !t.effort.isEmpty { args += ["--effort", t.effort] }
        if !t.model.isEmpty { args += ["--model", t.model] }
        var input: Data
        if let png = t.picture {
            let message: [String: Any] = ["type": "user", "message": ["role": "user", "content": [
                ["type": "text", "text": t.channel == "improve" ? "The strokes chosen, as they look:" : "What the window shows of the whiteboard now:"],
                ["type": "image", "source": ["type": "base64", "media_type": "image/png", "data": png.base64EncodedString()]],
                ["type": "text", "text": prompt],
            ]]]
            input = (try? JSONSerialization.data(withJSONObject: message)) ?? Data()
            input.append(10)
        } else { input = Data(prompt.utf8) }
        var said = "", result: String?, failed: String?
        let r: Claude.Result
        do {
            r = try Claude.run(args: args, cwd: work, input: input, timeout: 600, pid: setPid, lines: { line in
                guard let d = line.data(using: .utf8), let v = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
                switch v["type"] as? String {
                case "stream_event":
                    if let ev = v["event"] as? [String: Any], ev["type"] as? String == "content_block_delta",
                       let delta = ev["delta"] as? [String: Any], delta["type"] as? String == "text_delta",
                       let text = delta["text"] as? String, current() { said += text; piece(text) }
                case "result":
                    if (v["is_error"] as? Bool) == true { failed = String(((v["result"] as? String) ?? "it failed").prefix(300)) }
                    else { result = v["result"] as? String }
                default: break
                }
            })
        } catch { throw fail("Couldn't run claude: \(error.localizedDescription)") }
        if r.timedOut { throw fail("Claude took longer than ten minutes") }
        if let failed { throw fail("Claude: \(failed)") }
        let text = said.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (result ?? "") : said
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let last = r.err.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").last.map { String($0.prefix(200)) }
            throw fail("Claude: \((last?.isEmpty ?? true) ? "nothing came back" : last!)")
        }
        return text
    }

    // MARK: files for the chat

    /// Files for Claude to read, chosen in the system's own window; what was chosen comes back as "ai-picked", with this window's word.
    func aiPick() {
        let panel = NSOpenPanel()
        panel.title = "Add to the Conversation"
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        let token = aiS.token
        panel.beginSheetModal(for: window) { [weak self] r in
            let paths = r == .OK ? panel.urls.map { $0.path } : []
            _ = self?.handleAssistant("ai-picked", ["token": token, "paths": paths])
        }
    }

    func aiPicked(_ msg: [String: Any]) {
        guard (msg["token"] as? String) == aiS.token else { return }
        var list: [[String: Any]] = []
        for p in ((msg["paths"] as? [String]) ?? []).map(Lib.resolve).filter(Lib.isFile).prefix(12) {
            list.append(["path": p, "name": Lib.name(p)])
            aiS.files.insert(p)
        }
        js("MdView.aiPicked", [list])
    }

    // MARK: a figure

    func stopFigure() {
        aiS.lock.lock()
        aiS.drawTurn += 1
        let pid = aiS.drawPid
        aiS.drawPid = nil
        aiS.lock.unlock()
        if let pid { Claude.kill(pid: pid) }
    }

    /// Has Claude draw a figure (the tool without its own — only reading the reference picture, when there is one). One at a time.
    func drawFigure(id: Any, text: String, image: String?, previous: String?, change: String?) {
        stopFigure()
        aiS.lock.lock(); let mine = aiS.drawTurn; aiS.lock.unlock()
        let state = aiS
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let (svg, error) = Self.drawRun(text: text, image: image, previous: previous, change: change, mine: mine, state: state) else { return }
            DispatchQueue.main.async { self?.js("MdView.graphic", [id, svg as Any? ?? NSNull(), error as Any? ?? NSNull()]) }
        }
    }

    /// (svg, error) for the page, or nil when the request was stopped meanwhile.
    private static func drawRun(text: String, image: String?, previous: String?, change: String?, mine: Int, state: AIState) -> (String?, String?)? {
        let still: () -> Bool = { state.lock.lock(); defer { state.lock.unlock() }; return state.drawTurn == mine }
        if let fake = ProcessInfo.processInfo.environment["MDVIEW_GRAPHIC_FAKE"] {
            // (tests: no model, a known figure)
            Thread.sleep(forTimeInterval: 0.4)
            let tag = change != nil ? "changed" : image != nil ? "ref" : "new"
            return still() ? (AISVG.clean(fake.replacingOccurrences(of: "TAG", with: tag)), nil) : nil
        }
        guard Claude.find() != nil else { return (nil, "The claude command was not found") }
        let work = Claude.workDir("graphic")
        try? Lib.fm.removeItem(atPath: work)
        defer { try? Lib.fm.removeItem(atPath: work) }
        do {
            try Lib.fm.createDirectory(atPath: work, withIntermediateDirectories: true)
            var tools = ["--tools", ""]
            let prompt: String
            if let previous, !previous.isEmpty, let change {
                prompt = "Here is the figure you drew:\n\n\(previous)\n\nChange it as follows and reply with the complete new SVG: \(change)"
            } else if let image {
                let e = Lib.ext(image)
                let reference = Lib.join(work, "reference." + (e.isEmpty ? "png" : e))
                try Lib.fm.copyItem(atPath: image, toPath: reference)
                tools = ["--tools", "Read", "--allowedTools", "Read", "--add-dir", work]
                let how = text.isEmpty ? "." : ", following this description: \(text)"
                prompt = "A reference picture is at \(reference) — read it first. Redraw what it shows as a clean figure in your style\(how)"
            } else { prompt = text.isEmpty ? "" : "Draw: \(text)" }
            let args = ["-p", prompt, "--system-prompt", AIPrompts.graphic] + tools
                + ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--output-format", "text"] + AIPrompts.settings
            let r = try Claude.run(args: args, cwd: work, input: nil, timeout: 300, pid: { pid in
                state.lock.lock(); if state.drawTurn == mine { state.drawPid = pid }; state.lock.unlock()
            })
            if !still() { return nil }   // stopped: whoever stopped it has taken the process
            let err = r.timedOut ? "It took longer than five minutes" : r.err
            if let svg = AISVG.clean(r.timedOut ? "" : r.out) { return (svg, nil) }
            let said = err.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? r.out : err
            let last = said.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").last.map { String($0.prefix(200)) }
            return (nil, "Claude: \((last?.isEmpty ?? true) ? "no figure came back" : last!)")
        } catch { return still() ? (nil, "Couldn't run claude: \(error.localizedDescription)") : nil }
    }

    /// A reference picture for a figure: chosen from the files, or the one on the clipboard (kept in the cache while it is
    /// needed). The page gets its path.
    func graphicImage(how: String, data sent: String) {
        if how != "paste" && how != "data" {
            let panel = NSOpenPanel()
            panel.title = "Reference picture"
            panel.allowedContentTypes = Array(Lib.imgExt).compactMap { .init(filenameExtension: $0) }
            panel.beginSheetModal(for: window) { [weak self] r in
                guard r == .OK, let p = panel.url?.path else { return }
                self?.js("MdView.graphicImage", [p, "\(Page.fileURL(p))?\(Int(Date().timeIntervalSince1970))", NSNull()])
            }
            return
        }
        var got: (Data, String)?
        if how == "data" {
            if let d = Data(base64Encoded: sent), d.count <= 20_000_000, d.starts(with: [0x89, 0x50, 0x4E, 0x47]) { got = (d, ".png") }
        } else if let png = clipboardPNG() { got = (png, ".png") }
        guard let (data, ext) = got else {
            return js("MdView.graphicImage", [NSNull(), NSNull(), how == "data" ? "No picture came" : "No picture on the clipboard"])
        }
        let cache = (ProcessInfo.processInfo.environment["XDG_CACHE_HOME"].flatMap { $0.isEmpty ? nil : $0 } ?? Lib.join(Lib.home(), "Library/Caches")) + "/mdview"
        let p = Lib.join(cache, "reference\(ext)")
        do {
            try Lib.fm.createDirectory(atPath: cache, withIntermediateDirectories: true)
            try data.write(to: URL(fileURLWithPath: p))
            js("MdView.graphicImage", [p, "\(Page.fileURL(p))?\(Int(Date().timeIntervalSince1970))", NSNull()])
        } catch {}
    }

    /// The picture on the clipboard, as a PNG.
    private func clipboardPNG() -> Data? {
        let pb = NSPasteboard.general
        if let d = pb.data(forType: .png) { return d }
        if let d = pb.data(forType: .tiff), let rep = NSBitmapImageRep(data: d) { return rep.representation(using: .png, properties: [:]) }
        return nil
    }

    // MARK: the figure kept as a file of the note

    /// The figure as a file where the note's pictures go, and its Markdown at the caret.
    func saveGraphic(svg: String, name: String) {
        guard let svg = AISVG.clean(svg), let note = path, !Lib.shownAsPDF(note) else { return }
        let vault = resolver?.vault
        let words = Lib.rx(#"[\w-]+"#).matches(in: Lib.clean(name), range: NSRange(location: 0, length: (Lib.clean(name) as NSString).length))
            .prefix(5).map { (Lib.clean(name) as NSString).substring(with: $0.range) }
        var stem = aiTake(words.joined(separator: "-"), 48).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        if stem.isEmpty { stem = "graphic" }
        // (where a pasted picture goes, named as one is — Files.swift: the project's assets for a note of a linked project
        // under the folder shown, never outside the note's folder; its own copy of these had drifted: review 2026-11-17)
        let folder = attachmentDir(note, vault: vault)
        do {
            let target = try Lib.writeNew(folder, tries: 200, data: Data((svg + "\n").utf8), name: { $0 == 1 ? "\(stem).svg" : "\(stem)-\($0).svg" })
            attachments().own(target, note)
            js("MdView.insertImage", [["path": note, "markup": imageMarkup(target, note, vault: vault != nil)]])
        } catch { toast("Couldn't save the figure: \(error.localizedDescription)") }
    }

    // MARK: suggestions while typing

    func aiComplete(_ msg: [String: Any]) {
        let prefs = store.prefs
        guard truthy(prefs["aiComplete"]), truthy(prefs["aiOn"]) else { return }
        let before = String((msg["before"] as? String ?? "").suffix(6000))
        let model = AIPrompts.aiModel((prefs["aiModel"] as? String) ?? "")
        let q = AICompletion.Question(window: self, id: msg["id"] ?? NSNull(), before: before, after: aiTake(msg["after"] as? String ?? "", 1000), model: model)
        aiS.lock.lock()
        aiS.pending = q
        aiS.lock.unlock()
        AICompletion.drain(aiS)
    }
}

// MARK: - the model asked for the next words (Gemini)

enum AICompletion {
    struct Question {
        weak var window: NoteWindow?
        var id: Any, before: String, after: String, model: String
    }
    /// a model that does not know thinkingLevel is asked without
    static var thinking = true
    static let workers = 3

    /// A few questions may be under way at once; when all are busy, only the newest question waits (the page drops answers
    /// that no longer fit).
    static func drain(_ s: AIState) {
        s.lock.lock()
        while s.busy < workers, let q = s.pending {
            s.pending = nil
            s.busy += 1
            s.lock.unlock()
            DispatchQueue.global(qos: .userInitiated).async {
                let (text, error) = complete(q)
                DispatchQueue.main.async { q.window?.js("MdView.completion", [q.id, text as Any? ?? NSNull(), error as Any? ?? NSNull()]) }
                s.lock.lock(); s.busy -= 1; s.lock.unlock()
                drain(s)
            }
            s.lock.lock()
        }
        s.lock.unlock()
    }

    static func complete(_ q: Question) -> (String?, String?) {
        if let fake = ProcessInfo.processInfo.environment["MDVIEW_AI_FAKE"] {
            Thread.sleep(forTimeInterval: 0.05)   // (tests: no network, a known answer)
            return (fake, nil)
        }
        guard let key = AIKey.get() else { return (nil, "No GEMINI_API_KEY in the Keychain or \(AIKey.envFile)") }
        let session: URLSession = {
            let c = URLSessionConfiguration.ephemeral
            c.timeoutIntervalForRequest = 8
            c.timeoutIntervalForResource = 8
            return URLSession(configuration: c)
        }()
        for attempt in 0..<3 {
            var config: [String: Any] = ["maxOutputTokens": 40, "temperature": 0.2, "stopSequences": ["\n"]]
            if thinking { config["thinkingConfig"] = ["thinkingLevel": "minimal"] }
            let body: [String: Any] = [
                "systemInstruction": ["parts": [["text": AIPrompts.autocomplete]]],
                "contents": [["role": "user", "parts": [["text": "\(q.before)<caret/>\(q.after)"]]]],
                "generationConfig": config,
            ]
            guard let url = URL(string: "https://\(AIPrompts.host)/v1beta/models/\(q.model):generateContent"),
                  let data = try? JSONSerialization.data(withJSONObject: body) else { return (nil, nil) }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.httpBody = data
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(key, forHTTPHeaderField: "x-goog-api-key")
            let done = DispatchSemaphore(value: 0)
            var got: (Data?, URLResponse?, Error?)
            session.dataTask(with: req) { got = ($0, $1, $2); done.signal() }.resume()
            done.wait()
            if let e = got.2 {
                if attempt == 2 { return (nil, "Suggestions: \(e.localizedDescription)") }
                continue
            }
            let status = (got.1 as? HTTPURLResponse)?.statusCode ?? 0
            let json = got.0.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } ?? [:]
            if (200..<300).contains(status) {
                let parts = (((json["candidates"] as? [[String: Any]])?.first?["content"] as? [String: Any])?["parts"] as? [[String: Any]]) ?? []
                return (parts.compactMap { $0["text"] as? String }.joined(), nil)
            }
            let message = ((json["error"] as? [String: Any])?["message"] as? String) ?? String(status)
            if status == 400 && thinking && message.contains("hinking") { thinking = false; continue }   // (this model is asked without the setting)
            return (nil, "Suggestions: \(message.prefix(160))")
        }
        return (nil, nil)
    }
}
