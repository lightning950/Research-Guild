/* =========================================================================
   interiors-art.js -- the "Modern Interiors" theme (LimeZu's free pack).

   WHAT THIS FILE DOES
   Loads the pack's PNGs from static/assets/modern-interiors/, cuts the
   pieces we need out of the big sheets, recolours the scouts, and knows how
   to lay the guild hall out with them. game.js asks it for a room and for
   one "station" per agent, and never needs to know which art is in use.

   IF THE FILES ARE MISSING
   load() resolves to false and game.js falls back to the generated art in
   pixel-art.js. That keeps the app working if the pack is ever removed --
   which matters, because the free version is licensed for NON-COMMERCIAL use
   only (see static/assets/modern-interiors/ABOUT.md).

   WHY THE ROOM IS TOP-DOWN NOW
   The generated art was a flat front-on view. This pack is drawn in the
   classic top-down RPG perspective, so the layout follows it. Every desk in
   the pack shows its FRONT (drawers, legs) to the camera, so agents stand
   BEHIND their desks facing us, with the desk hiding their legs -- the
   classroom-teacher staging. (A first attempt put agents in front of the
   desks; the desk then sat on their heads like a box.) Rugs finally work
   too: in a front-on view a rug could not read as lying flat.
   ========================================================================= */

const InteriorsArt = (function () {
  "use strict";

  const BASE = "/static/assets/modern-interiors/";

  /* ----------------------------------------------------------------
     Casting. The pack has four characters and the guild has up to eight
     agents, so the three unique roles get their own character and every
     scout is Adam in a different coloured shirt -- a uniformed team, told
     apart by colour, which matches the party panel.
     ---------------------------------------------------------------- */
  const CAST = { planner: "Bob", synthesizer: "Amelia", verifier: "Alex" };
  const SCOUT_BASE = "Adam";

  // Same five colours the generated art and the party panel already use, so
  // a scout's shirt, nameplate underline and panel stripe all agree.
  const SCOUT_COLORS = ["#3f7fb5", "#4d8f52", "#b5643f", "#2f8f8a", "#8d5a8f"];

  // Each unique role's nameplate accent is taken from their outfit.
  const ACCENT = { planner: "#7d8099", synthesizer: "#b95d72", verifier: "#a2394b" };

  // Adam's shirt, exactly as it appears in the sheet. Found by listing every
  // colour in his front-facing frame; these two are the only purples.
  const ADAM_SHIRT_MID = [0x80, 0x5e, 0x8e];
  const ADAM_SHIRT_LIGHT = [0x9f, 0x74, 0xa8];
  const ADAM_SHIRT_DARK = [0x6c, 0x59, 0x81];   // rare: a few fold pixels in motion frames

  /* ----------------------------------------------------------------
     Crop rectangles [x, y, w, h] into Interiors_free_16x16.png.

     These were not eyeballed. Objects in the sheet do not sit neatly on the
     16px grid, so each box was found by scanning for the opaque pixels of
     that object, then checked visually on an enlarged contact sheet.
     ---------------------------------------------------------------- */
  const SPRITES = {
    shelfA:     [80, 224, 33, 32],
    shelfB:     [80, 256, 33, 32],
    rugRed:     [114, 244, 60, 40],
    rugBlue:    [212, 178, 40, 60],
    windowRed:  [115, 391, 25, 20],
    windowGrey: [147, 391, 25, 20],
    studyDesk:  [121, 618, 28, 22],     // desk with an open book: the scouts'
    deskWood:   [52, 885, 25, 21],      // plain drawer desk: scribe and warden
    blackboard: [210, 647, 28, 23],     // the planner works at this
    chart:      [208, 616, 31, 21],
    worldMap:   [160, 1065, 32, 19],
    globe:      [209, 577, 13, 21],
    palm:       [213, 704, 23, 31],
    tree:       [167, 713, 18, 25],
    plantSmall: [193, 722, 14, 16],
    lampCream:  [176, 886, 17, 26],
    lampBlue:   [208, 904, 15, 33],

    // The break corner (Phase 3). Boxes found the same way as the rest:
    // by scanning the sheet for each object's opaque pixels.
    //
    // The kitchenette is built the way every pixel-art cafe is built: a
    // COUNTER RUN against the wall, the machine standing ON it rather than
    // on the floor, a mug left beside it, a shelf above, and a fridge at
    // the end of the run. Two objects adrift in open floor read as two
    // objects; a counter against a wall reads as a kitchen.
    counterUnit: [64, 161, 16, 37],     // one counter segment
    coffeeMaker: [48, 138, 16, 22],     // the machine itself
    coffeeMug:   [196, 227, 9, 10],     // a cup someone left out
    wallShelf:   [5, 216, 22, 7],       // narrow shelf, hangs on the wall
    fridge:      [3, 92, 42, 54],
    breakTable:  [13, 161, 38, 37],     // square table, seen from above
    chairLeft:   [194, 993, 12, 22],
    chairRight:  [210, 993, 12, 22]
  };

  // Into Room_Builder_free_16x16.png. Column 1 of the dark-wood wall is the
  // seamless middle piece; columns 0 and 2 carry corner trims and showed a
  // visible seam every 16px when tiled.
  const ROOM = {
    wall:  [16, 208, 16, 32],
    floor: [176, 208, 16, 16]           // herringbone parquet
  };

  /* ----------------------------------------------------------------
     Character sheet layout, per the pack (all frames 16x32, facing order
     right / up / left / down):
       *_idle_anim : 24 frames, 6 per direction   -> front = 18..23, back = 6..11
       *_phone     :  9 frames, facing the camera -> phone in hand = 3..8
       *_idle      :  4 frames, one per direction -> front still = 3
       *_run       : 24 frames, 6 per direction   -> the walk cycles
     ---------------------------------------------------------------- */
  const FW = 16;
  const FH = 32;

  let images = {};
  let ready = false;
  let loading = null;
  const sheetCache = {};       // agentId -> composited, recoloured canvas
  const portraitCache = {};

  /* ============================================================ loading */

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("missing " + url)); };
      img.src = url;
    });
  }

  /**
   * Load every file the theme needs. Resolves true when all loaded, false if
   * any is missing -- never rejects, so a missing pack can't break boot.
   */
  function load() {
    if (loading) return loading;
    const files = {
      interiors: BASE + "Interiors_free_16x16.png",
      room: BASE + "Room_Builder_free_16x16.png"
    };
    [CAST.planner, CAST.synthesizer, CAST.verifier, SCOUT_BASE].forEach(function (n) {
      ["idle", "idle_anim", "phone", "run"].forEach(function (k) {
        files[n + "_" + k] = BASE + "characters/" + n + "_" + k + "_16x16.png";
      });
    });

    const names = Object.keys(files);
    loading = Promise.all(names.map(function (k) { return loadImage(files[k]); }))
      .then(function (list) {
        names.forEach(function (k, i) { images[k] = list[i]; });
        ready = true;
        return true;
      })
      .catch(function (err) {
        console.warn("[InteriorsArt] pack not available, using generated art:", err.message);
        images = {};
        return false;
      });
    return loading;
  }

  /* ============================================================ helpers */

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    return { c: c, x: x };
  }

  function crop(img, r) {
    const s = canvas(r[2], r[3]);
    s.x.drawImage(img, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
    return s.c;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function lighten(rgb, amount) {
    return rgb.map(function (v) { return Math.round(v + (255 - v) * amount); });
  }

  /**
   * Push a background texture back: desaturate toward grey, then darken.
   *
   * The pack's herringbone floor is a saturated red. Used at full strength
   * across the whole room it fought every character for attention -- the
   * figures sat on visual noise. The rule is value structure: backgrounds
   * darker and calmer, figures brightest. Editing the sprites like this is
   * allowed by the free license (non-commercial use).
   */
  function tone(cv, desaturate, darken) {
    const x = cv.getContext("2d");
    const data = x.getImageData(0, 0, cv.width, cv.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const grey = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      for (let k = 0; k < 3; k++) {
        const v = d[i + k] + (grey - d[i + k]) * desaturate;
        d[i + k] = Math.round(v * (1 - darken));
      }
    }
    x.putImageData(data, 0, 0);
    return cv;
  }

  function isScout(agentId) { return /^researcher-\d+$/.test(agentId); }

  function scoutIndex(agentId) {
    const m = /^researcher-(\d+)$/.exec(agentId);
    return m ? Number(m[1]) : 0;
  }

  function actorFor(agentId) { return CAST[agentId] || SCOUT_BASE; }

  /**
   * One canvas per agent holding every frame it needs, in four rows:
   *   row 0: idle_anim (24)  row 1: phone (9)  row 2: idle (4)
   *   row 3: run (24)
   * Rows are only ever APPENDED, so the portrait crop (row 2) keeps working.
   *
   * Scouts get their shirt recoloured here, once, so both the game and the
   * DOM party portraits draw the same recoloured pixels.
   */
  function sheetFor(agentId) {
    if (sheetCache[agentId]) return sheetCache[agentId];
    const actor = actorFor(agentId);
    const s = canvas(24 * FW, 4 * FH);
    s.x.drawImage(images[actor + "_idle_anim"], 0, 0);
    s.x.drawImage(images[actor + "_phone"], 0, FH);
    s.x.drawImage(images[actor + "_idle"], 0, FH * 2);
    s.x.drawImage(images[actor + "_run"], 0, FH * 3);

    if (isScout(agentId)) {
      const mid = hexToRgb(SCOUT_COLORS[scoutIndex(agentId) % SCOUT_COLORS.length]);
      const light = lighten(mid, 0.22);
      const dark = mid.map(function (v) { return Math.round(v * 0.8); });
      const data = s.x.getImageData(0, 0, s.c.width, s.c.height);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        if (d[i] === ADAM_SHIRT_MID[0] && d[i + 1] === ADAM_SHIRT_MID[1] && d[i + 2] === ADAM_SHIRT_MID[2]) {
          d[i] = mid[0]; d[i + 1] = mid[1]; d[i + 2] = mid[2];
        } else if (d[i] === ADAM_SHIRT_LIGHT[0] && d[i + 1] === ADAM_SHIRT_LIGHT[1] &&
                   d[i + 2] === ADAM_SHIRT_LIGHT[2]) {
          d[i] = light[0]; d[i + 1] = light[1]; d[i + 2] = light[2];
        } else if (d[i] === ADAM_SHIRT_DARK[0] && d[i + 1] === ADAM_SHIRT_DARK[1] &&
                   d[i + 2] === ADAM_SHIRT_DARK[2]) {
          d[i] = dark[0]; d[i + 1] = dark[1]; d[i + 2] = dark[2];
        }
      }
      s.x.putImageData(data, 0, 0);
    }
    sheetCache[agentId] = s.c;
    return s.c;
  }

  /* ============================================================ public: DOM */

  /** Head-and-shoulders portrait for the party panel, as a data URL. */
  function portrait(agentId, scale) {
    const z = scale || 2;
    const key = agentId + "@" + z;
    if (portraitCache[key]) return portraitCache[key];
    const sheet = sheetFor(agentId);
    const s = canvas(16 * z, 16 * z);
    // Front-facing still (row 2, frame 3), cropped from y=11. A head-only crop
    // (the first attempt) made all five scouts identical in the party panel:
    // they are the same character from the neck up, and the shirt colour is
    // the only thing telling them apart. This crop trims a little hair and
    // keeps the shirt.
    s.x.drawImage(sheet, 3 * FW, 2 * FH + 11, 16, 16, 0, 0, 16 * z, 16 * z);
    portraitCache[key] = s.c.toDataURL();
    return portraitCache[key];
  }

  function accent(agentId) {
    if (isScout(agentId)) return SCOUT_COLORS[scoutIndex(agentId) % SCOUT_COLORS.length];
    return ACCENT[agentId] || "#7d8099";
  }

  /* ============================================================ the theme */

  const theme = {
    name: "interiors",

    // Emote bubble anchor, relative to the feet: just right of the head.
    emote: { dx: 11, dy: -20 },

    // The pack has no front-facing typing frames, so "writing" is the idle
    // loop played fast plus a 1px busy-bounce (game.js adds the bounce).
    // With the desk hiding the hands, a bobbing head and shoulders is the
    // classic pixel-game shorthand for working hard.
    typingBob: true,

    // The failed pose in this pack is just the still frame, so a grey-red
    // tint carries the "something went wrong" signal.
    tintOnFail: 0xc88c8c,

    register: function (scene) {
      PixelArt.register(scene);    // emotes + bitmap font are shared by both themes
      Object.keys(SPRITES).forEach(function (k) {
        if (!scene.textures.exists("mi-" + k)) {
          let cv = crop(images.interiors, SPRITES[k]);
          // Rugs are floor too: quieted a little, less than the floor itself,
          // so they still read as accents.
          if (k === "rugRed" || k === "rugBlue") cv = tone(cv, 0.25, 0.1);
          scene.textures.addCanvas("mi-" + k, cv);
        }
      });
      if (!scene.textures.exists("mi-wall")) {
        scene.textures.addCanvas("mi-wall", crop(images.room, ROOM.wall));
        scene.textures.addCanvas("mi-floor", tone(crop(images.room, ROOM.floor), 0.45, 0.2));
      }
    },

    /**
     * Build the hall from the shared floorplan in world.js.
     *
     * Phase 2 took the positions out of this file. Furniture is collision
     * now, so a shelf this theme drew and the procedural theme did not would
     * mean an agent walking through a bookcase in one theme and around it in
     * the other. world.js owns WHERE; this function owns WHAT IT LOOKS LIKE.
     */
    buildRoom: function (s) {
      const W = GuildWorld.W, H = GuildWorld.H, FLOOR = GuildWorld.FLOOR_TOP;

      // Ceiling band, wall, floor.
      s.add.rectangle(0, 0, W, 16, 0x2a2536).setOrigin(0, 0).setDepth(0);
      for (let x = 0; x < W; x += 16) {
        s.add.image(x, 16, "mi-wall").setOrigin(0, 0).setDepth(0);
      }
      for (let y = FLOOR; y < H; y += 16) {
        for (let x = 0; x < W; x += 16) {
          s.add.image(x, y, "mi-floor").setOrigin(0, 0).setDepth(0);
        }
      }
      // A faint shadow where wall meets floor, so the floor sits under it
      // instead of butting against it.
      s.add.rectangle(0, FLOOR, W, 3, 0x000000, 0.18).setOrigin(0, 0).setDepth(1);

      GuildWorld.WALL.forEach(function (d) {
        s.add.image(d.x, d.y, "mi-" + d.id).setOrigin(0, 0).setDepth(2);
      });

      GuildWorld.FURNITURE.forEach(function (f) {
        // The archive case is not ours to draw: game.js builds it from
        // pixel-art.js (no sheet can hold "a bookcase with this many books
        // in it") and keeps it interactive and repaintable.
        if (f.id === "archiveCase") return;
        const key = GuildWorld.isCustomArt(f.id) ? PixelArt.KEYS[f.id] : "mi-" + f.id;
        const im = s.add.image(f.x, f.y, key).setOrigin(f.ox, f.oy);
        // Depth is the object's bottom edge -- the same rule the agents use,
        // so a walking agent passes in front of or behind anything correctly.
        // Rugs are the exception: they lie ON the floor and must never sort
        // in front of the feet standing on them.
        const bottom = f.y + im.height * (1 - f.oy);
        im.setDepth(f.depth !== undefined ? f.depth
          : (/^rug/.test(f.id) ? 1 : bottom));
      });

      // Two pools of lamplight: one over the planning corner, one over the
      // front band, so the room is not evenly lit at every point.
      [[54, 92], [280, 236]].forEach(function (p) {
        const g = s.add.graphics().setDepth(2);
        g.fillStyle(0xefcf83, 0.06);
        g.fillEllipse(p[0], p[1], 150, 86);
        g.fillStyle(0xefcf83, 0.04);
        g.fillEllipse(p[0], p[1], 96, 54);
      });
    },

    /**
     * Build one agent's objects. Returns the pieces game.js manages.
     *
     * No desk is created here any more: desks are furniture in world.js, and
     * agents stand behind whichever one their zone sits at. The nameplate
     * travels with the agent, so game.js repositions it every frame.
     */
    createVisuals: function (s, agentId, x, feetY, plateText) {
      const texKey = "mi-char-" + agentId;
      if (!s.textures.exists(texKey)) {
        const tex = s.textures.addCanvas(texKey, sheetFor(agentId));
        for (let i = 0; i < 24; i++) tex.add("a" + i, 0, i * FW, 0, FW, FH);
        for (let i = 0; i < 9; i++) tex.add("p" + i, 0, i * FW, FH, FW, FH);
        for (let i = 0; i < 4; i++) tex.add("s" + i, 0, i * FW, 2 * FH, FW, FH);
        for (let i = 0; i < 24; i++) tex.add("r" + i, 0, i * FW, 3 * FH, FW, FH);
      }
      const range = function (prefix, a, b) {
        const out = [];
        for (let i = a; i <= b; i++) out.push({ key: texKey, frame: prefix + i });
        return out;
      };
      // Both the idle_anim and run sheets run right / up / left / down, six
      // frames each, so the direction blocks line up between the two.
      [
        ["idle-right", range("a", 0, 5), 6, -1],
        ["idle-up",    range("a", 6, 11), 6, -1],
        ["idle-left",  range("a", 12, 17), 6, -1],
        ["idle-down",  range("a", 18, 23), 6, -1],
        ["walk-right", range("r", 0, 5), 10, -1],
        ["walk-up",    range("r", 6, 11), 10, -1],
        ["walk-left",  range("r", 12, 17), 10, -1],
        ["walk-down",  range("r", 18, 23), 10, -1],
        ["read", range("p", 3, 8), 6, -1],       // head down over a device
        ["type", range("a", 18, 23), 12, -1],    // fast idle + busy-bounce
        ["cheer", range("a", 18, 23), 12, -1],   // quick idle + hop tween
        ["sad", [{ key: texKey, frame: "s3" }], 1, 0]
      ].forEach(function (d) {
        const k = texKey + "-" + d[0];
        if (!s.anims.exists(k)) {
          s.anims.create({ key: k, frames: d[1], frameRate: d[2], repeat: d[3] });
        }
      });

      const sprite = s.add.sprite(x, feetY, texKey, "a18").setOrigin(0.5, 1).setDepth(feetY);

      // Nameplate just below the feet. It follows the agent around, so it
      // cannot live under a desk any more -- and under the feet is also the
      // one place it never covers the face or the emote.
      const plateKeys = PixelArt.registerNameplate(s, agentId, plateText, accent(agentId));
      // Depth 900: a nameplate is a label, not furniture. Sorted by the
      // feet it went behind the very desk its owner stands at.
      const plate = s.add.image(x, feetY + 2, plateKeys.normal).setOrigin(0.5, 0)
        .setDepth(900);

      return {
        sprite: sprite,
        desk: null,
        plate: plate,
        plateKeys: plateKeys,
        texKey: texKey,
        // Local to the 16x32 frame: the whole body plus the nameplate below.
        hitArea: [-8, 0, 32, 46]
      };
    }
  };

  return {
    load: load,
    isReady: function () { return ready; },
    portrait: portrait,
    accent: accent,
    theme: theme,
    // exposed for tests
    SPRITES: SPRITES,
    ROOM: ROOM
  };
})();
