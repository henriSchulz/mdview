// md://localhost/… — what the page asks for: /app/<file of the checkout>, /file/<any file>,
// /shell/<n> (the page itself). The same addresses the Tauri shell serves.
import Foundation
import UniformTypeIdentifiers
import WebKit

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    var pages: [String: String] = [:]   // path -> html
    /// The base folder of a file the page asks for (NoteWindow.topOf): where what a note names is looked for (Lib.found).
    var topOf: ((String) -> String?)?
    /// What is being read for the page, until it is answered — or stopped by the page (then it is not answered at all).
    private var running: [ObjectIdentifier: WKURLSchemeTask] = [:]
    private static let io = DispatchQueue(label: "mdview.files", qos: .userInitiated, attributes: .concurrent)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let path = url.path.removingPercentEncoding ?? url.path
        if let html = pages[path] {
            return respond(task, url, Data(html.utf8), "text/html")
        } else if path.hasPrefix("/app/") {
            let rel = String(path.dropFirst(5))
            guard !rel.contains(".."), let data = try? Data(contentsOf: Page.root.appendingPathComponent(rel)) else { return notFound(task, url) }
            return respond(task, url, data, mime(URL(fileURLWithPath: rel)))
        } else if path.hasPrefix("/file/") {
            // a file of the user's: read beside the window (it may be large, or looked for — Lib.found), answered on the main thread
            let asked = String(path.dropFirst(5)), top = topOf?(asked)
            let key = ObjectIdentifier(task)
            running[key] = task
            Self.io.async {
                let real = Lib.found(asked, top: top)
                let data = try? Data(contentsOf: URL(fileURLWithPath: real))
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.running.removeValue(forKey: key) != nil else { return }
                    if let data { self.respond(task, url, data, self.mime(URL(fileURLWithPath: real))) } else { self.notFound(task, url) }
                }
            }
            return
        }
        notFound(task, url)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { running[ObjectIdentifier(task)] = nil }

    private func notFound(_ task: WKURLSchemeTask, _ url: URL) {
        let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
        task.didReceive(r); task.didReceive(Data()); task.didFinish()
    }

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ data: Data, _ type: String) {
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil,
                                headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"])!
        task.didReceive(r); task.didReceive(data); task.didFinish()
    }

    private func mime(_ f: URL) -> String {
        switch f.pathExtension.lowercased() {
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "html": return "text/html; charset=utf-8"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "md", "markdown", "txt": return "text/plain; charset=utf-8"
        default: return UTType(filenameExtension: f.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
