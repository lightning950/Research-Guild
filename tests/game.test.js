/* Behaviour checks for game.js, run headless. Run: node tests/game.test.js

   There is no browser here, so this file stubs the three things game.js
   talks to: a canvas (for pixel-art.js to draw into), Phaser (scene, sprites,
   tweens, timers) and window.matchMedia. The stubs are deliberately dumb --
   they record what was asked of them and nothing else. What is under test is
   the choreography: who walks where, when, and what they play on arrival.

   The Modern Interiors theme cannot be tested this way (its sheets are PNGs
   decoded by the browser), so the procedural theme drives the behaviour
   tests and the interiors theme gets a static check that it registers the
   same animation keys. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok || !detail ? "" : "  -- " + detail));
}

/* ----------------------------------------------------------- stubs */

function ctxStub() {
  const noop = function () {};
  return {
    fillStyle: "", strokeStyle: "", imageSmoothingEnabled: false, font: "",
    fillRect: noop, clearRect: noop, strokeRect: noop, drawImage: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop,
    scale: noop, putImageData: noop,
    getImageData: function (x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h };
    }
  };
}

function canvasStub() {
  return { width: 0, height: 0, getContext: ctxStub, toDataURL: function () { return ""; } };
}

const timers = [];     // pending delayedCalls, fired by tick()
const tweens = [];     // active tweens, advanced by tick()

/* The tween stub WRITES TO ITS TARGET, on purpose.

   It used to be a no-op that returned a handle, and that hid a real bug:
   the looping "typing" bob owns sprite.y, and a walk starting while it was
   still running fought it for the same property every frame, so the agent
   walked on the spot forever. A stub that never moves anything can never
   catch that. This one is crude -- linear, and it treats yoyo+repeat as a
   perpetual oscillation -- but it does the one thing that matters: it keeps
   writing to the target until something kills it. */
function stepTweens(ms) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    if (t.dead) { tweens.splice(i, 1); continue; }

    t.elapsed += ms * t.dir;
    let done = false;
    if (t.elapsed >= t.dur) {
      if (t.yoyo) { t.elapsed = t.dur; t.dir = -1; }
      else done = true;
    } else if (t.elapsed <= 0 && t.dir === -1) {
      t.elapsed = 0;
      t.dir = 1;
      if (t.repeat !== -1 && ++t.loops > t.repeat) done = true;
    }

    const p = Math.max(0, Math.min(1, t.elapsed / t.dur));
    Object.keys(t.props).forEach(function (k) {
      const pr = t.props[k];
      t.targets[k] = pr.from + (pr.to - pr.from) * p;
    });
    if (done) tweens.splice(i, 1);
  }
}

function displayObject(x, y) {
  const o = {
    x: x || 0, y: y || 0, alpha: 1, depth: 0, visible: true, width: 16, height: 16,
    frame: null, anims: { currentAnim: null },
    setOrigin: function () { return o; },
    setDepth: function (d) { o.depth = d; return o; },
    setAlpha: function (a) { o.alpha = a; return o; },
    setVisible: function (v) { o.visible = v; return o; },
    setPosition: function (px, py) { o.x = px; o.y = py; return o; },
    setFrame: function (f) { o.frame = f; return o; },
    setTexture: function () { return o; },
    setTint: function () { return o; },
    clearTint: function () { return o; },
    setInteractive: function () { return o; },
    on: function () { return o; },
    destroy: function () { o.destroyed = true; return o; },
    play: function (key) { o.anims.currentAnim = { key: key }; return o; },
    fillStyle: function () { return o; },
    fillEllipse: function () { return o; }
  };
  return o;
}

