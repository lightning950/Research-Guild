/* =========================================================================
   world.js -- the map: what stands where, where agents may walk, and how
   they get from one place to another.

   WHY THIS FILE EXISTS SEPARATELY FROM THE THEMES

   Before Phase 2 each theme owned its own room: interiors-art.js placed
   LimeZu furniture, pixel-art.js placed generated furniture, and the two
   agreed only by accident. Once agents WALK, the furniture is no longer
   decoration -- it is collision, and a shelf that exists in one theme and
   not the other means a path that works in one theme and wedges an agent
   into a bookcase in the other.

   So the floorplan lives here, once:
     - FURNITURE  -- every floor-standing object, with the footprint it
                     blocks. Themes read this list and draw their own art
                     for each entry; they never invent positions.
     - WALL       -- decoration hung on the back wall. Never blocks.
     - ZONES      -- named standing spots, each with the direction the agent
                     faces once it arrives.
     - path()     -- A* over the tile grid, returned as pixel waypoints.

   THE GRID IS 16px, THE ROOM IS 480x270 (30 x 17 tiles).
   Rows 0..2 are ceiling and wall; the floor starts at row 3. Feet are
   clamped to y<=264 so nobody's shoes hang off the bottom edge.

   ZONE TILES ARE ALWAYS WALKABLE, even when furniture covers them. An agent
   stands BEHIND its desk: the desk is drawn in front of the body, so the
   desk's own rect overlaps the tile the agent occupies. Rather than hand-
   tune every footprint around that, buildGrid() clears every zone tile at
   the end. That also guarantees a zone can never become unreachable by a
   later furniture tweak -- and the test suite checks exactly that.
   ========================================================================= */

