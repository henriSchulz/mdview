// Claude on a whiteboard (board.js: the bubble under the star, its ready-made choices; ai.js: the chat): the bubble and the
// chat are two ways in, each with its own button, and all that is done from the bubble stands in the chat (Henri,
// 2026-11-19: „die kleine bubble und den chat separat … alles aus der bubble kommt in den chat … vorgefertigte optionen,
// damit man oft nicht die tastatur braucht“). Claude itself is made up here: what it answers is given (MDVIEW_*_FAKE).
import AppKit
import XCTest
@testable import MdView

final class BoardAskTests: ShellTest {
    override func setUp() {
        super.setUp()
        setenv("MDVIEW_TALK_FAKE", "transform||Erklärt, PICTURE.", 1)
        setenv("MDVIEW_BOARD_FAKE", "Zwei Fehler markiert.\n<board>\n{\"add\":\"ink\",\"d\":\"M 300 300 L 340 340\",\"c\":\"#e5484d\"}\n</board>\n", 1)
        setenv("MDVIEW_IMPROVE_FAKE", "<board>\n</board>\n", 1)
    }
    override func tearDown() {
        for k in ["MDVIEW_TALK_FAKE", "MDVIEW_BOARD_FAKE", "MDVIEW_IMPROVE_FAKE"] { unsetenv(k) }
        super.tearDown()
    }