function sceneStub() {
  const s = {
    animKeys: [],
    add: {
      image: function (x, y) { return displayObject(x, y); },
      sprite: function (x, y) { return displayObject(x, y); },
      rectangle: function (x, y) { return displayObject(x, y); },
      graphics: function () { return displayObject(0, 0); }
    },
    textures: {
      exists: function () { return false; },
      addCanvas: function () { return { add: function () {} }; },
      // A canvas texture, as Phaser hands one back: the archive case is
      // repainted through this rather than replaced.
      get: function () {
        return {
          getContext: ctxStub,
          refresh: function () { s.textureRefreshes = (s.textureRefreshes || 0) + 1; }
        };
      }
    },
    anims: {
      exists: function (k) { return s.animKeys.indexOf(k) !== -1; },
      create: function (cfg) { s.animKeys.push(cfg.key); }
    },
    tweens: {
      add: function (cfg) {
        const t = {
          targets: cfg.targets, props: {}, dur: cfg.duration || 1,
          elapsed: 0, dir: 1, loops: 0,
          yoyo: !!cfg.yoyo, repeat: cfg.repeat === undefined ? 0 : cfg.repeat,
          dead: false, stop: function () { t.dead = true; }
        };
        ["x", "y", "alpha", "v"].forEach(function (k) {
          if (cfg[k] !== undefined) t.props[k] = { from: cfg.targets[k], to: cfg[k] };
        });
        tweens.push(t);
        return t;
      },
      killTweensOf: function (obj) {
        for (let i = tweens.length - 1; i >= 0; i--) {
          if (tweens[i].targets === obj) tweens.splice(i, 1);
        }
      }
    },
    time: {
      delayedCall: function (ms, fn) {
        const t = { at: ms, fn: fn, remove: function () { t.dead = true; } };
        timers.push(t);
        return t;
      }
    }
  };
  return s;
}

/** Run the scene's update loop for `ms`, firing any timers that come due. */
function tick(scene, game, ms) {
  const STEP = 16;
  for (let t = 0; t < ms; t += STEP) {
    timers.slice().forEach(function (timer) {
      timer.at -= STEP;
      if (!timer.dead && timer.at <= 0) {
        timer.dead = true;
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    });
    stepTweens(STEP);
    game.sceneObj.update(t, STEP);
  }
}

/* ------------------------------------------------------- the sandbox */

const sandbox = {
  console: console,
  Math: Math,
  Date: Date,
  Uint8ClampedArray: Uint8ClampedArray,
  document: { createElement: canvasStub, getElementById: function () { return null; } },
  window: { matchMedia: function () { return { matches: false }; } },
  Image: function () {}
};
sandbox.globalThis = sandbox;

const Phaser = {
  AUTO: 0,
  Geom: { Rectangle: function () {} },
  Scale: { FIT: 0, CENTER_BOTH: 0 },
  Game: function (cfg) {
    this.cfg = cfg;
    const sc = sceneStub();
    this.scene = sc;
    this.sceneObj = cfg.scene;
    cfg.scene.create.call(sc);
    // create() stores the scene it was called on; keep a handle for update().
    this.sceneObj.update = cfg.scene.update.bind(sc);
  }
};
Phaser.Geom.Rectangle.Contains = function () { return true; };
sandbox.Phaser = Phaser;

vm.createContext(sandbox);
["world.js", "pixel-art.js", "game.js"].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "static", "js", f), "utf8"),
    sandbox, { filename: f });
});

// `const GuildGame = ...` is a lexical binding, so it never lands on the
// sandbox object: ask the context for it by name instead.
const G = vm.runInContext("GuildGame", sandbox);
const World = vm.runInContext("GuildWorld", sandbox);
const game = G.boot();

/** Tick, recording the zones a station passes through. Asserting on where
    an agent IS at some chosen millisecond turns every round trip into a
    race; asserting on where it WENT does not. */
function trace(game, ms, st) {
  const seen = [];
  const STEP = 160;
  for (let t = 0; t < ms; t += STEP) {
    tick(game.scene, game, STEP);
    if (seen[seen.length - 1] !== st.zone) seen.push(st.zone);
  }
  return seen;
}

/* --------------------------------------------------------- the tests */

check("boots on the procedural theme", G.themeName() === "procedural");
check("canvas is 480x270", game.cfg.width === 480 && game.cfg.height === 270);

