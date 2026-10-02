/* mdview — user-facing strings of the active mode, in one place so they can
 * be translated. MdStrings.t("key", …values) fills {0}, {1} …
 * The app's older strings are still inline in viewer.js and mdview.py. */
"use strict";
(() => {
  const TABLES = {
    en: {
      "mode.label": "Mode",
      "mode.edit": "Edit source",
      "mode.active": "Active",
      "mode.read": "Read",
      "mode.tip.edit": "{0} (Ctrl+Alt+1, or Ctrl+E)",
      "mode.tip.active": "{0} (Ctrl+Alt+2)",
      "mode.tip.read": "{0} (Ctrl+Alt+3)",
      "active.loadFailed": "Couldn't load the active mode",
      "active.placeholder": "Start writing…",
      "active.label": "Document",
      "link.label": "Link",
      "link.open": "Open",
      "link.edit": "Edit",
      "link.remove": "Remove",
      "link.text": "Text",
      "link.url": "Address",
      "active.keptEdits": "File changed on disk — keeping your edits",
    },
    de: {
      "mode.label": "Modus",
      "mode.edit": "Quelltext bearbeiten",
      "mode.active": "Aktiv",
      "mode.read": "Lesen",
      "mode.tip.edit": "{0} (Strg+Alt+1 oder Strg+E)",
      "mode.tip.active": "{0} (Strg+Alt+2)",
      "mode.tip.read": "{0} (Strg+Alt+3)",
      "active.loadFailed": "Aktiv-Modus konnte nicht geladen werden",
      "active.placeholder": "Schreib los …",
      "active.label": "Dokument",
      "link.label": "Link",
      "link.open": "Öffnen",
      "link.edit": "Bearbeiten",
      "link.remove": "Entfernen",
      "link.text": "Text",
      "link.url": "Adresse",
      "active.keptEdits": "Datei wurde außerhalb geändert — deine Änderungen bleiben",
    },
  };
  const S = {
    lang: "en",
    t(key, ...values) {
      const s = (TABLES[S.lang] && TABLES[S.lang][key]) ?? TABLES.en[key] ?? key;
      return s.replace(/\{(\d+)\}/g, (_m, i) => values[i] ?? "");
    },
  };
  window.MdStrings = S;
})();
