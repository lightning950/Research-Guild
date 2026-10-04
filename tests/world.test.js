const W = require("../static/js/world.js");

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok || !detail ? "" : "  -- " + detail));
}

const zoneNames = Object.keys(W.ZONES);

/* 1. Every zone stands on a walkable tile. */
{
  const bad = zoneNames.filter(function (n) {
    const z = W.ZONES[n];
    const t = W.tileOf(z.x, z.y);
    return !W.isWalkable(t.col, t.row);
  });
  check("every zone tile is walkable", bad.length === 0, bad.join(", "));
}


{
  const bad = zoneNames.filter(function (n) {
    const z = W.ZONES[n];
    return z.x < 8 || z.x > W.W - 8 || z.y < W.FLOOR_TOP + 4 || z.y > W.FEET_MAX;
  });
  check("every zone is on the floor and on screen", bad.length === 0, bad.join(", "));
}


{
  const gate = W.tileOf(W.ZONES.gate.x, W.ZONES.gate.y);
  const seen = {};
  const queue = [gate];
  seen[gate.row * W.COLS + gate.col] = true;
  while (queue.length) {
    const c = queue.shift();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      const nc = c.col + d[0], nr = c.row + d[1];
      const k = nr * W.COLS + nc;
      if (seen[k] || !W.isWalkable(nc, nr)) return;
      seen[k] = true;
      queue.push({ col: nc, row: nr });
    });
  }
  const unreachable = zoneNames.filter(function (n) {
    const t = W.tileOf(W.ZONES[n].x, W.ZONES[n].y);
    return !seen[t.row * W.COLS + t.col];
  });
  check("every zone is reachable from the gate", unreachable.length === 0,
    unreachable.join(", "));
}

/* 4. No path between any two zones steps through a blocked tile, and every
      step is axis-aligned (the walk cycles are four-directional). */
{
  let badTile = null, badStep = null, pairs = 0;
  for (let i = 0; i < zoneNames.length; i++) {
    for (let j = 0; j < zoneNames.length; j++) {
      if (i === j) continue;
      const a = W.ZONES[zoneNames[i]], b = W.ZONES[zoneNames[j]];
      const pts = W.path(a.x, a.y, b.x, b.y);
      pairs++;
      let prev = { x: a.x, y: a.y };
      pts.forEach(function (p) {
        const t = W.tileOf(p.x, p.y);
        if (!W.isWalkable(t.col, t.row) && !badTile) {
          badTile = zoneNames[i] + " -> " + zoneNames[j] + " at " + p.x + "," + p.y;
        }
        if (p.x !== prev.x && p.y !== prev.y && !badStep) {
          badStep = zoneNames[i] + " -> " + zoneNames[j];
        }
        prev = p;
      });

      const last = pts[pts.length - 1];
      if ((last.x !== b.x || last.y !== Math.min(b.y, W.FEET_MAX)) && !badTile) {
        badTile = zoneNames[i] + " -> " + zoneNames[j] + " did not end on the zone";
      }
    }
  }
  check("all " + pairs + " zone-to-zone paths stay on walkable tiles", !badTile, badTile);
  check("all path steps are axis-aligned", !badStep, badStep);
}

/* 4b. Occupied tiles are walked AROUND, not through. Every zone tile is
       forced walkable, so another agent's desk is otherwise a legal
       shortcut -- which is how the planner walked through a scout.

       Note the helper: a route is a list of CORNERS, so a tile the agent
       walks straight over never appears in it. Checking the waypoints alone
       would have declared this fixed while the agent still cut the corner. */
{
  const walked = function (from, pts) {
    const tiles = {};
    let cur = { x: from.x, y: from.y };
    tiles[W.tileKey(cur.x, cur.y)] = true;
    pts.forEach(function (pt) {
      const dx = Math.sign(pt.x - cur.x), dy = Math.sign(pt.y - cur.y);
      while (cur.x !== pt.x || cur.y !== pt.y) {
        cur = { x: dx ? cur.x + dx : cur.x, y: dy ? cur.y + dy : cur.y };
        tiles[W.tileKey(cur.x, cur.y)] = true;
      }
    });
    return tiles;
  };

  const a = W.ZONES.desk0, b = W.ZONES.desk4;
  const blocker = W.ZONES.desk2;
  const key = W.tileKey(blocker.x, blocker.y);

  const direct = walked(a, W.path(a.x, a.y, b.x, b.y));
  check("the direct route along the desk row really does cross the middle desk",
    direct[key] === true, "nothing to detour around -- the test proves nothing");

  const avoid = {};
  avoid[key] = true;
  const round = W.path(a.x, a.y, b.x, b.y, avoid);
  check("an occupied desk is routed around", walked(a, round)[key] !== true,
    round.map(function (p) { return p.x + "," + p.y; }).join(" "));
  check("the detour still arrives",
    round[round.length - 1].x === b.x && round[round.length - 1].y === b.y);

  // and when there is genuinely no way round, it still gets there
  const boxed = {};
  for (let c = 0; c < W.COLS; c++) {
    for (let r = 0; r < W.ROWS; r++) boxed[r * W.COLS + c] = true;
  }
  const squeeze = W.path(a.x, a.y, b.x, b.y, boxed);
  check("a sealed room falls back to a direct route rather than freezing",
    squeeze.length > 0 && squeeze[squeeze.length - 1].x === b.x);
}


{
  const a = W.claim("planner", "browse");
  const b = W.claim("verifier", "browse");
  check("two agents claim two different browse spots", a !== b, a + " / " + b);
  check("claiming twice keeps the same spot", W.claim("planner", "browse") === a);


  check("a full group refuses a strict claim",
    W.claim("synthesizer", "browse", true) === null);
  check("a full group still shares when not strict",
    W.claim("synthesizer", "browse") !== null);

  W.release("planner");
  check("a released spot is handed to the next claimant",
    W.claim("researcher-9", "browse", true) === a);
  W.releaseAll();
}


{
  check("home zones map correctly",
    W.homeZone("planner") === "board" &&
    W.homeZone("synthesizer") === "scribe" &&
    W.homeZone("verifier") === "warden" &&
    W.homeZone("researcher-3") === "desk3" &&
    W.homeZone("researcher-7") === "desk4" &&
    W.homeZone("nobody") === null);
}


{
  const bad = W.FURNITURE.filter(function (f) {
    if (!f.block) return false;
    const b = f.block;
    return b[0] < 0 || b[1] < W.FLOOR_TOP || b[0] + b[2] > W.W || b[1] + b[3] > W.H;
  }).map(function (f) { return f.id; });
  check("furniture footprints are on the floor", bad.length === 0, bad.join(", "));
}

console.log(failures === 0 ? "\nWORLD: PASS" : "\nWORLD: FAIL (" + failures + ")");
process.exit(failures === 0 ? 0 : 1);
