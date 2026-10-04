const { chromium } = require("playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 720 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  await p.goto("http://127.0.0.1:5000/");
  await p.waitForTimeout(2500);
  await p.click("text=NEW QUEST").catch(() => {});
  await p.evaluate(() => GuildGame.setPartySize(5));
  await p.waitForTimeout(9000);

  const seen = {};
  let shots = 0;
  for (let i = 0; i < 80; i++) {
    await p.waitForTimeout(1000);
    const snap = await p.evaluate(() => {
      const o = {};
      Object.keys(GuildGame._stations).forEach(id => {
        const s = GuildGame._stations[id];
        o[id] = {
          z: s.zone,
          a: GuildGame._activityOf(id),
          anim: s.sprite.anims.currentAnim
            ? s.sprite.anims.currentAnim.key.replace(/^mi-char-[\w-]*?-(?=idle|walk|read|type|sit|nap|cheer|sad)/, "")
            : null,
          e: s.emote.visible && s.emote.frame ? s.emote.frame.name : null
        };
      });
      return o;
    });
    Object.keys(snap).forEach(id => {
      seen[id] = seen[id] || [];
      const v = snap[id];
      if (!v.a) return;
      const tag = v.a + " @" + v.z + " " + v.anim + (v.e ? " [" + v.e + "]" : "");
      if (seen[id][seen[id].length - 1] !== tag) seen[id].push(tag);
    });
    const busy = Object.keys(snap).filter(k => snap[k].a).length;
    if (busy >= 3 && shots < 2) { shots++; await p.screenshot({ path: "routine" + shots + ".png" }); }
  }

  Object.keys(seen).forEach(id => {
    if (seen[id].length) console.log(id.padEnd(14), seen[id].slice(0, 5).join("  |  "));
  });
  console.log("screenshots:", shots, "| errors:", errs.length ? errs.slice(0, 3) : "none");
  await b.close();
})();
