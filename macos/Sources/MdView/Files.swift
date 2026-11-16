// Files (area A): what is done to the files of the folder from its list and All Notes — copy, cut, paste,
// duplicate, import, hide, folder looks, the history of these steps (undo), pictures and files put into a note,
// files dropped on a window, "open with", the clipboard. Rust originals: shell/files.rs, shell/undo.rs, hidden.rs,
// looks.rs, attach.rs, shell/folder.rs (hide … add_files), host.rs (clipboard).
import AppKit

/// What was done to files, so it can be taken back (shell/undo.rs).
enum UndoStep {
    case made([String])
    case moved([(String, String)], String)   // (old, new) pairs, "rename" | "move"
    case trashed([String])
}

final class FilesState {}

extension NoteWindow {
    /// Core calls this after it did something to files.
    func did(_ step: UndoStep) {}

    /// The paths put away by hand in this folder (.mdview/hidden.json) — hidden.rs `listed`.
    func hiddenListed(_ folder: String) -> Set<String> { [] }
    /// … and what the application keeps for a note (attach.rs `owned`).
    func attachmentsOwned() -> Set<String> { [] }
    /// A folder's colours and signs (looks.rs `listed`), for MdView.setFolder.
    func looksListed(_ folder: String) -> Any { [String: Any]() }
    /// A path of this folder moved: its hidden mark and its look go along (hidden::moved, looks::moved).
    func filesMoved(folder: String, old: String, new: String?) {}

    func handleFiles(_ type: String, _ msg: [String: Any]) -> Bool { false }
}