const GuildWorld = (function () {
  "use strict";

  const W = 480;
  const H = 270;
  const TILE = 16;
  const COLS = W / TILE;              // 30
  const ROWS = Math.ceil(H / TILE);   // 17
  const FLOOR_TOP = 48;               // ceiling + wall band above this
  const FLOOR_ROW = FLOOR_TOP / TILE; // 3
  const FEET_MAX = 264;               // lowest a pair of feet may stand

  /* ----------------------------------------------------------------
     WALL DECORATION -- drawn between y=16 and y=48, never blocks.
     The blackboard is hard left because the planner works at it and the
     planning zone is the top-left corner of the hall.
     ---------------------------------------------------------------- */
  const WALL = [
    { id: "blackboard", x: 40,  y: 19 },
    { id: "worldMap",   x: 150, y: 24 },
    { id: "windowRed",  x: 200, y: 22 },
    { id: "chart",      x: 250, y: 22 },
    { id: "windowGrey", x: 100, y: 22 },   // moved: the kitchenette has the
    { id: "wallShelf",  x: 298, y: 32 }    // right-hand wall now
  ];

  /* ----------------------------------------------------------------
     FURNITURE -- floor-standing objects.

       x, y, ox, oy : where the theme draws it (ox/oy are the sprite origin)
       block        : [x, y, w, h] footprint that blocks walking, or null
       depth        : optional sort override. Depth is normally an object's
                      bottom edge, which is right for things standing on the
                      floor and wrong for things standing on OTHER THINGS:
                      a mug on a counter has its bottom higher up the screen
                      than the counter's front face, so the counter was being
                      drawn over the top of it.

     A desk's block is only its LOWER half. The upper half is where the
     agent stands, and blocking it would mean an agent permanently inside
     an obstacle. Depth sorting puts the desk in front of the body, so the
     two overlap on purpose.
     ---------------------------------------------------------------- */
  const FURNITURE = [
    // --- the planner's cabin (top left) ---
    //     A desk with a computer on it. The planner used to stand facing a
    //     blackboard for the whole run, visibly doing nothing.
    { id: "rugRed",    x: 54,  y: 92,  ox: 0.5, oy: 0.5, block: null },
    { id: "deskWood",  x: 54,  y: 96,  ox: 0.5, oy: 0,   block: [41, 108, 26, 10] },
    // Keep the screen to the planner's right so it shares the desktop with
    // the mug instead of covering the middle of the desk.
    { id: "monitor",   x: 61,  y: 105, ox: 0.5, oy: 1,   block: null, depth: 118 },
    { id: "coffeeMug", x: 46,  y: 104, ox: 0.5, oy: 1,   block: null, depth: 119 },
    { id: "globe",     x: 104, y: 86,  ox: 0.5, oy: 1,   block: [98, 78, 13, 10] },
    { id: "shelfA",    x: 2,   y: 26,  ox: 0,   oy: 0,   block: [2, 48, 33, 10] },
    { id: "lampCream", x: 128, y: 88,  ox: 0.5, oy: 1,   block: [121, 80, 15, 10] },

    // --- the kitchenette, against the back wall ---
    //     The counter runs along the wall, the machine stands on it, and
    //     the fridge closes the run off -- which also screens the archive
    //     corner, the job the two potted plants used to do badly.
    { id: "counterUnit", x: 296, y: 46, ox: 0,   oy: 0, block: [296, 72, 16, 12] },
    { id: "counterUnit", x: 312, y: 46, ox: 0,   oy: 0, block: [312, 72, 16, 12] },
    { id: "coffeeMaker", x: 306, y: 58, ox: 0.5, oy: 1, block: null, depth: 84 },
    { id: "coffeeMug",   x: 322, y: 58, ox: 0.5, oy: 1, block: null, depth: 85 },
    { id: "fridge",      x: 336, y: 48, ox: 0,   oy: 0, block: [336, 88, 42, 14] },

    // --- the archive (top right). One custom-drawn case, not a pair of
    //     stock shelves: its shelves carry a spine per saved report, so
    //     this is the one piece of furniture whose art is data. The zone
    //     in front of it is where the scribe files, and where a visitor
    //     stands to read the spines. ---
    { id: "archiveCase", x: 396, y: 20, ox: 0, oy: 0, block: [396, 56, 50, 12] },

    // --- scout desks (the middle row) ---
    { id: "studyDesk", x: 96,  y: 144, ox: 0.5, oy: 0,   block: [82, 160, 28, 8] },
    { id: "studyDesk", x: 154, y: 144, ox: 0.5, oy: 0,   block: [140, 160, 28, 8] },
    { id: "studyDesk", x: 212, y: 144, ox: 0.5, oy: 0,   block: [198, 160, 28, 8] },
    { id: "studyDesk", x: 270, y: 144, ox: 0.5, oy: 0,   block: [256, 160, 28, 8] },
    { id: "studyDesk", x: 328, y: 144, ox: 0.5, oy: 0,   block: [314, 160, 28, 8] },

    // --- the front band: scribe writes, warden checks ---
    { id: "deskWood",  x: 228, y: 230, ox: 0.5, oy: 0,   block: [215, 242, 26, 12] },
    { id: "monitor",   x: 234, y: 236, ox: 0.5, oy: 1,   block: null, depth: 252 },
    { id: "deskWood",  x: 332, y: 230, ox: 0.5, oy: 0,   block: [319, 242, 26, 12] },
    { id: "monitor",   x: 338, y: 236, ox: 0.5, oy: 1,   block: null, depth: 252 },
    { id: "rugBlue",   x: 286, y: 206, ox: 0.5, oy: 0.5, block: null },
    { id: "lampBlue",  x: 284, y: 250, ox: 0.5, oy: 1,   block: [277, 240, 15, 12] },

    // --- the break corner (bottom right): where off-duty agents go.
    //     The routine in game.js is only believable if the room actually
    //     has the places it sends people to -- a coffee machine to stand
    //     at and open floor for the standing discussion area.
    // --- corners ---
    { id: "palm",      x: 4,   y: 266, ox: 0,   oy: 1,   block: [4, 250, 23, 14] },
    { id: "tree",      x: 452, y: 266, ox: 0,   oy: 1,   block: [452, 252, 18, 12] }
  ];

  /* Pieces drawn in code (pixel-art.js) rather than cropped from the art
     pack, because the free pack has nothing that will do: a bookcase whose
     contents are data, and a computer (the office set is paid-only). Both
     themes render these from the same drawing. */
  const CUSTOM_ART = ["archiveCase", "monitor"];

  /* ----------------------------------------------------------------
     ZONES -- named standing spots. `face` is the direction the agent turns
     once it arrives, which decides the idle frame it settles into.

     Slot groups (table*, pace*) are claimed one agent at a time through
     claim(); the fixed zones belong to one agent for the whole run.
     ---------------------------------------------------------------- */
  const ZONES = {
    board:   { x: 54,  y: 102, face: "down" },   // planner's desk
    archive: { x: 420, y: 104, face: "up" },     // in front of the shelves
    gate:    { x: 180, y: 54,  face: "down" },   // where agents arrive
    scribe:  { x: 228, y: 236, face: "down" },
    warden:  { x: 332, y: 236, face: "down" },

    // Where a scout stands to hand its findings to the scribe: 32px clear,
    // or the two nameplates run into each other. (The warden used to have a
    // matching spot on the other side, but it verifies at its own desk and
    // computer now, so it never walks over.)
    deliver: { x: 196, y: 236, face: "right" },

    // Where the planner stands when it comes down to see how the scouts are
    // getting on: in front of the desk row, looking up at it.
    inspect0: { x: 154, y: 178, face: "up" },
    inspect1: { x: 270, y: 178, face: "up" },

    // Scout desks, in the same order as researcher-0..4. Scouts stand
    // behind their desks and face down toward the work surface.
    desk0: { x: 96,  y: 150, face: "down" },
    desk1: { x: 154, y: 150, face: "down" },
    desk2: { x: 212, y: 150, face: "down" },
    desk3: { x: 270, y: 150, face: "down" },
    desk4: { x: 328, y: 150, face: "down" },

    /* ---- off-duty spots ----
       Agents do not wander at random: each one works through a fixed rota
       of things to do, and every one of those things happens HERE, at a
       named spot it has to walk to. Each spot holds exactly one agent
       (claim() enforces it), which is what keeps two of them from standing
       inside each other. */
    coffee: { x: 312, y: 100, face: "up" },     // at the counter
    shelf:  { x: 18,  y: 70,  face: "up" },     // browsing the bookshelf
    chatA:  { x: 296, y: 190, face: "right" },  // two agents, facing each
    chatB:  { x: 328, y: 190, face: "left" },   // other, mid-conversation

    // Five standing discussion spots around the break table. Each face points
    // toward the table and the other scouts.
    table0: { x: 384, y: 148, face: "down" },
    table1: { x: 408, y: 148, face: "down" },
    table2: { x: 352, y: 190, face: "right" },
    table3: { x: 440, y: 190, face: "left" },
    table4: { x: 396, y: 242, face: "up" }
  };

  /* Off-duty groups. A group with one spot still goes through claim(), so
     a second agent wanting coffee waits its turn instead of sharing it. */
  const GROUPS = {
    coffee: ["coffee"],
    // Only spots that actually face shelves. There used to be a second one
    // at x=50, which is in front of the BLACKBOARD -- agents "browsing the
    // books" stood at the planning board reading the wall.
    browse: ["shelf", "archive"],
    chat:   ["chatA", "chatB"],
    table:  ["table0", "table1", "table2", "table3", "table4"],
    // The planner's rounds: two places to stand and watch the desk row.
    inspect: ["inspect0", "inspect1"]
  };

  /* ============================================================ the grid */

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
    // Zone tiles win over furniture: see the header note.
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

  /* ================================================================ A*

     Four-neighbour, Manhattan heuristic, because the walk cycles are
     four-directional: a diagonal step would need art that does not exist
     and would read as sliding. Paths therefore come out L-shaped, which is
     how characters move in the games this room is imitating anyway.
     ================================================================ */

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
      // Unreachable even with the room to itself (should not happen -- the
      // suite checks every zone pair). Walking straight there beats standing
      // still and looking broken.
      return [{ x: toX, y: Math.min(toY, FEET_MAX) }];
    }

    // Collapse runs in the same direction: one waypoint per corner, so the
    // mover changes facing only where the path actually turns.
    const out = [];
    for (let i = 0; i < tiles.length; i++) {
      const prev = tiles[i - 1] || start;
      const next = tiles[i + 1];
      if (next && (next.col - tiles[i].col) === (tiles[i].col - prev.col) &&
                  (next.row - tiles[i].row) === (tiles[i].row - prev.row)) {
        continue;                       // straight through: not a waypoint
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
      // Linear scan for the smallest f. The grid is 510 tiles; a heap would
      // be more code than the search it speeds up.
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

  /* =========================================================== claiming

     Slot groups hand out one spot per agent. Without this, five scouts all
     pick table0 and stand inside each other.
     ======================================================================= */

  const held = {};      // agentId -> zone name

  function claim(agentId, group, strict) {
    const names = GROUPS[group];
    if (!names) return null;
    if (names.indexOf(held[agentId]) !== -1) return held[agentId];   // keep it
    const taken = {};
    Object.keys(held).forEach(function (a) {
      if (a !== agentId) taken[held[a]] = true;
    });
    let pick = null;
    for (let i = 0; i < names.length && !pick; i++) {
      if (!taken[names[i]]) pick = names[i];
    }
    // Work slots share rather than fail: a sixth scout standing at the end
    // of the bench is better than one standing nowhere. Off-duty activities
    // pass strict, because two agents in one chair is exactly the collision
    // the routine exists to avoid -- they pick something else to do instead.
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
