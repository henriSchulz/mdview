// The AI of the app (area D): the chat, "Transform with AI", figures drawn by a model, suggestions while typing, the
// key. Rust originals: ai.rs, shell/claude.rs.
import AppKit

final class AIState {}

extension NoteWindow {
    func handleAssistant(_ type: String, _ msg: [String: Any]) -> Bool { false }
}
