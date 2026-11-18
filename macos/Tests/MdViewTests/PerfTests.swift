// How quick the app is — numbers, not a check: only with MDVIEW_PERF=<a folder of notes> (a copy of one's own: the
// tests write nothing into it, but a copy is what is safe). Each case runs a few times; the median is told, and all of
// it written to MDVIEW_PERF_OUT (JSON) if that is set.
//   MDVIEW_PERF=/path/to/notes MDVIEW_PERF_OUT=/tmp/perf.json swift test --filter PerfTests
// What is measured: the time to what is seen (a window's note drawn, a note switched to, a mode taken), the frames of
// what moves (a gap between two frames over 20 ms is a frame missed at 60 Hz), and the turns of the main run loop that
// held it longer than a frame (the shell's own work, which every input waits for).
import AppKit
import WebKit
import XCTest
@testable import MdView

final class PerfTests: ShellTest {
    static var report: [String: Any] = [:]
    var corpus: String { ProcessInfo.processInfo.environment["MDVIEW_PERF"] ?? "" }

    override func setUpWithError() throws {
        try XCTSkipIf(corpus.isEmpty, "only with MDVIEW_PERF")
    }

    override class func tearDown() {
        if let out = ProcessInfo.processInfo.environment["MDVIEW_PERF_OUT"], !report.isEmpty,
           let d = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? d.write(to: URL(fileURLWithPath: out))
        }
        super.tearDown()
    }

    // MARK: tools

    static func now() -> Double { Date().timeIntervalSince1970 * 1000 }
    static func median(_ v: [Double]) -> Double { v.isEmpty ? 0 : v.sorted()[v.count / 2] }
    static func p95(_ v: [Double]) -> Double { v.isEmpty ? 0 : v.sorted()[min(v.count - 1, Int(Double(v.count) * 0.95))] }
    static func r(_ x: Double) -> Double { (x * 10).rounded() / 10 }

    func note(_ rel: String) -> String { Lib.join(corpus, rel) }

    /// The run loop's turns that took longer than a frame, while `body` runs.
    func hangs(_ body: () -> Void) -> (count: Int, max: Double, total: Double) {
        var began = 0.0, long: [Double] = []
        let obs = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity([.afterWaiting, .beforeWaiting]).rawValue, true, 0) { _, act in
            if act == .afterWaiting { began = PerfTests.now() } else if began > 0 { let d = PerfTests.now() - began; if d > 16.7 { long.append(d) }; began = 0 }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), obs, .commonModes)
        body()
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), obs, .commonModes)
        return (long.count, long.max() ?? 0, long.reduce(0, +))
    }

    /// The page's frames from now on (requestAnimationFrame's times).
    func framesStart(_ w: NoteWindow) {
        _ = page(w, "(() => { const s = window.__perf = { t: [], on: true }; const tick = (ts) => { if (!s.on) return; s.t.push(ts); requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()")
    }

    /// The frames since `framesStart`: how many, the longest gap, how many gaps missed a frame (>20 ms) or two (>34 ms).
    func framesStop(_ w: NoteWindow) -> [String: Double] {
        let s = page(w, "(() => { const s = window.__perf; s.on = false; const g = []; for (let i = 1; i < s.t.length; i++) g.push(s.t[i] - s.t[i - 1]); return JSON.stringify({ frames: s.t.length, max: g.length ? Math.max(...g) : 0, over20: g.filter((x) => x > 20).length, over34: g.filter((x) => x > 34).length }); })()") as? String ?? "{}"
        return (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Double] ?? [:]
    }

    /// A window as the app makes it (AppDelegate's list, as `open`), painted as a seen one.
    func make(path: String? = nil, folder: String? = nil) -> NoteWindow {
        let w = NoteWindow(path: path, folder: folder)
        paint(w)
        windows.append(w)
        AppDelegate.shared.windows.append(w)
        w.onClose = { w in AppDelegate.shared.windows.removeAll { $0 === w } }
        return w
    }

    /// Whether the note at `p` is the one the page shows, drawn and faded in.
    func drawn(_ w: NoteWindow, _ p: String) -> Bool {
        (page(w, "!!(window.MdPage && MdPage.current && MdPage.current.path === \(jsonString(p)) && document.querySelector('#content.ready'))") as? Bool) == true
    }

    func put(_ name: String, _ v: [String: Any]) {
        PerfTests.report[name] = v
        let line = v.keys.sorted().map { "\($0)=\(v[$0]!)" }.joined(separator: "  ")
        print("PERF \(name): \(line)")
    }

    func close(_ w: NoteWindow) {
        w.closeNow()
        AppDelegate.shared.windows.removeAll { $0 === w }
        wait(0.3)
    }

    // MARK: the cases

    /// A new window with a note: until the note is drawn — the first of the run (a web process to start) and the others.
    func testA_NewWindow() {
        let p = note("Notizen/Bildschirm-Spiegel Aufbau.md")
        var ready: [Double] = [], drawnAt: [Double] = [], beforeNav: [Double] = []
        var first: [String: Double] = [:]
        for i in 0..<6 {
            let t0 = PerfTests.now()
            let w = make(path: p)
            wait(15) { w.ready }
            let t1 = PerfTests.now()
            wait(10) { self.drawn(w, p) }
            let t2 = PerfTests.now()
            let origin = (page(w, "performance.timeOrigin") as? Double) ?? t0
            if i == 0 { first = ["ready": PerfTests.r(t1 - t0), "drawn": PerfTests.r(t2 - t0), "beforeNav": PerfTests.r(origin - t0)] }
            else { ready.append(t1 - t0); drawnAt.append(t2 - t0); beforeNav.append(origin - t0) }
            close(w)
        }
        put("A new window", ["cold_drawn_ms": first["drawn"]!, "cold_beforeNav_ms": first["beforeNav"]!,
                             "warm_ready_ms": PerfTests.r(PerfTests.median(ready)), "warm_drawn_ms": PerfTests.r(PerfTests.median(drawnAt)),
                             "warm_beforeNav_ms": PerfTests.r(PerfTests.median(beforeNav))])
    }

    /// A folder window (the whole corpus): until the page is up, and what one scan of the folder costs the main thread.
    func testB_FolderWindow() {
        var ready: [Double] = []
        var w: NoteWindow!
        for _ in 0..<4 {
            let t0 = PerfTests.now()
            w = make(folder: corpus)
            wait(20) { w.ready }
            ready.append(PerfTests.now() - t0)
            close(w)
        }
        w = make(folder: corpus)
        wait(20) { w.ready }
        var scans: [Double] = []
        for _ in 0..<5 { let t = PerfTests.now(); w.rescan(); scans.append(PerfTests.now() - t) }
        // what the page does with the folder it is told (MdView.setFolder, its time inside the page)
        _ = page(w, "(() => { const f = MdView.setFolder; window.__sf = []; MdView.setFolder = function () { const t = performance.now(); const r = f.apply(this, arguments); window.__sf.push(performance.now() - t); return r; }; return 1; })()")
        for _ in 0..<5 { w.treeJSON = nil; w.sendFolder(); wait(0.15) }
        let sf = (page(w, "JSON.stringify(window.__sf)") as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [Double] } ?? []
        let notes = (page(w, "MdPage.folder && MdPage.folder.all ? JSON.stringify(MdPage.folder.all).length : 0") as? Double) ?? 0
        put("B folder window", ["ready_ms": PerfTests.r(PerfTests.median(ready)), "rescan_main_ms": PerfTests.r(PerfTests.median(scans)),
                                "setFolder_page_ms": PerfTests.r(PerfTests.median(sf)), "tree_json_chars": notes])
    }

    /// From one note to another in a folder window, as a click in the sidebar does it.
    func testC_NoteSwitch() {
        let w = make(folder: corpus)
        wait(20) { w.ready }
        let list = ["Notizen/Bildschirm-Spiegel Aufbau.md", "Notizen/UI-Framework Konzept.md", "Notizen/ASUS UX31A Ladefehler.md",
                    "Notizen/Mac + Tablet/Cast-Latenz und Strom.md", "Notizen/Current Bugs.md", "Notizen/OS Design Updates.md"].map(note)
            .filter { Lib.isFile($0) }
        w.on("note", ["path": list[0]])
        wait(10) { self.drawn(w, list[0]) }
        var times: [Double] = []
        var h = (count: 0, max: 0.0, total: 0.0)
        h = hangs {
            for round in 0..<2 {
                for p in (round == 0 ? Array(list.dropFirst()) : list) {
                    let t0 = PerfTests.now()
                    w.on("note", ["path": p])
                    wait(10) { self.drawn(w, p) }
                    times.append(PerfTests.now() - t0)
                }
            }
        }
        put("C note switch", ["median_ms": PerfTests.r(PerfTests.median(times)), "p95_ms": PerfTests.r(PerfTests.p95(times)),
                              "main_hangs": h.count, "main_hang_max_ms": PerfTests.r(h.max)])
    }

    /// A note chosen as a click chooses it (going, then the shell asked): from the click to the frame that shows it — and where
    /// that time goes: the way to the shell and back, the page's drawing, the frames held. Chosen among the rows of All Notes
    /// too (tile: All Notes goes as the note comes), and drawn as the shell alone asks for it (direct: what drawing costs).
    func testC2_NoteClick() {
        let w = make(folder: corpus)
        wait(20) { w.ready }
        let list = ["Notizen/Bildschirm-Spiegel Aufbau.md", "Notizen/UI-Framework Konzept.md", "Notizen/ASUS UX31A Ladefehler.md",
                    "Notizen/Mac + Tablet/Cast-Latenz und Strom.md", "Notizen/Current Bugs.md", "Notizen/OS Design Updates.md"].map(note)
            .filter { Lib.isFile($0) }
        w.on("note", ["path": list[0]])
        wait(10) { self.drawn(w, list[0]) }
        wait(2)
        // (the shell calls MdView.render by its name: wrapped, it says when the shell's answer came, and — where the page
        // draws at once — what drawing cost, and the layout after it)
        _ = page(w, """
        (() => { const raf = window.requestAnimationFrame.bind(window); // (whether the note came out in a frame's callback: painted in that frame)
          window.requestAnimationFrame = (cb) => raf((ts) => { const b = document.body.hasAttribute('data-going'); try { cb(ts); } finally { if (b && !document.body.hasAttribute('data-going') && window.__sw) window.__sw.inFrame = 1; } });
          const orig = MdView.render; MdView.render = function () { const s = window.__sw || {}; s.called = performance.now();
          const going = document.body.hasAttribute('data-going'); const r = orig.apply(this, arguments);
          if (!going) { s.sync = performance.now() - s.called; const t = performance.now(); document.body.getBoundingClientRect(); void document.documentElement.scrollHeight; s.layout = performance.now() - t; }
          return r; }; return 1; })()
        """)
        func probe(_ p: String, mode: String) -> [String: Double] {
            if mode == "tile" {
                let at = String(p.dropFirst(corpus.count + 1)).split(separator: "/").dropLast().map(String.init)
                _ = page(w, "(MdOverview.close(false), MdOverview.open(null, { scope: 'folders', at: \(jsonString(at)) }), 1)")
                wait(5) { (self.page(w, "[...document.querySelectorAll('#overview .ov-item')].some((e) => e.dataset.path === \(jsonString(p)))") as? Bool) == true }
                wait(0.8)
            }
            _ = page(w, """
            ((p, mode) => { const s = window.__sw = { t0: performance.now(), frames: [] };
              // shown: the start of the frame after the one that paints it — the next one where it came out in a frame's
              // callback, the one after the next where it came between two frames
              const mo = new MutationObserver(() => { if (!document.body.hasAttribute('data-going') && !s.arrived) { s.arrived = performance.now(); mo.disconnect();
                if (s.inFrame) requestAnimationFrame(() => { s.shown = performance.now(); }); else requestAnimationFrame(() => requestAnimationFrame(() => { s.shown = performance.now(); })); } });
              mo.observe(document.body, { attributes: true, attributeFilter: ['data-going'] });
              const tick = (ts) => { s.frames.push(ts); if (!s.shown || performance.now() - s.shown < 400) requestAnimationFrame(tick); else s.done = 1; };
              requestAnimationFrame(tick);
              if (mode === 'click') { MdPage.going(p); MdPage.post('note', { path: p }); }
              if (mode === 'tile') MdOverview.go([...document.querySelectorAll('#overview .ov-item')].find((e) => e.dataset.path === p));
              return 1; })(\(jsonString(p)), \(jsonString(mode)))
            """)
            if mode == "direct" { w.on("note", ["path": p]); _ = page(w, "(() => { const s = window.__sw; s.arrived = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { s.shown = performance.now(); })); return 1; })()") }
            wait(10) { (self.page(w, "window.__sw.done || 0") as? Double) == 1 }
            let s = page(w, """
            (() => { const s = window.__sw; const g = []; for (let i = 1; i < s.frames.length; i++) g.push(s.frames[i] - s.frames[i - 1]);
              return JSON.stringify({ shell: (s.called || 0) - s.t0, sync: s.sync || 0, layout: s.layout || 0, arrived: s.arrived - s.t0, shown: s.shown - s.t0,
                gap: g.length ? Math.max(...g) : 0, over34: g.filter((x) => x > 34).length }); })()
            """) as? String ?? "{}"
            return (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Double] ?? [:]
        }
        var shown: [Double] = [], tiles: [Double] = [], shell: [Double] = [], sync: [Double] = [], layout: [Double] = []
        var h = (count: 0, max: 0.0, total: 0.0)
        h = hangs {
            for round in 0..<3 {
                for p in (round == 0 ? Array(list.dropFirst()) : list) {
                    let r = probe(p, mode: "click")
                    shown.append(r["shown"] ?? 0); shell.append(r["shell"] ?? 0)
                    print("PERF C2 click \(round) \(Lib.name(p)): " + r.keys.sorted().map { "\($0)=\(PerfTests.r(r[$0]!))" }.joined(separator: " "))
                }
            }
        }
        for round in 0..<2 {
            for p in (round == 0 ? Array(list.dropFirst()) : list) {
                let r = probe(p, mode: "tile")
                tiles.append(r["shown"] ?? 0)
                print("PERF C2 tile \(round) \(Lib.name(p)): " + r.keys.sorted().map { "\($0)=\(PerfTests.r(r[$0]!))" }.joined(separator: " "))
            }
        }
        for p in list {
            let r = probe(p, mode: "direct")
            sync.append(r["sync"] ?? 0); layout.append(r["layout"] ?? 0)
            print("PERF C2 direct \(Lib.name(p)): " + r.keys.sorted().map { "\($0)=\(PerfTests.r(r[$0]!))" }.joined(separator: " "))
        }
        put("C2 note click", ["shown_median_ms": PerfTests.r(PerfTests.median(shown)), "shown_p95_ms": PerfTests.r(PerfTests.p95(shown)),
                              "tile_median_ms": PerfTests.r(PerfTests.median(tiles)), "tile_p95_ms": PerfTests.r(PerfTests.p95(tiles)),
                              "shell_median_ms": PerfTests.r(PerfTests.median(shell)), "draw_median_ms": PerfTests.r(PerfTests.median(sync)),
                              "layout_median_ms": PerfTests.r(PerfTests.median(layout)), "main_hangs": h.count, "main_hang_max_ms": PerfTests.r(h.max)])
    }

    /// The sidebar shown and hidden, gliding: the frames of it.
    func testD_SidebarGlide() {
        let p = note("Notizen/UI-Framework Konzept.md")
        let w = make(folder: corpus)
        wait(20) { w.ready }
        w.on("note", ["path": p])
        wait(10) { self.drawn(w, p) }
        wait(0.5)
        var over20 = 0.0, over34 = 0.0, frames = 0.0, maxGap = 0.0
        let h = hangs {
            for _ in 0..<3 {
                framesStart(w)
                _ = page(w, "(MdPage.showSidebar(true, true), 1)")
                wait(0.8)
                _ = page(w, "(MdPage.showSidebar(false, true), 1)")
                wait(0.8)
                let f = framesStop(w)
                over20 += f["over20"] ?? 0; over34 += f["over34"] ?? 0; frames += f["frames"] ?? 0; maxGap = max(maxGap, f["max"] ?? 0)
            }
        }
        put("D sidebar glide", ["frames": frames, "missed_frames": over20, "missed_two": over34, "max_gap_ms": PerfTests.r(maxGap),
                                "main_hangs": h.count])
    }

    /// Reading to the active mode: the first time (its scripts loaded) and again.
    func testE_ModeSwitch() {
        let p = note("Notizen/UI-Framework Konzept.md")
        let w = make(path: p)
        wait(15) { w.ready }
        wait(10) { self.drawn(w, p) }
        func to(_ m: String) -> Double {
            let t0 = PerfTests.now()
            _ = page(w, "(MdPage.setMode(\(jsonString(m))), 1)")
            wait(10) { (self.page(w, "MdPage.mode === \(jsonString(m)) && (\(jsonString(m)) !== 'active' || !!(window.MdActive && MdActive.view && MdActive.view.pm && MdActive.view.el && MdActive.view.el.offsetHeight))") as? Bool) == true }
            return PerfTests.now() - t0
        }
        let first = to("active")
        var again: [Double] = [], back: [Double] = []
        for _ in 0..<4 { back.append(to("read")); again.append(to("active")) }
        put("E mode switch", ["active_first_ms": PerfTests.r(first), "active_again_ms": PerfTests.r(PerfTests.median(again)),
                              "read_ms": PerfTests.r(PerfTests.median(back))])
    }

    /// Typing in the active mode: one letter's transaction, and the time to the next frame after it; then the same while
    /// the shell rescans the folder (what a save sets off).
    func testF_Typing() {
        let src = note("Notizen/UI-Framework Konzept.md")
        // (a copy to type into: the corpus is not written)
        let p = write("Typing.md", read(src))
        let w = make(folder: dir)
        wait(20) { w.ready }
        w.on("note", ["path": p])
        wait(10) { self.drawn(w, p) }
        _ = page(w, "(MdPage.setMode('active'), 1)")
        wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true }
        wait(0.5)
        let typeJS = """
        new Promise((done) => {
          const v = MdActive.view.pm, out = { sync: [], frame: [] };
          v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc)));
          let n = 0;
          const one = () => {
            const t = performance.now();
            v.dispatch(v.state.tr.insertText(n % 6 === 5 ? " " : "a"));
            out.sync.push(performance.now() - t);
            requestAnimationFrame(() => { out.frame.push(performance.now() - t); if (++n < 40) setTimeout(one, 60); else done(JSON.stringify(out)); });
          };
          one();
        })
        """
        func run() -> (sync: [Double], frame: [Double]) {
            let s = page(w, typeJS) as? String ?? "{}"
            let o = (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: [Double]] ?? [:]
            return (o["sync"] ?? [], o["frame"] ?? [])
        }
        // (page() waits 10 s at most; 40 letters take ~3 s)
        let calm = run()
        // the same while the folder is scanned again and again, as saves set it off (a bigger folder: the corpus)
        let big = make(folder: corpus)
        wait(20) { big.ready }
        var scanning = true
        func scanLoop() { guard scanning else { return }; big.rescanQuietly(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { scanLoop() } }
        scanLoop()
        var busy = (sync: [Double](), frame: [Double]())
        let h = hangs { busy = run() }
        scanning = false
        put("F typing", ["sync_median_ms": PerfTests.r(PerfTests.median(calm.sync)), "sync_p95_ms": PerfTests.r(PerfTests.p95(calm.sync)),
                         "to_frame_median_ms": PerfTests.r(PerfTests.median(calm.frame)), "to_frame_p95_ms": PerfTests.r(PerfTests.p95(calm.frame)),
                         "rescanning_to_frame_p95_ms": PerfTests.r(PerfTests.p95(busy.frame)), "rescanning_main_hang_max_ms": PerfTests.r(h.max)])
    }

    /// A long note scrolled from top to bottom in 1.5 s (in reading and in the active mode): the frames.
    func testG_Scroll() {
        let p = note("Notizen/UI-Framework Konzept.md")
        let w = make(path: p)
        wait(15) { w.ready }
        wait(10) { self.drawn(w, p) }
        wait(0.5)
        let scrollJS = """
        new Promise((done) => {
          scrollTo(0, 0);
          const end = document.documentElement.scrollHeight - innerHeight, t0 = performance.now();
          const step = () => { const k = Math.min(1, (performance.now() - t0) / 1500); scrollTo(0, end * k); if (k < 1) requestAnimationFrame(step); else done(end); };
          requestAnimationFrame(step);
        })
        """
        var out: [String: Any] = [:]
        for m in ["read", "active"] {
            _ = page(w, "(MdPage.setMode('\(m)'), 1)")
            wait(10) { (self.page(w, "MdPage.mode === '\(m)'") as? Bool) == true }
            wait(0.6)
            framesStart(w)
            let height = page(w, scrollJS) as? Double ?? 0
            let f = framesStop(w)
            out["\(m)_missed_frames"] = f["over20"] ?? 0
            out["\(m)_max_gap_ms"] = PerfTests.r(f["max"] ?? 0)
            out["\(m)_frames"] = f["frames"] ?? 0
            out["\(m)_height_px"] = height
        }
        put("G scroll", out)
    }

    /// The window made wider and narrower in steps, as a hand pulling its corner: the time until the page has laid out.
    func testH_Resize() {
        let p = note("Notizen/UI-Framework Konzept.md")
        let w = make(path: p)
        wait(15) { w.ready }
        wait(10) { self.drawn(w, p) }
        var times: [Double] = []
        let h = hangs {
            for i in 0..<24 {
                let width = 700 + Double((i % 12) * 25) * (i < 12 ? 1 : -1) + (i < 12 ? 0 : 300)
                let t0 = PerfTests.now()
                w.window.setContentSize(NSSize(width: width, height: 700))
                wait(2) { (self.page(w, "innerWidth") as? Double) == width }
                _ = page(w, "new Promise((r) => requestAnimationFrame(() => r(1)))")
                times.append(PerfTests.now() - t0)
            }
        }
        put("H resize", ["step_median_ms": PerfTests.r(PerfTests.median(times)), "step_p95_ms": PerfTests.r(PerfTests.p95(times)),
                         "main_hangs": h.count, "main_hang_max_ms": PerfTests.r(h.max)])
    }

    /// All Notes over the whole corpus, as the list Henri has it: until its rows stand.
    func testI_AllNotes() {
        let w = make(folder: corpus)
        wait(20) { w.ready }
        wait(0.5)
        var times: [Double] = []
        for _ in 0..<4 {
            let t0 = PerfTests.now()
            _ = page(w, "(MdOverview.showAt([], 'all'), 1)")
            wait(10) { ((self.page(w, "document.querySelectorAll('#overview [data-path]').length") as? Double) ?? 0) > 5 }
            _ = page(w, "new Promise((r) => requestAnimationFrame(() => r(1)))")
            times.append(PerfTests.now() - t0)
            _ = page(w, "(MdOverview.close(), 1)")
            wait(0.6)
        }
        let rows = page(w, "(MdOverview.showAt([], 'all'), document.querySelectorAll('#overview [data-path]').length)") as? Double ?? 0
        put("I all notes", ["first_ms": PerfTests.r(times.first ?? 0), "again_ms": PerfTests.r(PerfTests.median(Array(times.dropFirst()))), "rows": rows])
    }

    /// A note with a Mermaid diagram: drawn, and its diagram drawn.
    func testJ_Heavy() {
        let p = note("Notizen/Bildschirm-Spiegel Aufbau.md")
        var drawnAt: [Double] = [], figure: [Double] = []
        for _ in 0..<3 {
            let t0 = PerfTests.now()
            let w = make(path: p)
            wait(15) { w.ready }
            wait(10) { self.drawn(w, p) }
            drawnAt.append(PerfTests.now() - t0)
            wait(10) { (self.page(w, "!!document.querySelector('#content .rendered svg, #content .cached svg')") as? Bool) == true }
            figure.append(PerfTests.now() - t0)
            close(w)
        }
        put("J mermaid note", ["drawn_ms": PerfTests.r(PerfTests.median(drawnAt)), "diagram_ms": PerfTests.r(PerfTests.median(figure))])
    }

    /// A new window as the app opens it (AppDelegate.openWindow) while a spare is ready: until the note is drawn.
    func testK_SpareWindow() {
        let p = note("Notizen/Bildschirm-Spiegel Aufbau.md")
        let app = AppDelegate.shared!
        app.sparesOn = true
        defer { app.sparesOn = false; app.spare?.dispose(); app.spare = nil }
        var times: [Double] = [], shellSide: [Double] = [], toPage: [Double] = [], renderSync: [Double] = [], toFrame: [Double] = []
        for _ in 0..<5 {
            app.makeSpare()
            let s = app.spare!
            wait(15) { s.ready }
            // (as a spare that stood a while: its warming done — MdView.warm)
            wait(8) { (self.page(s, "!!(window.mermaid && window.MdActive && MdActive.view)") as? Bool) == true }
            wait(0.5)
            _ = page(s, "(() => { const f = MdView.render; window.__r = {}; MdView.render = function () { const t = performance.now(); window.__r.at = performance.timeOrigin + t; const r = f.apply(this, arguments); window.__r.sync = performance.now() - t; requestAnimationFrame(() => { window.__r.frame = performance.timeOrigin + performance.now(); }); return r; }; return 1; })()")
            let t0 = PerfTests.now()
            app.openWindow(p)
            let t1 = PerfTests.now()
            let w = app.windows.last!
            paint(w)
            windows.append(w)
            wait(10) { self.drawn(w, p) }
            times.append(PerfTests.now() - t0)
            shellSide.append(t1 - t0)
            let r = ((page(w, "JSON.stringify(window.__r)") as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]).compactMapValues { $0 as? Double }
            toPage.append((r["at"] ?? t0) - t0); renderSync.append(r["sync"] ?? 0); toFrame.append((r["frame"] ?? t0) - t0)
            close(w)
        }
        put("K spare window", ["drawn_ms": PerfTests.r(PerfTests.median(times)), "max_ms": PerfTests.r(times.max() ?? 0),
                               "shell_ms": PerfTests.r(PerfTests.median(shellSide)), "render_called_at_ms": PerfTests.r(PerfTests.median(toPage)),
                               "render_sync_ms": PerfTests.r(PerfTests.median(renderSync)), "first_frame_at_ms": PerfTests.r(PerfTests.median(toFrame))])
    }

    /// How many frames a page gets in a second (requestAnimationFrame), with WebKit's own wish for 60 Hz pages and without
    /// it — in Low Power Mode WebKit holds pages to 30.
    func testZ_FrameRate() {
        func rate(_ near60: Bool) -> Double {
            let cfg = WKWebViewConfiguration()
            if #available(macOS 14, *) { cfg.preferences.inactiveSchedulingPolicy = .none }
            if near60 {
                let sel = NSSelectorFromString("_setEnabled:forFeature:")
                let all = (WKPreferences.self as AnyObject).perform(NSSelectorFromString("_features"))?.takeUnretainedValue() as? [NSObject] ?? []
                if let f = all.first(where: { ($0.value(forKey: "key") as? String) == "PreferPageRenderingUpdatesNear60FPSEnabled" }) {
                    typealias Set = @convention(c) (AnyObject, Selector, Bool, AnyObject) -> Void
                    unsafeBitCast(cfg.preferences.method(for: sel), to: Set.self)(cfg.preferences, sel, true, f)
                }
            }
            let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300), configuration: cfg)
            let win = NSWindow(contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
            win.contentView = web
            win.isReleasedWhenClosed = false
            let occl = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
            typealias SetB = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(web.method(for: occl), to: SetB.self)(web, occl, false)
            win.collectionBehavior = [.transient, .ignoresCycle]
            win.orderBack(nil)
            var loaded = false
            web.loadHTMLString("<body>x</body>", baseURL: nil)
            wait(5) { web.isLoading == false }
            wait(0.3)
            var n: Double = 0
            web.callAsyncJavaScript("return new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); })", arguments: [:], in: nil, in: .page) { res in
                if case .success(let v) = res { n = (v as? Double) ?? 0 }
                loaded = true
            }
            wait(5) { loaded }
            win.close()
            return n
        }
        put("Z frame rate", ["default_fps": rate(false), "near60_fps": rate(true)])
    }
}
