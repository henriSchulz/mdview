// md://localhost/… — what the page asks for: /app/<file of the checkout>, /file/<any file>,
// /shell/<n> (the page itself). The same addresses the Tauri shell serves.
import Foundation
import UniformTypeIdentifiers
import WebKit

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    var pages: [String: String] = [:]   // path -> html

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        let path = url.path.removingPercentEncoding ?? url.path
        var file: URL?
        if let html = pages[path] {
            return respond(task, url, Data(html.utf8), "text/html")
        } else if path.hasPrefix("/app/") {
            let rel = String(path.dropFirst(5))
            if !rel.contains("..") { file = Page.root.appendingPathComponent(rel) }
        } else if path.hasPrefix("/file/") {
            file = URL(fileURLWithPath: String(path.dropFirst(5)))
        }
        guard let f = file, let data = try? Data(contentsOf: f) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
            task.didReceive(r); task.didReceive(Data()); return task.didFinish()
        }
        respond(task, url, data, mime(f))
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

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
