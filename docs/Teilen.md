---
tags: [mdview, web, teilen]
date: 2026-10-06
color: blue
---

# Notizen teilen

Eine Notiz unter einem Link veröffentlichen: für alle, die den Link haben, oder zusätzlich mit
einem Passwort. Immer nur zum Lesen, und immer nur diese eine Notiz. Baut auf [[Git-Phase-3]]
auf: Die Web-App zeigt die Notiz, die Desktop-App und die Web-App legen die Freigabe an.

> [!important] Stand
> Gebaut und geprüft (8 Tests in `web/test/share.test.mjs` und `auth.test.mjs`, einer in
> `src-tauri/src/share.rs`, `dev/rig.sh share` am Desktop). **Auf dem Server ist es noch aus:**
> Ihm fehlt der Schlüssel der GitHub App – siehe „Was du dafür tun musst". Bis dahin sagt der
> Dialog im Web, dass von dieser Adresse nichts geteilt wird, und ein Link zeigt nichts.

## Was es tut

- **Share…** im Menü einer Notiz (Rechtsklick in der Seitenleiste) und unter der Uhr („Share
  This Note…"): ein kleines Fenster mit dem Link, einem Feld für ein Passwort und „Stop
  Sharing". In der Web-App und in der Desktop-App dasselbe Fenster.
- Der Link hat die Form `https://<web-app>/s/<konto>/<repository>/<id>`. Die ID sind 128
  zufällige Bit: Wer den Link nicht hat, findet die Notiz nicht.
- Mit Passwort fragt die Seite zuerst danach. Nach fünf falschen Versuchen wird für diesen Link
  eine Weile keines mehr angesehen.
- Der Link zeigt immer den **aktuellen Stand** der Notiz (mit bis zu einer halben Minute
  Verzug). Wird sie umbenannt, zeigt er sie weiter; wird sie gelöscht oder die Freigabe
  aufgehoben, zeigt er nichts mehr.

## Was mit einer Notiz mitgeht

| Mit geteilt | Nicht geteilt |
|---|---|
| die Notiz selbst | jede andere Notiz, auch wenn die geteilte auf sie verlinkt |
| ihre Bilder (`![](…)`, `<img>`) | Dateien, auf die sie nur verlinkt (auch PDFs) |
| was sie einbettet (`![[…]]`): Notizen, PDFs, Bilder – und deren Bilder und Einbettungen | die Seitenleiste, die Suche, der Verlauf |

Links auf andere Notizen sind in der geteilten Notiz zu sehen, führen aber nirgendhin („This was
not shared with the note"). Der Server gibt unter einem Link nur die Dateien dieser Liste
heraus; alles andere ist 404, auch `.mdview/shares.json`.

> [!warning] Ein eingebettetes PDF geht ganz mit
> Auch wenn nur eine Seite eingebettet ist: Der Betrachter braucht die ganze Datei.

## Wie es gebaut ist

```mermaid
flowchart LR
  D[Desktop-App oder Web-App: Share…] -- "Commit: .mdview/shares.json" --> G[(Repository bei GitHub)]
  B[Besucher mit Link] --> S[/s/konto/repo/id/]
  S -- "liest als GitHub App, nur dieses Repository, nur lesend" --> G
```

- **Kein Datenbestand auf dem Server.** Was geteilt ist, steht im Repository selbst, in
  `.mdview/shares.json`: je Freigabe die ID, der Pfad der Notiz, und von einem Passwort nur sein
  PBKDF2-SHA256 (600 000 Runden, mit Salz). Teilen, Passwort ändern und Aufheben sind Commits
  wie jede andere Änderung.
- **Der Server liest als GitHub App**, nicht als Nutzer: Mit dem privaten Schlüssel der App holt
  er sich für genau das eine Repository ein Token, das nur lesen darf (`web/lib/app.ts`).
- **Die geteilte Notiz läuft in derselben Seite** wie die App, mit einer eigenen, kleinen Hülle
  (`web/public/host/share.js`): Sie kennt nur den Text der Notiz und wohin ihre Verweise führen,
  und schreibt nichts. Skripte in der Notiz laufen nicht, Dateien kommen abgeschottet.
- **Das Passwort** wird einmal eingegeben; danach trägt der Browser sieben Tage ein Cookie, das
  nur für diesen Link und dieses Passwort gilt. Ein geändertes Passwort macht es ungültig.
- **Der Link verrät sich nicht weiter:** `Referrer-Policy: no-referrer`, und Suchmaschinen wird
  gesagt, die Seite nicht aufzunehmen.

| Wo | Was |
|---|---|
| `active/share.js` | das Fenster, für beide Hüllen |
| `src-tauri/src/share.rs` | Desktop: die Datei lesen und schreiben, der Link |
| `web/public/host/host.js` | Web: dasselbe, als Commit |
| `web/lib/app.ts`, `web/lib/share.ts` | Server: Token als App; Freigabe lesen, Passwort prüfen |
| `web/app/s/[owner]/[repo]/[id]/` | die Seite hinter dem Link, ihre Daten, ihre Dateien |

## Grenzen

- **Nur Projekte, die mit GitHub verknüpft sind.** Am Desktop sagt das Fenster sonst, was fehlt.
  Der Link gilt erst, wenn der Commit bei GitHub angekommen ist; so lange steht das im Fenster.
- **Wer das Repository lesen kann, sieht, was geteilt ist** – und den Hash eines Passworts. Bei
  einem öffentlichen Repository also jeder. Ein kurzes Passwort lässt sich dann durchprobieren.
- **Aufheben wirkt mit bis zu einer halben Minute Verzug** (so lange merkt sich der Server, was
  er gelesen hat). Was ein Besucher schon geladen hat, hat er.
- **Kein Ablaufdatum, keine Liste aller Freigaben** im Fenster. Die Datei lässt sich lesen.
- **Ordner und ganze Repositories** lassen sich nicht teilen. So entschieden.

## Was du dafür tun musst

1. In den Einstellungen der GitHub App (github.com › Settings › Developer settings › GitHub Apps
   › mdview) unter **Private keys** „Generate a private key" drücken. GitHub lädt eine
   `.pem`-Datei herunter.
2. Im Terminal, im Ordner `web/`:
   `npx firebase-tools apphosting:secrets:set GITHUB_APP_PRIVATE_KEY --data-file <pfad zur .pem>`.
   Die Frage, ob das Backend das Secret lesen darf, mit Ja beantworten.
3. In `web/apphosting.yaml` die beiden auskommentierten Zeilen für `GITHUB_APP_PRIVATE_KEY`
   einschalten und pushen. (Vorher nicht: Ein Bau, der ein Secret nennt, das es nicht gibt,
   scheitert.) Sag mir Bescheid, dann mache ich das.
4. Die `.pem`-Datei danach löschen.

## Durchklicken

- [ ] Web: Uhr › „Share This Note…" › „Share": Der Link steht da; in einem privaten Fenster geöffnet zeigt er die Notiz, ohne Anmeldung
- [ ] Ein Bild und eine eingebettete Notiz erscheinen; ein Link auf eine andere Notiz sagt „This was not shared with the note"
- [ ] Passwort setzen: Das private Fenster fragt danach; falsch wird abgelehnt, richtig öffnet
- [ ] Die Notiz ändern: Der Link zeigt nach einer halben Minute und Neuladen den neuen Stand
- [ ] „Stop Sharing": Der Link zeigt „Nothing here"
- [ ] Desktop: dasselbe Fenster; der Link gilt, sobald der Abgleich durch ist
- [ ] Die Adresse einer Datei raten (`…/file/<andere Notiz>.md`): 404
