/* Development probe (dev/rig.sh m5, second start): the mode the app opens in. */
(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  window.MdHost.post(JSON.stringify({ type: "probe", name: "mode", text: JSON.stringify({ view: document.body.dataset.view || "read", focus: !!(window.MdActive && MdActive.view.pm && MdActive.view.pm.hasFocus()) }) }));
})();
