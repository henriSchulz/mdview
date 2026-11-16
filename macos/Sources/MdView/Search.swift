// Search, previews, the note beside, whiteboards and PDFs (area B). Rust originals: search.rs, slides.rs,
// shell/folder.rs (search, send_previews, new_board, send_boards, board_free), shell.rs (render_pdf, send_pdf),
// shell/files.rs (board_*, note_read/note_save, pdfink_*).
import AppKit

final class SearchState {}

extension NoteWindow {
    func handleSearch(_ type: String, _ msg: [String: Any]) -> Bool { false }
}

extension NoteWindow {
    /// A PDF (or a presentation as one) is the note on screen: the page is told so (shell.rs `render_pdf`).
    func renderPDF(fragment: String?) {}
}
