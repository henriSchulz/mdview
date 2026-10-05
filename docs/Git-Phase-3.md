---
tags: [mdview, git, web, plan]
date: 2026-10-06
color: blue
---

# Git-Phase 3: Die Web-App

Umsetzungsplan für die dritte Phase. Nach [[Git-Phase-1]] (lokale Historie) und [[Git-Phase-2]]
(Verknüpfung mit GitHub) kommt die Web-App: dieselben Notizen im Browser lesen und schreiben,
mit GitHub als einziger Quelle. Sie hat keinen eigenen Datenbestand und keine KI-Funktionen.

> [!important] Stand
> Entschieden am 6. Oktober 2026: zuerst nur Lesen; es gibt einen Knopf „Mit GitHub anmelden";
> die App läuft als Next.js-App bei **Firebase App Hosting**, gebaut aus diesem Repository, das
> öffentlich bleibt (MIT). Gebaut sind Schritt 1 (die Liste der Naht) und Schritt 2 (Gerüst,
> Anmeldung, Liste der Repositories; `web/`, 7 Tests gegen ein GitHub-Double). Gegen das echte
> GitHub und bei Firebase ist noch nichts gelaufen: Dafür fehlen das Backend bei Firebase, die
> Callback-URL und das Client-Secret (siehe „Was du dafür tun musst"). Schritt 3 bis 6 sind Plan.

## Was am Ende da ist

- Eine Next.js-App. Ohne Anmeldung bei GitHub sieht man nur die Anmeldeseite.
- Nach der Anmeldung: die freigegebenen Repositories, eines öffnen, und darin dieselbe
  Oberfläche wie in der Desktop-App – Seitenleiste, Tabs, Lesen, aktiver Modus, Quelltext,
  PDFs, Suche, Alle Notizen.
- Änderungen werden als Commits bei GitHub festgehalten, mit Konto und Gerät.
- Was die Desktop-App oder ein anderer Browser schreibt, erscheint ohne Neuladen.
- Ändern zwei dieselbe Stelle, kommt dasselbe Konfliktfenster wie am Desktop.
- Der Verlauf einer Notiz, mit Differenz und Wiederherstellen.

## Die Lage im Code

Die Oberfläche ist schon jetzt von der Hülle getrennt. Sie spricht über genau eine Stelle:

| Richtung | Wie | Umfang |
|---|---|---|
| Seite → Hülle | `MdHost.post(JSON)` | 64 Nachrichten |
| Hülle → Seite | `MdView.…(…)` | 29 Aufrufe |
| Dateien neben einer Notiz | `<base href>` aus `render`, `MdHost.files` | zwei Adressen |
| Skripte und Styles | aus dem `src` des eigenen Skripts (`ASSETS`) | nichts zu tun |

Die Web-App ist damit eine zweite Hülle. Was die Rust-Hülle für die Seite tut, muss sie auch
tun – aber gegen GitHub statt gegen die Platte:

| Was die Hülle tut | Rust heute | Web |
|---|---|---|
| Ordner als Baum, Reihenfolge, Titel | `scan.rs` | aus dem Stand des Repositorys, im Browser |
| Notiz laden, Wikilinks auflösen, Rücklinks | `shell.rs`, `scan.rs` | neu in TypeScript |
| Tabs, Zurück und Vor, zuletzt geöffnet | `shell.rs` | neu in TypeScript; Zustand im Browser |
| Speichern, neu, umbenennen, löschen, Bild einfügen | `shell.rs` | Entwurf im Browser, dann Commit |
| Verlauf, Abgleich, Konflikte | `history.rs`, `sync.rs` | über die GitHub-API |
| Einstellungen, Thema, Bewegung | `shell.rs`, `theme.rs` | im Browser; Thema fest hell und dunkel |

Das ist der größte Posten der Phase: rund 2500 Zeilen Hüllenlogik, von denen die Web-App etwa
die Hälfte braucht.

**Was die Web-App nicht bekommt**

- KI: Vorschläge beim Tippen und gezeichnete Grafiken (`ghost.js`, `graphic.js`, die Seite
  „Writing Help" und ihre Nachrichten). So entschieden.
- Was nur ein Rechner hat: „Open With…", „Show in Finder", der Ordnerdialog, das Omarchy-Thema,
  die SF-Symbole (die gezeichneten Symbole sind als Ersatz schon da).
- Verlauf einschalten, verknüpfen, Projekte aufnehmen: Im Web ist jedes geöffnete Repository
  schon verknüpft.

## Was die GitHub-Doku sagt

| Punkt | Befund |
|---|---|
| Anmeldung im Web | Der Web-Ablauf derselben GitHub App: Weiterleitung zu GitHub und zurück, mit PKCE. Der Tausch des Codes gegen das Token braucht das **Client-Secret**, also einen Server. Die Rückkehradresse muss in der App als „Callback URL" eingetragen sein |
| Token | wie am Desktop: 8 Stunden, Auffrischtoken 6 Monate. Erneuern braucht hier ebenfalls das Client-Secret |
| Schreiben | GraphQL `createCommitOnBranch`: mehrere Dateien in einem Commit, mit `expectedHeadOid` – der Commit gelingt nur, wenn der Branch noch dort steht. Autor ist, wem das Token gehört; GitHub signiert den Commit, er gilt als „Verified" |
| Alles lesen | `GET …/git/trees/{sha}?recursive=1`: bis 100 000 Einträge und 7 MB, darüber `truncated` |
| Eine Datei lesen | Contents-API: bis 1 MB normal, bis 100 MB als Rohdaten, darüber nicht |
| Grenzen | 5000 Anfragen pro Stunde je Nutzer; höchstens 80 schreibende pro Minute und 500 pro Stunde |

## Aufbau

```mermaid
flowchart LR
  subgraph Browser
    P[Seite: viewer.js, active/, vendor/ – unverändert]
    H[host.ts: die Hülle im Browser]
    D[(Entwürfe und Zwischenspeicher: IndexedDB)]
    P <-- "MdHost.post / MdView.…" --> H
    H <--> D
  end
  subgraph Server[Next.js-Server]
    A[Anmeldung, Sitzung]
    R[/api: Stand, Datei, Commit, Verlauf/]
    F[/file: Bilder und PDFs/]
  end
  H -- fetch --> R
  P -- "img, pdf" --> F
  A & R & F -- Token --> G[GitHub]
```

- **Das Token bleibt auf dem Server.** Es liegt verschlüsselt in einem Cookie, das Skripte nicht
  lesen können. Der Browser spricht nur mit der eigenen App, die App mit GitHub.
- **Die Hülle läuft im Browser** (`host.ts`). Sie hält den Stand des Repositorys im Speicher,
  beantwortet die Nachrichten der Seite und fragt den Server nur nach Daten.
- **Ein Stand auf einmal.** Beim Öffnen holt der Server den Baum und den Text aller Notizen zum
  aktuellen Commit und gibt ihn in Stücken an den Browser. Danach sind Titel, Wikilinks,
  Rücklinks, Vorschauen und Suche lokal wie am Desktop. Bilder und PDFs kommen einzeln, wenn
  sie gebraucht werden. Alles ist nach Commit und Blob benannt und bleibt im Browser liegen.
- **Die Seite selbst wird nicht kopiert.** `viewer.js`, `active/`, `vendor/` und die Styles
  kommen beim Bauen aus dem Checkout in die Web-App.

## Bei Firebase App Hosting

Der Weg dorthin: Zuerst war GitHub Pages gewählt. Dort gibt es keinen Anmelde-Knopf, weil Pages
nur Dateien ausliefert und GitHubs Adressen für den Token-Tausch sich von einer Webseite nicht
aufrufen lassen (geprüft am 6. Oktober 2026). Firebase App Hosting führt die Next.js-App samt
Server-Teil aus; damit geht die Anmeldung so, wie sie oben gezeichnet ist.

| Punkt | Befund aus der Firebase-Doku |
|---|---|
| Tarif | nur im Bezahltarif (Blaze) |
| Next.js | ab 13.5 |
| Woher gebaut wird | aus einem verbundenen GitHub-Repository; jeder Push auf den Live-Branch (`main`) veröffentlicht von selbst |
| App in einem Unterordner | „App root directory", hier `/web` |
| Einstellungen | `web/apphosting.yaml`: Größe und Zahl der Instanzen, Umgebungsvariablen |
| Geheimnisse | `firebase apphosting:secrets:set NAME`; sie liegen in Googles Secret Manager, nicht im Repository |
| Adresse | `<backend>--<projekt>.<region>.hosted.app`; eine eigene Domain lässt sich später verbinden |

Daraus folgt:

- **Der Aufbau oben gilt:** Anmeldung und Sitzung auf dem Server, das Token in einem
  verschlüsselten Cookie, der Browser spricht nur mit der eigenen App.
- **Die Anmeldung hält**, solange das Auffrischtoken gilt (sechs Monate ohne Gebrauch): Der
  Server erneuert das Token selbst.
- **Kosten:** Die App läuft nur, wenn jemand sie aufruft (`minInstances: 0`). Der erste Aufruf
  nach einer Pause dauert dafür ein paar Sekunden.

## Schreiben

1. Die Seite speichert wie immer nach 800 ms („save"). Die Web-Hülle legt den Text sofort als
   Entwurf in den Browser; ein Neuladen oder Absturz verliert nichts.
2. Ein Commit folgt wie am Desktop: nach 30 s Ruhe, mit <kbd>Ctrl</kbd>+<kbd>S</kbd>, und wenn
   der Tab verlassen wird.
3. Der Commit nennt den Stand, auf dem er aufbaut (`expectedHeadOid`). Steht der Branch noch
   dort, ist er drin.
4. Steht er woanders, hat inzwischen jemand geschrieben. Die Hülle holt, was neu ist, und führt
   je Datei drei Fassungen zusammen: den alten Stand, den Entwurf, den neuen Stand. Geht das
   ohne Konflikt, wird der Commit auf dem neuen Stand wiederholt.
5. Geht es nicht, öffnet sich das Konfliktfenster aus Phase 2 (`active/conflict.js`). Die Hülle
   liefert ihm die Stellen im selben Format wie `sync.rs`.

Der Commit trägt die Trailer `Device:` und `Client: web …`. Die Geräte-ID entsteht einmal je
Browser. Weil der Entwurf vorher nie committet war, entsteht im Web kein Merge-Commit: Die
eigene Änderung kommt einfach hinter die fremde.

**Von außen:** Alle 60 s und beim Zurückkehren in den Tab fragt die Hülle, wo der Branch steht.
Hat er sich bewegt, holt sie die geänderten Dateien; eine offene Notiz ohne Entwurf wird neu
gezeigt, eine mit Entwurf beim nächsten Commit zusammengeführt.

## Festlegungen

| Frage | Festlegung |
|---|---|
| Wo die App liegt | Ordner `web/` in diesem Repository, mit eigenem `package.json`. Die Desktop-App braucht weiterhin kein Node |
| Next.js | Version 16, App Router |
| Anmeldung | Der Knopf „Mit GitHub anmelden": der Web-Ablauf derselben GitHub App mit PKCE, in zwei Routen der App (hin, zurück) und einem verschlüsselten Cookie. Kein Auth.js, kein Firebase Authentication |
| Zugang | Ohne Anmeldung zeigt die App nur die Anmeldeseite |
| Was ein Projekt ist | Wie am Desktop: ein Repository mit `.mdview/project.json`. Eines ohne wird nur gelesen; „Use This Repository" schreibt die Markerdatei als Commit |
| Zustand des Nutzers | Tabs, zuletzt geöffnet, Einstellungen: im Browser, je Repository. Nichts davon auf dem Server |
| Zusammenführen dreier Fassungen | Im Browser, mit dem npm-Paket `node-diff3` |
| Thema | Hell und dunkel nach dem System, mit den Farben des Cupertino-Themas |

## Schritte

Jeder Schritt ist für sich lauffähig. Bis Schritt 3 wird nichts geschrieben.

### 1. Die Naht festschreiben

- Die 64 Nachrichten und 29 Aufrufe stehen in `web/host/contract.ts`, jede mit dem, was die
  Web-Hülle damit tut: beantworten (23 und 15), schreiben (11 und 9, in der Lese-Fassung
  abgelehnt), im Browser erledigen (8 und 2), entfällt (22 und 3). Die Liste ist gegen
  `shell.rs` abgeglichen: nichts fehlt, nichts ist erfunden.
- Das HTML-Gerüst der Seite (heute in `shell.rs` zusammengesetzt: CSP, Styles, Skriptliste) so
  herausziehen, dass beide Hüllen dieselbe Liste benutzen.
- Prüfung: Die Desktop-App läuft unverändert durch `dev/rig.sh`.

### 2. Gerüst und Anmeldung

- `web/`: Next.js 16 mit dem App Router. `scripts/assets.mjs` holt die Seite der Desktop-App
  beim Bauen aus dem Checkout nach `public/app/`.
- Anmeldung in vier Routen unter `app/auth/`: hin zu GitHub (mit `state` und PKCE), zurück
  (Tausch des Codes mit dem Client-Secret), Erneuern, Abmelden. `proxy.ts` lässt ohne Sitzung
  nur die Anmeldeseite durch.
- Die Sitzung (`lib/session.ts`) liegt verschlüsselt in einem Cookie, das Skripte nicht lesen
  können; auf dem Server wird nichts gespeichert. Das Token wird fünf Minuten vor Ablauf
  erneuert, und zwar je Auffrischtoken nur einmal, auch wenn zwei Anfragen gleichzeitig kommen.
  Die Anmeldung hält damit, bis man sich abmeldet oder sechs Monate nicht da war.
- Nach der Anmeldung: die freigegebenen Repositories mit Suchfeld, nichts vorausgewählt.
- `apphosting.yaml`: eine Instanz, die schläft, wenn niemand da ist; die beiden Geheimnisse.
- Prüfung: `npm run build && npm test` in `web/` – 7 Tests spielen einen Browser gegen ein
  GitHub-Double: ohne Anmeldung nichts, hin und zurück, falsche Antworten, Ziel nach der
  Anmeldung (nie eine fremde Adresse), Erneuern auch bei zwei Anfragen zugleich, Abmelden, ein
  gefälschtes Cookie. Gegen das echte GitHub steht es aus.

### 3. Lesen

- Server: der Stand eines Commits in Stücken; `/file/…` für Bilder und PDFs.
- `host.ts`: Baum und Seitenleiste, Notiz laden, Wikilinks und Rücklinks, Tabs, Zurück und Vor,
  Alle Notizen, PDFs, Einstellungen ohne die Seiten, die es im Web nicht gibt.
- Prüfung: derselbe Testordner in Desktop und Web, die gerenderte Seite Notiz für Notiz
  verglichen (wie `dev/rig.sh compare`, mit Playwright statt des Rigs).

### 4. Schreiben

- Entwürfe im Browser; Commit nach Ruhezeit, mit <kbd>Ctrl</kbd>+<kbd>S</kbd>, beim Verlassen.
- Neue Notiz, Ordner, umbenennen, löschen, Bild einfügen und ablegen.
- Prüfung: Tests gegen das Double für jeden Fall; die Tipp-Probes des Rigs (`edit`, `native`,
  `m4`) laufen auch gegen die Web-Hülle.

### 5. Änderungen von außen und Konflikte

- Nachfragen nach dem Stand, Aktualisieren der offenen Notiz, Zusammenführen beim Commit.
- Das Konfliktfenster, gespeist von der Web-Hülle.
- Prüfung: zwei Browser gegen das Double; Desktop und Web gegen dasselbe Repository von Hand.

### 6. Verlauf und Abschluss

- Das Verlaufsfenster: Versionen einer Notiz über die Commits ihres Pfads, Text einer Version,
  Wiederherstellen als Commit.
- Veröffentlichen, Abschnitt in `docs/FEATURES.md`, eine Liste zum Durchklicken wie in Phase 2.

## Was du dafür tun musst

> [!info] Angelegt am 5. Oktober 2026
> Firebase-Projekt `md-view` (Tarif Blaze), Backend `mdview` in `europe-west4`, verbunden mit
> `henriSchulz/mdview`, Ordner `/web`, Branch `main`. Adresse:
> `https://mdview--md-view.europe-west4.hosted.app`. Der erste Bau ist wie erwartet an den
> fehlenden Geheimnissen gescheitert.

Sobald das Gerüst der Web-App im Repository liegt:

1. In der Firebase-Konsole das Projekt wählen oder anlegen (Bezahltarif) und unter **App
   Hosting** ein Backend anlegen: mit GitHub verbinden, das Repository `henriSchulz/mdview`
   wählen, „App root directory" `/web`, Live-Branch `main`. Firebase nennt danach die Adresse.
2. In den Einstellungen der GitHub App die **Callback URL** `https://<adresse>/auth/callback`
   eintragen (für die Entwicklung zusätzlich `http://localhost:3000/auth/callback`) und ein
   **Client-Secret** erzeugen.
3. Im Terminal, im Ordner `web/`: `npx firebase-tools login`, dann
   `npx firebase-tools apphosting:secrets:set GITHUB_CLIENT_SECRET` (fragt nach dem Wert) und
   ebenso `SESSION_SECRET` (eine lange Zufallsfolge). Das Secret brauche ich nicht.

## Risiken

- **Umfang der zweiten Hülle.** Jede Nachricht, die die Seite schickt, braucht im Web eine
  Antwort oder eine bewusste Lücke. Schritt 1 macht die Liste, damit nichts stillschweigend
  fehlt.
- **Zwei Hüllen, eine Seite.** Was künftig in `shell.rs` dazukommt, muss auch in `host.ts`
  dazukommen. Der Vergleich aus Schritt 3 bleibt als Prüfung stehen, damit das auffällt.
- **Große Repositories.** Der Stand kommt in Stücken, weil eine Antwort bei manchen Anbietern
  nur wenige MB groß sein darf. Ein Repository mit sehr vielen oder sehr großen Notizen lädt
  beim ersten Öffnen spürbar; danach liegt es im Browser.
- **Umbenennungen im Verlauf.** Die GitHub-API liefert die Commits eines Pfads, folgt aber
  keiner Umbenennung. Der Web-Verlauf endet dort, wo die Notiz ihren Namen bekam, anders als am
  Desktop.
- **Tab zu, bevor committet ist.** Der Entwurf liegt im Browser und wird beim nächsten Öffnen
  committet; bis dahin sieht ihn kein anderes Gerät.
- **Erneuern des Tokens bei mehreren Tabs.** Das Auffrischtoken wechselt bei jedem Gebrauch.
  Zwei Tabs, die gleichzeitig erneuern, würden sich gegenseitig abmelden; das Erneuern läuft
  deshalb über eine einzige Stelle im Server.

## Offene Entscheidungen

1. **Bleibt das Repository öffentlich?** Es wurde für GitHub Pages öffentlich gemacht. App
   Hosting baut auch aus einem privaten Repository.
2. **Nur für dich oder für andere?** Die GitHub App ist „Only on this account". Sollen andere
   die Web-App benutzen, muss sie „Any account" werden.
