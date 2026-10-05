---
tags: [mdview, git, web, check]
date: 2026-10-06
color: green
---

# Git-Phase 3: Durchklicken im Browser

Was sich nur mit dem echten GitHub und einem Menschen prüfen lässt. Alles andere prüfen die
Tests in `web/` (`npm run build && npm test`); der Plan dazu ist [[Git-Phase-3]]. Die Adresse:
<https://mdview--md-view.europe-west4.hosted.app>

> [!important] Vorher
> Zuerst mit `md-view-test-notes`, nicht mit echten Notizen. Am besten hängt ein Testordner der
> Desktop-App am selben Repository (siehe [[Git-Phase-2-Check]]): Dann sieht man beide Seiten.

## 1. Anmelden

- [x] „Sign in with GitHub" führt zu GitHub und zurück zur Liste der Repositories (5. Oktober 2026)
- [ ] Am nächsten Tag die Seite öffnen: ohne neue Anmeldung in der Liste (das Token wurde erneuert)
- [ ] „Sign Out", dann die Adresse eines Repositorys direkt aufrufen: Es kommt die Anmeldeseite
- [ ] Ein Repository, das der App nicht freigegeben ist, per Adresse aufrufen: „not there, or the app was not given it"

## 2. Lesen

- [ ] Ein Repository mit Notizen öffnen: Seitenleiste, Tabs und Notiz sehen aus wie am Desktop
- [ ] Wikilinks, gewöhnliche Links und Bilder in einer Notiz funktionieren
- [ ] Ein PDF aus der Seitenleiste öffnet im Betrachter
- [ ] <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd>: „Alle Notizen" zeigt Kacheln mit dem Anfang jeder Notiz
- [ ] Die Seite neu laden: dieselben Tabs, dieselbe Notiz
- [ ] Die Adresse einer Notiz in einem neuen Tab öffnen: Diese Notiz erscheint
- [ ] Dunkles Thema im System: Die App ist dunkel

## 3. Schreiben

- [ ] Im aktiven Modus tippen, 30 Sekunden warten: Der Commit steht auf github.com, mit deinem Namen und „Device: … Client: web"
- [ ] Tippen und <kbd>Ctrl</kbd>+<kbd>S</kbd>: Der Commit ist nach wenigen Sekunden da
- [ ] Tippen und den Tab sofort schließen, wieder öffnen: Das Getippte ist da und wird ein Commit
- [ ] Neue Notiz, umbenennen, löschen über die Seitenleiste: je ein Commit
- [ ] Ein Bild aus der Zwischenablage einfügen: Es erscheint in der Notiz und liegt im Repository
- [ ] Im aktiven Modus ein Bild aus dem Dateimanager auf die Notiz ziehen: Es steht dort, wo es fallen gelassen wurde, und liegt unter seinem Namen im Repository
- [ ] Ein PDF in der Seitenleiste umbenennen: ein Commit, die Datei unter dem neuen Namen
- [ ] Ein Repository ohne `.mdview/project.json` öffnen: nur lesen; Uhr › „Use This Repository for History…" fragt nach und schreibt dann die Markerdatei

## 4. Mit der Desktop-App zusammen

- [ ] Am Desktop ändern und <kbd>Ctrl</kbd>+<kbd>S</kbd>: Im Browser steht es binnen einer Minute, ohne Neuladen
- [ ] Im Browser ändern und <kbd>Ctrl</kbd>+<kbd>S</kbd>: Am Desktop steht es binnen einer Minute
- [ ] An beiden verschiedene Stellen derselben Notiz ändern: Beides ist danach in der Notiz
- [ ] An beiden dieselbe Zeile ändern, zuerst am Desktop speichern: Im Browser wird die Uhr rot; „Resolve Conflicts…" zeigt beide Fassungen, mit dem Namen des Desktop-Geräts
- [ ] Gewählt und „Join": Beide Seiten haben danach dasselbe

## 5. Verlauf und Einstellungen

- [ ] <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>: die Versionen der Notiz, die vom Desktop mit dessen Gerätenamen
- [ ] Eine ältere Version wiederherstellen: Sie ist wieder die Notiz, als neuer Commit
- [ ] <kbd>Ctrl</kbd>+<kbd>,</kbd>: keine Seite „Writing Help"; unter History das Repository, der Branch, der Stand; kein „Turn Off", kein „Unlink"

## Was dabei auffällt

Hier notieren, was nicht so war wie beschrieben.

