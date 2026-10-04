const { chromium } = require("playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  await p.goto("http://127.0.0.1:5000/");
  await p.waitForTimeout(3000);
  await p.click("text=NEW QUEST").catch(() => {});

  const before = (await (await p.request.get("http://127.0.0.1:5000/api/reports")).json()).length;

  await p.click("#mode-deep");
  await p.fill("#topic-input", "how do noise-cancelling headphones work");
  const t0 = Date.now();
  await p.click("#start-btn");

  const zones = {};      // agent -> ordered zones visited
  const clocks = [];
  let done = false, deadlineSeen = false;

  while (Date.now() - t0 < 400000 && !done) {
    await p.waitForTimeout(1000);
    const st = await p.evaluate(() => {
      const o = { zones: {}, clock: null, chip: null };
      Object.keys(GuildGame._stations).forEach(id => { o.zones[id] = GuildGame._stations[id].zone; });
      const c = document.getElementById("countdown");
      o.clock = c.hidden ? null : c.textContent;
      o.chip = document.getElementById("report-chip").hidden ? null
        : document.getElementById("ready-topic").textContent;
      o.spines = GuildGame._archiveCount();
      o.log = Array.from(document.querySelectorAll("#log li, .log-line")).length;
      return o;
    });
    Object.keys(st.zones).forEach(id => {
      zones[id] = zones[id] || [];
      if (zones[id][zones[id].length - 1] !== st.zones[id]) zones[id].push(st.zones[id]);
    });
    if (st.clock && clocks[clocks.length - 1] !== st.clock) clocks.push(st.clock);
    // a deep run counts DOWN from its deadline, so the first tick is near 5:00
    if (st.clock && /^[45]:/.test(st.clock)) deadlineSeen = true;
    if (st.chip) { done = true; console.log("chip:", st.chip, "| spines:", st.spines); }
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log("deep run finished in", secs + "s", "| completed:", done);
  console.log("clock counted down from a deadline:", deadlineSeen, "| first/last:",
    clocks[0], "->", clocks[clocks.length - 1]);
  Object.keys(zones).forEach(id => console.log("  " + id.padEnd(14), zones[id].join(" -> ")));

  const after = (await (await p.request.get("http://127.0.0.1:5000/api/reports")).json()).length;
  console.log("reports on disk:", before, "->", after);

  const tail = await p.evaluate(() => Array.from(document.querySelectorAll("#log li, .log-line"))
    .slice(-6).map(e => e.innerText.replace(/\s+/g, " ").slice(0, 100)));
  console.log("log tail:"); tail.forEach(l => console.log("   " + l));
  await p.screenshot({ path: "p5-deep.png" });
  console.log("errors:", errs.length ? errs.slice(0, 4) : "none");
  await b.close();
})();
