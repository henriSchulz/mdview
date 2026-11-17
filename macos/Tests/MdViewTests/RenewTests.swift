// The GitHub sign-in renewed across a night with the lid shut (History.swift): the Mac awake again, a token that ran
// out meanwhile — or soon will — is renewed at once (review 2026-11-17: its renewal waited for hours of awake time, and
// every sync said "sign in again").
import AppKit
import XCTest
@testable import MdView

final class RenewTests: ShellTest {
    func testAwakeAgainARunOutSignInIsRenewed() {
        let hub = HistoryHub.shared
        hub.start()
        let kept = hub.session
        defer { hub.session = kept }
        hub.session = Session(access: "old", expires: GitHub.now() - 30, login: "henri", name: "", id: 1)
        let before = hub.renewTurn
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
        XCTAssertTrue(wait(2) { hub.renewTurn > before }, "awake again, the run-out sign-in was not renewed")
    }

    func testAwakeAgainASignInWithTimeLeftIsLeftAsItIs() {
        let hub = HistoryHub.shared
        hub.start()
        let kept = hub.session
        defer { hub.session = kept }
        hub.session = Session(access: "fresh", expires: GitHub.now() + 4 * 3600, login: "henri", name: "", id: 1)
        let before = hub.renewTurn
        NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
        wait(0.3)
        XCTAssertEqual(hub.renewTurn, before)
    }
}
