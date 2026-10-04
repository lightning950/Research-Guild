const GuildWorld = (function () {
  "use strict";

  const W = 480;
  const H = 270;
  const TILE = 16;
  const COLS = W / TILE;
  const ROWS = Math.ceil(H / TILE);
  const FLOOR_TOP = 48;
  const FLOOR_ROW = FLOOR_TOP / TILE;
  const FEET_MAX = 264;


  const WALL = [
    { id: "blackboard", x: 40,  y: 19 },
    { id: "worldMap",   x: 150, y: 24 },
    { id: "windowRed",  x: 200, y: 22 },
    { id: "chart",      x: 250, y: 22 },
    { id: "windowGrey", x: 100, y: 22 },
    { id: "wallShelf",  x: 298, y: 32 }
  ];

  /* Furniture footprints use the lower half of desks so agents can stand at them. */
  const FURNITURE = [



    { id: "rugRed",    x: 54,  y: 92,  ox: 0.5, oy: 0.5, block: null },
    { id: "deskWood",  x: 54,  y: 96,  ox: 0.5, oy: 0,   block: [41, 108, 26, 10] },


    { id: "monitor",   x: 61,  y: 105, ox: 0.5, oy: 1,   block: null, depth: 118 },
    { id: "coffeeMug", x: 46,  y: 104, ox: 0.5, oy: 1,   block: null, depth: 119 },
    { id: "globe",     x: 104, y: 86,  ox: 0.5, oy: 1,   block: [98, 78, 13, 10] },
    { id: "shelfA",    x: 2,   y: 26,  ox: 0,   oy: 0,   block: [2, 48, 33, 10] },
    { id: "lampCream", x: 128, y: 88,  ox: 0.5, oy: 1,   block: [121, 80, 15, 10] },





    { id: "counterUnit", x: 296, y: 46, ox: 0,   oy: 0, block: [296, 72, 16, 12] },
    { id: "counterUnit", x: 312, y: 46, ox: 0,   oy: 0, block: [312, 72, 16, 12] },
    { id: "coffeeMaker", x: 306, y: 58, ox: 0.5, oy: 1, block: null, depth: 84 },
    { id: "coffeeMug",   x: 322, y: 58, ox: 0.5, oy: 1, block: null, depth: 85 },
    { id: "fridge",      x: 336, y: 48, ox: 0,   oy: 0, block: [336, 88, 42, 14] },






    { id: "archiveCase", x: 396, y: 20, ox: 0, oy: 0, block: [396, 56, 50, 12] },


    { id: "studyDesk", x: 96,  y: 144, ox: 0.5, oy: 0,   block: [82, 160, 28, 8] },
    { id: "studyDesk", x: 154, y: 144, ox: 0.5, oy: 0,   block: [140, 160, 28, 8] },
    { id: "studyDesk", x: 212, y: 144, ox: 0.5, oy: 0,   block: [198, 160, 28, 8] },
    { id: "studyDesk", x: 270, y: 144, ox: 0.5, oy: 0,   block: [256, 160, 28, 8] },
    { id: "studyDesk", x: 328, y: 144, ox: 0.5, oy: 0,   block: [314, 160, 28, 8] },


    { id: "deskWood",  x: 228, y: 230, ox: 0.5, oy: 0,   block: [215, 242, 26, 12] },
    { id: "monitor",   x: 234, y: 236, ox: 0.5, oy: 1,   block: null, depth: 252 },
    { id: "deskWood",  x: 332, y: 230, ox: 0.5, oy: 0,   block: [319, 242, 26, 12] },
    { id: "monitor",   x: 338, y: 236, ox: 0.5, oy: 1,   block: null, depth: 252 },
    { id: "rugBlue",   x: 286, y: 206, ox: 0.5, oy: 0.5, block: null },
    { id: "lampBlue",  x: 284, y: 250, ox: 0.5, oy: 1,   block: [277, 240, 15, 12] },






    { id: "palm",      x: 4,   y: 266, ox: 0,   oy: 1,   block: [4, 250, 23, 14] },
    { id: "tree",      x: 452, y: 266, ox: 0,   oy: 1,   block: [452, 252, 18, 12] }
  ];


  const CUSTOM_ART = ["archiveCase", "monitor"];


  const ZONES = {
    board:   { x: 54,  y: 102, face: "down" },
    archive: { x: 420, y: 104, face: "up" },
    gate:    { x: 180, y: 54,  face: "down" },
    scribe:  { x: 228, y: 236, face: "down" },
    warden:  { x: 332, y: 236, face: "down" },





    deliver: { x: 196, y: 236, face: "right" },



    inspect0: { x: 154, y: 178, face: "up" },
    inspect1: { x: 270, y: 178, face: "up" },



    desk0: { x: 96,  y: 150, face: "down" },
    desk1: { x: 154, y: 150, face: "down" },
    desk2: { x: 212, y: 150, face: "down" },
    desk3: { x: 270, y: 150, face: "down" },
    desk4: { x: 328, y: 150, face: "down" },


    coffee: { x: 312, y: 100, face: "up" },
    shelf:  { x: 18,  y: 70,  face: "up" },
    chatA:  { x: 296, y: 190, face: "right" },
    chatB:  { x: 328, y: 190, face: "left" },



    table0: { x: 384, y: 148, face: "down" },
    table1: { x: 408, y: 148, face: "down" },
    table2: { x: 352, y: 190, face: "right" },
    table3: { x: 440, y: 190, face: "left" },
    table4: { x: 396, y: 242, face: "up" }
  };


  const GROUPS = {
    coffee: ["coffee"],



    browse: ["shelf", "archive"],
    chat:   ["chatA", "chatB"],
    table:  ["table0", "table1", "table2", "table3", "table4"],

    inspect: ["inspect0", "inspect1"]
  };



  let grid = null;   // grid[row][col] === true when walkable

  function buildGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      g[r] = [];
      for (let c = 0; c < COLS; c++) g[r][c] = r >= FLOOR_ROW;
    }
    FURNITURE.forEach(function (f) {
      if (!f.block) return;
      const b = f.block;
      const c0 = Math.floor(b[0] / TILE), c1 = Math.floor((b[0] + b[2] - 1) / TILE);
      const r0 = Math.floor(b[1] / TILE), r1 = Math.floor((b[1] + b[3] - 1) / TILE);
      for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) g[r][c] = false;
      }
    });

    Object.keys(ZONES).forEach(function (k) {
      const z = ZONES[k];
      g[Math.floor(z.y / TILE)][Math.floor(z.x / TILE)] = true;
    });
    return g;
  }

  function isWalkable(col, row) {
    if (!grid) grid = buildGrid();
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    return grid[row][col];
  }

  function tileOf(x, y) {
    return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
  }

  /** The key path()'s `avoid` map uses for the tile containing (x, y). */
  function tileKey(x, y) {
    return Math.floor(y / TILE) * COLS + Math.floor(x / TILE);
  }

  function centreOf(col, row) {
    return { x: col * TILE + TILE / 2, y: Math.min(row * TILE + TILE / 2, FEET_MAX) };
  }

  /** Nearest walkable tile to (x,y), searched in rings. Used when a start
      point has been left inside furniture by a resize or a theme change. */
  function nearestWalkable(x, y) {
    const t = tileOf(x, y);
    if (isWalkable(t.col, t.row)) return t;
    for (let rad = 1; rad < Math.max(COLS, ROWS); rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          if (isWalkable(t.col + dc, t.row + dr)) {
            return { col: t.col + dc, row: t.row + dr };
          }
        }
      }
    }
    return t;
  }



  /**
   * Join a start pixel, a run of tile centres and an exact destination into
   * a list of AXIS-ALIGNED steps.
   *
   * Zones sit at hand-picked pixels, not at tile centres, so the first and
   * last steps of a raw path usually move on both axes at once -- and a
   * diagonal step has no walk frame to play, so the agent would appear to
   * slide. Each end therefore gets its corner squared: slide across, then
   * step in.
   */
  function squareOff(from, tiles, dest) {
    const out = tiles.slice();
    if (out.length && out[0].x !== from.x && out[0].y !== from.y) {
      out.unshift({ x: out[0].x, y: from.y });
    }
    const last = out.length ? out[out.length - 1] : from;
    if (last.x !== dest.x && last.y !== dest.y) out.push({ x: dest.x, y: last.y });
    const tail = out.length ? out[out.length - 1] : from;
    if (tail.x !== dest.x || tail.y !== dest.y) out.push(dest);
    return out;
  }

  /**
   * A route from one point to another.
   *
   * `avoid` is the tiles other agents are standing on, keyed by tileKey().
   * The furniture grid alone is not enough to keep agents out of each
   * other: every ZONE tile is forced walkable (an agent has to be able to
   * stand at its own desk), which makes somebody else's desk a perfectly
   * legal shortcut -- and the planner duly walked straight through a scout
   * on its way back to its cabin. Treating occupied tiles as blocked at
   * planning time is what makes it walk round instead.
   *
   * The start and goal tiles are never avoided: you are standing on one of
   * them, and refusing to arrive at the other would simply freeze the walk.
   * If avoidance leaves no route at all, the search is retried without it --
   * squeezing past someone beats standing still for the rest of the run.
   */
  function path(fromX, fromY, toX, toY, avoid) {
    const start = nearestWalkable(fromX, fromY);
    const goal = nearestWalkable(toX, toY);
    const key = function (c, r) { return r * COLS + c; };

    if (start.col === goal.col && start.row === goal.row) {
      return squareOff({ x: fromX, y: fromY }, [], { x: toX, y: Math.min(toY, FEET_MAX) });
    }

    const tiles = search(start, goal, key, avoid) || search(start, goal, key, null);
    if (!tiles) {



      return [{ x: toX, y: Math.min(toY, FEET_MAX) }];
    }



    const out = [];
    for (let i = 0; i < tiles.length; i++) {
      const prev = tiles[i - 1] || start;
      const next = tiles[i + 1];
      if (next && (next.col - tiles[i].col) === (tiles[i].col - prev.col) &&
                  (next.row - tiles[i].row) === (tiles[i].row - prev.row)) {
        continue;
      }
      out.push(centreOf(tiles[i].col, tiles[i].row));
    }
    return squareOff({ x: fromX, y: fromY }, out,
      { x: toX, y: Math.min(toY, FEET_MAX) });
  }

  /** A* proper. Returns the tiles from start (exclusive) to goal, or null. */
  function search(start, goal, key, avoid) {
    const startK = key(start.col, start.row);
    const goalK = key(goal.col, goal.row);
    const blocked = function (c, r) {
      if (!isWalkable(c, r)) return true;
      const k = key(c, r);
      if (k === startK || k === goalK) return false;
      return !!(avoid && avoid[k]);
    };

    const open = [{ col: start.col, row: start.row, g: 0, f: 0 }];
    const cameFrom = {};
    const best = {};
    best[key(start.col, start.row)] = 0;
    let found = false;

    while (open.length) {


      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.col === goal.col && cur.row === goal.row) { found = true; break; }

      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let i = 0; i < neighbours.length; i++) {
        const nc = cur.col + neighbours[i][0];
        const nr = cur.row + neighbours[i][1];
        if (blocked(nc, nr)) continue;
        const k = key(nc, nr);
        const g = cur.g + 1;
        if (best[k] !== undefined && best[k] <= g) continue;
        best[k] = g;
        cameFrom[k] = key(cur.col, cur.row);
        open.push({
          col: nc, row: nr, g: g,
          f: g + Math.abs(nc - goal.col) + Math.abs(nr - goal.row)
        });
      }
    }

    if (!found) return null;

    const tiles = [];
    let k = goalK;
    while (k !== startK) {
      tiles.unshift({ col: k % COLS, row: Math.floor(k / COLS) });
      k = cameFrom[k];
    }
    return tiles;
  }



  const held = {};

  function claim(agentId, group, strict) {
    const names = GROUPS[group];
    if (!names) return null;
    if (names.indexOf(held[agentId]) !== -1) return held[agentId];
    const taken = {};
    Object.keys(held).forEach(function (a) {
      if (a !== agentId) taken[held[a]] = true;
    });
    let pick = null;
    for (let i = 0; i < names.length && !pick; i++) {
      if (!taken[names[i]]) pick = names[i];
    }


    // pass strict, because two agents in one chair is exactly the collision

    if (!pick) {
      if (strict) return null;
      pick = names[names.length - 1];
    }
    held[agentId] = pick;
    return pick;
  }

  function release(agentId) { delete held[agentId]; }

  function releaseAll() {
    Object.keys(held).forEach(function (a) { delete held[a]; });
  }

  /** The fixed home zone for an agent id, or null for one we do not place. */
  function homeZone(agentId) {
    const m = /^researcher-(\d+)$/.exec(agentId);
    if (m) return "desk" + Math.min(Number(m[1]), 4);
    if (agentId === "planner") return "board";
    if (agentId === "synthesizer") return "scribe";
    if (agentId === "verifier") return "warden";
    return null;
  }

  return {
    W: W, H: H, TILE: TILE, COLS: COLS, ROWS: ROWS,
    FLOOR_TOP: FLOOR_TOP, FEET_MAX: FEET_MAX,
    WALL: WALL, FURNITURE: FURNITURE, ZONES: ZONES, GROUPS: GROUPS,
    CUSTOM_ART: CUSTOM_ART,
    isCustomArt: function (id) { return CUSTOM_ART.indexOf(id) !== -1; },
    zone: function (name) { return ZONES[name] || null; },
    homeZone: homeZone,
    isWalkable: isWalkable,
    tileOf: tileOf,
    tileKey: tileKey,
    nearestWalkable: nearestWalkable,
    path: path,
    claim: claim,
    release: release,
    releaseAll: releaseAll,
    // exposed for the test suite
    buildGrid: function () { grid = buildGrid(); return grid; }
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GuildWorld;
