// From the iPhone or iPad (Continuity Camera): Take Photo, Scan Documents, Add Sketch — the system's own entries, in File ›
// Import from iPhone or iPad (Henri, 2026-11-19: "können wir das als features in mdview hinzufügen? … dann man auch in der
// all notes ansicht dokumente einscannen kann und foto hinzufügen kann über das iphone"). The system asks the window's first
// responder — the web view — whether it takes a picture or a PDF, and hands it over on a pasteboard of its own.
// What comes: with a note on screen it goes into the note, as a pasted picture or a dropped file does (kept where the note's
// pictures are; at the caret while it is edited, at its end while it is read). In All Notes it is a file of the folder shown —
// a scan a PDF, a photo or a sketch a picture —, named by what it is and when it came.
import AppKit
import WebKit

enum FromDevice {
    /// What came on the pasteboard: a scan is a PDF; a photo or a sketch a picture (a JPEG or a PNG as it is; anything
    /// else — TIFF, HEIC, whatever the system can read as a picture, a file it names — a PNG where it is see-through,
    /// a sketch, else a JPEG).
    static func read(_ pb: NSPasteboard) -> (data: Data, ext: String, scan: Bool)? {
        if let d = pb.data(forType: .pdf), !d.isEmpty { return (d, ".pdf", true) }
        for (t, ext) in [("public.jpeg", ".jpg"), ("public.png", ".png")] {
            if let d = pb.data(forType: NSPasteboard.PasteboardType(t)), !d.isEmpty { return (d, ext, false) }
        }
        // (a file handed over by its address)
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], let u = urls.first,
           let d = try? Data(contentsOf: u), !d.isEmpty {
            let e = u.pathExtension.lowercased()
            if e == "pdf" { return (d, ".pdf", true) }
            if ["jpg", "jpeg", "png"].contains(e) { return (d, e == "png" ? ".png" : ".jpg", false) }
            if let got = picture(NSImage(data: d)) { return got }
        }
        for t in pb.types ?? [] {
            if let d = pb.data(forType: t), !d.isEmpty, let got = picture(NSImage(data: d)) { return got }
        }
        return picture(NSImage(pasteboard: pb))
    }

    private static func picture(_ image: NSImage?) -> (data: Data, ext: String, scan: Bool)? {
        guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), rep.pixelsWide > 0 else { return nil }
        if rep.hasAlpha, let png = rep.representation(using: .png, properties: [:]) { return (png, ".png", false) }
        if let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) { return (jpg, ".jpg", false) }
        return nil
    }

    /// "Scan 2026-11-19 13.05.07" — a name that says what it is and sorts by when it came.
    static func stem(scan: Bool, at date: Date = Date()) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd HH.mm.ss"
        return (scan ? "Scan " : "Photo ") + df.string(from: date)
    }

    /// Whether a kind of data is one the app takes from a device.
    static func takes(_ type: NSPasteboard.PasteboardType?) -> Bool {
        guard let t = type?.rawValue else { return false }
        return NSImage.imageTypes.contains(t)
    }
}

extension NoteWindow {
    /// Somewhere to put what comes: a note on screen, or a folder (All Notes).
    var takesFromDevice: Bool { path != nil || folder != nil }

    /// The folder All Notes shows, as the page says it ({ scope, at: [names from the window's folder down] }), else the window's.
    func shownFolder(_ where_: Any?) -> String? {
        guard let folder else { return nil }
        if let s = where_ as? String, let j = try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any],
           let at = j["at"] as? [String], !at.isEmpty, !at.contains(where: { $0.contains("/") || $0 == ".." }) {
            let dir = at.reduce(folder) { Lib.join($0, $1) }
            if Lib.isDir(dir) { return dir }
        }
        return folder
    }

    /// What the device sent, put where it belongs. → whether it was taken
    @discardableResult func takeFromDevice(_ pb: NSPasteboard) -> Bool {
        guard takesFromDevice else { return false }
        guard let got = FromDevice.read(pb) else {
            // (said, and written down with what did come: the system only says "the operation couldn't be completed")
            NSLog("MdView: from the device, nothing that is a picture or a PDF — types: %@", (pb.types ?? []).map(\.rawValue).joined(separator: ", "))
            toast("Nothing came that is a picture or a PDF")
            return false
        }
        let stem = FromDevice.stem(scan: got.scan)
        NSLog("MdView: from the device, %d bytes of %@ — types: %@", got.data.count, got.ext, (pb.types ?? []).map(\.rawValue).joined(separator: ", "))
        // a whiteboard open over the window: onto the board, as a file dropped on it (the board keeps it beside itself)
        if boardOpen {
            let tmp = Lib.join(NSTemporaryDirectory(), "mdview-device-\(UUID().uuidString)")
            do {
                try Lib.fm.createDirectory(atPath: tmp, withIntermediateDirectories: true)
                let file = Lib.join(tmp, stem + got.ext)
                try got.data.write(to: URL(fileURLWithPath: file))
                web.evaluateJavaScript("(window.MdBoard && MdBoard.drop ? MdBoard.drop([\(jsonString(URL(fileURLWithPath: file).absoluteString))]) : false)") { _, _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { try? Lib.fm.removeItem(atPath: tmp) }
                }
                return true
            } catch { toast("Couldn't save: \(error.localizedDescription)"); return false }
        }
        let overview = (chrome?.state["overview"] as? Bool) == true
        if let note = path, !overview {
            // (while it is read, and where only the active mode takes a file at the caret: at the note's end)
            let mode = chrome?.state["mode"] as? String ?? "read"
            _ = note
            return putInNote(got.data, stem: stem, ext: got.ext, append: mode == "read" || (got.scan && mode != "active"))
        }
        guard folder != nil else { return false }
        web.evaluateJavaScript("(() => { const w = window.MdOverview && MdOverview.where && MdOverview.where(); return w ? JSON.stringify(w) : ''; })()") { [weak self] r, _ in
            guard let self, let dir = self.shownFolder(r) else { return }
            self.keepFromDevice(got.data, stem: stem, ext: got.ext, in: dir)
        }
        return true
    }

    /// A file of the folder: written, and the folder's list shown anew.
    @discardableResult func keepFromDevice(_ data: Data, stem: String, ext: String, in dir: String) -> String? {
        do {
            let target = try Lib.writeNew(dir, tries: 100, data: data) { $0 == 1 ? "\(stem)\(ext)" : "\(stem)-\($0)\(ext)" }
            rescan()
            toast("Added \(Lib.name(target))")
            return target
        } catch { toast("Couldn't save: \(error.localizedDescription)"); return nil }
    }
}
