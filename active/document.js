/* mdview active mode — a document: the store, the editor document built
 * from it, and the way back to Markdown. No view needed (tests use this). */
"use strict";
(() => {
  const A = window.MdActive;

  /* p: the payload the reading view draws (text, raw, links, vault).
   * -> { store, doc, loaded }; loaded maps a segment id to the node built for it. */
  function open(p, definitions = {}) {
    // p.raw is the file as on disk; once the text was edited elsewhere it no longer matches
    const lf = (s) => s.replace(/\r\n?/g, "\n");
    const original = p.raw != null && lf(p.raw) === p.text ? p.raw
      : /\r\n/.test(p.raw || "") ? p.text.replace(/\n/g, "\r\n") : p.text;
    const store = A.store.parse(original, { links: p.links, vault: p.vault, ...definitions });
    store.vault = !!p.vault;
    const doc = A.build(store);
    const loaded = new Map();
    doc.forEach((node) => { if (node.attrs.bid != null) loaded.set(node.attrs.bid, node); });
    return { store, doc, loaded };
  }

  /* The document as Markdown. A block that is as it was loaded comes back
   * from the store's slice; only a changed one is written anew.
   * exact: with the file's own line endings (false: "\n").
   * starts: if given, filled with the offset of every block written. */
  /* May `cur` stand on the line right after `prev`? A paragraph only after
   * what ends for sure (a heading, a rule, a fence); anything else also where
   * it interrupts what stands before it. */
  const kind = (n) => (n.type.name === "island" ? "island:" + n.attrs.kind : n.type.name);
  function tight(prev, cur) {
    const p = kind(prev), c = kind(cur);
    const ended = /^(heading|horizontal_rule|island:(code|math|frontmatter))$/.test(p);
    if (c === "paragraph") return ended;
    if (ended || /^(hidden|island:)/.test(p)) return true;
    // after a paragraph, a list or a quote: only what interrupts them
    if (c === "heading") return cur.attrs.markup !== "=" && cur.attrs.markup !== "-";
    if (c === "horizontal_rule") return !(p === "paragraph" && /^-/.test(cur.attrs.markup || "---"));
    if (c === "blockquote" || c === "bullet_list") return true;
    if (c === "ordered_list") return cur.attrs.start === 1;
    return c === "island:code" && /^ {0,3}(```|~~~)/.test(cur.attrs.raw);
  }

  function serialize(d, doc = d.doc, exact = true, starts = null) {
    // what gets written, in order
    const nodes = [];
    doc.forEach((node) => {
      if (node.type.name === "island" && node.attrs.virtual) return;
      // an empty paragraph is a place to type, not something Markdown can hold
      if (node.type.name === "paragraph" && !node.content.size && doc.childCount > 1) return;
      const was = d.loaded.get(node.attrs.bid);
      nodes.push({ node, clean: !!was && (was === node || was.eq(node)) });
    });
    // Two lists of one kind in a row would read as one list: a changed one takes another marker.
    const marker = (n) => A.markdown.markerOf(n.node, d);
    nodes.forEach((n, i) => {
      const prev = nodes[i - 1], next = nodes[i + 1];
      if (n.clean || !/_list$/.test(n.node.type.name)) return;
      const taken = [prev, next].filter((o) => o && o.node.type === n.node.type).map((o) => o.marker || marker(o));
      if (!taken.includes(marker(n))) return;
      n.marker = (n.node.type.name === "ordered_list" ? [".", ")"] : ["-", "*", "+"]).find((m) => !taken.includes(m));
    });
    // (two blocks that are still the kinds they were stand as they stood)
    const rekinded = (n) => { const was = d.loaded.get(n.node.attrs.bid); return !was || kind(was) !== kind(n.node); };
    const parts = nodes.map((n, i) => {
      const prev = nodes[i - 1];
      // Code by indentation right after a list would read as part of the last item. Where the two
      // stood like that in the file it worked; behind a list that is new there, it gets a fence.
      if (prev && /_list$/.test(prev.node.type.name) && (rekinded(prev) || rekinded(n)) && kind(n.node) === "island:code" && !/^ {0,3}(```|~~~)/.test(n.node.attrs.raw)) {
        const c = A.islands.parseCode(n.node.attrs.raw);
        return { id: n.node.attrs.bid, text: A.islands.buildCode({ ...c, indented: false }) };
      }
      if (n.clean) return { id: n.node.attrs.bid };
      return { id: n.node.attrs.bid, text: A.markdown.block(n.node, d, n.marker) };
    });
    // A separator without a blank line (a heading right under a paragraph) is only kept where it
    // still separates once one of the two blocks has changed.
    nodes.forEach((n, i) => {
      const prev = nodes[i - 1];
      if (prev && (rekinded(prev) || rekinded(n)) && !tight(prev.node, n.node)) parts[i].blank = true;
    });
    return A.store.serialize(d.store, parts, exact, starts);
  }

  A.document = { open, serialize };
})();
