/* Development probe (dev/rig.sh ai-subpage): Claude itself, asked in the chat's Edit mode — from the note, not from inside the
 * page — to write into a subpage. The page's content is part of what it is given, and what it writes lands in the page. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms) => { for (let t = 0; t < ms; t += 100) { try { if (f()) return true; } catch (e) { /* not yet */ } await sleep(100); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await sleep(900); MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active", 4000);
    await sleep(400);
    const file = () => MdView.core.ai.fileText(), before = file();
    document.getElementById("ai-bubble").click();
    const chat = () => document.getElementById("ai-chat");
    await until(() => chat() && chat().hasAttribute("data-open"), 5000);
    if (!MdAi.state().editing) chat().querySelector(".ai-mode").click();
    const f = chat().querySelector(".ai-field");
    f.value = "mach in der subpage Alpha info über kaskoden hin mit schaltkreis";
    f.dispatchEvent(new Event("input", { bubbles: true }));
    chat().querySelector(".ai-send").click();
    await until(() => MdAi.state().talking, 4000);
    const answered = await until(() => !MdAi.state().talking, 300000);
    await sleep(900);
    const last = MdAi.state().talk.at(-1) || {}, t = file();
    const page = (/<!-- page[^>]*: Alpha -->([\s\S]*?)<!-- \/page -->/.exec(t) || [])[1] || "";
    o.real = { made: last.made, said: String(last.text || last.error).slice(0, 400), page: page.slice(0, 700), outside: t.replace(page, "").slice(0, 300) };
    ok("Claude itself, asked from the note to write into the subpage: it does not say it cannot see it", answered && !last.error && last.made && last.made.done >= 1 && !(last.made.missed || []).length, o.real);
    ok("… what it wrote stands in that page: about cascodes, with a drawing", /[Kk]asko|[Cc]ascod/.test(page) && /```svg\n<svg/.test(page) && /In alpha\./.test(page), o.real.page);
    ok("… and nowhere else: the rest of the note is as it was", t.replace(page, "") === before.replace((/<!-- page[^>]*: Alpha -->([\s\S]*?)<!-- \/page -->/.exec(before) || [])[1], ""), o.real.outside);
    out("shot", {}); await sleep(1200);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("ai-subpage", o);
})();
