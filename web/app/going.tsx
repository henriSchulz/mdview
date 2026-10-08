"use client";
// Waiting shown while another page of the app is on its way: a link of the app followed, or a
// form sent, and the answer takes a moment (the repositories are asked of GitHub first). The
// ring appears only after the wait that is no wait (globals.css: body[data-wait], --loading-delay).
import { useEffect } from "react";

export function Going() {
  useEffect(() => {
    const on = () => { document.body.dataset.wait = ""; }, off = () => { delete document.body.dataset.wait; };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target && a.target !== "_self") return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return; // (elsewhere, or a place on this page)
      on();
    };
    const submit = (e: SubmitEvent) => { if (!e.defaultPrevented) on(); };
    document.addEventListener("click", click);
    document.addEventListener("submit", submit);
    window.addEventListener("pageshow", off); // (come back to with the browser's Back: nothing is on its way)
    return () => { document.removeEventListener("click", click); document.removeEventListener("submit", submit); window.removeEventListener("pageshow", off); };
  }, []);
  return <div id="wait" role="status" aria-label="Loading"><span /></div>;
}