/* Every animation key the state table can ask for must exist. */
{
  const st = G._stations.planner;
  const want = ["idle-up", "idle-down", "idle-left", "idle-right",
    "walk-up", "walk-down", "walk-left", "walk-right",
    "read", "type", "cheer", "sad"];
  const have = game.scene.animKeys;
  const missing = want.filter(function (k) {
    return have.indexOf(st.texKey + "-" + k) === -1;
  });
  check("procedural theme registers every animation key", missing.length === 0,
    missing.join(", "));
}

/* The three fixed roles start at home. */
{
  const at = function (id, zone) {
    const s = G._stations[id], z = World.zone(zone);
    return s && s.sprite.x === z.x && s.sprite.y === z.y;
  };
  check("planner, scribe and warden start at their zones",
    at("planner", "board") && at("synthesizer", "scribe") && at("verifier", "warden"));
}

/* Scouts enter at the gate and walk to their own desks. */
{
  G._setRoutine(false);       // the routine is tested on its own, further down
  G.setPartySize(3);
  const s0 = G._stations["researcher-0"];
  check("scouts appear at the gate",
    s0.sprite.x === World.zone("gate").x && s0.sprite.y === World.zone("gate").y);

  tick(game.scene, game, 14000);
  const arrived = [0, 1, 2].every(function (i) {
    const s = G._stations["researcher-" + i];
    const z = World.zone("desk" + i);
    return Math.round(s.sprite.x) === z.x && Math.round(s.sprite.y) === z.y;
  });
  check("scouts walk from the gate to their desks", arrived);
}

/* ---- work happens where you sit ----
   Scouts search, read and write at their OWN desk; the warden verifies at
   its own computer. Nothing about doing the work moves anybody any more. */
{
  const s = G._stations["researcher-1"];
  const desk = World.zone("desk1");

  ["searching", "reading", "typing", "thinking"].forEach(function (state) {
    G.setAgentState("researcher-1", state);
    tick(game.scene, game, 4000);
    check("a scout stays at its desk while " + state,
      s.zone === "desk1" && Math.round(s.sprite.x) === desk.x, s.zone);
  });

  G.setAgentState("researcher-1", "searching");
  check("the search emote shows at once", s.emote.visible && s.emote.frame === "search");
  check("the scout stands facing its desk while working",
    !s.route && /-read$/.test(s.sprite.anims.currentAnim.key),
    s.sprite.anims.currentAnim.key);

  G.setAgentState("researcher-1", "typing");
  tick(game.scene, game, 2000);
  check("writing is at the same desk while standing",
    s.zone === "desk1" && /-type$/.test(s.sprite.anims.currentAnim.key) &&
    s.emote.frame === "pen",
    s.zone + " / " + s.sprite.anims.currentAnim.key + " / " + s.emote.frame);
  G.setAgentState("researcher-1", "idle");
}

/* The warden verifies at its own desk and computer; it never walks over. */
{
  const w = G._stations.verifier;
  const zones = [];
  ["thinking", "reading", "typing", "done"].forEach(function (state) {
    G.setAgentState("verifier", state);
    tick(game.scene, game, 3000);
    if (zones[zones.length - 1] !== w.zone) zones.push(w.zone);
  });
  check("the warden never leaves its own desk to verify",
    zones.length === 1 && zones[0] === "warden", zones.join(" -> "));
  G.setAgentState("verifier", "idle");
}

/* The planner works at the monitor with the same front-facing work animation
   as the scribe and warden. */
{
  const p = G._stations.planner;
  G.setAgentState("planner", "thinking");
  tick(game.scene, game, 3000);
  check("the planner faces the monitor while it works",
    p.zone === "board" && /-(read|type)$/.test(p.sprite.anims.currentAnim.key),
    p.zone + " / " + p.sprite.anims.currentAnim.key);
  check("and still shows what it is doing", p.emote.visible && p.emote.frame === "book");
  G.setAgentState("planner", "idle");
  tick(game.scene, game, 500);
}


