const { chromium } = require("playwright");

const line = (label, ok, detail) =>
  console.log((ok ? "PASS  " : "FAIL  ") + label + (ok || !detail ? "" : "  -- " + detail));

(async () => {
  const b = await chromium.launch();

  /* ---- 1. the procedural fallback, with the art pack unavailable ---- */
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    // Aborted pack requests are what this test is FOR, so they are not errors.
    p.on("console", m => {
      if (m.type() === "error" && !/ERR_FAILED|Failed to load resource/.test(m.text())) {
        errs.push(m.text());
      }
    });
    // the pack is "missing": every one of its files fails to load
    await p.route("**/static/assets/modern-interiors/**", r => r.abort());

    await p.goto("http://127.0.0.1:5000/");
    await p.waitForTimeout(3500);
    await p.click("text=NEW QUEST").catch(() => {});
    await p.evaluate(() => { GuildGame._setRoutine(false); GuildGame.setPartySize(5); });
    await p.waitForTimeout(9000);

    line("fallback: boots on the generated art", await p.evaluate(() => GuildGame.themeName()) === "procedural");
    line("fallback: a canvas is drawn", await p.evaluate(() => !!document.querySelector("#stage canvas")));

    const zones = await p.evaluate(() => {
      const o = {};
      Object.keys(GuildGame._stations).forEach(id => { o[id] = GuildGame._stations[id].zone; });
      return o;
    });
    line("fallback: scouts reached their desks",
      [0, 1, 2, 3, 4].every(i => zones["researcher-" + i] === "desk" + i), JSON.stringify(zones));

    await p.evaluate(() => {
      GuildGame.setAgentState("planner", "thinking");
      GuildGame.setAgentState("researcher-0", "reading");
      GuildGame.setArchiveCount(7);
    });
    await p.waitForTimeout(1500);
    line("fallback: the planner works standing at its desk",
      /-read$/.test(await p.evaluate(() =>
        GuildGame._stations.planner.sprite.anims.currentAnim.key)));
    line("fallback: the scouts are seated at theirs",
      /-sit-down$/.test(await p.evaluate(() =>
        GuildGame._stations["researcher-0"].sprite.anims.currentAnim.key)));
    line("fallback: the archive case takes a count", await p.evaluate(() => GuildGame._archiveCount()) === 7);
    line("fallback: no errors", errs.length === 0, errs.slice(0, 2).join(" | "));
    await p.screenshot({ path: "p5-fallback.png" });
    await p.close();
  }

  /* ---- 2. a phone ---- */
  {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.goto("http://127.0.0.1:5000/");
    await p.waitForTimeout(3500);
    await p.click("text=NEW QUEST").catch(() => {});
    await p.waitForTimeout(800);

    const m = await p.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      return { canvas: r("#stage canvas"), bar: r(".questbar"), dock: r(".side"),
               mode: r(".mode"), start: r("#start-btn"),
               hScroll: document.documentElement.scrollWidth > innerWidth + 2 };
    });
    line("phone: no sideways scrolling", !m.hScroll);
    line("phone: the hall keeps 16:9", Math.abs(m.canvas.w / m.canvas.h - 16 / 9) < 0.02,
      (m.canvas.w / m.canvas.h).toFixed(3));
    line("phone: the hall fits the screen width", m.canvas.w <= 390, m.canvas.w + "px");
    line("phone: quest bar and mode toggle are on screen",
      m.bar.y + m.bar.h <= 844 + 1 && m.mode.w > 40, JSON.stringify({ bar: m.bar, mode: m.mode }));
    line("phone: the dock drops below the hall", m.dock.y > m.canvas.y + m.canvas.h - 2,
      "dock " + m.dock.y + " vs hall bottom " + (m.canvas.y + m.canvas.h));
    line("phone: tap targets are big enough", m.start.h >= 36 && m.mode.h >= 32,
      "start " + m.start.h + ", mode " + m.mode.h);
    line("phone: no errors", errs.length === 0, errs.slice(0, 2).join(" | "));
    await p.screenshot({ path: "p5-phone.png", fullPage: true });
    await p.close();
  }

  /* ---- 3. reduced motion: poses still change, decoration stops ---- */
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", e => errs.push(e.message));
    await p.goto("http://127.0.0.1:5000/");
    await p.waitForTimeout(3500);
    await p.click("text=NEW QUEST").catch(() => {});
    await p.evaluate(() => GuildGame.setPartySize(3));
    await p.waitForTimeout(8000);
    // The scribe stands at its desk, so its pose is the one that moves. A
    // SEATED agent (scout, at its desk) keeps the seated frame whatever it
    // is doing -- there the emote is what changes, so check that too.
    await p.evaluate(() => {
      GuildGame.setAgentState("synthesizer", "typing");
      GuildGame.setAgentState("researcher-0", "typing");
    });
    await p.waitForTimeout(1500);
    line("reduced motion: state still changes a standing agent's pose",
      /-type$/.test(await p.evaluate(() =>
        GuildGame._stations.synthesizer.sprite.anims.currentAnim.key)));
    line("reduced motion: a seated agent still shows what it is doing",
      await p.evaluate(() => {
        const s = GuildGame._stations["researcher-0"];
        return s.emote.visible && s.emote.frame.name === "pen";
      }));
    const before = await p.evaluate(() => GuildGame._stations.planner.zone);
    await p.waitForTimeout(16000);
    const after = await p.evaluate(() => GuildGame._stations.planner.zone);
    line("reduced motion: nobody wanders off duty", before === after, before + " -> " + after);
    line("reduced motion: no errors", errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
  }

  await b.close();
})();
