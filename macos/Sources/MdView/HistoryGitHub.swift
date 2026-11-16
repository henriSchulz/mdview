// Signing in with GitHub, for a linked project's other side. The app is a GitHub App's client: it shows a code, the user
// confirms it in the browser (the device flow — nothing secret is in the program), and GitHub hands out a token for eight hours
// and one to renew it with for six months. The renewing one is kept in the Keychain, the other only in memory. Rust original: github.rs.
import Foundation
import Security

struct Hosts {
    var web: String
    var api: String
    static var current: Hosts {
        let e = ProcessInfo.processInfo.environment
        func from(_ n: String, _ or: String) -> String { (e[n].flatMap { $0.isEmpty ? nil : $0 }) ?? or }
        return Hosts(web: from("MDVIEW_GITHUB_WEB", "https://github.com"), api: from("MDVIEW_GITHUB_API", "https://api.github.com"))
    }
}

struct Session {
    var access: String
    var expires: Double
    var login: String
    var name: String
    var id: Int
    /// Who the commits made here are by: the name, and the address GitHub knows the account by without telling a real one.
    var author: (String, String) { (name.isEmpty ? login : name, "\(id)+\(login)@users.noreply.github.com") }
}

enum GitHubNews {
    case code(String, String)
    case signedIn(Session, String?)
    case out(String)
    case later
    case repos(Result<[[String: Any]], HistoryError>)
    case made(Result<[String: Any], HistoryErrorJSON>)
}
struct HistoryErrorJSON: Error { var json: [String: Any] }

enum GitHub {
    static let clientID = "Iv23liovowgVJASctV6s" // (the GitHub App "mdview"; not a secret)
    static let service = "dev.henri.MdView"
    static let give = "https://github.com/settings/installations"
    static let page = 100
    static let pages = 5

    static func now() -> Double { Date().timeIntervalSince1970 }

    // MARK: http

    /// A request made and waited for (on a background thread): (status, body).
    static func http(_ req: URLRequest, timeout: TimeInterval = 15) -> (Int, Data)? {
        var r = req
        r.timeoutInterval = timeout
        let sem = DispatchSemaphore(value: 0)
        var result: (Int, Data)?
        URLSession.shared.dataTask(with: r) { d, resp, _ in
            if let h = resp as? HTTPURLResponse { result = (h.statusCode, d ?? Data()) }
            sem.signal()
        }.resume()
        sem.wait()
        return result
    }