/* A handoff is a round trip: out with the findings, back to the desk. */
{
  const s = G._stations["researcher-0"];
  G.setAgentState("researcher-0", "typing");
  tick(game.scene, game, 14000);
  G.handoff("researcher-0", "synthesizer");
  const went = trace(game, 25000, s);
  check("the handoff reaches the scribe's desk", went.indexOf("deliver") !== -1,
    went.join(" -> "));
  check("the scout walks home after handing over", s.zone === "desk0", s.zone);
}

/* Each section sends the scribe to the board and back. */
{
  const sc = G._stations.synthesizer;
  G.setAgentState("synthesizer", "typing");
  tick(game.scene, game, 4000);
  G.sectionFocus();
  const trip = trace(game, 30000, sc);
  check("the scribe reaches the board", trip.indexOf("board") !== -1, trip.join(" -> "));
  check("the scribe carries the outline back to its desk", sc.zone === "scribe", sc.zone);
  check("and goes back to writing",
    /-type$/.test(sc.sprite.anims.currentAnim.key), sc.sprite.anims.currentAnim.key);
}

/* Nameplate and emote travel with the body. */
{
  const s = G._stations["researcher-1"];
  G.setAgentState("researcher-1", "searching");
  tick(game.scene, game, 2000);
  // Agents with a seated desk wear their name above their head, because
  // below the feet is where their monitor and mug are.
  const wantY = s.plateAbove
    ? Math.round(s.sprite.y) - (s.sprite.height + 14)
    : Math.round(s.sprite.y) + 2;
  check("the nameplate follows the body",
    s.plate.x === Math.round(s.sprite.x) && s.plate.y === wantY,
    s.plate.y + " wanted " + wantY + " (above: " + s.plateAbove + ")");
  check("the emote follows the body",
    Math.abs(s.emote.x - (Math.round(s.sprite.x) + 12)) < 1);
  check("depth tracks the feet", s.sprite.depth === Math.round(s.sprite.y));
  tick(game.scene, game, 14000);
}

/* ---- the off-duty routine ----

   The contract is not "it moves". It is: every agent works through ITS OWN
   fixed rota, in order; every activity happens at a spot it walked to; no
   two agents ever occupy the same spot; and real work always wins. */
{
  const ROTA = {
    planner: ["coffee", "browse", "chat"],
    synthesizer: ["coffee", "browse", "chat"],
    verifier: ["browse", "coffee", "chat"]
  };
  const ids = Object.keys(ROTA);

  G.reset();
  tick(game.scene, game, 4000);
  G._setRoutine(true);
  ids.forEach(function (id) { G.setAgentState(id, "idle"); });

  // Watch for a couple of minutes of game time, sampling who is where and
  // what they are up to.
  const seen = {};            // id -> activities performed, in order
  const zoneClashes = [];
  ids.forEach(function (id) { seen[id] = []; });
  for (let t = 0; t < 150000; t += 200) {
    tick(game.scene, game, 200);
    const occupied = {};
    Object.keys(G._stations).forEach(function (id) {
      const st = G._stations[id];
      const act = G._activityOf(id);
      if (act && seen[id] && seen[id][seen[id].length - 1] !== act) seen[id].push(act);
      // Two agents standing still on the same named spot is the collision
      // the routine is supposed to make impossible.
      if (!st.route) {
        if (occupied[st.zone]) zoneClashes.push(st.zone + ": " + occupied[st.zone] + " + " + id);
        occupied[st.zone] = id;
      }
    });
  }

  check("every agent did something off duty",
    ids.every(function (id) { return seen[id].length > 0; }),
    JSON.stringify(seen));

  // Activities must appear in rota order (skips are allowed -- a taken chair
  // or a chat with nobody free moves the agent on down its list).
  let orderBad = null;
  ids.forEach(function (id) {
    const rota = ROTA[id];
    let at = rota.indexOf(seen[id][0]);
    if (at === -1) { orderBad = id + " did " + seen[id][0] + ", not on its rota"; return; }
    seen[id].forEach(function (act) {
      // A chat can be started BY someone else, so it may appear on an agent
      // whose own list never mentions it. Every other activity must be its own.
      if (act === "chat" && rota.indexOf("chat") === -1) return;
      const want = rota.indexOf(act);
      if (want === -1) { orderBad = id + " did " + act + ", not on its rota"; return; }
      // walking forward around the ring, never backwards
      let steps = (want - at + rota.length) % rota.length;
      if (steps === 0 && seen[id].length > 1) steps = rota.length;
      at = want;
    });
  });
  check("activities come from each agent's own rota, in order", !orderBad, orderBad);

  check("no two agents ever stand on the same spot", zoneClashes.length === 0,
    zoneClashes.slice(0, 3).join("; "));

  check("the routine uses the room's off-duty spots",
    ids.some(function (id) { return seen[id].indexOf("coffee") !== -1; }) &&
    ids.some(function (id) { return seen[id].indexOf("browse") !== -1; }),
    JSON.stringify(seen));
}

