// The app and the system around the page (area E): the theme (system appearance, Velum), the settings' info,
// updates, printing, full screen, the menus, the Dock, the document types, the icon. Rust originals: theme.rs,
// update.rs, host.rs, shell.rs (settings_info), shell/app.rs.
import AppKit

final class SystemState {}

extension NoteWindow {
    func handleSystem(_ type: String, _ msg: [String: Any]) -> Bool { false }
}