    /// A board with one stroke on it, open in a window WebKit paints (`openPainted`: the chat's and the bubble's layout).
    func boardWithAStroke() -> NoteWindow {
        let sample = Lib.join(ShellTest.checkout, "web/public/welcome/samples/Empty.board.svg")
        let board = write("assets/A.board.svg", read(sample))
        let w = openPainted(write("A.md", "# Ask\n\n![](assets/A.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the board did not open")
        let setup = """
        window.__bd = {
          stage: () => document.querySelector('#board .bd-stage'),
          ev(type, x, y, id) { this.stage().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, pressure: 0.5 })); },
          stroke(y, id) { this.ev('pointerdown', 200, y, id); for (let i = 1; i < 30; i++) this.ev('pointermove', 200 + i * 8, y + Math.sin(i / 3) * 20, id); this.ev('pointerup', 432, y, id); return MdBoard.state().items; },
          press(sel, kind) { const b = document.querySelector(sel); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: kind || 'mouse', isPrimary: true, button: 0, buttons: 1 })); b.click(); return 1; },
          pop: () => document.querySelector('#board .bd-vpop'),
          bubble: () => { const p = document.querySelector('#board .bd-vpop'); return p.hasAttribute('data-open') && p.dataset.kind === 'ask'; },
          talk: () => (window.MdAi ? MdAi.state().talk : []),
        };
        document.querySelector('#board [data-kind="pen"]').click();
        return 1;
        """
        var done = false
        w.web.callAsyncJavaScript(setup, arguments: [:], in: nil, in: .page) { _ in done = true }
        wait(5) { done }
        XCTAssertEqual(page(w, "__bd.stroke(260, 7)") as? Int, 1, "the stroke was not drawn")
        page(w, "(document.querySelector('#board [data-kind=\"lasso\"]').click(), 1)")
        return w
    }
    func bubble(_ w: NoteWindow) -> Bool { page(w, "__bd.bubble()") as? Bool == true }
    func chat(_ w: NoteWindow) -> Bool { page(w, "!!(window.MdAi && MdAi.chat.open)") as? Bool == true }
    func idle(_ w: NoteWindow) -> Bool { page(w, "(() => { const s = window.MdBoard && MdBoard.state(); return (!s || (!s.claude.busy && !s.improving)) && !(window.MdAi && MdAi.state().talking); })()") as? Bool == true }
    /// The last thing asked in the chat: what it shows, what Claude was told, and the answer after it.
    func last(_ w: NoteWindow) -> (shown: String, told: String, answer: String) {
        let r = page(w, "(() => { const t = window.MdAi ? MdAi.state().talk : [], i = t.map((m) => m.role).lastIndexOf('user'); if (i < 0) return ['', '', '']; const a = t[i + 1] || {}; return [t[i].shown || t[i].text, t[i].text, a.text || a.error || '']; })()") as? [String] ?? []
        return r.count == 3 ? (r[0], r[1], r[2]) : ("", "", "")
    }

    /// The star opens the bubble, always — also after the chat was used; the chat has its own button, and each shuts the other.
    func testTheBubbleAndTheChatEachHaveTheirButton() {
        let w = boardWithAStroke()
        XCTAssertEqual(page(w, "!!document.querySelector('#board .bd-actions [data-do=\"chat\"]') && getComputedStyle(document.querySelector('#board .bd-actions [data-do=\"chat\"]')).display !== 'none'") as? Bool, true, "no button of the chat's own in the board's bar")
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]')")
        XCTAssertTrue(wait(3) { self.bubble(w) }, "the star did not open the bubble")
        XCTAssertFalse(chat(w))
        page(w, "__bd.press('#board .bd-actions [data-do=\"chat\"]')")
        XCTAssertTrue(wait(5) { self.chat(w) }, "the chat's button did not open the chat")
        XCTAssertFalse(bubble(w), "the bubble stays under the chat")
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]')")
        XCTAssertTrue(wait(3) { self.bubble(w) }, "after the chat, the star opens the chat again instead of the bubble")
        XCTAssertTrue(wait(3) { !self.chat(w) }, "the chat stays over the bubble")
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]')")
        XCTAssertTrue(wait(3) { !self.bubble(w) }, "pressed again, the star does not shut the bubble")
    }

    /// The bubble has its ready-made choices, about what the window shows when nothing is chosen; opened with a pen, its
    /// field does not take the keys (an iPad's keyboard would come up over the board), opened with a mouse it does.
    func testTheBubblesChoicesWithoutKeys() {
        let w = boardWithAStroke()
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        wait(0.3)
        let ks = page(w, "[...__bd.pop().querySelectorAll('[data-m=\"preset\"]')].map((b) => b.dataset.p + (b.disabled ? '-' : '+'))") as? [String] ?? []
        XCTAssertEqual(ks, ["tidy+", "redraw+", "check+", "solve+", "explain+", "latex+", "tonote+"], "the ready-made choices (To the Note: the board stands in a note)")
        XCTAssertEqual(page(w, "!!__bd.pop().querySelector('.bd-ask-about[data-view]')") as? Bool, true, "nothing chosen: not said that it is about what the window shows")
        XCTAssertEqual(page(w, "document.activeElement === __bd.pop().querySelector('.bd-ask-field')") as? Bool, false, "opened with a pen, the field took the keys")
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]')") // (shut)
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'mouse')")
        XCTAssertTrue(wait(3) { (self.page(w, "document.activeElement === __bd.pop().querySelector('.bd-ask-field')") as? Bool) == true }, "opened with a mouse, the field does not take the keys")
        // the stroke chosen: the bubble is about it
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]')")
        page(w, "(document.getElementById('board').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true })), 1)")
        XCTAssertTrue(wait(3) { (self.page(w, "MdBoard.state().picked.length") as? Int) == 1 }, "the stroke could not be chosen")
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        XCTAssertEqual(page(w, "!!__bd.pop().querySelector('.bd-ask-about:not([data-view])')") as? Bool, true, "a stroke chosen: the bubble does not say it is about it")
    }

    /// A choice done on the board (Check) and one answered in words (Explain), and Tidy: each stands in the chat by its name,
    /// with its answer — Claude told more than the name, and over the board shown a picture of it (to read a hand).
    func testWhatTheBubbleDidStandsInTheChat() {
        let w = boardWithAStroke()
        let before = page(w, "MdBoard.state().items") as? Int ?? 0
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        page(w, "__bd.press('#board .bd-vpop [data-p=\"check\"]', 'pen')")
        XCTAssertTrue(wait(10) { self.last(w).shown == "Check" && !self.last(w).answer.isEmpty && self.idle(w) }, "Check is not in the chat: \(last(w))")
        XCTAssertTrue(last(w).told.contains("mistakes"), "Claude was told only the name: \(last(w).told)")
        XCTAssertEqual(page(w, "MdBoard.state().items") as? Int, before + 1, "Check's steps were not done on the board")
        XCTAssertFalse(chat(w), "Check is done on the board: the chat need not open")

        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        page(w, "__bd.press('#board .bd-vpop [data-p=\"explain\"]', 'pen')")
        XCTAssertTrue(wait(5) { self.chat(w) }, "Explain answers in words: the chat did not open")
        XCTAssertTrue(wait(10) { self.last(w).shown == "Explain" && self.last(w).answer.contains("with a picture") && self.idle(w) }, "Explain in the chat, with a picture of the board: \(last(w))")
        XCTAssertEqual(page(w, "MdAi.state().talk.filter((m) => m.role === 'user').length") as? Int, 2)
        XCTAssertEqual(page(w, "[...document.querySelectorAll('#ai-chat .ai-user .ai-said')].map((e) => e.textContent).join('|')") as? String, "Check|Explain", "the chat shows what Claude was told, not the choices' names")

        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        page(w, "__bd.press('#board .bd-vpop [data-p=\"tidy\"]', 'pen')")
        XCTAssertTrue(wait(10) { self.last(w).shown == "Tidy Handwriting" && !self.last(w).answer.isEmpty && self.idle(w) }, "Tidy is not in the chat: \(last(w))")
        XCTAssertEqual(page(w, "MdBoard.state().picked.length") as? Int, 0, "Tidy on what the window shows chose what it made")
    }

    // MARK: the note and its whiteboards (Henri, 2026-11-19: „besseres Zusammenspiel zwischen whiteboard und notizen und
    // dessen KIs“)

    /// The board's own question is told the note the board stands in (its task, its words) — not only the board.
    func testTheBoardsQuestionKnowsItsNote() {
        setenv("MDVIEW_BOARD_FAKE", "Gelöst, NOTED.\n<board>\n{\"add\":\"ink\",\"d\":\"M 300 300 L 340 340\"}\n</board>\n", 1)
        let w = boardWithAStroke()
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        page(w, "__bd.press('#board .bd-vpop [data-p=\"solve\"]', 'pen')")
        XCTAssertTrue(wait(10) { self.last(w).shown == "Solve" && self.idle(w) }, "Solve: \(last(w))")
        XCTAssertTrue(last(w).answer.contains("with the note"), "the board's question was not told its note: \(last(w).answer)")
    }

    /// The note's chat, no board open, sees the note's whiteboards as pictures — never their files' text.
    func testTheNotesChatSeesItsBoards() {
        setenv("MDVIEW_TALK_FAKE", "transform||Gesehen: PICTURES.", 1)
        let w = boardWithAStroke()
        page(w, "(MdBoard.close(), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!MdBoard.shown && [...document.querySelectorAll('#content img, #active img')].some((i) => MdView.core.board.is(i) && i.complete && i.naturalWidth > 0)") as? Bool) == true }, "the board's picture is not in the note")
        page(w, "MdView.core.ai.load().then((ai) => (ai.chat.show(), 1))")
        XCTAssertTrue(wait(3) { self.chat(w) })
        page(w, "(() => { const f = document.querySelector('#ai-chat .ai-field'); f.value = 'Was steht auf dem Whiteboard?'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()")
        XCTAssertTrue(wait(10) { self.last(w).answer.hasPrefix("Gesehen") && self.idle(w) }, "the chat did not answer: \(last(w))")
        XCTAssertEqual(last(w).answer, "Gesehen: 1 pictures.", "the note's board did not go as a picture")
    }

    /// To the Note: what the board holds is written out under the board's picture in the note — and stands in the chat.
    func testToTheNotePutsItUnderTheBoard() {
        setenv("MDVIEW_TALK_FAKE", "transform||Abgeschrieben.\n<insert>\n$$x^2 = 4$$\n</insert>", 1)
        let w = boardWithAStroke()
        let note = Lib.join(dir, "A.md")
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        XCTAssertEqual(page(w, "!!__bd.pop().querySelector('[data-p=\"tonote\"]:not([disabled])')") as? Bool, true, "a board in a note has no To the Note")
        page(w, "__bd.press('#board .bd-vpop [data-p=\"tonote\"]', 'pen')")
        XCTAssertTrue(wait(10) { self.last(w).shown == "To the Note" && self.idle(w) }, "To the Note is not in the chat: \(last(w))")
        XCTAssertTrue(wait(8) { self.read(note).contains("![](assets/A.board.svg)\n\n$$x^2 = 4$$") }, "not written under the board:\n\(read(note))")
        XCTAssertFalse(chat(w), "To the Note opened the chat")
    }

    /// Draw on a Whiteboard: a paragraph of the note chosen, a whiteboard is made under it, opened, and Claude asked to put
    /// it there by hand — told the paragraph, shown in the chat by the row's name.
    func testDrawOnAWhiteboardFromTheNote() {
        setenv("MDVIEW_BOARD_FAKE", "Skizziert.\n<board>\n{\"add\":\"ink\",\"d\":\"M 100 100 L 200 160\"}\n</board>\n", 1)
        let note = write("P.md", "# Pythagoras\n\nIm rechtwinkligen Dreieck gilt $a^2 + b^2 = c^2$.\n")
        let w = openPainted(note)
        page(w, "(MdView.setMode('active'), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true }, "no active mode")
        page(w, "(() => { const v = MdActive.view.pm; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isTextblock && n.textContent.startsWith('Im recht')) at = pos + 2; }); v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, at, at + 5))); MdView.core.ai.toBoard(v); return 1; })()")
        XCTAssertTrue(wait(15) { (self.page(w, "!!(window.MdBoard && MdBoard.shown && document.querySelector('#board[data-open]'))") as? Bool) == true }, "no board was opened")
        XCTAssertTrue(wait(15) { self.last(w).shown.hasPrefix("Draw on a Whiteboard · Im rechtwinkligen") && self.idle(w) }, "not asked, or not in the chat: \(last(w))")
        XCTAssertTrue(last(w).told.contains("<from-note>") && last(w).told.contains("$a^2 + b^2 = c^2$"), "Claude was not told the paragraph: \(last(w).told.prefix(300))")
        XCTAssertEqual(page(w, "MdBoard.state().items") as? Int, 1, "the steps were not done on the new board")
        XCTAssertTrue(wait(8) { self.read(note).range(of: #"\$\.\n\n!\[[^\]]*\]\([^)]*\.board\.svg\)"#, options: .regularExpression) != nil }, "the board does not stand under the paragraph:\n\(read(note))")
    }

    /// Pictures of the bubble (not a check): only with MDVIEW_SNAP=<folder>.
    func testPictures() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let w = boardWithAStroke()
        w.window.setContentSize(NSSize(width: 1100, height: 760))
        page(w, "__bd.press('#board .bd-actions [data-do=\"claude\"]', 'pen')")
        XCTAssertTrue(wait(3) { self.bubble(w) })
        wait(1)
        for (name, theme) in [("bubble-light", "light"), ("bubble-dark", "dark")] {
            w.window.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
            page(w, "(document.documentElement.dataset.theme = '\(theme)', 1)")
            wait(0.8)
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-o", "-l", String(w.window.windowNumber), Lib.join(snap!, name + ".png")]
            try p.run(); p.waitUntilExit()
        }
    }
}