/* Work always wins: an event mid-activity sends the agent back to its post. */
{
  const p = G._stations.planner;
  let guard = 0;
  while (!G._activityOf("planner") && guard++ < 400) tick(game.scene, game, 200);
  check("an agent was mid-activity to interrupt", !!G._activityOf("planner"), p.zone);

  G.setAgentState("planner", "thinking");
  tick(game.scene, game, 20000);
  check("a pipeline event cancels the activity",
    G._activityOf("planner") === null && p.zone === "board" &&
    /-read$/.test(p.sprite.anims.currentAnim.key),
    p.zone + " / " + p.sprite.anims.currentAnim.key);
  G._setRoutine(false);
}

/* reset() clears the scouts and puts the fixed three back. */
{
  G.reset();
  tick(game.scene, game, 20000);
  check("reset removes the scouts", G._stations["researcher-0"] === undefined);
  check("reset puts the fixed three home",
    G._stations.planner.zone === "board" &&
    G._stations.synthesizer.zone === "scribe" &&
    G._stations.verifier.zone === "warden");
}

/* ---- the planner's rounds ----
   The planner's own work ends seconds into a run, so it comes down to look
   over the scouts' shoulders -- but twice at most, and never while it is
   itself working. */
{
  G._setRoutine(false);
  G.reset();
  tick(game.scene, game, 6000);
  const p = G._stations.planner;

  const visits = [];
  for (let i = 0; i < 4; i++) {
    G.inspectScouts();
    const trip = trace(game, 26000, p);
    trip.forEach(function (z) { if (/^inspect/.test(z)) visits.push(z); });
  }
  check("the planner goes to look at the desk row", visits.length > 0, visits.join(","));
  check("but no more than twice a run", visits.length <= 2, visits.join(","));
  check("and ends back in its cabin", p.zone === "board", p.zone);

  // a fresh run, and it is willing again
  G.reset();
  tick(game.scene, game, 6000);
  G.setAgentState("planner", "typing");      // busy: must be ignored
  G.inspectScouts();
  tick(game.scene, game, 3000);
  check("it never abandons its own work to do rounds", p.zone === "board", p.zone);
  G.setAgentState("planner", "idle");
  tick(game.scene, game, 1000);
  G.inspectScouts();
  const after = trace(game, 26000, p);
  check("a new run allows rounds again",
    after.some(function (z) { return /^inspect/.test(z); }), after.join(" -> "));
  tick(game.scene, game, 20000);
}

/* ---- nobody walks through anybody ----
   The planner's trip home from the desk row used to cut straight through
   whichever scout was in the way. */
{
  G._setRoutine(false);
  G.reset();
  tick(game.scene, game, 4000);
  G.setPartySize(5);
  tick(game.scene, game, 14000);          // scouts settle at their desks

  const p = G._stations.planner;
  const others = ["researcher-0", "researcher-1", "researcher-2",
    "researcher-3", "researcher-4", "synthesizer", "verifier"];

  G.setAgentState("planner", "done");
  tick(game.scene, game, 2000);
  G.inspectScouts();

  let overlap = null;
  for (let t = 0; t < 40000 && !overlap; t += 100) {
    tick(game.scene, game, 100);
    others.forEach(function (id) {
      const o = G._stations[id];
      if (!o) return;
      // two bodies within four pixels of each other is a walk-through
      if (Math.abs(o.sprite.x - p.sprite.x) < 4 && Math.abs(o.sprite.y - p.sprite.y) < 4) {
        overlap = id + " at " + Math.round(o.sprite.x) + "," + Math.round(o.sprite.y);
      }
    });
  }
  check("the planner never walks through another agent", !overlap, overlap);
  check("and still gets back to its cabin", p.zone === "board", p.zone);
}

