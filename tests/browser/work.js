const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://127.0.0.1:5000/");
  await p.waitForTimeout(2800);
  await p.click("text=NEW QUEST").catch(() => {});
  await p.evaluate(() => { GuildGame._setRoutine(false); GuildGame.setPartySize(5); });
  await p.waitForTimeout(7000);

  // everyone at work, as during a real run
  await p.evaluate(() => {
    for (let i = 0; i < 5; i++) GuildGame.setAgentState("researcher-" + i, "searching");
    GuildGame.setAgentState("planner", "thinking");
    GuildGame.setAgentState("verifier", "reading");
    GuildGame.setAgentState("synthesizer", "typing");
  });
  await p.waitForTimeout(6000);
  const atWork = await p.evaluate(() => {
    const o = {};
    Object.keys(GuildGame._stations).forEach(id => {
      const s = GuildGame._stations[id];
      o[id] = s.zone + ":" + (s.sprite.anims.currentAnim || {}).key.replace(/^mi-char-[\w-]*?-(?=idle|walk|read|type|sit)/, "");
    });
    return o;
  });
  Object.keys(atWork).forEach(k => console.log("  " + k.padEnd(14), atWork[k]));
  await p.screenshot({ path: "atwork.png" });

  // the planner's rounds
  // after planning, the planner reports done and is free
  await p.evaluate(() => GuildGame.setAgentState("planner", "done"));
  await p.waitForTimeout(2000);
  const seen = [];
  await p.evaluate(() => GuildGame.inspectScouts());
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(500);
    const z = await p.evaluate(() => GuildGame._stations.planner.zone);
    if (seen[seen.length - 1] !== z) seen.push(z);
  }
  console.log("planner round trip:", seen.join(" -> "));
  await p.evaluate(() => { GuildGame.inspectScouts(); });
  for (let i = 0; i < 50; i++) { await p.waitForTimeout(500);
    const z = await p.evaluate(() => GuildGame._stations.planner.zone);
    if (seen[seen.length - 1] !== z) seen.push(z); }
  await p.evaluate(() => { GuildGame.inspectScouts(); });
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(500);
    const z = await p.evaluate(() => GuildGame._stations.planner.zone);
    if (seen[seen.length - 1] !== z) seen.push(z); }
  console.log("after three asks (cap is two):", seen.join(" -> "));
  console.log("errors:", errs.length ? errs.slice(0, 3) : "none");
  await b.close();
})();
