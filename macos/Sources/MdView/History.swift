// A folder's history, its other side, and sharing (area C). Rust originals: history.rs, shell/project.rs,
// sync.rs, github.rs, share.rs, paste.rs.
import AppKit

final class HistoryState {}

extension NoteWindow {
    /// Where the folder stands with a history: "none", a "project" itself, "inside" one above, or "foreign" (shell/app.rs `standing`).
    func historyStanding(_ folder: String) -> String { "none" }
    /// The links shared of this folder's notes (share.rs `listed`), for MdView.setFolder.
    func sharedListed(_ folder: String) -> Any { [Any]() }

    func handleHistory(_ type: String, _ msg: [String: Any]) -> Bool { false }
}
