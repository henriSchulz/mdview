// A whiteboard told in words, for a client of the Model Context Protocol: what is written on it —
// text, sticky notes, shapes with text, tables, links, files, pictures, scenes — top to bottom,
// left to right, with where it stands; the strokes of ink only counted (they are drawing, not
// text). Read from the file's lines as board/format.js writes them; the picture is not looked at.

const OPEN = '<metadata id="mdview-board"><![CDATA[', CLOSE = "]]></metadata>";

type Item = { id?: string; k?: string; x?: number; y?: number; w?: number; h?: number; p?: number[]; text?: string; cells?: string[][]; url?: string; src?: string; name?: string; shape?: string; from?: { id?: string }; to?: { id?: string } };

const at = (it: Item) => `(${Math.round(it.x ?? it.p?.[0] ?? 0)}, ${Math.round(it.y ?? it.p?.[1] ?? 0)})`;
const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** The board in Markdown. null: the text is no whiteboard. */
export function boardText(text: string): string | null {
  const a = text.indexOf(OPEN), b = a < 0 ? -1 : text.indexOf(CLOSE, a);
  if (a < 0 || b < 0) return null;
  const items = new Map<string, Item>(), scenes: string[] = [];
  let lost = 0;
  for (const raw of text.slice(a + OPEN.length, b).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let o: Item & { board?: unknown };
    try { o = JSON.parse(line); } catch { lost++; continue; }
    if (!o || typeof o !== "object" || "board" in o) continue;
    if (o.k === "scene") { scenes.push(o.name || "Scene"); continue; }
    if (typeof o.id !== "string") { lost++; continue; }
    items.delete(o.id); // (the same id twice: the later line stands, as in format.js)
    items.set(o.id, o);
  }
  const all = [...items.values()];
  const ink = all.filter((it) => it.k === "ink").length;
  const rest = all.filter((it) => it.k !== "ink" && it.k !== "line").sort((p, q) => (p.y ?? 0) - (q.y ?? 0) || (p.x ?? 0) - (q.x ?? 0));
  const out: string[] = [];
  for (const it of rest) {
    if ((it.k === "text" || it.k === "sticky" || it.k === "shape") && it.text?.trim()) out.push(`- ${it.k === "shape" ? `${it.shape || "shape"}` : it.k} ${at(it)}: ${one(it.text)}`);
    else if (it.k === "table" && Array.isArray(it.cells)) {
      out.push(`- table ${at(it)}:`, "", ...it.cells.map((r) => `  | ${r.map((c) => one(String(c)).replace(/\|/g, "\\|")).join(" | ")} |`), "");
    } else if (it.k === "link" && it.url) out.push(`- link ${at(it)}: ${it.url}`);
    else if ((it.k === "file" || it.k === "image") && it.src) out.push(`- ${it.k === "image" ? "picture" : "file"} ${at(it)}: ${it.src}`);
  }
  const named = (id?: string) => { const t = id ? items.get(id) : undefined; return t ? (t.text ? `"${one(t.text).slice(0, 40)}"` : t.k || "item") : null; };
  for (const it of all.filter((i) => i.k === "line")) {
    const from = named(it.from?.id), to = named(it.to?.id);
    if (from && to) out.push(`- line: ${from} → ${to}`);
  }
  const head = [`Whiteboard: ${all.length} items${ink ? `, ${ink} strokes of ink (drawn, not text)` : ""}.${lost ? ` ${lost} lines could not be read.` : ""}`];
  if (scenes.length) head.push(`Scenes: ${scenes.join(", ")}.`);
  return [...head, "", ...(out.length ? out : ["Nothing written on it."])].join("\n");
}