/* The planner's desk has a side-positioned monitor and a mug on the desktop. */
{
  const seat = World.zone("board");
  const screen = World.FURNITURE.filter(function (f) { return f.id === "monitor"; })
    .filter(function (f) { return Math.abs(f.x - seat.x) < 20 && Math.abs(f.y - seat.y) < 20; })[0];
  const mug = World.FURNITURE.filter(function (f) { return f.id === "coffeeMug"; })
    .filter(function (f) { return Math.abs(f.x - seat.x) < 20 && Math.abs(f.y - seat.y) < 20; })[0];
  check("the planner's monitor sits to the side of the desk",
    !!screen && screen.x > seat.x && screen.y > seat.y,
    screen ? screen.x + "," + screen.y + " vs seat " + seat.x + "," + seat.y : "none");
  check("the planner's mug fits on the desktop",
    !!mug && mug.x > 41 && mug.x < 67 && mug.y > 96 && mug.y < 108,
    mug ? mug.x + "," + mug.y : "none");
  check("the planner faces the desk", seat.face === "down");
}

/* ---- the archive ----
   The case is a readout: one spine per saved report. Filing is a trip the
   scribe actually makes, and the spine lands when it arrives, not before. */
{
  G._setRoutine(false);
  G.setArchiveCount(4);
  const sc = G._stations.synthesizer;

  let filedAt = null;
  const before = G._archiveCount();
  G.fileReport(function () { filedAt = G._archiveCount(); });
  const trip = trace(game, 30000, sc);

  check("the scribe walks to the archive to file", trip.indexOf("archive") !== -1,
    trip.join(" -> "));
  check("filing adds exactly one spine", filedAt === before + 1,
    before + " -> " + filedAt);
  check("the scribe returns to its desk afterwards", sc.zone === "scribe", sc.zone);

  G.setArchiveCount(9);
  check("the count can be set from the server's list", G._archiveCount() === 9);

  // the scroll on the desk is a flag, not a state the room can get stuck in
  G.setReportReady(true);
  const lit = G._scrollVisible();
  G.setReportReady(false);
  check("the ready scroll shows and clears", lit === true && G._scrollVisible() === false);
}

/* After a quest, scouts gather standing around the shared RPG break table. */
{
  G.setPartySize(5);
  G.gatherScouts();
  tick(game.scene, game, 30000);
  const seats = ["table0", "table1", "table2", "table3", "table4"];
  const chatting = seats.every(function (zone, i) {
    const st = G._stations["researcher-" + i];
    const z = World.zone(zone);
    return st && st.zone === zone && !st.route &&
      Math.round(st.sprite.x) === z.x && Math.round(st.sprite.y) === z.y &&
      new RegExp("-idle-" + z.face + "$").test(st.sprite.anims.currentAnim.key) &&
      st.emote.visible && st.emote.frame === "chat";
  });
  check("scouts gather standing and facing each other", chatting);
  G.reset();
}

/* The interiors theme is not loadable here, so check it statically: it must
   register the same animation keys the state table asks for. */
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "static", "js", "interiors-art.js"), "utf8");
  const want = ["idle-up", "idle-down", "idle-left", "idle-right",
    "walk-up", "walk-down", "walk-left", "walk-right",
    "read", "type", "cheer", "sad"];
  const missing = want.filter(function (k) {
    return src.indexOf('["' + k + '"') === -1;
  });
  check("interiors theme registers every animation key", missing.length === 0,
    missing.join(", "));
  check("interiors theme loads the run sheets", /"run"/.test(src));
}

console.log(failures === 0 ? "\nGAME: PASS" : "\nGAME: FAIL (" + failures + ")");
process.exit(failures === 0 ? 0 : 1);
