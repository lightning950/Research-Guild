const { chromium } = require("playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });

  await p.goto("http://127.0.0.1:5000/");
  await p.waitForTimeout(2800);
  await p.click("text=NEW QUEST").catch(() => {});
  await p.waitForTimeout(1200);

  const onDisk = (await (await p.request.get("http://127.0.0.1:5000/api/reports")).json()).length;
  console.log("reports on disk:", onDisk, "| spines drawn:", await p.evaluate(() => GuildGame._archiveCount()));

  const box = await p.evaluate(() => {
    const c = document.querySelector("#stage canvas").getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  const at = (wx, wy) => ({ x: box.x + box.w * (wx / 480), y: box.y + box.h * (wy / 270) });
  const clip = (x0, y0, x1, y1) => ({
    x: box.x + box.w * (x0 / 480), y: box.y + box.h * (y0 / 270),
    width: box.w * ((x1 - x0) / 480), height: box.h * ((y1 - y0) / 270) });

  await p.screenshot({ path: "case.png", clip: clip(388, 12, 456, 76) });

  // clicking the case opens the archive
  const c = at(420, 40);
  await p.mouse.click(c.x, c.y);
  await p.waitForTimeout(900);
  const opened = await p.evaluate(() => !document.getElementById("archive").hidden);
  console.log("clicking the case opens the archive:", opened);
  const rows = await p.evaluate(() => document.querySelectorAll("#archive-list > *").length);
  console.log("archive rows listed:", rows);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);

  // the filing trip and the scroll on the desk
  await p.evaluate(() => { GuildGame.setReportReady(true); GuildGame.fileReport(); });
  let sawArchive = false;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(250);
    const z = await p.evaluate(() => GuildGame._stations.synthesizer.zone);
    if (z === "archive") sawArchive = true;
  }
  console.log("scribe visited the archive:", sawArchive,
    "| spines now:", await p.evaluate(() => GuildGame._archiveCount()),
    "| back home:", await p.evaluate(() => GuildGame._stations.synthesizer.zone));
  console.log("scroll lit on the desk:", await p.evaluate(() => GuildGame._scrollVisible()));

  await p.screenshot({ path: "scroll.png", clip: clip(200, 196, 280, 256) });
  console.log("errors:", errs.length ? errs.slice(0, 3) : "none");
  await b.close();
})();
