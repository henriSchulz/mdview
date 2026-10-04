---
tags: [mdview, umbau]
date: 2026-10-04
color: orange
---

# Tauri-Umbau

Die Hülle der App ist von Python (GTK 3 + WebKit2GTK) auf Tauri (Rust) umgezogen – auf dem
Branch `tauri`. Die Oberfläche ist die bisherige Web-Seite; `main` bleibt bis zum Merge die
Python-Fassung.

> [!important] Stand
> Auf Linux macht die Rust-Hülle alles, was `mdview.py` machte, und das Rig läuft gegen sie
> genauso durch wie gegen die Python-Hülle. Windows und macOS sind vorbereitet, aber noch
> nie gebaut oder gestartet worden.

## Was jetzt wie gebaut ist

- **Hülle:** `src-tauri/`, rund 3800 Zeilen Rust. `shell.rs` sind die Fenster (Tabs, Verlauf,
  Speichern, Sidebar), `scan.rs` der Ordner-Scan, Titel, Wikilinks und PDF-Rücklinks, `host.rs`
  alles Systemnahe (Zwischenablage, WebKit-Einstellungen, Portal), `ai.rs` Vorschläge und
  Grafiken, `main.rs` der Start und das Protokoll.
- **Seite:** unverändert bis auf den Weg zur Hülle. Statt `window.webkit.messageHandlers.mdview`
  ruft sie `MdHost.post(…)`; die Hülle antwortet wie bisher mit `MdView.render(…)` und Co.
- **Ein eigenes Protokoll** statt `file://`: `md://localhost/shell/…` ist die Seite des
  Fensters, `md://localhost/app/…` sind Skripte und Styles, `md://localhost/file/…` die Dateien
  neben einer Notiz (Bilder, Ton, Film; in Stücken, wenn danach gefragt wird).
- **Ein Thread für die Fensterlogik:** Ordner-Scan, Rücklink-Suche und Datei-Lesen laufen
  nicht mehr im Thread des Fensters.
- **Zweiter Start:** übergibt seine Dateien an die laufende Instanz (Single-Instance-Plugin
  statt `gdbus` im Launcher) und ist nach rund 70 ms wieder weg (Debug-Build).
- **Kein Build für die Seite:** `viewer.js` und Co. werden bei jedem Fenster frisch aus dem
  Checkout gelesen. Nur Änderungen in `src-tauri` brauchen `cargo build`.

## Geprüft

| Was | Ergebnis |
|---|---|
| `npm test` (jsdom) | 111 bestanden, 9 übersprungen (ohne `corpus/`) |
| Rig: `modes`, `edit`, `islands`, `m4`, `m5`, `folder`, `tabs`, `callout`, `link`, `native`, `edges`, `compare`, `pdf`, `clip`, `dnd`, `zoom`, `adjust`, `textmenu`, `more`, `lists`, `latex`, `mathtext`, `ghost`, `graphic` | bestanden |
| Rig: `regress` (Seite von `main` gegen diese) | Bericht und Screenshots gleich |
| Rig: `overview`, `panel`, `columns`, `prefs`, `blocks` | dieselben Fehlschläge wie auf `main` mit der Python-Hülle – nicht vom Umbau |
| Von Hand im Rig | Bilder über `md://`, Theme-Wechsel im Lauf, zweiter Start, Ordner-Fenster, Schließen aus der Seite |

Nicht geprüft: `perf`, `typing`, `shots`; der Datei-Dialog beim Start ohne Argument und ohne
letzten Ordner; Drucken; „Öffnen mit“ und „Im Dateimanager zeigen“; Vorschläge und Grafiken
mit dem echten Modell (im Rig nur mit festen Antworten).

## Was anders ist als in der Python-Hülle

- **Kennung:** `dev.henri.MdViewRs` statt `dev.henri.MdView`, damit die Rust-Fassung neben der
  noch laufenden Python-App startet, ohne dass deren D-Bus-Name sie abfängt. Die Fensterklasse
  bleibt `dev.henri.MdView` (Desktop-Eintrag, Dock). Beim Merge: Kennung in
  `src-tauri/tauri.conf.json` zurückstellen.
- **Kein Deckblatt** über dem ersten Bild des WebViews (das war gegen ein magentafarbenes
  Aufblitzen auf diesem Rechner). Das Fenster hat von Anfang an die Farbe des Themes; ob es
  trotzdem blitzt, muss man am echten Bildschirm sehen.
- **„Öffnen mit“** fragt nur noch das Portal; ohne Portal öffnet die Standard-App (früher ein
  GTK-Dialog).
- **Was die Seite sich merkt** (Scroll-Stellen, Embed-Größen) liegt unter der neuen Adresse
  `md://localhost` und fängt leer an.
- `![](file:///…)` mit ausgeschriebener `file:`-Adresse lädt nicht mehr; relative Pfade und
  Wikilinks wie bisher.

## Offen

- [ ] Auf macOS und Windows bauen und starten. Dort fehlen noch: Bild und HTML aus der
      Zwischenablage, Formel als Bild kopieren, Zwei-Finger-Zoom im PDF, die WebView-Schriften.
      Pfade mit `\` in der Seite (`overview.js`) sind ungeprüft.
- [ ] Angezeigte Tastenkürzel auf macOS (Cmd statt Strg).
- [ ] Schriften mitliefern oder ersetzen (Inter, JetBrains Mono); die SF-Symbole dürfen nicht
      weitergegeben werden.
- [ ] Installer (`bundle.active` ist aus; Icons für macOS fehlen), Signatur, Auto-Updater.
- [ ] PDFs über `md://` streamen statt als Base64-Stücke (der Weg ist da, die Seite nutzt ihn
      noch nicht).

## Verworfene Alternativen

| Weg | Warum nicht |
|---|---|
| Komplett Rust ohne WebView (egui, iced, GPUI) | Neubau der ganzen Oberfläche; für KaTeX, Mermaid und ProseMirror gibt es keinen gleichwertigen nativen Ersatz |
| Electron | läuft überall gleich, bringt aber ein ganzes Chromium mit |
| pywebview (Python bleibt) | weniger Arbeit, aber Python-Apps für macOS und Windows zu verpacken ist umständlich |
| Rust nur für Geschwindigkeit | die spürbare Zeit steckt im WebView, nicht in der Hülle |

## Was unabhängig davon mehr Tempo brächte

- Lange Notizen nur im sichtbaren Bereich rendern.
- Pro Tab einen eigenen WebView halten (bei Tauri noch als instabil markiert).
