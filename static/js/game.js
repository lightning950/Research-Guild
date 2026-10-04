const GuildGame = (function () {
  "use strict";

  const W = GuildWorld.W;
  const H = GuildWorld.H;
  const TILE = GuildWorld.TILE;




  const WALK_SPEED = 52;





  const PLATE_DEPTH = 900;



  const IDLE_BEFORE_ROUTINE = [4500, 9000];

  let game = null;
  let scene = null;
  let theme = null;
  let ready = false;
  const stations = {};
  let pendingStates = {};
  let clickHandler = null;
  let archiveHandler = null;
  let archiveCase = null;
  let archiveCount = 0;
  let scrollSprite = null;




  const reducedMotion = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);




  let routineEnabled = !reducedMotion;


  const PRESENTATION = {
    idle:      { anim: "stand", emote: null,     label: "idle" },
    thinking:  { anim: "read",  emote: "book",   label: "thinking" },
    searching: { anim: "read",  emote: "search", label: "searching" },
    reading:   { anim: "read",  emote: "book",   label: "reading" },
    typing:    { anim: "type",  emote: "pen",    label: "writing" },
    waiting:   { anim: "stand", emote: "wait",   label: "waiting" },
    done:      { anim: "cheer", emote: "check",  label: "done" },
    failed:    { anim: "sad",   emote: "cross",  label: "failed" },
    chatting:  { anim: "stand", emote: "chat",   label: "chatting" }
  };

  function isScout(agentId) { return /^researcher-\d+$/.test(agentId); }

  /** Scouts start their rota at different points, so five of them never
      troop off to the coffee machine in single file. */
  function scoutIndex(agentId) {
    const m = /^researcher-(\d+)$/.exec(agentId);
    return m ? Number(m[1]) : 0;
  }

  /** Short nameplate text. Kept short: the bitmap font spends 4px a letter. */
  function shortName(agentId) {
    const m = /^researcher-(\d+)$/.exec(agentId);
    if (m) return "SCOUT" + (Number(m[1]) + 1);
    if (agentId === "planner") return "PLANNER";
    if (agentId === "synthesizer") return "SCRIBE";
    if (agentId === "verifier") return "WARDEN";
    return agentId.toUpperCase();
  }

  function rand(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }


  function targetZone(agentId, state) {









    return GuildWorld.homeZone(agentId);
  }

  const ProceduralTheme = {
    name: "procedural",



    emote: { dx: 12, dy: -16 },

    typingBob: true,

    // Which generated prop stands in for each world.js furniture id.


    PROPS: {
      shelfA: "shelf", shelfB: "shelfAlt",
      studyDesk: "deskScreen", deskWood: "deskPlain",
      lampCream: "lamp", lampBlue: "lamp",
      tree: "plant", palm: "plant", plantSmall: "plant",
      globe: "books", rugRed: null, rugBlue: null,
      counterUnit: "deskPlain", coffeeMaker: "coffee", fridge: "shelfAlt",
      coffeeMug: null, wallShelf: null,
      monitor: "monitor",
      breakTable: "breakTable", chairLeft: "chair", chairRight: "chair",
      blackboard: "banner", worldMap: "banner", chart: "banner",
      windowRed: "window", windowGrey: "window"
    },

    register: function (s) { PixelArt.register(s); },

    buildRoom: function (s) {
      const K = PixelArt.KEYS;
      const FLOOR = GuildWorld.FLOOR_TOP;


      for (let y = FLOOR; y < H; y += TILE) {
        for (let x = 0; x < W; x += TILE) {
          const alt = ((x / TILE) + (y / TILE)) % 3 === 0;
          s.add.image(x, y, alt ? K.floorAlt : K.floor).setOrigin(0, 0).setDepth(0);
        }
      }


      for (let x = 0; x < W; x += TILE) {
        s.add.image(x, 0, K.wall).setOrigin(0, 0).setDepth(0);
        s.add.image(x, TILE, K.wall).setOrigin(0, 0).setDepth(0);
        s.add.image(x, TILE * 2, K.wainscot).setOrigin(0, 0).setDepth(1);
      }

      const draw = function (item, depthFloor) {

        if (item.id === "archiveCase") return;
        const key = GuildWorld.isCustomArt(item.id)
          ? item.id : ProceduralTheme.PROPS[item.id];
        if (!key) return;
        const im = s.add.image(item.x, item.y, K[key])
          .setOrigin(item.ox === undefined ? 0 : item.ox,
                     item.oy === undefined ? 0 : item.oy);
        const oy = item.oy === undefined ? 0 : item.oy;
        im.setDepth(depthFloor ? 2
          : (item.depth !== undefined ? item.depth : item.y + im.height * (1 - oy)));
      };

      GuildWorld.WALL.forEach(function (d) { draw(d, true); });
      GuildWorld.FURNITURE.forEach(function (f) { draw(f, false); });


      [[54, 92], [280, 236]].forEach(function (p) {
        const g = s.add.graphics().setDepth(2);
        g.fillStyle(0xefcf83, 0.07);
        g.fillEllipse(p[0], p[1], 150, 86);
        g.fillStyle(0xefcf83, 0.05);
        g.fillEllipse(p[0], p[1], 96, 54);
      });
    },

    createVisuals: function (s, agentId, x, feetY, plateText) {
      const texKey = PixelArt.registerCharacter(s, agentId, PixelArt.colorsFor(agentId));
      const f = function (name) { return { key: texKey, frame: name }; };
      [


        ["idle-down", [f("idle0"), f("idle1")], 2, -1],
        ["idle-up", [f("walkUp0")], 1, 0],
        ["idle-left", [f("walkLeft0")], 1, 0],
        ["idle-right", [f("walkRight0")], 1, 0],
        ["walk-down", [f("walkDown0"), f("walkDown1")], 7, -1],
        ["walk-up", [f("walkUp0"), f("walkUp1")], 7, -1],
        ["walk-left", [f("walkLeft0"), f("walkLeft1")], 7, -1],
        ["walk-right", [f("walkRight0"), f("walkRight1")], 7, -1],
        ["read", [f("read0"), f("read1")], 3, -1],
        ["type", [f("type0"), f("type1")], 10, -1],
        ["cheer", [f("cheer")], 1, 0],
        ["sad", [f("sad")], 1, 0]
      ].forEach(function (d) {
        const name = texKey + "-" + d[0];
        if (s.anims.exists(name)) return;
        s.anims.create({ key: name, frames: d[1], frameRate: d[2], repeat: d[3] });
      });

      const sprite = s.add.sprite(x, feetY, texKey, "idle0").setOrigin(0.5, 1).setDepth(feetY);



      const plateKeys = PixelArt.registerNameplate(s, agentId, plateText);
      const plate = s.add.image(x, feetY + 2, plateKeys.normal)
        .setOrigin(0.5, 0).setDepth(PLATE_DEPTH);

      return {
        sprite: sprite, plate: plate, plateKeys: plateKeys, texKey: texKey,
        hitArea: [-8, 0, 32, 38]
      };
    }
  };



  const GuildScene = {

    key: "guild",

    create: function () {
      scene = this;
      theme.register(this);




      Object.keys(stations).forEach(function (id) { delete stations[id]; });
      GuildWorld.releaseAll();

      theme.buildRoom(this);




      ["planner", "synthesizer", "verifier"].forEach(function (id) {
        makeStation(scene, id, GuildWorld.homeZone(id));
      });

      buildArchive(this);

      ready = true;

      // Replay anything that arrived while Phaser was still booting.
      Object.keys(pendingStates).forEach(function (id) {
        setAgentState(id, pendingStates[id]);
      });
      pendingStates = {};
    },

    /** Phaser's per-frame tick: the only place sprites actually move. */
    update: function (time, delta) {
      Object.keys(stations).forEach(function (id) {
        stepMovement(stations[id], delta);
        followBody(stations[id]);
      });
    }
  };


  function archiveSpec() {
    return GuildWorld.FURNITURE.filter(function (f) {
      return f.id === "archiveCase";
    })[0];
  }

  function buildArchive(s) {
    const spec = archiveSpec();
    if (!spec) return;

    archiveCase = s.add.image(spec.x, spec.y, PixelArt.KEYS.archiveCase)
      .setOrigin(spec.ox, spec.oy)
      .setDepth(spec.y + PixelArt.CASE_H);

    archiveCase.setInteractive({ useHandCursor: true });
    archiveCase.on("pointerover", function () { archiveCase.setTint(0xffe9b5); });
    archiveCase.on("pointerout", function () { archiveCase.clearTint(); });
    archiveCase.on("pointerdown", function () { if (archiveHandler) archiveHandler(); });

    redrawArchive(s);



    const desk = GuildWorld.zone("scribe");
    scrollSprite = s.add.image(desk.x + 9, desk.y + 4, PixelArt.KEYS.scroll)
      .setOrigin(0.5, 1)
      .setDepth(960)
      .setVisible(false);
  }

  /**
   * Repaint the case for the current count.
   *
   * Draw INTO the existing canvas texture and refresh it. Removing the
   * texture and adding a new one under the same key frees the GL texture
   * the image is still holding, and the case then renders as nothing at
   * all ("Cannot read properties of null (reading 'glTexture')") -- which
   * also killed the filing trip, because the throw happened inside the
   * scribe's arrival callback and it never walked home.
   */
  function redrawArchive(s) {
    if (!archiveCase) return;
    const tex = s.textures.get(PixelArt.KEYS.archiveCase);
    if (!tex || !tex.getContext) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, PixelArt.CASE_W, PixelArt.CASE_H);
    ctx.drawImage(PixelArt.archiveCase(archiveCount), 0, 0);
    tex.refresh();
  }



  /**
   * One agent: character, nameplate and emote slot, standing at a zone.
   *
   * Desks are furniture in world.js, not per-agent props: an agent that
   * walks away from its desk should leave the desk behind.
   */
  function makeStation(s, agentId, zoneName) {
    if (stations[agentId]) return stations[agentId];

    const z = GuildWorld.zone(zoneName) || GuildWorld.zone("gate");
    const v = theme.createVisuals(s, agentId, z.x, z.y, shortName(agentId));

    const emote = s.add.sprite(z.x + theme.emote.dx, z.y + theme.emote.dy,
      PixelArt.KEYS.emotes, "search")
      .setOrigin(0.5, 1)
      .setDepth(1000)
      .setVisible(false);

    const station = {
      id: agentId,
      sprite: v.sprite,
      plate: v.plate,
      plateKeys: v.plateKeys,
      emote: emote,
      texKey: v.texKey,
      state: "idle",
      facing: z.face,
      plateAbove: plateAboveHead(agentId),
      zone: zoneName,
      route: null,
      routeStep: 0,
      arriveCb: null,
      emoteTween: null,


      rotaIndex: scoutIndex(agentId),
      activity: null,
      routineTimer: null,




      hover: { v: 0 },
      settleTimer: null,
      fillerTimer: null
    };
    stations[agentId] = station;




    // targeting sprite and nameplate together. A state change kills tweens
    // on the sprite -- and that killed the shared fade too, freezing the


    [v.sprite, v.plate].forEach(function (o) {
      o.setAlpha(0);
      s.tweens.add({ targets: o, alpha: 1, duration: 260, ease: "Linear" });
    });

    followBody(station);
    playStand(station);


    // The hit area is far larger than the sprite (body and nameplate).


    const h = v.hitArea;
    v.sprite.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(h[0], h[1], h[2], h[3]),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    });
    v.sprite.on("pointerover", function () { v.plate.setTexture(v.plateKeys.hover); });
    v.sprite.on("pointerout", function () { v.plate.setTexture(v.plateKeys.normal); });
    v.sprite.on("pointerdown", function () {
      if (clickHandler) clickHandler(agentId);
    });

    scheduleRoutine(station);
    return station;
  }



  /**
   * Keep the nameplate and emote with the body, and re-sort by feet.
   *
   * A nameplate normally hangs just under the feet. For an agent whose desk
   * is a SEATED one, that is precisely where its monitor and mug sit, and
   * the plate covered them completely -- so those agents wear their name
   * above their head instead. It is decided from the agent's HOME zone, not
   * from where it happens to be standing, so the plate does not jump from
   * one side of the body to the other every time it walks somewhere.
   */
  function plateAboveHead(agentId) {
    const home = GuildWorld.zone(GuildWorld.homeZone(agentId));
    return !!(home && home.seated);
  }

  function followBody(st) {
    const x = Math.round(st.sprite.x);
    const y = Math.round(st.sprite.y);
    st.sprite.setDepth(y);
    // Measured from the sprite, not a fixed 46: the two themes draw
    // characters 32 and 24 pixels tall, and a constant left the generated

    const above = y - (st.sprite.height + 14);
    st.plate.setPosition(x, st.plateAbove ? above : y + 2).setDepth(PLATE_DEPTH);
    st.emote.setPosition(x + theme.emote.dx, y + theme.emote.dy + st.hover.v);
  }

  /** The animation key for a state, resolving "stand" against the facing. */
  function animKey(st, anim) {
    const a = anim === "stand" ? "idle-" + st.facing : anim;
    return st.texKey + "-" + (theme.animFor ? theme.animFor(st.id, st.state, a) : a);
  }

  function playStand(st) {
    st.sprite.play(animKey(st, "stand"), true);
  }

  /**
   * Send an agent to a zone. `cb` runs on arrival -- immediately if the
   * agent is already standing there, so callers never need to special-case
   * "no walk needed".
   */
  function walkTo(st, zoneName, cb) {
    const z = GuildWorld.zone(zoneName);
    if (!z) { if (cb) cb(); return; }

    // MOVEMENT OWNS THE SPRITE'S POSITION. The typing bob, the done hop and
    // the failed shake all tween sprite.y or sprite.x on a loop, and a tween


    // the tween drags the sprite back to where it was. The agent then walks


    scene.tweens.killTweensOf(st.sprite);
    const from = st.route ? null : GuildWorld.zone(st.zone);
    if (from && Math.abs(st.sprite.x - from.x) <= 6 && Math.abs(st.sprite.y - from.y) <= 6) {
      st.sprite.setPosition(from.x, from.y);
    } else {
      st.sprite.setPosition(Math.round(st.sprite.x), Math.round(st.sprite.y));
    }
    st.sprite.setAlpha(1);

    st.zone = zoneName;
    if (Math.round(st.sprite.x) === z.x && Math.round(st.sprite.y) === z.y) {
      st.route = null;
      st.facing = z.face;
      if (cb) cb(); else playStand(st);
      return;
    }

    st.route = GuildWorld.path(st.sprite.x, st.sprite.y, z.x, z.y, occupiedBy(st));
    st.routeStep = 0;
    st.arriveCb = cb || null;
    st.destFace = z.face;
    faceTowards(st, st.route[0]);
  }

  /**
   * The tiles other agents are on, for the pathfinder to route around.
   *
   * Both where they ARE and where they are HEADING: two agents converging
   * on the same tile from opposite sides would otherwise plan straight
   * through each other and end up standing in the same place.
   */
  function occupiedBy(mover) {
    const avoid = {};
    Object.keys(stations).forEach(function (id) {
      const o = stations[id];
      if (o === mover) return;
      avoid[GuildWorld.tileKey(o.sprite.x, o.sprite.y)] = true;
      if (o.route && o.route.length) {
        const end = o.route[o.route.length - 1];
        avoid[GuildWorld.tileKey(end.x, end.y)] = true;
      }
    });
    return avoid;
  }

  function faceTowards(st, point) {
    const dx = point.x - st.sprite.x;
    const dy = point.y - st.sprite.y;
    let dir = st.facing;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? "right" : "left";
    else if (dy !== 0) dir = dy > 0 ? "down" : "up";
    if (dir !== st.facing || !/-walk-/.test(st.sprite.anims.currentAnim
        ? st.sprite.anims.currentAnim.key : "")) {
      st.facing = dir;
      st.sprite.play(st.texKey + "-walk-" + dir, true);
    }
  }

  /** Advance one agent along its route. Called every frame, for everyone. */
  function stepMovement(st, delta) {
    if (!st.route) return;

    let budget = WALK_SPEED * (delta / 1000);
    while (budget > 0 && st.route) {
      const target = st.route[st.routeStep];
      const dx = target.x - st.sprite.x;
      const dy = target.y - st.sprite.y;
      const dist = Math.abs(dx) + Math.abs(dy);   // steps are axis-aligned

      if (dist <= budget) {
        st.sprite.setPosition(target.x, target.y);
        budget -= dist;
        st.routeStep++;
        if (st.routeStep >= st.route.length) {

          st.route = null;
          st.facing = st.destFace || st.facing;
          const cb = st.arriveCb;
          st.arriveCb = null;
          if (cb) cb(); else playStand(st);
          break;
        }
        faceTowards(st, st.route[st.routeStep]);
      } else {
        const k = budget / dist;
        st.sprite.setPosition(st.sprite.x + dx * k, st.sprite.y + dy * k);
        budget = 0;
      }
    }
  }



  const ACTIVITIES = {

    coffee: { group: "coffee", anim: "stand", emote: "mug",  dwell: [5000, 8000] },
    browse: { group: "browse", anim: "read",  emote: "book", dwell: [6000, 10000] },
    chat:   { group: "chat",   anim: "stand", emote: "chat", dwell: [7000, 11000] }
  };

  /** Each role's round, in order. Scouts share one list but start at
      different points in it, so five of them never move as a block. */
  const ROTAS = {
    planner:     ["coffee", "browse", "chat"],
    synthesizer: ["coffee", "browse", "chat"],
    verifier:    ["browse", "coffee", "chat"],
    scout:       ["coffee", "chat", "browse"]
  };

  function rotaFor(agentId) {
    return ROTAS[agentId] || ROTAS.scout;
  }

  function cancelRoutine(st) {
    if (st.routineTimer) { st.routineTimer.remove(); st.routineTimer = null; }
    if (st.activity) {
      st.activity = null;
      GuildWorld.release(st.id);
    }
  }

  /** Stand at your post a while, then go and do the next thing on your list. */
  function scheduleRoutine(st) {
    if (!routineEnabled || !scene) return;
    if (st.routineTimer) { st.routineTimer.remove(); st.routineTimer = null; }
    st.routineTimer = scene.time.delayedCall(rand(IDLE_BEFORE_ROUTINE), function () {
      st.routineTimer = null;
      if (st.state !== "idle" || st.route) { scheduleRoutine(st); return; }
      startNextActivity(st);
    });
  }

  /**
   * Take the next activity off the rota. If its spot is taken (or a chat has
   * nobody to talk to) move down the list rather than waiting: an agent
   * frozen because someone else got the chair reads as a bug.
   */
  function startNextActivity(st) {
    if (!routineEnabled) return;
    const rota = rotaFor(st.id);
    for (let tries = 0; tries < rota.length; tries++) {
      const name = rota[st.rotaIndex % rota.length];
      st.rotaIndex++;
      if (name === "chat" ? beginChat(st) : beginActivity(st, name)) return;
    }
    scheduleRoutine(st);
  }

  function beginActivity(st, name) {
    const act = ACTIVITIES[name];
    const spot = GuildWorld.claim(st.id, act.group, true);
    if (!spot) return false;

    st.activity = name;
    walkTo(st, spot, function () {
      st.sprite.play(animKey(st, act.anim), true);
      showEmote(st, act.emote);
      st.routineTimer = scene.time.delayedCall(rand(act.dwell), function () {
        st.routineTimer = null;
        endActivity(st);
      });
    });
    return true;
  }

  /**
   * Two agents, two facing spots, one conversation.
   *
   * The INITIATOR is following its own rota; the partner is simply whoever
   * happens to be free, so a chat can interrupt an agent whose list does not
   * mention chatting. That is deliberate -- being collared by a colleague is
   * how an office works -- and the partner's own rota position is left
   * untouched, so it carries on where it left off afterwards.
   */
  function beginChat(st) {
    const partner = Object.keys(stations).map(function (id) { return stations[id]; })
      .filter(function (o) {
        return o !== st && o.state === "idle" && !o.activity && !o.route;
      })[0];
    if (!partner) return false;

    const a = GuildWorld.claim(st.id, "chat", true);
    const b = GuildWorld.claim(partner.id, "chat", true);
    if (!a || !b) { GuildWorld.release(st.id); GuildWorld.release(partner.id); return false; }

    const act = ACTIVITIES.chat;
    [[st, a], [partner, b]].forEach(function (pair) {
      const who = pair[0];
      if (who.routineTimer) { who.routineTimer.remove(); who.routineTimer = null; }
      who.activity = "chat";
      walkTo(who, pair[1], function () {
        who.sprite.play(animKey(who, act.anim), true);
        showEmote(who, act.emote);
        who.routineTimer = scene.time.delayedCall(rand(act.dwell), function () {
          who.routineTimer = null;
          endActivity(who);
        });
      });
    });
    return true;
  }

  /** Done loafing: give the spot back and go home. */
  function endActivity(st) {
    st.activity = null;
    GuildWorld.release(st.id);
    showEmote(st, null);
    if (st.state !== "idle") return;
    walkTo(st, GuildWorld.homeZone(st.id), function () {
      playStand(st);
      scheduleRoutine(st);
    });
  }



  /** Pose, emote and flourishes for the state the agent is now in. */
  function applyLook(st) {
    const look = PRESENTATION[st.state] || PRESENTATION.idle;

    scene.tweens.killTweensOf(st.sprite);
    // A hop or shake killed mid-flight leaves the sprite a few pixels off


    const here = st.route ? null : GuildWorld.zone(st.zone);
    if (here) st.sprite.setPosition(here.x, here.y);
    st.sprite.play(animKey(st, look.anim), true);

    if (theme.tintOnFail) {
      if (st.state === "failed") st.sprite.setTint(theme.tintOnFail);
      else st.sprite.clearTint();
    }

    if (st.state === "done") {
      if (!reducedMotion) {
        scene.tweens.add({
          targets: st.sprite, y: st.sprite.y - 5, duration: 150,
          yoyo: true, repeat: 1, ease: "Quad.easeOut"
        });
      }
      st.settleTimer = scene.time.delayedCall(1400, function () {
        if (st.state === "done") playStand(st);
      });
    } else if (st.state === "failed") {
      if (!reducedMotion) {
        scene.tweens.add({
          targets: st.sprite, x: st.sprite.x - 2, duration: 60, yoyo: true, repeat: 3
        });
      }
    } else if (st.state === "typing" && theme.typingBob && !reducedMotion) {


      scene.tweens.add({
        targets: st.sprite, y: st.sprite.y - 1, duration: 110, yoyo: true, repeat: -1
      });
    } else if (st.state === "waiting") {
      // Rate-limited, not crashed. Dimming says "stalled but alive" -- a
      // frozen sprite at full brightness looks like the app hung.
      scene.tweens.add({ targets: st.sprite, alpha: 0.55, duration: 300 });
      return;
    }
    st.sprite.setAlpha(1);
  }

  function setAgentState(agentId, state) {
    // Events can beat the scene's boot; stash and replay in create().
    if (!ready || !scene) {
      pendingStates[agentId] = state;
      return;
    }

    const st = stations[agentId];
    if (!st) return;

    st.state = state;
    cancelRoutine(st);
    if (st.settleTimer) { st.settleTimer.remove(); st.settleTimer = null; }



    showEmote(st, (PRESENTATION[state] || PRESENTATION.idle).emote);


    if (isScout(agentId) && state !== "searching" && state !== "reading") {
      GuildWorld.release(agentId);
    }

    const dest = targetZone(agentId, state);
    if (dest && dest !== st.zone) {
      walkTo(st, dest, function () { applyLook(st); afterSettle(st); });
    } else {
      applyLook(st);
      afterSettle(st);
    }
  }

  function afterSettle(st) {
    if (st.state === "idle") scheduleRoutine(st);
  }

  /** Gather every scout around the break table for a standing discussion. */
  function gatherScouts() {
    if (!ready || !scene) return;
    Object.keys(stations).filter(isScout).sort().forEach(function (id) {
      const st = stations[id];
      const zone = GuildWorld.claim(id, "table", true);
      if (!zone) return;
      cancelRoutine(st);
      st.state = "chatting";
      showEmote(st, "chat");
      walkTo(st, zone, function () {
        applyLook(st);
      });
    });
  }

  function showEmote(st, frame) {
    if (st.emoteTween) { st.emoteTween.stop(); st.emoteTween = null; }
    if (!frame) { st.emote.setVisible(false); return; }

    st.emote.setFrame(frame).setVisible(true);
    st.hover.v = 0;
    followBody(st);


    if (!reducedMotion) {
      st.emoteTween = scene.tweens.add({
        targets: st.hover, v: -3, duration: 620,
        yoyo: true, repeat: -1, ease: "Sine.easeInOut"
      });
    }
  }


  /**
   * Summon `count` scouts (1-5). They appear at the gate and walk to their
   * desks, which is both an entrance and a free explanation of who is who.
   */
  function setPartySize(count) {
    if (!ready || !scene) return;
    const n = Math.max(1, Math.min(count, 5));
    for (let i = 0; i < n; i++) {
      const id = "researcher-" + i;
      if (stations[id]) continue;
      const st = makeStation(scene, id, "gate");
      st.zone = "gate";
      // Staggered so five scouts do not walk out of the gate as one block.
      scene.time.delayedCall(i * 220, function () {
        walkTo(st, GuildWorld.homeZone(id), function () {
          playStand(st);
          scheduleRoutine(st);
        });
      });
    }
  }

  /**
   * A carried handoff: `from` walks to `to`, pauses beside them, walks back.
   * The pause is what sells it -- an agent that turns round the instant it
   * arrives looks like it forgot why it came.
   */
  function handoff(fromId, toId) {
    if (!ready || !scene) return;
    const st = stations[fromId];
    if (!st || st.state === "failed") return;

    const spot = toId === "synthesizer" ? "deliver"
      : toId === "verifier" ? "warden"
      : GuildWorld.homeZone(toId);
    if (!spot) return;

    cancelRoutine(st);
    walkTo(st, spot, function () {
      playStand(st);
      showEmote(st, "check");
      scene.time.delayedCall(900, function () {
        walkTo(st, GuildWorld.homeZone(st.id), function () {
          showEmote(st, (PRESENTATION[st.state] || PRESENTATION.idle).emote);
          applyLook(st);
          afterSettle(st);
        });
      });
    });
  }

  /**
   * The scribe starts a section: it walks to the board to read the outline,
   * then carries it back to its desk and writes. One round trip per section
   * is what keeps the longest, quietest stretch of a deep run watchable.
   */
  function sectionFocus() {
    if (!ready || !scene) return;
    const st = stations.synthesizer;
    if (!st) return;
    cancelRoutine(st);
    walkTo(st, "board", function () {
      playStand(st);
      showEmote(st, "book");
      scene.time.delayedCall(700, function () {
        walkTo(st, GuildWorld.homeZone("synthesizer"), function () {
          showEmote(st, (PRESENTATION[st.state] || PRESENTATION.idle).emote);
          applyLook(st);
        });
      });
    });
  }


  const MAX_ROUNDS = 2;
  let roundsThisRun = 0;

  function inspectScouts() {
    if (!ready || !scene) return;
    const st = stations.planner;
    if (!st || roundsThisRun >= MAX_ROUNDS) return;

    if (st.route || st.activity || ["typing", "thinking"].indexOf(st.state) !== -1) return;

    roundsThisRun++;
    cancelRoutine(st);

    // like a replay of the first.
    const spots = GuildWorld.GROUPS.inspect;
    const spot = spots[(roundsThisRun - 1) % spots.length];

    walkTo(st, spot, function () {
      playStand(st);
      showEmote(st, "search");
      scene.time.delayedCall(2600, function () {
        GuildWorld.release(st.id);
        walkTo(st, GuildWorld.homeZone("planner"), function () {
          showEmote(st, (PRESENTATION[st.state] || PRESENTATION.idle).emote);
          applyLook(st);
          afterSettle(st);
        });
      });
    });
  }

  /** Send one agent to a named zone and leave it there (used by app.js). */
  function moveAgent(agentId, zoneName) {
    if (!ready || !scene) return;
    const st = stations[agentId];
    if (!st) return;
    cancelRoutine(st);
    walkTo(st, zoneName, function () { applyLook(st); afterSettle(st); });
  }

  /** Clear the scouts and put the fixed three back home and idle. */
  function reset() {
    roundsThisRun = 0;
    if (!ready || !scene) { pendingStates = {}; return; }
    Object.keys(stations).forEach(function (id) {
      if (!isScout(id)) return;
      const st = stations[id];
      if (st.emoteTween) st.emoteTween.stop();
      if (st.settleTimer) st.settleTimer.remove();
      cancelRoutine(st);
      [st.sprite, st.plate, st.emote].forEach(function (o) {
        if (o) o.destroy();
      });
      delete stations[id];
    });
    GuildWorld.releaseAll();
    ["planner", "synthesizer", "verifier"].forEach(function (id) {
      const st = stations[id];
      if (!st) return;
      st.state = "idle";
      showEmote(st, null);
      walkTo(st, GuildWorld.homeZone(id), function () {
        applyLook(st);
        scheduleRoutine(st);
      });
    });
  }

  /**
   * Boot Phaser into #stage with the best available theme.
   *
   * app.js calls this after InteriorsArt.load() has settled, so by now we
   * know whether the Modern Interiors files are present.
   */
  function boot() {
    if (game) return game;

    theme = (typeof InteriorsArt !== "undefined" && InteriorsArt.isReady())
      ? InteriorsArt.theme
      : ProceduralTheme;

    if (typeof Phaser === "undefined") {
      const fb = document.getElementById("stage-fallback");
      if (fb) {
        fb.innerHTML = "<p>Could not load Phaser from the CDN.<br>" +
                       "The quest log on the right still works.</p>";
      }
      return null;
    }

    const fallback = document.getElementById("stage-fallback");
    if (fallback) fallback.remove();

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "stage",
      width: W,
      height: H,

      pixelArt: true,
      backgroundColor: "#131a2b",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: GuildScene,
      audio: { noAudio: true }   // sound is Web Audio in sound.js, not Phaser
    });
    return game;
  }

  return {
    boot: boot,
    onAgentClick: function (fn) { clickHandler = fn; },
    setPartySize: setPartySize,
    setAgentState: setAgentState,
    moveAgent: moveAgent,
    handoff: handoff,
    inspectScouts: inspectScouts,
    gatherScouts: gatherScouts,
    sectionFocus: sectionFocus,
    reset: reset,

    /** How many reports are on file; redraws the spines. */
    setArchiveCount: function (n) {
      archiveCount = Math.max(0, n | 0);
      if (ready && scene) redrawArchive(scene);
    },

    /** Clicking the bookcase opens the archive (app.js). */
    onArchiveClick: function (fn) { archiveHandler = fn; },

    /**
     * The scribe carries the finished report to the archive, files it, and
     * comes back. The spine appears at the moment of filing, not when the
     * run ended, so the shelf fills in front of you.
     */
    fileReport: function (onFiled) {
      if (!ready || !scene) { if (onFiled) onFiled(); return; }
      const st = stations.synthesizer;
      if (!st) { if (onFiled) onFiled(); return; }

      cancelRoutine(st);
      walkTo(st, "archive", function () {
        playStand(st);
        showEmote(st, "book");
        scene.time.delayedCall(700, function () {
          archiveCount += 1;
          redrawArchive(scene);
          if (!reducedMotion) {

            archiveCase.setTint(0xffe9b5);
            scene.time.delayedCall(260, function () { archiveCase.clearTint(); });
          }
          if (onFiled) onFiled();
          walkTo(st, GuildWorld.homeZone("synthesizer"), function () {
            showEmote(st, null);
            applyLook(st);
            afterSettle(st);
          });
        });
      });
    },

    /** The glowing scroll on the scribe's desk: a report waiting to be read. */
    setReportReady: function (on) {
      if (!scrollSprite) return;
      scene.tweens.killTweensOf(scrollSprite);
      scrollSprite.setVisible(!!on).setAlpha(1);
      if (on && !reducedMotion) {
        scene.tweens.add({
          targets: scrollSprite, alpha: 0.45, duration: 900,
          yoyo: true, repeat: -1, ease: "Sine.easeInOut"
        });
      }
    },

    shortName: shortName,
    themeName: function () { return theme ? theme.name : null; },
    stateLabel: function (state) {
      return (PRESENTATION[state] || PRESENTATION.idle).label;
    },
    // exposed for the test suite
    _stations: stations,
    _targetZone: targetZone,
    _setRoutine: function (on) { routineEnabled = on && !reducedMotion; },
    _archiveCount: function () { return archiveCount; },
    _scrollVisible: function () { return !!(scrollSprite && scrollSprite.visible); },
    _activityOf: function (id) { return stations[id] ? stations[id].activity : null; }
  };
})();
