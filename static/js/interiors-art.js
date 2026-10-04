const InteriorsArt = (function () {
  "use strict";

  const BASE = "/static/assets/modern-interiors/";


  const CAST = { planner: "Bob", synthesizer: "Amelia", verifier: "Alex" };
  const SCOUT_BASE = "Adam";

  // Same five colours the generated art and the party panel already use, so

  const SCOUT_COLORS = ["#3f7fb5", "#4d8f52", "#b5643f", "#2f8f8a", "#8d5a8f"];


  const ACCENT = { planner: "#7d8099", synthesizer: "#b95d72", verifier: "#a2394b" };



  const ADAM_SHIRT_MID = [0x80, 0x5e, 0x8e];
  const ADAM_SHIRT_LIGHT = [0x9f, 0x74, 0xa8];
  const ADAM_SHIRT_DARK = [0x6c, 0x59, 0x81];


  const SPRITES = {
    shelfA:     [80, 224, 33, 32],
    shelfB:     [80, 256, 33, 32],
    rugRed:     [114, 244, 60, 40],
    rugBlue:    [212, 178, 40, 60],
    windowRed:  [115, 391, 25, 20],
    windowGrey: [147, 391, 25, 20],
    studyDesk:  [121, 618, 28, 22],
    deskWood:   [52, 885, 25, 21],
    blackboard: [210, 647, 28, 23],
    chart:      [208, 616, 31, 21],
    worldMap:   [160, 1065, 32, 19],
    globe:      [209, 577, 13, 21],
    palm:       [213, 704, 23, 31],
    tree:       [167, 713, 18, 25],
    plantSmall: [193, 722, 14, 16],
    lampCream:  [176, 886, 17, 26],
    lampBlue:   [208, 904, 15, 33],









    counterUnit: [64, 161, 16, 37],
    coffeeMaker: [48, 138, 16, 22],
    coffeeMug:   [196, 227, 9, 10],
    wallShelf:   [5, 216, 22, 7],
    fridge:      [3, 92, 42, 54],
    breakTable:  [13, 161, 38, 37],
    chairLeft:   [194, 993, 12, 22],
    chairRight:  [210, 993, 12, 22]
  };




  const ROOM = {
    wall:  [16, 208, 16, 32],
    floor: [176, 208, 16, 16]
  };


  const FW = 16;
  const FH = 32;

  let images = {};
  let ready = false;
  let loading = null;
  const sheetCache = {};
  const portraitCache = {};



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



  /** Head-and-shoulders portrait for the party panel, as a data URL. */
  function portrait(agentId, scale) {
    const z = scale || 2;
    const key = agentId + "@" + z;
    if (portraitCache[key]) return portraitCache[key];
    const sheet = sheetFor(agentId);
    const s = canvas(16 * z, 16 * z);





    s.x.drawImage(sheet, 3 * FW, 2 * FH + 11, 16, 16, 0, 0, 16 * z, 16 * z);
    portraitCache[key] = s.c.toDataURL();
    return portraitCache[key];
  }

  function accent(agentId) {
    if (isScout(agentId)) return SCOUT_COLORS[scoutIndex(agentId) % SCOUT_COLORS.length];
    return ACCENT[agentId] || "#7d8099";
  }



  const theme = {
    name: "interiors",


    emote: { dx: 11, dy: -20 },





    typingBob: true,



    tintOnFail: 0xc88c8c,

    register: function (scene) {
      PixelArt.register(scene);
      Object.keys(SPRITES).forEach(function (k) {
        if (!scene.textures.exists("mi-" + k)) {
          let cv = crop(images.interiors, SPRITES[k]);


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


      s.add.rectangle(0, 0, W, 16, 0x2a2536).setOrigin(0, 0).setDepth(0);
      for (let x = 0; x < W; x += 16) {
        s.add.image(x, 16, "mi-wall").setOrigin(0, 0).setDepth(0);
      }
      for (let y = FLOOR; y < H; y += 16) {
        for (let x = 0; x < W; x += 16) {
          s.add.image(x, y, "mi-floor").setOrigin(0, 0).setDepth(0);
        }
      }


      s.add.rectangle(0, FLOOR, W, 3, 0x000000, 0.18).setOrigin(0, 0).setDepth(1);

      GuildWorld.WALL.forEach(function (d) {
        s.add.image(d.x, d.y, "mi-" + d.id).setOrigin(0, 0).setDepth(2);
      });

      GuildWorld.FURNITURE.forEach(function (f) {



        if (f.id === "archiveCase") return;
        const key = GuildWorld.isCustomArt(f.id) ? PixelArt.KEYS[f.id] : "mi-" + f.id;
        const im = s.add.image(f.x, f.y, key).setOrigin(f.ox, f.oy);


        // Rugs are the exception: they lie ON the floor and must never sort

        const bottom = f.y + im.height * (1 - f.oy);
        im.setDepth(f.depth !== undefined ? f.depth
          : (/^rug/.test(f.id) ? 1 : bottom));
      });



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
        ["read", range("p", 3, 8), 6, -1],
        ["type", range("a", 18, 23), 12, -1],
        ["cheer", range("a", 18, 23), 12, -1],
        ["sad", [{ key: texKey, frame: "s3" }], 1, 0]
      ].forEach(function (d) {
        const k = texKey + "-" + d[0];
        if (!s.anims.exists(k)) {
          s.anims.create({ key: k, frames: d[1], frameRate: d[2], repeat: d[3] });
        }
      });

      const sprite = s.add.sprite(x, feetY, texKey, "a18").setOrigin(0.5, 1).setDepth(feetY);




      const plateKeys = PixelArt.registerNameplate(s, agentId, plateText, accent(agentId));


      const plate = s.add.image(x, feetY + 2, plateKeys.normal).setOrigin(0.5, 0)
        .setDepth(900);

      return {
        sprite: sprite,
        desk: null,
        plate: plate,
        plateKeys: plateKeys,
        texKey: texKey,

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

    SPRITES: SPRITES,
    ROOM: ROOM
  };
})();