    static func json(_ d: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:] }

    /// A form sent to GitHub's sign-in side; what it says, as JSON (also where it says no).
    static func form(_ hosts: Hosts, _ path: String, _ fields: [(String, String)]) throws -> [String: Any] {
        var req = URLRequest(url: URL(string: hosts.web + path)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        req.httpBody = Data(fields.map { "\($0.0)=\($0.1.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
        guard let (_, body) = http(req) else { throw HistoryError("GitHub could not be reached") }
        let j = json(body)
        if j.isEmpty { throw HistoryError("GitHub said something unreadable") }
        return j
    }

    static func api(_ hosts: Hosts, _ access: String, _ path: String, method: String = "GET", body: Data? = nil) -> (Int, [String: Any])? {
        var req = URLRequest(url: URL(string: hosts.api + path)!)
        req.httpMethod = method
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        req.setValue("mdview", forHTTPHeaderField: "User-Agent")
        if let body { req.httpBody = body; req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        guard let (s, d) = http(req) else { return nil }
        return (s, json(d))
    }

    struct Tokens { var access: String; var expires: Double; var refresh: String }

    static func tokens(_ said: [String: Any]) -> Tokens? {
        guard let a = said["access_token"] as? String else { return nil }
        return Tokens(access: a, expires: now() + ((said["expires_in"] as? Double) ?? 8 * 3600), refresh: said["refresh_token"] as? String ?? "")
    }

    static func why(_ said: [String: Any]) -> String { (said["error_description"] as? String) ?? (said["error"] as? String) ?? "GitHub said no" }

    static func session(_ hosts: Hosts, _ t: Tokens) throws -> Session {
        guard let (s, who) = api(hosts, t.access, "/user"), s == 200 else { throw HistoryError("GitHub did not say who this is") }
        guard let login = who["login"] as? String else { throw HistoryError("GitHub did not say who this is") }
        return Session(access: t.access, expires: t.expires, login: login, name: who["name"] as? String ?? "", id: who["id"] as? Int ?? 0)
    }

    // MARK: the keychain

    static func account(_ place: String) -> String { "github \(place)" }

    static func remember(_ place: String, _ refresh: String) -> String? {
        if ProcessInfo.processInfo.environment["MDVIEW_NO_KEYRING"] != nil { return "no keyring" }
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account(place)]
        SecItemDelete(q as CFDictionary)
        var add = q
        add[kSecValueData as String] = Data(refresh.utf8)
        let s = SecItemAdd(add as CFDictionary, nil)
        return s == errSecSuccess ? nil : "keychain error \(s)"
    }

    static func recall(_ place: String) -> String? {
        if ProcessInfo.processInfo.environment["MDVIEW_NO_KEYRING"] != nil { return nil }
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account(place),
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        let s = String(decoding: d, as: UTF8.self)
        return s.isEmpty ? nil : s
    }

    static func forget(_ place: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account(place)]
        SecItemDelete(q as CFDictionary)
    }

    static func signOut(_ place: String) { forget(place) }

    // MARK: the flows

    /// The device flow, start to end: the code is told at once, then GitHub is asked — as often as it allows — whether the
    /// user confirmed it. nil: given up (stop was set).
    static func deviceFlow(_ hosts: Hosts, stop: StopFlag, tell: (GitHubNews) -> Void) throws -> Tokens? {
        let begun = try form(hosts, "/login/device/code", [("client_id", clientID)])
        guard let device = begun["device_code"] as? String, let code = begun["user_code"] as? String else { throw HistoryError(why(begun)) }
        let uri = begun["verification_uri"] as? String ?? "https://github.com/login/device"
        var every = (begun["interval"] as? Double) ?? 5
        let until = now() + ((begun["expires_in"] as? Double) ?? 900)
        tell(.code(code, uri))
        while now() < until {
            var slept = 0.0
            while slept < every { Thread.sleep(forTimeInterval: 0.25); slept += 0.25; if stop.on { return nil } }
            if stop.on { return nil }
            guard let said = try? form(hosts, "/login/oauth/access_token", [("client_id", clientID), ("device_code", device), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")]) else { continue }
            if let t = tokens(said) { return t }
            switch said["error"] as? String {
            case "authorization_pending": break
            case "slow_down": every = (said["interval"] as? Double) ?? every + 5
            default: throw HistoryError(why(said))
            }
        }
        throw HistoryError("the code was not confirmed in time")
    }

    final class StopFlag { var on = false }

    /// Sign in: on a thread of its own, telling the app as it goes. Setting `stop` gives it up.
    static func signIn(place: String, stop: StopFlag, tell: @escaping (GitHubNews) -> Void) {
        DispatchQueue.global().async {
            let hosts = Hosts.current
            let news: GitHubNews
            do {
                if let t = try deviceFlow(hosts, stop: stop, tell: tell) {
                    do { let s = try session(hosts, t); let note = remember(place, t.refresh).map { "not kept for the next start: \($0)" }; news = .signedIn(s, note) }
                    catch { news = .out("\(error)") }
                } else { news = .out("") }
            } catch { news = .out("\(error)") }
            tell(news)
        }
    }

    /// The sign-in kept in the Keychain is taken up again: its token renewed (the one to renew with changes with every use).
    static func resume(place: String, tell: @escaping (GitHubNews) -> Void) {
        DispatchQueue.global().async {
            guard let refresh = recall(place) else { return }
            let hosts = Hosts.current
            let news: GitHubNews
            do {
                let said = try form(hosts, "/login/oauth/access_token", [("client_id", clientID), ("grant_type", "refresh_token"), ("refresh_token", refresh)])
                if let t = tokens(said), !t.refresh.isEmpty {
                    if remember(place, t.refresh) == nil, let s = try? session(hosts, t) { news = .signedIn(s, nil) } else { news = .later }
                } else { forget(place); news = .out(why(said)) } // (GitHub does not take it any more: signed out)
            } catch { news = .later }
            tell(news)
        }
    }

    /// The repositories the signed-in user can reach through the app: those of every account the app is installed on.
    static func repositories(_ hosts: Hosts, _ access: String) throws -> [[String: Any]] {
        guard let (s, inst) = api(hosts, access, "/user/installations?per_page=\(page)"), s == 200 else { throw HistoryError("GitHub could not be reached") }
        var all: [[String: Any]] = []
        for id in (inst["installations"] as? [[String: Any]] ?? []).compactMap({ $0["id"] as? Int }) {
            for pg in 1...pages {
                guard let (s2, got) = api(hosts, access, "/user/installations/\(id)/repositories?per_page=\(page)&page=\(pg)"), s2 == 200 else { throw HistoryError("GitHub could not be reached") }
                let repos = got["repositories"] as? [[String: Any]] ?? []
                for r in repos {
                    if let name = r["full_name"] as? String, let url = r["clone_url"] as? String {
                        all.append(["name": name, "url": url, "branch": r["default_branch"] as? String ?? "main", "private": r["private"] as? Bool ?? false])
                    }
                }
                if repos.count < page { break }
            }
        }
        all.sort { ($0["name"] as? String ?? "").lowercased() < ($1["name"] as? String ?? "").lowercased() }
        return all
    }

    static func repos(session: Session, tell: @escaping (GitHubNews) -> Void) {
        DispatchQueue.global().async {
            do { tell(.repos(.success(try repositories(Hosts.current, session.access)))) }
            catch { tell(.repos(.failure(error as? HistoryError ?? HistoryError("\(error)")))) }
        }
    }

    /// A repository's name as GitHub takes it, from any text (a folder's name).
    static func repoName(_ text: String) -> String {
        var out = ""
        var gap = false
        for c in text {
            let said: String
            switch c {
            case "ä": said = "ae"; case "ö": said = "oe"; case "ü": said = "ue"
            case "Ä": said = "Ae"; case "Ö": said = "Oe"; case "Ü": said = "Ue"; case "ß": said = "ss"
            default:
                if c.isASCII && (c.isLetter || c.isNumber) || "-_.".contains(c) { said = String(c) } else { gap = true; continue }
            }
            if gap && !out.isEmpty { out += "-" }
            gap = false
            out += said
        }
        let trim = CharacterSet(charactersIn: "-.")
        out = out.trimmingCharacters(in: trim)
        if out.count > 100 { out = String(out.prefix(100)).trimmingCharacters(in: trim) }
        return out
    }

    /// The name a new repository for a project is offered under: mdview_ and the folder's name.
    static func newName(_ folder: String) -> String {
        let f = repoName(folder)
        return f.isEmpty ? "mdview" : repoName("mdview_\(f)")
    }

    /// A new repository on the user's account, private and empty — then looked at with the same token.
    static func create(_ hosts: Hosts, _ access: String, _ name: String) -> Result<[String: Any], HistoryErrorJSON> {
        func no(_ error: String, _ why: String, _ name: String) -> Result<[String: Any], HistoryErrorJSON> {
            .failure(HistoryErrorJSON(json: ["error": error, "why": why, "name": name]))
        }
        let body = try? JSONSerialization.data(withJSONObject: ["name": name, "private": true, "auto_init": false, "description": "Notes, kept with Markdown Notes"])
        guard let (code, made) = api(hosts, access, "/user/repos", method: "POST", body: body) else { return no("failed", "GitHub could not be reached", name) }
        if code >= 300 {
            let message = made["message"] as? String ?? ""
            let details = (made["errors"] as? [[String: Any]] ?? []).compactMap { $0["message"] as? String }.joined(separator: "; ")
            switch code {
            case 422 where details.contains("already exists"): return no("taken", details, name)
            case 403: return no("denied", message, name)
            default: return no("failed", !details.isEmpty ? details : !message.isEmpty ? message : "GitHub said \(code)", name)
            }
        }
        guard let full = made["full_name"] as? String, let url = made["clone_url"] as? String else { return no("failed", "GitHub did not say what it made", name) }
        if let (s, seen) = api(hosts, access, "/repos/\(full)"), s == 200, seen["full_name"] is String {
            return .success(["name": full, "url": url, "branch": made["default_branch"] as? String ?? "main", "private": made["private"] as? Bool ?? true])
        }
        return no("unreached", "", full) // (made, but not given to the app: the user gives it on GitHub, then links it)
    }

    static func make(session: Session, name: String, tell: @escaping (GitHubNews) -> Void) {
        DispatchQueue.global().async { tell(.made(create(Hosts.current, session.access, name))) }
    }

    static func shown(_ s: Session) -> [String: Any] { ["login": s.login, "name": s.name] }
}
