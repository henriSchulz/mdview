/* mdview active mode — a document: the store, the editor document built
 * from it, and the way back to Markdown. No view needed (tests use this). */
"use strict";
(() => {
  const A = window.MdActive;

  /* p: the payload the reading view draws (text, raw, links, vault).
   * -> { store, doc, loaded }; loaded maps a segment id to the node built for it. */
  function open(p) {
    // p.raw is the file as on disk; once the text was edited elsewhere it no longer matches
    const lf = (s) => s.replace(/\r\n?/g, "\n");
    const original = p.raw != null && lf(p.raw) === p.text ? p.raw
      : /\r\n/.test(p.raw || "") ? p.text.replace(/\n/g, "\r\n") : p.text;
    const store = A.store.parse(original, { links: p.links, vault: p.vault });
    const doc = A.build(store);
    const loaded = new Map();
    doc.forEach((node) => { if (node.attrs.bid != null) loaded.set(node.attrs.bid, node); });
    return { store, doc, loaded };
  }

  /* The document as Markdown. A block that is as it was loaded comes back
   * from the store's slice; only a changed one is written anew.
   * exact: with the file's own line endings (false: "\n"). */
  function serialize(d, doc = d.doc, exact = true) {
    const parts = [];
    doc.forEach((node) => {
      if (node.type.name === "island" && node.attrs.virtual) return;
      const was = d.loaded.get(node.attrs.bid);
      if (was && (was === node || was.eq(node))) parts.push({ id: node.attrs.bid });
      else parts.push({ text: A.markdown ? A.markdown.block(node, d.store) : "" });
    });
    return A.store.serialize(d.store, parts, exact);
  }

  A.document = { open, serialize };
})();
