/* =========================================================================
   pixel-art.js -- generates every texture the game uses, in code.

   WHY GENERATE ART INSTEAD OF LOADING THE ITCH.IO PACKS?

   The two packs you named (Modern Interiors, Tiny RPG Characters) are great,
   but both need a manual click-through download and then a per-tile atlas
   mapping before a single pixel appears on screen. That would leave Phase B
   blocked on a download.

   So this file paints the tileset and the characters with plain canvas rects
   on a strict 16x16 grid and a fixed 24-colour palette -- which is literally
   how the original 16-bit artists worked, just with code instead of a mouse.
   Nothing here is smoothed, anti-aliased or fractional.

   HOW TO SWAP IN THE REAL PACKS LATER (the seam):
   Every texture is registered by a string key in register() below. Phaser
   never cares where a texture came from. So to use LimeZu tiles instead,
   preload the real spritesheets under the SAME keys in game.js's preload()
   and delete the matching builder call here. game.js needs no changes at all.
   Keys are listed in TEXTURE_KEYS at the bottom for exactly this reason.
   ========================================================================= */

const PixelArt = (function () {
  "use strict";

  /* ----------------------------------------------------------------
     PALETTE

     24 colours, hand-picked as 8 ramps of 3. A tight palette is the
     single biggest reason real pixel art looks cohesive and why
     "pick any hex code" art does not: every surface in the room
     shares the same limited set, so it reads as one place.
     ---------------------------------------------------------------- */
  const P = {
    // outline / darkest -- used for every silhouette edge
    ink:      "#1b1526",
    ink2:     "#302640",

    // wood: floor, desks, shelves
    woodD:    "#5a3620",
    wood:     "#8a5a33",
    woodL:    "#b5824d",

    // floorboards (lighter than furniture so furniture reads on top)
    floorD:   "#9c6f43",
    floor:    "#bd8d57",
    floorL:   "#d2a874",

    // plaster wall
    wallD:    "#2f3c5c",
    wall:     "#455878",
    wallL:    "#5d7396",

    // parchment: paper, books, lamplight
    parchD:   "#bca87e",
    parch:    "#e4d4ab",
    parchL:   "#f6ecd0",

    // brass / gold accents
    brassD:   "#8a6222",
    brass:    "#c9963f",
    brassL:   "#efcf83",

    // skin
    skinD:    "#c1804f",
    skin:     "#e8b083",
    skinL:    "#f6d3ad",

    // signal colours (emotes, book spines, screens)
    red:      "#a8394f",
    green:    "#4d8f52",
    blue:     "#3f7fb5",
    cyan:     "#5fc8d2",
    violet:   "#7a5aa8",
    white:    "#f4f1e6"
  };

  /* Per-agent colour identity. One robe colour each so you can tell who is
     who at 16 pixels tall -- silhouette alone is not enough at this size. */
  const ROLE_COLORS = {
    planner:       { robe: "#7a5aa8", robeD: "#4e3873", trim: P.brass,  hair: "#2b2135" },
    synthesizer:   { robe: "#d9cdae", robeD: "#a2977c", trim: P.brassD, hair: "#5a4a3a" },
    verifier:      { robe: "#a8394f", robeD: "#6e2232", trim: P.brassL, hair: "#241a24" },
    // Researchers cycle through these in order.
    researchers: [
      { robe: "#3f7fb5", robeD: "#27527a", trim: P.parchL, hair: "#2a2030" },
      { robe: "#4d8f52", robeD: "#2f5c36", trim: P.parchL, hair: "#3d2a1e" },
      { robe: "#b5643f", robeD: "#7a3f26", trim: P.parchL, hair: "#26202c" },
      { robe: "#2f8f8a", robeD: "#1d5c59", trim: P.parchL, hair: "#3a2438" },
      { robe: "#8d5a8f", robeD: "#5c3660", trim: P.parchL, hair: "#241c2e" }
    ]
  };

  /* ----------------------------------------------------------------
     Tiny drawing helpers.

     Everything is integer rects. There is no arc, no gradient and no
     line width anywhere in this file -- those are what make "pixel
     art" look like vector art pretending.
     ---------------------------------------------------------------- */

  function surface(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    return { cv: cv, ctx: ctx };
  }

  /** Fill one rectangle of pixels. The workhorse of the whole file. */
  function r(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  /** One pixel. */
  function px(ctx, x, y, c) { r(ctx, x, y, 1, 1, c); }

  /**
   * Deterministic pseudo-random 0..1 from two integers.
   * Used for plank grain and book spines. Deterministic matters: the room
   * must look identical on every page load, or it reads as noise.
   */
  function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  /* ================================================================
     ROOM TILES
     ================================================================ */

  /**
   * 16x16 wooden floorboard, two variants.
   *
   * The first version of this drew a full-height vertical seam plus a
   * full-width horizontal one, which crossed in the middle of every tile.
   * Repeated across the room that produced a field of plus-signs that read
   * as visual static, not as a floor.
   *
   * Real floorboards are LONG and DIRECTIONAL: continuous horizontal seams
   * every 8px, and only the occasional short butt-joint where two boards
   * meet end to end. Grain runs along the board, never across it.
   */
  function floorTile(variant) {
    const s = surface(16, 16);
    const c = s.ctx;
    r(c, 0, 0, 16, 16, P.floor);

    // Continuous seams between boards. These line up tile-to-tile, which is
    // exactly what we want: it makes the boards look long.
    r(c, 0, 7, 16, 1, P.floorD);
    r(c, 0, 15, 16, 1, P.floorD);
    // A 1px highlight just under each seam: the lit edge of the next board.
    r(c, 0, 8, 16, 1, P.floorL);
    r(c, 0, 0, 16, 1, P.floorL);

    // One short butt-joint per tile, confined to a single board and placed
    // differently per variant so the joints scatter instead of forming a
    // column. This is the only vertical mark on the floor.
    if (variant) r(c, 4, 1, 1, 6, P.floorD);
    else r(c, 11, 9, 1, 6, P.floorD);

    // Grain: short HORIZONTAL dashes, low contrast, kept off the seams.
    for (let i = 0; i < 4; i++) {
      const gy = hash(i, variant) > 0.5 ? 3 + (i % 3) : 11 + (i % 3);
      const gx = Math.floor(hash(variant, i) * 11);
      r(c, gx, gy, 2 + Math.floor(hash(gx, gy) * 2), 1, "rgba(120,80,45,0.18)");
    }
    return s.cv;
  }

  /** 16x16 plaster wall with a subtle speckle. */
  function wallTile() {
    const s = surface(16, 16);
    const c = s.ctx;
    r(c, 0, 0, 16, 16, P.wall);
    // top highlight where the wall meets the ceiling light
    r(c, 0, 0, 16, 2, P.wallL);
    for (let i = 0; i < 8; i++) {
      px(c, Math.floor(hash(i, 3) * 16), Math.floor(hash(3, i) * 16), P.wallD);
    }
    return s.cv;
  }

  /** 16x16 wainscot panelling -- the wood strip where wall meets floor.
      This band is what stops the room looking like two flat colours. */
  function wainscotTile() {
    const s = surface(16, 16);
    const c = s.ctx;
    r(c, 0, 0, 16, 16, P.wood);
    r(c, 0, 0, 16, 2, P.woodL);       // top rail highlight
    r(c, 0, 13, 16, 3, P.woodD);      // skirting board
    r(c, 2, 4, 12, 8, P.woodD);       // recessed panel
    r(c, 3, 5, 10, 6, P.wood);
    return s.cv;
  }

  /** Bookshelf, 32x34, standing against the wall. Book spines are
      seeded-random colours from the palette only. */
  function bookshelf(seed) {
    const s = surface(32, 34);
    const c = s.ctx;
    r(c, 0, 0, 32, 34, P.woodD);            // carcass
    r(c, 1, 1, 30, 32, P.wood);             // inner face
    r(c, 0, 32, 32, 2, P.ink);              // shadow at the base

    const spineColors = [P.red, P.green, P.blue, P.violet, P.brass, P.cyan, P.parchD];

    // three shelves
    for (let shelf = 0; shelf < 3; shelf++) {
      const top = 3 + shelf * 10;
      r(c, 2, top + 8, 28, 2, P.woodD);     // the shelf board itself

      // books standing on it
      let x = 3;
      while (x < 28) {
        const w = 2 + Math.floor(hash(seed + shelf, x) * 2);   // 2-3px wide
        const h = 5 + Math.floor(hash(x, seed + shelf) * 3);   // 5-7px tall
        const col = spineColors[Math.floor(hash(x * 3, shelf + seed) * spineColors.length)];
        r(c, x, top + 8 - h, w, h, col);
        px(c, x, top + 8 - h, P.ink);                          // spine top nick
        x += w + 1;
      }
    }
    return s.cv;
  }

  /** Desk seen slightly from the front, 34x18. Characters stand BEHIND it,
      which is why it is a separate sprite and not a tile. */
  function desk(withScreen) {
    const s = surface(34, 18);
    const c = s.ctx;
    r(c, 0, 2, 34, 5, P.woodL);     // top surface (catches the light)
    r(c, 0, 7, 34, 3, P.wood);      // front edge
    r(c, 0, 10, 34, 1, P.woodD);
    r(c, 2, 11, 4, 6, P.woodD);     // left leg
    r(c, 28, 11, 4, 6, P.woodD);    // right leg
    r(c, 0, 17, 34, 1, P.ink);      // contact shadow

    if (withScreen) {
      // A little CRT, back turned to us: dark bezel with a glow spill.
      r(c, 11, 0, 12, 4, P.ink2);
      r(c, 12, 1, 10, 2, P.cyan);
    } else {
      // A few sheets of paper instead.
      r(c, 6, 1, 7, 2, P.parchL);
      r(c, 20, 1, 6, 2, P.parch);
    }
    return s.cv;
  }

  /** Window with a night sky, 26x20. Gives the room a light source. */
  function windowPane() {
    const s = surface(26, 20);
    const c = s.ctx;
    r(c, 0, 0, 26, 20, P.woodD);        // frame
    r(c, 2, 2, 22, 16, "#1d2740");      // night sky
    // stars, fixed positions
    [[5, 5], [11, 3], [18, 7], [8, 12], [20, 13]].forEach(function (p) {
      px(c, p[0], p[1], P.parchL);
    });
    r(c, 12, 2, 2, 16, P.woodD);        // mullion
    r(c, 2, 9, 22, 2, P.woodD);         // transom
    r(c, 0, 18, 26, 2, P.wood);         // sill
    return s.cv;
  }

  /** Hanging lamp, 14x20, with a warm pool of light under the shade. */
  /** A plain wooden chair, seen from the side. 12x22 to match the pack's. */
  function chair() {
    const s = surface(12, 22);
    const c = s.ctx;
    r(c, 1, 2, 3, 18, P.woodD);        // back post
    r(c, 2, 3, 1, 15, P.wood);
    r(c, 1, 2, 9, 2, P.wood);          // top rail
    r(c, 1, 11, 10, 3, P.woodL);       // seat
    r(c, 1, 14, 10, 1, P.woodD);
    r(c, 2, 15, 2, 6, P.woodD);        // legs
    r(c, 8, 15, 2, 6, P.woodD);
    r(c, 0, 20, 12, 1, "rgba(27,21,38,0.3)");
    return s.cv;
  }

  /** A square break table seen from above, 38x37 like the pack's. */
  function breakTable() {
    const s = surface(38, 37);
    const c = s.ctx;
    r(c, 1, 2, 36, 26, P.woodD);       // top, outlined
    r(c, 2, 3, 34, 24, P.woodL);
    r(c, 4, 5, 30, 20, P.wood);        // inner panel, so it is not a flat slab
    r(c, 3, 28, 4, 8, P.woodD);        // legs
    r(c, 31, 28, 4, 8, P.woodD);
    r(c, 1, 35, 36, 2, "rgba(27,21,38,0.25)");
    return s.cv;
  }

  /** The coffee machine: a dark appliance with a pot and a hot plate. */
  function coffeeMaker() {
    const s = surface(16, 22);
    const c = s.ctx;
    r(c, 2, 1, 12, 20, P.ink);         // body
    r(c, 3, 2, 10, 18, P.ink2);
    r(c, 4, 3, 8, 5, P.wallD);         // water tank
    r(c, 5, 4, 6, 3, P.cyan);
    r(c, 4, 10, 8, 6, P.ink);          // carafe recess
    r(c, 5, 11, 6, 4, P.woodD);        // the coffee itself
    r(c, 5, 11, 6, 1, P.wood);
    r(c, 4, 17, 8, 2, P.brass);        // hot plate, glowing
    px(c, 12, 4, P.red);               // power light
    return s.cv;
  }

  /* ================================================================
     THE ARCHIVE BOOKCASE

     Drawn here rather than cropped from the pack, because it is the one
     object in the room whose ART IS DATA: every report the guild has ever
     saved is a spine on these shelves, so the case has to be redrawn each
     time one is filed. A fixed sprite could not do that.

     Both themes use this same drawing. The Modern Interiors theme crops
     everything else from LimeZu's sheet, but there is no sheet anywhere
     with "a bookcase holding exactly nineteen books", and the case is the
     thing the player is meant to walk up to and click.
     ================================================================ */

  const CASE_W = 50;
  const CASE_H = 46;
  const SHELF_ROWS = [7, 20, 33];      // y of each shelf board
  const SLOTS = 11;                    // spines that fit on one shelf

  /** Book colours, deliberately muted so thirty spines do not read as a
      bag of sweets. Index by slot, so a given report keeps its colour. */
  const SPINES = ["#7a3b46", "#3f6b52", "#44557f", "#8a6222", "#6b4675", "#2f6b6b"];

  /**
   * The case holding `filled` reports. Anything past the shelves' capacity
   * is simply not drawn -- the shelves look full, which is the honest
   * reading of "more reports than fit".
   */
  function archiveCase(filled) {
    const s = surface(CASE_W, CASE_H);
    const c = s.ctx;
    const n = Math.max(0, filled | 0);

    // carcass
    r(c, 0, 0, CASE_W, CASE_H, P.ink);
    r(c, 1, 1, CASE_W - 2, CASE_H - 2, P.woodD);
    r(c, 2, 2, CASE_W - 4, CASE_H - 5, P.wood);
    r(c, 3, 4, CASE_W - 6, CASE_H - 9, P.ink2);        // the dark interior

    // cornice, with a brass band so it reads as the room's one grand object
    r(c, 0, 0, CASE_W, 3, P.woodD);
    r(c, 1, 1, CASE_W - 2, 1, P.woodL);
    r(c, 2, 3, CASE_W - 4, 1, P.brass);

    let left = n;
    SHELF_ROWS.forEach(function (y, row) {
      // the board itself
      r(c, 3, y + 10, CASE_W - 6, 2, P.woodL);
      r(c, 3, y + 12, CASE_W - 6, 1, P.woodD);

      for (let i = 0; i < SLOTS && left > 0; i++, left--) {
        const x = 4 + i * 4;
        const h = 8 + ((row + i) % 3);                 // uneven heights
        const col = SPINES[(row * SLOTS + i) % SPINES.length];
        r(c, x, y + 10 - h, 3, h, col);
        r(c, x, y + 10 - h, 1, h, P.ink2);             // shadowed edge
        r(c, x + 1, y + 9 - h, 1, 1, P.brassL);        // gilt top
      }
    });

    // a small footing, so it stands rather than floats
    r(c, 1, CASE_H - 3, CASE_W - 2, 2, P.woodD);
    r(c, 0, CASE_H - 1, CASE_W, 1, "rgba(27,21,38,0.35)");
    return s.cv;
  }

  /**
   * A desktop computer, seen from the front-ish like everything else in
   * this room. Drawn here because the FREE half of Modern Interiors has no
   * computer in it at all -- the office set is in the paid pack, which this
   * project cannot use. 11x13, so it sits on a desk without burying it.
   */
  function monitor() {
    const s = surface(11, 13);
    const c = s.ctx;
    r(c, 0, 0, 11, 9, P.ink);          // bezel
    r(c, 1, 1, 9, 7, P.ink2);
    r(c, 1, 1, 9, 6, P.wallD);         // the screen itself
    r(c, 2, 2, 7, 4, P.cyan);          // lit, because somebody is working
    r(c, 2, 2, 7, 1, P.white);         // glare along the top
    r(c, 3, 4, 3, 1, P.wallD);         // a line of text on it
    r(c, 4, 9, 3, 2, P.ink);           // neck
    r(c, 2, 11, 7, 2, P.ink2);         // foot
    r(c, 2, 11, 7, 1, P.wallL);
    return s.cv;
  }

  /**
   * The scroll that appears on the scribe's desk when a report is ready.
   * Tiny -- 9x11 -- because it sits on a desk the agent is standing at;
   * the pulse in game.js is what makes the eye find it.
   */
  function scroll() {
    const s = surface(9, 11);
    const c = s.ctx;
    r(c, 1, 1, 7, 9, P.ink);
    r(c, 2, 2, 5, 7, P.parch);
    r(c, 2, 2, 5, 1, P.parchL);
    r(c, 3, 4, 3, 1, P.ink2);          // a line of writing
    r(c, 3, 6, 3, 1, P.ink2);
    r(c, 1, 0, 7, 2, P.brass);         // rolled top
    r(c, 1, 9, 7, 2, P.brass);         // rolled bottom
    return s.cv;
  }

  function lamp() {
    const s = surface(14, 20);
    const c = s.ctx;
    r(c, 6, 0, 2, 6, P.ink2);           // cord
    r(c, 2, 6, 10, 2, P.brassD);        // shade rim
    r(c, 1, 8, 12, 4, P.brass);         // shade
    r(c, 3, 12, 8, 2, P.brassL);        // bulb glow
    r(c, 5, 14, 4, 2, P.parchL);        // hotspot
    return s.cv;
  }

  /** Potted plant, 14x24. Every office scene needs one. */
  function plant() {
    const s = surface(14, 24);
    const c = s.ctx;
    r(c, 3, 17, 8, 6, P.woodD);         // pot
    r(c, 4, 17, 6, 1, P.wood);          // pot rim highlight
    r(c, 6, 10, 2, 8, "#3f6b39");       // stem
    // fronds
    [[1, 8], [10, 8], [2, 12], [9, 12], [5, 5], [4, 2]].forEach(function (p, i) {
      r(c, p[0], p[1], 4, 3, i % 2 ? "#4d8f52" : "#3f6b39");
    });
    r(c, 2, 23, 10, 1, P.ink);          // shadow
    return s.cv;
  }

  /** Guild banner for the back wall, 18x26. Pure set dressing, but it
      gives the composition a centre and sells "guild hall". */
  function banner() {
    const s = surface(18, 26);
    const c = s.ctx;
    r(c, 0, 0, 18, 2, P.woodD);         // rod
    r(c, 2, 2, 14, 20, P.red);          // cloth
    r(c, 2, 2, 14, 1, P.brassL);
    r(c, 3, 3, 12, 18, "#8a2c3f");      // inner field
    // a book glyph
    r(c, 6, 8, 6, 5, P.parchL);
    r(c, 8, 8, 1, 5, P.brassD);
    // pennant tail
    r(c, 2, 22, 5, 3, P.red);
    r(c, 11, 22, 5, 3, P.red);
    return s.cv;
  }

  /**
   * A stack of books left on the floor, 14x16.
   *
   * Added after looking at the composition: with only three rows of agents
   * the floor read as a large empty plain. Small props in the gaps give the
   * eye something to rest on and make the room feel lived in -- which is
   * what "set dressing" means and why every RPG interior is full of it.
   */
  function bookPile(seed) {
    const s = surface(14, 16);
    const c = s.ctx;
    const cols = [P.red, P.blue, P.green, P.violet, P.brass];
    let y = 14;
    // Stack 3-4 books, each offset slightly so the pile looks unstable.
    const n = 3 + Math.floor(hash(seed, 9) * 2);
    for (let i = 0; i < n; i++) {
      const h = 2 + Math.floor(hash(i, seed) * 2);
      const w = 9 + Math.floor(hash(seed, i) * 4);
      const x = 1 + Math.floor(hash(i * 3, seed) * 3);
      y -= h;
      r(c, x, y, w, h, cols[Math.floor(hash(seed + i, i) * cols.length)]);
      r(c, x, y, w, 1, P.parchL);      // page block catching the light
      r(c, x, y + h - 1, w, 1, P.ink); // shadow under each book
    }
    r(c, 1, 15, 12, 1, "rgba(27,21,38,0.35)");   // contact shadow
    return s.cv;
  }

  /* ================================================================
     CHARACTERS

     Each character is a 16-frame sheet of 16x24 cells:

       0 idle0   1 idle1    2 read0   3 read1
       4 type0   5 type1    6 cheer   7 sad
       8..15     walk<Down|Up|Left|Right><0|1>

     The eight walk frames were added in Phase 2, when agents started
     moving between zones. Two frames a direction is the minimum that
     reads as walking: legs together, legs apart. Frame 0 of each pair
     doubles as that direction's standing pose.

     16x24 is the Tiny-RPG-ish proportion: a 6px head on a 9px body,
     which is the smallest size that still reads as a person with a
     recognisable pose.
     ================================================================ */

  const FRAME_W = 16;
  const FRAME_H = 24;
  const POSES = ["idle0", "idle1", "read0", "read1", "type0", "type1", "cheer", "sad",
    "walkDown0", "walkDown1", "walkUp0", "walkUp1",
    "walkLeft0", "walkLeft1", "walkRight0", "walkRight1",
    "sitDown", "sitUp", "sitLeft", "sitRight"];

  const WALK = /^walk(Down|Up|Left|Right)([01])$/;
  const SIT = /^sit(Down|Up|Left|Right)$/;

  /**
   * Paint one character frame into ctx at (ox, oy).
   * `col` is a ROLE_COLORS entry; `pose` is one of POSES.
   */
  function charFrame(ctx, ox, oy, pose, col) {
    // `bob` is the entire trick behind idle animation: shifting the whole
    // figure down one pixel every other frame reads as breathing.
    const bob = (pose === "idle1" || pose === "type1") ? 1 : 0;
    const y = oy + bob;

    // Ground shadow stays put while the body bobs -- if the shadow moves
    // too, the character looks like it is floating rather than breathing.
    r(ctx, ox + 4, oy + 22, 8, 2, "rgba(27,21,38,0.35)");

    /* ---- legs & feet ---- */
    r(ctx, ox + 5, y + 18, 2, 4, P.ink2);
    r(ctx, ox + 9, y + 18, 2, 4, P.ink2);
    r(ctx, ox + 4, y + 21, 3, 2, P.ink);
    r(ctx, ox + 9, y + 21, 3, 2, P.ink);

    /* ---- robe / torso ---- */
    r(ctx, ox + 4, y + 10, 8, 9, col.robe);
    r(ctx, ox + 3, y + 11, 1, 7, col.robeD);   // left shading edge
    r(ctx, ox + 12, y + 11, 1, 7, col.robeD);  // right shading edge
    r(ctx, ox + 4, y + 17, 8, 2, col.robeD);   // hem in shadow
    r(ctx, ox + 7, y + 10, 2, 7, col.trim);    // centre trim stripe

    /* ---- head ---- */
    r(ctx, ox + 5, y + 4, 6, 6, P.skin);
    r(ctx, ox + 5, y + 4, 6, 1, P.skinL);      // forehead highlight
    r(ctx, ox + 10, y + 5, 1, 5, P.skinD);     // cheek shadow
    r(ctx, ox + 6, y + 10, 4, 1, P.skinD);     // neck

    /* ---- hair ---- */
    r(ctx, ox + 4, y + 2, 8, 3, col.hair);
    r(ctx, ox + 4, y + 5, 1, 2, col.hair);     // sideburns
    r(ctx, ox + 11, y + 5, 1, 2, col.hair);

    /* ---- face: the pose-specific part ---- */
    if (pose === "sad") {
      // Downcast: eyes as short dashes, mouth flat.
      r(ctx, ox + 6, y + 8, 2, 1, P.ink);
      r(ctx, ox + 9, y + 8, 2, 1, P.ink);
    } else if (pose === "cheer") {
      px(ctx, ox + 6, y + 7, P.ink);
      px(ctx, ox + 9, y + 7, P.ink);
      r(ctx, ox + 7, y + 8, 2, 2, P.ink);      // open mouth
    } else if (pose === "read0" || pose === "read1") {
      // Looking down at the book: eyes one row lower.
      px(ctx, ox + 6, y + 8, P.ink);
      px(ctx, ox + 9, y + 8, P.ink);
    } else {
      px(ctx, ox + 6, y + 7, P.ink);
      px(ctx, ox + 9, y + 7, P.ink);
    }

    /* ---- arms & props: this is what distinguishes the states ---- */
    if (pose === "read0" || pose === "read1") {
      // Both arms forward, holding an open book at chest height.
      r(ctx, ox + 2, y + 12, 2, 4, col.robe);
      r(ctx, ox + 12, y + 12, 2, 4, col.robe);
      r(ctx, ox + 2, y + 15, 2, 2, P.skin);
      r(ctx, ox + 12, y + 15, 2, 2, P.skin);

      r(ctx, ox + 3, y + 13, 10, 5, P.parchD);      // covers
      r(ctx, ox + 4, y + 14, 4, 3, P.parchL);       // left page
      r(ctx, ox + 9, y + 14, 3, 3, P.parchL);       // right page
      r(ctx, ox + 8, y + 13, 1, 5, P.woodD);        // spine
      // The only difference between read0 and read1 is which page has
      // a line of text on it -- that alternation reads as page-turning.
      r(ctx, pose === "read0" ? ox + 5 : ox + 10, y + 15, 2, 1, P.ink2);

    } else if (pose === "type0" || pose === "type1") {
      // Arms down and forward onto a keyboard, one hand lower per frame.
      const lh = pose === "type0" ? 0 : 1;         // left-hand offset
      const rh = pose === "type0" ? 1 : 0;         // right-hand offset
      r(ctx, ox + 2, y + 11, 2, 4, col.robe);
      r(ctx, ox + 12, y + 11, 2, 4, col.robe);
      r(ctx, ox + 2, y + 15 + lh, 2, 2, P.skin);
      r(ctx, ox + 12, y + 15 + rh, 2, 2, P.skin);
      r(ctx, ox + 4, y + 17, 8, 2, P.ink2);        // keyboard
      r(ctx, ox + 5, y + 17, 6, 1, P.wallL);       // keys catching light

    } else if (pose === "cheer") {
      // Arms thrown up.
      r(ctx, ox + 2, y + 7, 2, 5, col.robe);
      r(ctx, ox + 12, y + 7, 2, 5, col.robe);
      r(ctx, ox + 2, y + 6, 2, 2, P.skin);
      r(ctx, ox + 12, y + 6, 2, 2, P.skin);

    } else if (pose === "sad") {
      // Arms hanging limp, slightly narrower stance.
      r(ctx, ox + 3, y + 11, 2, 6, col.robeD);
      r(ctx, ox + 11, y + 11, 2, 6, col.robeD);
      r(ctx, ox + 3, y + 17, 2, 2, P.skinD);
      r(ctx, ox + 11, y + 17, 2, 2, P.skinD);

    } else {
      // Idle: arms at the sides.
      r(ctx, ox + 2, y + 11, 2, 5, col.robe);
      r(ctx, ox + 12, y + 11, 2, 5, col.robe);
      r(ctx, ox + 2, y + 16, 2, 2, P.skin);
      r(ctx, ox + 12, y + 16, 2, 2, P.skin);
    }
  }

  /**
   * Paint one WALK frame: `dir` is down/up/left/right, `step` is 0 (legs
   * together, which is also the standing pose for that direction) or 1
   * (legs apart, arms swung).
   *
   * This is deliberately cheap art. The Modern Interiors pack ships real
   * six-frame run cycles; this theme only has to keep an agent legible
   * while it crosses the room, so it reuses the idle body and changes the
   * three things the eye actually reads at 16 pixels: the legs, the arms,
   * and which way the face is pointing.
   */
  function charWalkFrame(ctx, ox, oy, dir, step, col) {
    const y = oy + (step ? 1 : 0);      // the same one-pixel bob as idle
    const side = dir === "left" || dir === "right";

    // The shadow stays put while the body bobs.
    r(ctx, ox + 4, oy + 22, 8, 2, "rgba(27,21,38,0.35)");

    /* ---- legs: together, or one forward and one back ---- */
    if (!step) {
      r(ctx, ox + 5, y + 18, 2, 4, P.ink2);
      r(ctx, ox + 9, y + 18, 2, 4, P.ink2);
      r(ctx, ox + 4, y + 21, 3, 2, P.ink);
      r(ctx, ox + 9, y + 21, 3, 2, P.ink);
    } else if (side) {
      // Seen from the side the stride reads front-to-back, not apart.
      r(ctx, ox + 6, y + 18, 2, 4, P.ink2);
      r(ctx, ox + 8, y + 18, 2, 3, P.ink2);
      r(ctx, ox + 3, y + 21, 4, 2, P.ink);
      r(ctx, ox + 9, y + 20, 4, 2, P.ink);
    } else {
      r(ctx, ox + 4, y + 18, 2, 4, P.ink2);
      r(ctx, ox + 10, y + 18, 2, 4, P.ink2);
      r(ctx, ox + 3, y + 21, 3, 2, P.ink);
      r(ctx, ox + 10, y + 21, 3, 2, P.ink);
    }

    /* ---- robe / torso: a touch narrower side-on ---- */
    const tx = side ? ox + 5 : ox + 4;
    const tw = side ? 6 : 8;
    r(ctx, tx, y + 10, tw, 9, col.robe);
    r(ctx, tx - 1, y + 11, 1, 7, col.robeD);
    r(ctx, tx + tw, y + 11, 1, 7, col.robeD);
    r(ctx, tx, y + 17, tw, 2, col.robeD);
    if (!side) r(ctx, ox + 7, y + 10, 2, 7, col.trim);

    /* ---- head ---- */
    r(ctx, ox + 5, y + 4, 6, 6, P.skin);
    r(ctx, ox + 5, y + 4, 6, 1, P.skinL);
    r(ctx, ox + 6, y + 10, 4, 1, P.skinD);

    /* ---- hair, and the face only where a face would be visible ---- */
    r(ctx, ox + 4, y + 2, 8, 3, col.hair);
    if (dir === "up") {
      // Walking away: the back of the head is all hair, no features. That
      // absence is the entire signal that the agent is heading upscreen.
      r(ctx, ox + 5, y + 4, 6, 5, col.hair);
    } else if (dir === "down") {
      r(ctx, ox + 4, y + 5, 1, 2, col.hair);
      r(ctx, ox + 11, y + 5, 1, 2, col.hair);
      px(ctx, ox + 6, y + 7, P.ink);
      px(ctx, ox + 9, y + 7, P.ink);
    } else {
      // Side-on: hair covers the trailing half, one eye on the leading one.
      const lead = dir === "right";
      r(ctx, lead ? ox + 4 : ox + 8, y + 4, 4, 5, col.hair);
      px(ctx, lead ? ox + 9 : ox + 6, y + 7, P.ink);
      r(ctx, lead ? ox + 11 : ox + 4, y + 8, 1, 1, P.skinD);   // nose
    }

    /* ---- arms: one forward, one back on the stepping frame ---- */
    if (side) {
      const ax = dir === "right" ? ox + 9 : ox + 5;
      r(ctx, ax, y + 11, 2, step ? 4 : 5, col.robe);
      r(ctx, ax, y + (step ? 15 : 16), 2, 2, P.skin);
    } else {
      const la = step ? 1 : 0;
      r(ctx, ox + 2, y + 11 + la, 2, 5, col.robe);
      r(ctx, ox + 12, y + 11 - la, 2, 5, col.robe);
      r(ctx, ox + 2, y + 16 + la, 2, 2, P.skin);
      r(ctx, ox + 12, y + 16 - la, 2, 2, P.skin);
    }
  }

  /**
   * Paint one SEATED frame. The whole figure drops 5px and the legs fold
   * forward, which at this size is the entire difference between standing
   * and sitting -- the chair underneath does the rest of the explaining.
   */
  function charSitFrame(ctx, ox, oy, dir, col) {
    const y = oy + 5;
    const side = dir === "left" || dir === "right";

    r(ctx, ox + 4, oy + 22, 8, 2, "rgba(27,21,38,0.3)");

    /* ---- legs, folded forward rather than hanging ---- */
    if (side) {
      const f = dir === "right" ? 1 : -1;
      r(ctx, ox + 6, y + 15, 2, 3, P.ink2);
      r(ctx, ox + 6 + 3 * f, y + 15, 3, 2, P.ink2);   // thigh forward
      r(ctx, ox + 6 + 5 * f, y + 15, 2, 3, P.ink);    // shin down
    } else {
      r(ctx, ox + 5, y + 15, 2, 3, P.ink2);
      r(ctx, ox + 9, y + 15, 2, 3, P.ink2);
      r(ctx, ox + 4, y + 17, 3, 2, P.ink);
      r(ctx, ox + 9, y + 17, 3, 2, P.ink);
    }

    /* ---- torso ---- */
    const tx = side ? ox + 5 : ox + 4;
    const tw = side ? 6 : 8;
    r(ctx, tx, y + 7, tw, 8, col.robe);
    r(ctx, tx - 1, y + 8, 1, 6, col.robeD);
    r(ctx, tx + tw, y + 8, 1, 6, col.robeD);
    if (!side) r(ctx, ox + 7, y + 7, 2, 6, col.trim);

    /* ---- head ---- */
    r(ctx, ox + 5, y + 1, 6, 6, P.skin);
    r(ctx, ox + 5, y + 1, 6, 1, P.skinL);
    r(ctx, ox + 4, oy + 4, 8, 3, col.hair);
    if (dir === "up") {
      r(ctx, ox + 5, y + 1, 6, 5, col.hair);          // back of the head
    } else if (dir === "down") {
      px(ctx, ox + 6, y + 4, P.ink);
      px(ctx, ox + 9, y + 4, P.ink);
    } else {
      const lead = dir === "right";
      r(ctx, lead ? ox + 4 : ox + 8, y + 1, 4, 5, col.hair);
      px(ctx, lead ? ox + 9 : ox + 6, y + 4, P.ink);
    }

    /* ---- arms resting in the lap / on the table ---- */
    if (side) {
      const ax = dir === "right" ? ox + 10 : ox + 4;
      r(ctx, ax, y + 9, 2, 4, col.robe);
      r(ctx, ax, y + 12, 2, 2, P.skin);
    } else {
      r(ctx, ox + 2, y + 8, 2, 4, col.robe);
      r(ctx, ox + 12, y + 8, 2, 4, col.robe);
      r(ctx, ox + 2, y + 11, 2, 2, P.skin);
      r(ctx, ox + 12, y + 11, 2, 2, P.skin);
    }
  }

  /** Build the 20-frame sheet for one role colour. Returns a canvas. */
  function charSheet(col) {
    const s = surface(FRAME_W * POSES.length, FRAME_H);
    POSES.forEach(function (pose, i) {
      const w = WALK.exec(pose);
      const si = SIT.exec(pose);
      if (w) charWalkFrame(s.ctx, i * FRAME_W, 0, w[1].toLowerCase(), Number(w[2]), col);
      else if (si) charSitFrame(s.ctx, i * FRAME_W, 0, si[1].toLowerCase(), col);
      else charFrame(s.ctx, i * FRAME_W, 0, pose, col);
    });
    return s.cv;
  }

  /* ================================================================
     EMOTES

     Little icons that pop above a sprite's head. At 16 pixels tall a
     character's pose alone is ambiguous, so the emote is what actually
     tells you "searching" from "writing" at a glance. This is exactly
     how Stardew/Harvest Moon communicate NPC state.

     6-frame sheet of 14x14: search, book, pen, check, cross, wait
     ================================================================ */

  const EMOTES = ["search", "book", "pen", "check", "cross", "wait",
    // Phase 3, for the off-duty routine. The pack has no frames for
    // drinking, sleeping or talking, so the icon carries the whole meaning.
    "mug", "zzz", "chat"];

  function emoteSheet() {
    const s = surface(14 * EMOTES.length, 14);
    const c = s.ctx;

    EMOTES.forEach(function (name, i) {
      const o = i * 14;

      // Shared bubble: parchment square with a dark outline and a tail.
      r(c, o + 1, 0, 12, 11, P.ink);
      r(c, o + 2, 1, 10, 9, P.parchL);
      r(c, o + 5, 11, 3, 2, P.ink);     // tail pointing down at the head
      r(c, o + 5, 11, 2, 1, P.parchL);

      if (name === "search") {
        // magnifying glass
        r(c, o + 4, 3, 4, 1, P.ink2);
        r(c, o + 3, 4, 1, 3, P.ink2);
        r(c, o + 8, 4, 1, 3, P.ink2);
        r(c, o + 4, 7, 4, 1, P.ink2);
        r(c, o + 4, 4, 4, 3, P.cyan);
        r(c, o + 8, 7, 2, 2, P.woodD);  // handle
      } else if (name === "book") {
        r(c, o + 3, 3, 8, 5, P.parchD);
        r(c, o + 4, 4, 3, 3, P.white);
        r(c, o + 8, 4, 3, 3, P.white);
        r(c, o + 7, 3, 1, 5, P.woodD);
      } else if (name === "pen") {
        r(c, o + 8, 2, 2, 2, P.brass);  // nib end
        r(c, o + 7, 4, 2, 2, P.brassD);
        r(c, o + 5, 6, 2, 2, P.woodD);
        r(c, o + 3, 8, 8, 1, P.ink2);   // the line being written
      } else if (name === "check") {
        r(c, o + 4, 6, 2, 2, P.green);
        r(c, o + 5, 7, 2, 2, P.green);
        r(c, o + 6, 5, 2, 2, P.green);
        r(c, o + 7, 3, 2, 2, P.green);
        r(c, o + 8, 2, 2, 2, P.green);
      } else if (name === "cross") {
        for (let k = 0; k < 5; k++) {
          px(c, o + 4 + k, 3 + k, P.red);
          px(c, o + 8 - k, 3 + k, P.red);
          px(c, o + 5 + k, 3 + k, P.red);
        }
      } else if (name === "wait") {
        // three dots -- the universal "stalled, not dead" signal
        r(c, o + 3, 5, 2, 2, P.ink2);
        r(c, o + 6, 5, 2, 2, P.ink2);
        r(c, o + 9, 5, 2, 2, P.ink2);
      } else if (name === "mug") {
        // steaming cup: body, handle, two curls of steam
        r(c, o + 4, 5, 6, 4, P.white);
        r(c, o + 4, 5, 6, 1, P.parchD);     // coffee surface
        r(c, o + 10, 6, 1, 2, P.ink2);      // handle
        r(c, o + 4, 9, 6, 1, P.ink2);       // base shadow
        px(c, o + 5, 3, P.parchD);
        px(c, o + 6, 2, P.parchD);
        px(c, o + 8, 3, P.parchD);
      } else if (name === "zzz") {
        // three Z's climbing away, biggest last -- reads as asleep
        const zed = function (x, y, w) {
          r(c, o + x, y, w, 1, P.ink2);
          r(c, o + x, y + w, w, 1, P.ink2);
          for (let k = 1; k < w; k++) px(c, o + x + w - 1 - k, y + k, P.ink2);
        };
        zed(3, 7, 2);
        zed(6, 4, 3);
        zed(9, 2, 2);
      } else if (name === "chat") {
        // two speech tails facing each other: a conversation, not a thought
        r(c, o + 3, 3, 5, 4, P.cyan);
        r(c, o + 4, 7, 2, 1, P.cyan);
        r(c, o + 7, 5, 4, 4, P.brassL);
        r(c, o + 8, 9, 2, 1, P.brassL);
      }
    });
    return s.cv;
  }

  /* ================================================================
     BITMAP FONT + NAMEPLATES

     Why a hand-made 3x5 font instead of Press Start 2P for the in-game
     nameplates: in a real browser the web-font version came out smeared.
     Phaser rasterises text into the 320x240 canvas at 7px -- off the
     font's native 8px grid, so the glyph edges get anti-aliased -- and the
     browser then magnifies that blur 2-3x. The outline stroke made it worse.

     A bitmap font cannot blur: each glyph is a 3x5 grid of on/off pixels,
     drawn with the same fillRect as everything else, so it lands exactly
     on the pixel grid at any zoom. 5px tall is also small enough that
     nameplates stop colliding with the emote icons. This is how GBA-era
     games did small labels.
     ================================================================ */

  // Each glyph: 5 rows of 3 columns, "#" = lit.
  const GLYPHS = {
    A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."],
    C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."],
    E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."],
    G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
    I: ["###", ".#.", ".#.", ".#.", "###"], J: ["..#", "..#", "..#", "#.#", ".#."],
    K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
    M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"],
    O: [".#.", "#.#", "#.#", "#.#", ".#."], P: ["##.", "#.#", "##.", "#..", "#.."],
    Q: [".#.", "#.#", "#.#", "##.", ".##"], R: ["##.", "#.#", "##.", "#.#", "#.#"],
    S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
    U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."],
    W: ["#.#", "#.#", "###", "###", "#.#"], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
    Y: ["#.#", "#.#", ".#.", ".#.", ".#."], Z: ["###", "..#", ".#.", "#..", "###"],
    0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"],
    2: ["##.", "..#", ".#.", "#..", "###"], 3: ["##.", "..#", ".#.", "..#", "##."],
    4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "##.", "..#", "##."],
    6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."],
    8: ["###", "#.#", "###", "#.#", "###"], 9: ["###", "#.#", "###", "..#", "##."],
    " ": ["...", "...", "...", "...", "..."]
  };

  /** Pixel width of a string in the bitmap font (3px glyphs, 1px gaps). */
  function textWidth(text) {
    return Math.max(0, text.length * 4 - 1);
  }

  /** Draw a string in the bitmap font. Unknown characters render as blanks. */
  function drawText(ctx, text, x, y, color) {
    const s = String(text).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = GLYPHS[s[i]] || GLYPHS[" "];
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (g[row][col] === "#") px(ctx, x + i * 4 + col, y + row, color);
        }
      }
    }
  }

  /**
   * A nameplate: dark pill, light lettering, and a 1px underline in the
   * agent's robe colour so the label and the character visibly belong
   * together. The `hover` variant swaps to brass for mouse-over feedback.
   *
   * Corners are cut by leaving single pixels unpainted -- the pixel-art way
   * to round a rectangle, since there are no arcs anywhere in this file.
   */
  function nameplate(text, accent, hover) {
    const w = textWidth(text) + 6;
    const h = 9;
    const s = surface(w, h + 1);
    const c = s.ctx;
    const bg = hover ? P.brass : P.ink;
    const fg = hover ? P.ink : P.parchL;

    r(c, 1, 0, w - 2, h, bg);
    r(c, 0, 1, w, h - 2, bg);
    drawText(c, text, 3, 1, fg);
    r(c, 3, 7, w - 6, 1, accent);                          // identity underline
    r(c, 1, h, w - 2, 1, "rgba(27,21,38,0.45)");           // drop shadow
    return s.cv;
  }

  /* ================================================================
     Registration into Phaser
     ================================================================ */

  /** Texture keys, published so the itch.io swap described at the top of
      this file knows exactly what to override. */
  const TEXTURE_KEYS = {
    floor: "tile-floor", floorAlt: "tile-floor-alt",
    wall: "tile-wall", wainscot: "tile-wainscot",
    shelf: "prop-shelf", shelfAlt: "prop-shelf-alt",
    deskPlain: "prop-desk", deskScreen: "prop-desk-pc",
    window: "prop-window", lamp: "prop-lamp",
    plant: "prop-plant", banner: "prop-banner",
    books: "prop-books", booksAlt: "prop-books-alt",
    chair: "prop-chair", breakTable: "prop-break-table", coffee: "prop-coffee",
    archiveCase: "prop-archive", scroll: "prop-scroll", monitor: "prop-monitor",
    emotes: "emotes"
  };

  /**
   * Create every texture inside a Phaser scene.
   * Called once from the scene's create(), before anything is placed.
   */
  function register(scene) {
    const add = function (key, cv) { scene.textures.addCanvas(key, cv); };

    add(TEXTURE_KEYS.floor, floorTile(0));
    add(TEXTURE_KEYS.floorAlt, floorTile(1));
    add(TEXTURE_KEYS.wall, wallTile());
    add(TEXTURE_KEYS.wainscot, wainscotTile());
    add(TEXTURE_KEYS.shelf, bookshelf(1));
    add(TEXTURE_KEYS.shelfAlt, bookshelf(7));
    add(TEXTURE_KEYS.deskPlain, desk(false));
    add(TEXTURE_KEYS.deskScreen, desk(true));
    add(TEXTURE_KEYS.window, windowPane());
    add(TEXTURE_KEYS.lamp, lamp());
    add(TEXTURE_KEYS.plant, plant());
    add(TEXTURE_KEYS.banner, banner());
    add(TEXTURE_KEYS.chair, chair());
    add(TEXTURE_KEYS.scroll, scroll());
    add(TEXTURE_KEYS.monitor, monitor());
    // The case starts empty; game.js redraws it as soon as it knows how
    // many reports are actually on file.
    add(TEXTURE_KEYS.archiveCase, archiveCase(0));
    add(TEXTURE_KEYS.breakTable, breakTable());
    add(TEXTURE_KEYS.coffee, coffeeMaker());
    add(TEXTURE_KEYS.books, bookPile(2));
    add(TEXTURE_KEYS.booksAlt, bookPile(5));

    // Emote sheet: one canvas texture carrying six named frames.
    const emoteTex = scene.textures.addCanvas(TEXTURE_KEYS.emotes, emoteSheet());
    EMOTES.forEach(function (name, i) {
      emoteTex.add(name, 0, i * 14, 0, 14, 14);
    });
  }

  /**
   * Register the spritesheet for one agent and return its texture key.
   * Named frames (not indices) so game.js reads as `frame: "read0"`
   * rather than `frame: 2`, which is far easier to follow.
   */
  function registerCharacter(scene, agentId, col) {
    const key = "char-" + agentId;
    if (scene.textures.exists(key)) return key;

    const tex = scene.textures.addCanvas(key, charSheet(col));
    POSES.forEach(function (pose, i) {
      tex.add(pose, 0, i * FRAME_W, 0, FRAME_W, FRAME_H);
    });
    return key;
  }

  /**
   * Register both nameplate textures (normal + hover) for one agent.
   * Returns { normal, hover } texture keys.
   */
  function registerNameplate(scene, agentId, text, accentColor) {
    // The underline colour identifies the agent. The generated art uses the
    // robe colour; the Modern Interiors theme passes its outfit colour in.
    const accent = accentColor || colorsFor(agentId).robe;
    const keys = { normal: "plate-" + agentId, hover: "plate-" + agentId + "-hover" };
    if (!scene.textures.exists(keys.normal)) {
      scene.textures.addCanvas(keys.normal, nameplate(text, accent, false));
      scene.textures.addCanvas(keys.hover, nameplate(text, accent, true));
    }
    return keys;
  }

  /** Which colour set belongs to an agent id. */
  function colorsFor(agentId) {
    const m = /^researcher-(\d+)$/.exec(agentId);
    if (m) {
      const list = ROLE_COLORS.researchers;
      return list[Number(m[1]) % list.length];
    }
    return ROLE_COLORS[agentId] || ROLE_COLORS.planner;
  }

  /**
   * A head-and-shoulders portrait as a data URL, for the DOM party panel.
   *
   * Cropping the same generated sprite guarantees the panel and the game
   * can never disagree about what an agent looks like -- which is the
   * usual bug when a UI keeps its own copy of the art.
   */
  function portrait(agentId, scale) {
    const col = colorsFor(agentId);
    const src = surface(FRAME_W, FRAME_H);
    charFrame(src.ctx, 0, 0, "idle0", col);

    const z = scale || 2;
    const out = surface(13 * z, 13 * z);
    out.ctx.imageSmoothingEnabled = false;
    // Crop x 2..14, y 1..14 -- head plus a little shoulder.
    out.ctx.drawImage(src.cv, 2, 1, 13, 13, 0, 0, 13 * z, 13 * z);
    return out.cv.toDataURL();
  }

  return {
    PALETTE: P,
    KEYS: TEXTURE_KEYS,
    POSES: POSES,
    EMOTES: EMOTES,
    FRAME_W: FRAME_W,
    FRAME_H: FRAME_H,
    register: register,
    registerCharacter: registerCharacter,
    archiveCase: archiveCase,
    CASE_W: CASE_W,
    CASE_H: CASE_H,
    registerNameplate: registerNameplate,
    textWidth: textWidth,
    colorsFor: colorsFor,
    portrait: portrait
  };
})();
