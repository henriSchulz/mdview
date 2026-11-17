// The user's own LaTeX snippets (config folder's snippets.js, Page.swift userSnippets): the page has them, as the Rust
// shell gives them (review 2026-11-17: never handed to the page on macOS).
import XCTest
@testable import MdView

final class SnippetTests: ShellTest {
    func testTheUsersOwnSnippetsReachThePage() throws {
        let config = Lib.join(dir, "config") // (never the user's own ~/.config)
        let kept = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"]
        setenv("XDG_CONFIG_HOME", config, 1)
        defer { if let kept { setenv("XDG_CONFIG_HOME", kept, 1) } else { unsetenv("XDG_CONFIG_HOME") } }
        write("config/mdview/snippets.js", "export default [\n  { trigger: \"zzq\", replacement: \"\\\\zeta\", options: \"mA\" },\n];\n")
        let w = open(write("N.md", "# N\n"))
        XCTAssertEqual(page(w, "typeof MdSnippets === 'function' ? JSON.stringify(MdSnippets(() => ({}))) : 'none'") as? String,
                       "[{\"trigger\":\"zzq\",\"replacement\":\"\\\\zeta\",\"options\":\"mA\"}]")
        // (a list alone, without export, as the Rust shell takes it too)
        write("config/mdview/snippets.js", "[{ trigger: \"qq\", replacement: \"\\\\quad\", options: \"mA\" }];\n")
        XCTAssertTrue(Page.userSnippets().contains("return ([{ trigger"))
    }
}
