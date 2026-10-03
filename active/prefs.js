/* mdview active mode — its settings: a dialog in the app's own look, kept by
 * the application (state.json, "active") and handed to every window
 * (window.MdPrefs, MdView.setPrefs). */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const DEFAULTS = {
    lang: "en", startMode: "last", bar: true, slash: true, syntax: false, quotes: false, wrap: 0,
    images: "beside", style: "auto", bullet: "-", emphasis: "*", strongMark: "**", ordered: ".",
    dialogWidth: 0, dialogHeight: 0,
    latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, latexBrackets: true, latexText: true,
  };
  const post = (type, data = {}) => window.webkit?.messageHandlers?.mdview?.postMessage(JSON.stringify({ type, ...data }));
  const now = () => ({ ...DEFAULTS, ...(window.MdPrefs || {}) });

  // the rows of the dialog: [key, kind, choices]
  const ROWS = [
    ["section", "prefs.general"],
    ["lang", "select", [["en", "English"], ["de", "Deutsch"]]],
    ["startMode", "select", [["last", "prefs.start.last"], ["read", "mode.read"], ["active", "mode.active"], ["edit", "mode.edit"]]],
    ["section", "prefs.editing"],
    ["bar", "switch"],
    ["slash", "switch"],
    ["syntax", "switch"],
    ["quotes", "switch"],
    ["wrap", "select", [[0, "prefs.wrap.off"], [72, "72"], [80, "80"], [100, "100"], [120, "120"]]],
    ["images", "select", [["beside", "prefs.images.beside"], ["assets", "prefs.images.assets"]]],
    ["section", "prefs.latex"],
    ["latexSnippets", "switch"],
    ["latexFraction", "switch"],
    ["latexMatrix", "switch"],
    ["latexTabout", "switch"],
    ["latexEnlarge", "switch"],
    ["latexBrackets", "switch"],
    ["latexText", "switch"],
    ["section", "prefs.newMarkdown"],
    ["style", "select", [["auto", "prefs.style.auto"], ["fixed", "prefs.style.fixed"]]],
    ["bullet", "select", [["-", "- item"], ["*", "* item"], ["+", "+ item"]], "fixed"],
    ["ordered", "select", [[".", "1. item"], [")", "1) item"]], "fixed"],
    ["emphasis", "select", [["*", "*italic*"], ["_", "_italic_"]], "fixed"],
    ["strongMark", "select", [["**", "**bold**"], ["__", "__bold__"]], "fixed"],
  ];
  const label = (k) => (/^[a-z]+\.[a-z.]+$/i.test(k) ? T(k) : k);

  function open() {
    if (A.dialog.open) return false;
    const view = A.view.pm, start = now(), values = { ...start };
    A.dialog.show({
      title: T("prefs.title"),
      anchor: () => null,
      build(body) {
        const form = A.dialog.el("div", { class: "pf" });
        const dependents = [];
        for (const [key, kind, choices, when] of ROWS) {
          if (key === "section") { form.appendChild(A.dialog.el("div", { class: "pf-section" }, T(kind))); continue; }
          const row = A.dialog.el("label", { class: "pf-row" + (when ? " pf-sub" : "") });
          const name = A.dialog.el("span", { class: "pf-name" }, T("prefs." + key));
          let input;
          if (kind === "switch") {
            input = A.dialog.el("input", { type: "checkbox", class: "pf-switch", role: "switch" });
            input.checked = !!values[key];
            input.onchange = () => { values[key] = input.checked; };
          } else {
            input = A.dialog.el("select", { class: "lp-field pf-select" });
            for (const [v, l] of choices) {
              const o = A.dialog.el("option", { value: String(v) });
              o.textContent = label(l);
              input.appendChild(o);
            }
            // a folder of one's own, typed in, shows as a choice of its own
            if (key === "images" && !choices.some(([v]) => v === values.images)) {
              const o = A.dialog.el("option", { value: values.images });
              o.textContent = values.images;
              input.appendChild(o);
            }
            input.value = String(values[key]);
            input.onchange = () => {
              values[key] = typeof DEFAULTS[key] === "number" ? Number(input.value) : input.value;
              dependents.forEach((f) => f());
            };
          }
          const hint = T("prefs." + key + ".hint");
          row.append(name, input);
          if (hint !== "prefs." + key + ".hint") row.title = ""; // (no browser tooltip; the hint stands below)
          form.appendChild(row);
          if (hint !== "prefs." + key + ".hint") form.appendChild(A.dialog.el("div", { class: "pf-hint" + (when ? " pf-sub" : "") }, hint));
          if (when) {
            const sync = () => { row.hidden = values.style !== when; if (row.nextSibling && row.nextSibling.classList.contains("pf-hint")) row.nextSibling.hidden = row.hidden; };
            dependents.push(sync);
            sync();
          }
        }
        body.appendChild(form);
        return {
          focus: () => form.querySelector("select, input")?.focus(),
          result: () => (Object.keys(values).some((k) => values[k] !== start[k]) ? values : undefined),
        };
      },
      done(v) {
        const changed = {};
        for (const k of Object.keys(v)) if (v[k] !== start[k]) changed[k] = v[k];
        window.MdPrefs = { ...now(), ...changed }; // at once here; the application keeps them and tells the other windows
        post("prefs", { prefs: changed });
        if (changed.lang) window.MdView.core.toast(T("prefs.langLater"));
        if (A.onPrefs) A.onPrefs();
      },
      cancel() { if (view) view.focus(); },
    });
    return true;
  }

  // the settings changed: what depends on them follows at once
  A.onPrefs = () => {
    if (A.view.store) A.view.store.profile = null; // the style of new Markdown
    if (!now().bar) A.bar.hide();
    if (!now().slash && A.menu.isOpen) A.menu.close();
    if (A.view.pm) A.view.pm.dispatch(A.view.pm.state.tr.setMeta("prefs", true)); // decorations drawn again
  };
  A.prefs = { open, get: now, DEFAULTS };
})();
