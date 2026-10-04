const { chromium } = require("playwright");

// wide-and-short sizes included on purpose: that is where the quest bar
// went off the bottom of the window.
const SIZES = [[1366, 768], [1440, 900], [1536, 864], [1920, 1080], [1920, 900], [1916, 868], [1280, 700]];

const line = (ok, msg) => console.log((ok ? "PASS  " : "FAIL  ") + msg);

(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [w, h] of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto("http://127.0.0.1:5000/");

    await p.waitForTimeout(2800);
    await p.click("text=NEW QUEST").catch(() => {});
    await p.evaluate(() => {
      const chip = document.getElementById("report-chip");
      chip.hidden = false;                      // the dock at its tallest
      document.getElementById("ready-topic").textContent = "a finished report";
      document.getElementById("countdown").hidden = false;
      document.getElementById("countdown").textContent = "5:00";
    });
    await p.waitForTimeout(1200);

    const m = await p.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null;
        const b = e.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom),
                 left: Math.round(b.left), right: Math.round(b.right),
                 w: Math.round(b.width), h: Math.round(b.height) }; };
      return {
        canvas: r("#stage canvas"), stage: r("#stage"), glass: r(".screen__glass"), input: r("#topic-input"),
        start: r("#start-btn"), mode: r(".mode"), dock: r(".side"),
        party: r(".party"), log: r("#log"), chip: r(".ready"), dialogue: r(".dialogue"),
        vh: innerHeight, vw: innerWidth,
        pageScroll: document.documentElement.scrollHeight > innerHeight + 2
      };
    });

    const onScreen = e => e && e.top >= 0 && e.bottom <= m.vh + 1 && e.left >= 0 && e.right <= m.vw + 1;
    const checks = [
      ["the quest input is fully on screen", onScreen(m.input)],
      ["START is fully on screen", onScreen(m.start)],
      ["the mode toggle is fully on screen", onScreen(m.mode)],
      ["the dock is fully on screen", onScreen(m.dock)],
      ["the report panel is fully on screen", onScreen(m.chip)],
      ["the party panel is visible", m.party.h > 20],
      ["the quest log is visible", m.log.h > 40],
      ["the dialogue is on screen", onScreen(m.dialogue)],
      ["no dead band above or below", Math.abs(m.stage.h - m.canvas.h) <= 1],
      ["no dead band left or right", Math.abs(m.stage.w - m.canvas.w) <= 1],
      ["the page does not scroll", !m.pageScroll]
    ];
    const fails = checks.filter(c => !c[1]);
    bad += fails.length;
    const pct = Math.round(100 * m.canvas.w * m.canvas.h / (m.vw * m.vh));
    console.log(`${w}x${h}: hall ${m.canvas.w}x${m.canvas.h} (${pct}%)` +
      (fails.length ? "  <-- " + fails.map(f => f[0]).join("; ") : "  all controls on screen"));
    await p.close();
  }
  console.log(bad === 0 ? "\nLAYOUT: PASS" : "\nLAYOUT: FAIL (" + bad + ")");
  await b.close();
  process.exit(bad === 0 ? 0 : 1);
})();
