// The pasteboard's copy in a project (HistoryShare.swift Paste.keep): what comes back from GitHub on two threads at
// once — a put and the waiting get it releases — is kept one at a time, the newest last (review 2026-11-17).
import XCTest
@testable import MdView

final class PasteKeepTests: XCTestCase {
    func testTextsComingBackTogetherLeaveTheNewest() throws {
        let root = NSTemporaryDirectory() + "mdview-paste-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: root + "/.mdview", withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: root + "/.git", withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: root) }
        for trial in 0..<60 {
            Paste.kept[root] = nil
            let base = trial * 100
            DispatchQueue.concurrentPerform(iterations: 16) { i in Paste.keep(root, "text \(base + i)", base + i) }
            XCTAssertEqual(Lib.read(Lib.join(root, Paste.file)), "text \(base + 15)", "trial \(trial): an older text was kept last")
        }
    }
}
