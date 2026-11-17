// The git command line, as the history reaches a repository (the Rust shell links libgit2; this app asks /usr/bin/git).
// Nothing here prompts: a credential is handed in with the call (an Authorization header for GitHub, in memory only —
// it stands in no file and in no address).
import Foundation

struct GitResult {
    var status: Int32
    var out: Data
    var err: String
    var ok: Bool { status == 0 }
    var text: String { String(decoding: out, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) }
    var raw: String { String(decoding: out, as: UTF8.self) }
}

enum Git {
    static let exe = FileManager.default.isExecutableFile(atPath: "/usr/bin/git") ? "/usr/bin/git" : "/opt/homebrew/bin/git"

    /// Runs git in `dir` (nil: where the app is). `env` adds to the environment, `input` goes to its standard input.
    @discardableResult
    static func run(_ args: [String], in dir: String? = nil, env: [String: String] = [:], input: Data? = nil) -> GitResult {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        if let dir { p.currentDirectoryURL = URL(fileURLWithPath: dir) }
        var e = ProcessInfo.processInfo.environment
        e["GIT_TERMINAL_PROMPT"] = "0"
        e["GIT_OPTIONAL_LOCKS"] = "0"
        e["LC_ALL"] = "C"
        e["GIT_ASKPASS"] = "/usr/bin/true"
        e.removeValue(forKey: "GIT_DIR"); e.removeValue(forKey: "GIT_INDEX_FILE"); e.removeValue(forKey: "GIT_WORK_TREE")
        for (k, v) in env { e[k] = v }
        p.environment = e
        let out = Pipe(), err = Pipe(), inp = Pipe()
        p.standardOutput = out; p.standardError = err
        p.standardInput = input != nil ? inp : FileHandle.nullDevice
        var outData = Data(), errData = Data()
        let g = DispatchGroup()
        do { try p.run() } catch { return GitResult(status: 127, out: Data(), err: error.localizedDescription) }
        g.enter(); DispatchQueue.global().async { outData = out.fileHandleForReading.readDataToEndOfFile(); g.leave() }
        g.enter(); DispatchQueue.global().async { errData = err.fileHandleForReading.readDataToEndOfFile(); g.leave() }
        if let input { Pipes.feed(inp.fileHandleForWriting, input) }
        p.waitUntilExit()
        g.wait()
        return GitResult(status: p.terminationStatus, out: outData, err: String(decoding: errData, as: UTF8.self))
    }

    static func lines(_ r: GitResult) -> [String] { r.raw.split(separator: "\n", omittingEmptySubsequences: true).map(String.init) }

    /// The arguments that carry a token to GitHub, and only to GitHub.
    static func auth(_ token: String?) -> [String] {
        guard let token, !token.isEmpty else { return ["-c", "credential.helper="] }
        let b = Data("x-access-token:\(token)".utf8).base64EncodedString()
        let host = Hosts.current.web
        return ["-c", "credential.helper=", "-c", "http.\(host)/.extraHeader=Authorization: Basic \(b)"]
    }
}

/// One `git cat-file --batch-check` process kept for many questions about objects ("<commit>:<path>").
final class BatchCheck {
    private let p = Process()
    private let inp = Pipe(), out = Pipe()
    private var buffer = Data()
    private var cache: [String: String?] = [:]

    init(repo: String) {
        p.executableURL = URL(fileURLWithPath: Git.exe)
        p.arguments = ["cat-file", "--batch-check"]
        p.currentDirectoryURL = URL(fileURLWithPath: repo)
        p.standardInput = inp; p.standardOutput = out; p.standardError = FileHandle.nullDevice
        _ = Pipes.safe
        try? p.run()
    }

    deinit { try? inp.fileHandleForWriting.close(); p.terminate() }

    /// The blob id of a path in a commit (nil: not there).
    func blob(_ commit: String, _ rel: String) -> String? {
        let key = "\(commit):\(rel)"
        if let c = cache[key] { return c }
        guard Pipes.feed(inp.fileHandleForWriting, Data((key + "\n").utf8), close: false) else { return nil } // (the process is gone)
        var line = ""
        while true {
            if let r = buffer.firstIndex(of: 10) {
                line = String(decoding: buffer[buffer.startIndex..<r], as: UTF8.self)
                buffer.removeSubrange(buffer.startIndex...r)
                break
            }
            let d = out.fileHandleForReading.availableData
            if d.isEmpty { break }
            buffer.append(d)
        }
        let parts = line.split(separator: " ")
        let id: String? = parts.count >= 3 && parts[1] == "blob" ? String(parts[0]) : nil
        cache[key] = id
        return id
    }
}
