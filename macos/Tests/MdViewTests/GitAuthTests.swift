// The sign-in handed to git (HistoryGit.swift Git.auth): git takes it for GitHub alone — and it stands nowhere on the
// command line, which every user of the Mac sees with `ps` (review 2026-11-17: the header with the token was an argument).
import XCTest
@testable import MdView

final class GitAuthTests: XCTestCase {
    let header = "Authorization: Basic " + Data("x-access-token:tok-123".utf8).base64EncodedString()

    func testGitReadsTheSignInForGitHubAlone() {
        let r = Git.run(["config", "--get-regexp", "^(http\\..*\\.extraheader|credential\\.helper)$"], env: Git.auth("tok-123"))
        XCTAssertTrue(r.raw.contains("http.\(Hosts.current.web)/.extraheader \(header)"), r.raw + r.err)
        XCTAssertTrue(r.raw.contains("credential.helper"), r.raw)
        let none = Git.run(["config", "--get-regexp", "^http\\..*\\.extraheader$"], env: Git.auth(nil))
        XCTAssertFalse(none.raw.contains("Basic"), "signed out, a header was given")
    }

    func testTheTokenIsNoArgumentOfGit() throws {
        // a git that writes down what it was given
        let dir = NSTemporaryDirectory() + "mdview-git-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let fake = dir + "/git", log = dir + "/log"
        try "#!/bin/sh\nprintf '%s\\n' \"$@\" > '\(log)'\nenv | grep '^GIT_CONFIG_' >> '\(log)'\nexit 0\n".write(toFile: fake, atomically: true, encoding: .utf8)
        chmod(fake, 0o755)
        let real = Git.exe
        Git.exe = fake
        defer { Git.exe = real }
        _ = try Sync.branches("https://github.com/henri/notes", Access(token: "tok-123"))
        let got = try String(contentsOfFile: log, encoding: .utf8)
        let args = got.components(separatedBy: "\n").prefix { !$0.hasPrefix("GIT_CONFIG_") }
        XCTAssertEqual(Array(args), ["ls-remote", "--heads", "https://github.com/henri/notes"], "git's arguments:\n" + got)
        XCTAssertTrue(got.contains(header), "the sign-in did not reach git:\n" + got)
    }

    func testAnAddressThatOnlyNamesGitHubIsNotGitHub() {
        XCTAssertTrue(Sync.githubURL("https://github.com/henri/notes"))
        XCTAssertTrue(Sync.githubURL("https://x-access-token@github.com/henri/notes"))
        for url in ["https://elsewhere.example?@github.com/x", "https://elsewhere.example#@github.com/x", "https://github.com@elsewhere.example/x"] {
            XCTAssertFalse(Sync.githubURL(url), url)
        }
    }
}
