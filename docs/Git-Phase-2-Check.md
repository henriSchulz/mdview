---
tags: [mdview, git, check]
date: 2026-10-05
color: green
---

# Git-Phase 2: Durchklicken gegen GitHub

Was sich nur mit dem echten GitHub und einem Menschen prüfen lässt. Die Kästchen lassen sich in
der Leseansicht abhaken. Alles andere prüfen `cargo test`, `dev/rig.sh sync` und
`dev/rig.sh github`; der Plan dazu ist [[Git-Phase-2]].

> [!important] Vorher
> Einen Testordner nehmen, nicht die echten Notizen, und das Repository `md-view-test-notes`.
> Es muss für den ersten Durchgang leer sein. Es ist öffentlich: nichts hineinlegen, was
> niemand sehen soll.

## 1. Anmelden

- [x] Settings › History › GitHub › Sign In… zeigt einen Code (am 5. Oktober 2026 gelaufen)
- [x] Im Browser bestätigt: „Signed in as Henri Schulz (@henriSchulz)"
- [ ] App beenden und neu starten: Es steht weiter „Signed in as …", ohne neuen Code
- [ ] Sign Out, dann wieder Sign In…: geht, mit neuem Code

## 2. Verknüpfen

- [ ] Testordner öffnen, Verlauf einschalten, eine Notiz ändern
- [ ] Settings › History › GitHub › Link…: Das Auswahlfenster zeigt `henriSchulz/md-view-test-notes`, nichts ist vorausgewählt
- [ ] Tippen filtert die Liste; „Link" ist grau, bis ein Eintrag gewählt ist
- [ ] Gewählt und „Link": Nach ein paar Sekunden steht dort „henriSchulz/md-view-test-notes · the same on both"
- [ ] Auf github.com liegen die Notizen im Repository, samt `.mdview/project.json`
- [ ] Die Commits dort tragen deinen Namen, und in der Nachricht stehen `Device:` und `Client:`
- [ ] Der Tooltip der Uhr sagt „GitHub: the same on both"

## 3. Hin und her

- [ ] Eine Notiz ändern und <kbd>Ctrl</kbd>+<kbd>S</kbd>: Der Commit ist nach wenigen Sekunden auf github.com
- [ ] Eine Notiz ändern und 30 Sekunden nichts tun: ebenso
- [ ] Auf github.com eine Notiz bearbeiten und committen: Binnen einer Minute steht die Änderung in der offenen Notiz
- [ ] Auf github.com eine neue Datei anlegen: Sie erscheint in der Seitenleiste
- [ ] Auf github.com eine Datei löschen: Sie verschwindet aus der Seitenleiste
- [ ] Ctrl+Alt+H auf einer so geänderten Notiz: Die Version von GitHub steht in der Liste

## 4. Zweites Gerät

Als zweites Gerät genügt ein zweiter Ordner auf demselben Rechner.

- [ ] Settings › History › GitHub › Get…: Repository wählen, einen Zielordner wählen
- [ ] Es öffnet sich ein Fenster mit den Notizen; die Uhr sagt „History: on · GitHub: the same on both"
- [ ] Im einen Ordner ändern und <kbd>Ctrl</kbd>+<kbd>S</kbd>: Im anderen steht es binnen einer Minute
- [ ] In beiden verschiedene Notizen ändern, jeweils <kbd>Ctrl</kbd>+<kbd>S</kbd>: Beide haben danach beides, auf github.com steht ein Merge-Commit
- [ ] In beiden dieselbe Notiz an verschiedenen Stellen ändern: wird von selbst zusammengeführt

## 5. Konflikt

- [ ] In beiden dieselbe Zeile verschieden ändern, erst im einen <kbd>Ctrl</kbd>+<kbd>S</kbd>, dann im anderen
- [ ] Im zweiten: Einblendung, die Uhr wird rot, ihr Menü hat „Resolve Conflicts…"
- [ ] Die Notiz dort ist, wie sie dort geschrieben wurde: keine Marker, nichts vom anderen
- [ ] Das Fenster zeigt beide Fassungen mit Gerät und Zeit; „Join" ist grau, bis gewählt ist
- [ ] Gewählt und „Join": Das Fenster schließt, die Uhr ist wieder ruhig, beide Ordner haben dasselbe

## 6. Ohne Netz, und was nicht geht

- [ ] WLAN aus, ändern, <kbd>Ctrl</kbd>+<kbd>S</kbd>: lokal festgehalten; die Einstellungen sagen „not reached"
- [ ] WLAN an: Binnen einer Minute ist es auf github.com
- [ ] Einen zweiten, anderen Testordner mit Verlauf mit demselben Repository verknüpfen: wird abgelehnt und gesagt, die Verknüpfung ist danach wieder weg
- [ ] Unlink: Die Zeile sagt wieder „Not linked"; auf github.com und im Verlauf ist alles noch da
- [ ] Auf github.com der App das Repository entziehen (github.com › Settings › Applications › Installed GitHub Apps › Configure): Es steht nicht mehr in der Auswahl

## 7. Aus Phase 1 noch offen

- [ ] Einen Ordner mit eigenem `git init` öffnen, Uhr › „Use This Repository for History…": Die Rückfrage nennt den Branch; „Cancel" ändert nichts
- [ ] Einen Ordner einschalten, in dem schon ein Projekt liegt: Die Frage „Take In" / „Leave Separate" kommt; „Take In" macht ein Projekt daraus

## Was dabei auffällt

Hier notieren, was nicht so war wie beschrieben.

