---
tags: [mdview, idee]
date: 2026-10-04
color: orange
---

# Tauri-Umbau

Eine Idee für später, nichts Beschlossenes: die Hülle der App von Python auf Tauri (Rust) umbauen,
damit sie auch auf Windows und macOS läuft. Die Oberfläche bliebe die heutige Web-Seite.

> [!important] Wann es sich lohnt
> Nur für Portabilität oder zum Weitergeben. Auf Linux nutzt Tauri ebenfalls WebKitGTK – Rendern
> und Scrollen wären dort genauso schnell wie heute.

## Stand heute

- **Hülle:** `mdview.py`, rund 2400 Zeilen Python mit GTK 3 und WebKit2GTK 4.1. Sie macht Fenster,
  Dateien, Ordner-Scan, Tabs und Verlauf, D-Bus, Theme.
- **Oberfläche:** reines JavaScript und CSS im WebView (`viewer.js`, `active/`, `overview.js`,
  `pdfview.js`), ohne Framework und ohne Build-Schritt.
- **Bibliotheken:** markdown-it, KaTeX, Mermaid, highlight.js, ProseMirror, pdf.js.
- So wie sie ist, läuft die App nur auf Linux: WebKitGTK gibt es für Windows nicht und auf macOS
  nur als Eigenbau.

## Was ein Umbau brächte

- **Windows und macOS** aus demselben Code, jeweils mit dem eingebauten WebView.
- **Installer** (`.dmg`, `.msi`, AppImage) aus einem Build, signierbar, mit Auto-Updater.
- **Keine Abhängigkeit** von Python und GTK 3; die Portierung auf GTK 4 entfiele.
- **Schnellerer Kaltstart**, weil der Python- und GTK-Import wegfällt.
- **Hintergrundarbeit ohne Ruckeln:** Ordner-Scan, Rücklink-Suche und PDF-Laden laufen heute im
  Haupt-Thread; PDFs könnten über ein eigenes Protokoll gestreamt werden statt als Base64-Stücke.
- **Mehrere WebViews pro Fenster** (bei Tauri noch als instabil markiert): Tabs könnten im
  Hintergrund weiterleben, statt beim Wechsel neu gezeichnet zu werden.

## Was er kostet

- Die Hülle neu schreiben, dazu das Rig und die Probes, die an `MDVIEW_PROBE` hängen.
- Ein Build-Schritt: heute Datei ändern und neu starten, dann kompiliert Rust mit.
- Omarchy-Integration nachbauen oder ersetzen: Live-Theme, henri-ui-Motion, D-Bus-Launcher.
- Schriften mitliefern oder ersetzen (Inter, JetBrains Mono); die SF-Symbole dürfen nicht
  weitergegeben werden, auf Windows blieben die SVG-Icons.
- Drei Engines testen: WebKit (macOS), Chromium (Windows), WebKitGTK (Linux). Zuerst zu prüfen:
  Editor im aktiven Modus, Glas-Effekt, Drucken.
- Angezeigte Tastenkürzel auf macOS anpassen (Cmd statt Strg).

## Verworfene Alternativen

| Weg | Warum nicht |
|---|---|
| Komplett Rust ohne WebView (egui, iced, GPUI) | Neubau der ganzen Oberfläche; für KaTeX, Mermaid und ProseMirror gibt es keinen gleichwertigen nativen Ersatz |
| Electron | läuft überall gleich, bringt aber ein ganzes Chromium mit |
| pywebview (Python bleibt) | weniger Arbeit, aber Python-Apps für macOS und Windows zu verpacken ist umständlich |
| Rust nur für Geschwindigkeit | die spürbare Zeit steckt im WebView, nicht in der Hülle |

## Erster Schritt, falls es ernst wird

Ein kleiner Durchstich statt des ganzen Umbaus:

- [ ] Tauri-Fenster, das die heutige Seite lädt
- [ ] eine Notiz lesen und speichern
- [ ] Ordner mit Sidebar und Tabs
- [ ] auf macOS oder Windows starten und sehen, was von der Seite ohne Änderung läuft

## Was unabhängig davon mehr Tempo brächte

- Lange Notizen nur im sichtbaren Bereich rendern.
- Pro Tab einen eigenen WebView halten (ginge auch in der jetzigen Hülle).
