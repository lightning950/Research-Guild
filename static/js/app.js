(function () {
  "use strict";


  // Otherwise a page joining a live run could receive the catch-up replay

  const socket = io({ autoConnect: false });

  const $ = function (id) { return document.getElementById(id); };
  const el = {
    form: $("topic-form"), input: $("topic-input"), startBtn: $("start-btn"),
    led: $("led"), model: $("console-model"),
    soundBtn: $("sound-btn"), menuBtn: $("menu-btn"),
    dlgName: $("dialogue-name"), dlgText: $("dialogue-text"), dlgCue: $("dialogue-cue"),
    party: $("party"), log: $("log"), logToggle: $("log-toggle"),
    title: $("title"), titleMenu: $("title-menu"), how: $("how"),
    howList: $("how-list"), examples: $("title-examples"), archiveCount: $("archive-count"),
    banner: $("banner"), bannerReason: $("banner-reason"), bannerHint: $("banner-hint"),
    bannerOk: $("banner-ok"),
    results: $("results"), resultTitle: $("result-title"), resultTopic: $("result-topic"),
    resultStats: $("result-stats"), report: $("report"), download: $("download-link"),
    copyBtn: $("copy-btn"), pdfBtn: $("pdf-btn"), closeBtn: $("close-results"),
    archive: $("archive"), archiveList: $("archive-list"),
    card: $("agent-card"), cardPortrait: $("card-portrait"), cardName: $("card-name"),
    cardRole: $("card-role"), cardBody: $("card-body"),
    modeNormal: $("mode-normal"), modeDeep: $("mode-deep"), countdown: $("countdown"),
    chip: $("report-chip"), chipTopic: $("ready-topic"), chipView: $("ready-view"),
    chipMd: $("ready-md"), chipAgain: $("ready-again")
  };



  const members = new Map();
  const agentLog = new Map();
  let running = false;
  let workspaceReady = false;
  let replaying = false;         // true while catch_up replays: no sound, no typing
  let clockTimer = null;
  let lastReport = "";


  const run = { topic: "", startTs: 0, subQuestions: [], complete: null };

  const WORKSPACE_KEY = "guild.workspace.id";
  const REPORTS_KEY = "guild.workspace.reports";
  let workspaceId = "";
  try {
    workspaceId = sessionStorage.getItem(WORKSPACE_KEY) || "";
    if (!workspaceId) {
      workspaceId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID().replace(/-/g, "")
        : "workspace" + Date.now() + Math.random().toString(36).slice(2);
      sessionStorage.setItem(WORKSPACE_KEY, workspaceId);
    }
  } catch (err) {
    workspaceId = "workspace" + Date.now() + Math.random().toString(36).slice(2);
  }




  //   1. web fonts (3s ceiling, so a slow font CDN never leaves a blank screen)


  //      generated art -- so either way the app boots.
  const fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
  const artReady = (typeof InteriorsArt !== "undefined") ? InteriorsArt.load() : Promise.resolve(false);
  Promise.all([
    Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 3000); })]),
    artReady
  ]).then(function () {
    GuildGame.boot();
    fitStage();
    GuildGame.onAgentClick(openCard);


    GuildGame.onArchiveClick(openArchive);
    buildHowList();
    socket.connect();
  });

  const cabinetEl = document.querySelector(".cabinet");
  const consoleEl = document.querySelector(".console");
  const screenEl = document.querySelector(".screen");
  const stageEl = document.getElementById("stage");

  function fitStage() {
    if (!cabinetEl || !consoleEl || !screenEl || !stageEl) return;

    if (window.matchMedia("(max-width: 860px)").matches) {
      stageEl.style.width = "";
      return;
    }




    const cab = getComputedStyle(cabinetEl);
    const innerW = cabinetEl.clientWidth -
      parseFloat(cab.paddingLeft) - parseFloat(cab.paddingRight);
    const innerH = cabinetEl.clientHeight -
      parseFloat(cab.paddingTop) - parseFloat(cab.paddingBottom);

    const dock = document.querySelector(".side");
    const gap = parseFloat(cab.columnGap) || 0;

    const prevMax = consoleEl.style.maxHeight;
    const prevW = stageEl.style.width;




    consoleEl.style.maxHeight = "none";





    stageEl.style.width = innerW + "px";
    const sideChrome = consoleEl.offsetWidth - stageEl.offsetWidth;
    const availW = innerW - (dock ? dock.offsetWidth : 0) - gap - sideChrome - 2;


    stageEl.style.width = Math.max(240, availW) + "px";
    const chrome = consoleEl.offsetHeight - stageEl.offsetHeight;
    consoleEl.style.maxHeight = prevMax;

    const availH = innerH - chrome - 2;





    const w = Math.max(240, Math.floor(Math.min(availH * 16 / 9, availW)));
    stageEl.style.width = w + "px";
    if (prevW === stageEl.style.width) return;

    // The box just changed under Phaser; ask it to measure again.
    if (typeof GuildGame !== "undefined" && GuildGame.refit) GuildGame.refit();
  }

  window.addEventListener("resize", fitStage);
  if (window.ResizeObserver) {






    new ResizeObserver(fitStage).observe(cabinetEl);
  }


  fitStage();
  window.addEventListener("load", fitStage);



  const MODE_KEY = "guild.mode";


  let mode = "normal";
  try {
    if (window.localStorage && localStorage.getItem(MODE_KEY) === "deep") mode = "deep";
  } catch (err) {  }

  function setMode(next) {
    mode = next === "deep" ? "deep" : "normal";
    const deep = mode === "deep";
    el.modeDeep.classList.toggle("is-on", deep);
    el.modeNormal.classList.toggle("is-on", !deep);
    el.modeDeep.setAttribute("aria-pressed", String(deep));
    el.modeNormal.setAttribute("aria-pressed", String(!deep));
    el.input.placeholder = deep
      ? "Go Beyond The Surface..."
      : "Set Your Sights On Something...";
    try {
      if (window.localStorage) localStorage.setItem(MODE_KEY, mode);
    } catch (err) {  }
  }



  el.modeNormal.addEventListener("click", function () { setMode("normal"); });
  el.modeDeep.addEventListener("click", function () { setMode("deep"); });
  setMode(mode);


  let questClock = null;

  function stopClock() {
    if (questClock) { clearInterval(questClock); questClock = null; }
    el.countdown.hidden = true;
    el.countdown.classList.remove("is-late");
  }

  function startClock(deadlineSecs) {
    stopClock();
    const began = Date.now();
    el.countdown.hidden = false;
    const tick = function () {
      const gone = Math.floor((Date.now() - began) / 1000);
      if (deadlineSecs) {
        const left = deadlineSecs - gone;
        el.countdown.classList.toggle("is-late", left < 0);
        const n = Math.abs(left);
        el.countdown.textContent = (left < 0 ? "+" : "") +
          Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
      } else {
        el.countdown.textContent =
          Math.floor(gone / 60) + ":" + String(gone % 60).padStart(2, "0");
      }
    };
    tick();
    questClock = setInterval(tick, 1000);
  }


  function showChip(data) {
    if (!data) return;
    el.chipTopic.textContent = data.topic || "";
    setMarkdownDownload(el.chipMd, data);
    el.chipMd.setAttribute("download", data.report_filename || "report.md");
    el.chip.hidden = false;
  }

  function hideChip() { el.chip.hidden = true; }

  el.chipView.addEventListener("click", function () {
    if (run.complete) showResults(run.complete, "live");
  });

  /**
   * Clear the desk for a fresh quest.
   *
   * Everything a finished run left lying about goes: the log, the party
   * list, the topic still sitting in the box. What does NOT go is the hall
   * -- the agents live here, so they stay at their desks rather than
   * blinking out of existence. Nor is anything lost: the report was filed
   * in the archive as it finished, and the message says so.
   */
  function startOver() {
    members.clear();
    agentLog.clear();
    el.party.innerHTML = "";
    el.log.innerHTML = "";
    el.input.value = "";
    run.subQuestions = [];
    run.complete = null;
    hideChip();
    GuildGame.setReportReady(false);
    el.banner.hidden = true;
    if (!el.results.hidden) closeOverlay(el.results);
    say("GUILD", "Filed in the archive. Name your next subject, Archivist.", true);
    el.input.focus();
  }

  el.chipAgain.addEventListener("click", startOver);

  /** A portrait from whichever art is actually in use, so the party panel
      always shows the same characters as the room. */
  function portrait(agentId, scale) {
    return (typeof InteriorsArt !== "undefined" && InteriorsArt.isReady())
      ? InteriorsArt.portrait(agentId, scale)
      : PixelArt.portrait(agentId, scale);
  }

  // Browsers only allow audio after a user gesture. Unlock on the very first

  function unlockAudioOnce() {
    Sound.unlock();
    document.removeEventListener("pointerdown", unlockAudioOnce);
    document.removeEventListener("keydown", unlockAudioOnce);
  }
  document.addEventListener("pointerdown", unlockAudioOnce);
  document.addEventListener("keydown", unlockAudioOnce);

  function sfx(name) { if (!replaying) Sound.play(name); }



  const ROLES = {
    planner: {
      title: "The Planner",
      blurb: "Reads your topic and splits it into 2 to 5 focused sub-questions, " +
             "sized to how broad the subject is."
    },
    researcher: {
      title: "Scout",
      blurb: "Takes one sub-question, searches the web, reads up to five sources " +
             "and writes a 150-200 word summary using only what it read."
    },
    synthesizer: {
      title: "The Scribe",
      blurb: "Merges every scout's notes into one structured report, resolving " +
             "overlaps and flagging contradictions."
    },
    verifier: {
      title: "The Warden",
      blurb: "Fact-checks the finished report against the scouts' notes and " +
             "flags anything unsupported or added from outside."
    }
  };

  function roleOf(agentId) {
    return /^researcher-/.test(agentId) ? ROLES.researcher : (ROLES[agentId] || ROLES.planner);
  }

  function researcherIndex(agentId) {
    const m = /^researcher-(\d+)$/.exec(agentId);
    return m ? Number(m[1]) : -1;
  }



  const DWELL_MS = 1100;
  let typeTimer = null;
  let typing = false;
  let finishedAt = 0;
  let pending = null;
  let pendingTimer = null;

  function say(speaker, text, priority) {
    if (priority || replaying) {
      pending = null;
      show(speaker, text, !!priority);
      return;
    }
    const idleFor = performance.now() - finishedAt;
    if (!typing && idleFor >= DWELL_MS) {
      show(speaker, text, false);
    } else {
      pending = { speaker: speaker, text: text };
      schedulePending();
    }
  }

  function schedulePending() {
    if (pendingTimer || typing) return;
    const wait = Math.max(0, DWELL_MS - (performance.now() - finishedAt));
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      if (pending && !typing) {
        const p = pending;
        pending = null;
        show(p.speaker, p.text, false);
      }
    }, wait);
  }

  function show(speaker, text, withBlips) {
    el.dlgName.textContent = speaker;
    if (typeTimer) clearInterval(typeTimer);
    el.dlgCue.hidden = true;

    // During a catch-up replay, show lines instantly -- typing out forty

    if (replaying) {
      el.dlgText.textContent = text;
      typing = false;
      finishedAt = performance.now();
      el.dlgCue.hidden = false;
      return;
    }

    typing = true;
    el.dlgText.textContent = "";
    const step = text.length > 70 ? 10 : 18;
    let i = 0;
    typeTimer = setInterval(function () {
      i += 1;
      el.dlgText.textContent = text.slice(0, i);


      if (withBlips && i % 2 === 0 && text[i - 1] !== " ") sfx("blip");
      if (i >= text.length) {
        clearInterval(typeTimer);
        typeTimer = null;
        typing = false;
        finishedAt = performance.now();
        el.dlgCue.hidden = false;
        if (pending) schedulePending();
      }
    }, step);
  }



  /**
   * Create (or fetch) one party row. Rows are <button>s so they are
   * reachable by keyboard and announced as clickable -- a div with a click
   * handler is invisible to anyone not using a mouse.
   */
  function member(agentId) {
    if (members.has(agentId)) return members.get(agentId);

    const empty = el.party.querySelector(".panel__empty");
    if (empty) empty.remove();

    const row = document.createElement("button");
    row.type = "button";
    row.className = "member";
    row.dataset.state = "idle";
    row.dataset.agent = agentId;

    const chip = document.createElement("span");
    chip.className = "member__chip";
    // Cropped from the same generated spritesheet the game uses, so the

    chip.style.backgroundImage = "url(" + portrait(agentId, 2) + ")";

    const body = document.createElement("span");
    body.className = "member__body";

    const name = document.createElement("span");
    name.className = "member__name";
    name.textContent = GuildGame.shortName(agentId);

    const state = document.createElement("span");
    state.className = "member__state";
    state.textContent = "waiting to start";

    const meter = document.createElement("span");
    meter.className = "member__meter";
    const fill = document.createElement("span");
    fill.className = "member__fill";
    meter.appendChild(fill);

    body.append(name, state, meter);
    row.append(chip, body);
    row.addEventListener("click", function () { openCard(agentId); });
    el.party.appendChild(row);

    const rec = { row: row, stateEl: state, fillEl: fill };
    members.set(agentId, rec);
    return rec;
  }

  function updateMember(event) {
    const rec = member(event.agent);
    rec.row.dataset.state = event.state;
    rec.stateEl.textContent = event.message || GuildGame.stateLabel(event.state);
    rec.fillEl.style.width = progressPercent(event) + "%";
  }

  /** Progress for a meter, from the backend's structured numbers. */
  function progressPercent(event) {
    if (event.state === "done") return 100;
    if (typeof event.done === "number" && event.total > 0) {
      return Math.round((event.done / event.total) * 100);
    }
    if (event.state === "searching") return 8;
    if (event.state === "typing") return 85;
    return 0;
  }



  function logLine(event, who, what, kind) {
    const nearBottom = el.log.scrollTop + el.log.clientHeight >= el.log.scrollHeight - 40;

    const line = document.createElement("div");
    line.className = "log-line " + (kind || "");

    const stamp = document.createElement("span");
    stamp.className = "time";
    stamp.textContent = clock(event.ts) + " ";

    const whoEl = document.createElement("span");
    whoEl.className = "who";
    whoEl.textContent = who ? who + ": " : "";

    const whatEl = document.createElement("span");
    whatEl.className = "what";


    whatEl.textContent = what;

    line.append(stamp, whoEl, whatEl);
    el.log.appendChild(line);

    if (nearBottom) el.log.scrollTop = el.log.scrollHeight;
  }

  function clock(ts) {
    const d = new Date((ts || Date.now() / 1000) * 1000);
    return d.toLocaleTimeString([], { hour12: false });
  }

  function setLogOpen(open) {
    el.log.hidden = !open;
    el.logToggle.textContent = open ? "HIDE" : "SHOW";
    el.logToggle.setAttribute("aria-expanded", String(open));
  }
  el.logToggle.addEventListener("click", function () { setLogOpen(el.log.hidden); });



  if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
    setLogOpen(false);
  }



  const overlayStack = [];

  function openOverlay(node) {
    if (overlayStack.some(function (o) { return o.node === node; })) return;
    overlayStack.push({ node: node, returnFocus: document.activeElement });
    node.style.zIndex = String(100 + overlayStack.length);
    node.hidden = false;
    document.body.classList.add("has-overlay");
    const focusable = node.querySelector("button, a[href]");
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function closeOverlay(node) {
    const i = overlayStack.findIndex(function (o) { return o.node === node; });
    if (i === -1) return;
    const entry = overlayStack.splice(i, 1)[0];
    node.hidden = true;
    if (!overlayStack.length) document.body.classList.remove("has-overlay");
    if (entry.returnFocus && document.contains(entry.returnFocus)) {
      entry.returnFocus.focus({ preventScroll: true });
    }
    if (node === el.card) cardAgent = null;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (overlayStack.length) {
      closeOverlay(overlayStack[overlayStack.length - 1].node);
    } else if (!el.banner.hidden) {
      hideBanner();
    }
  });


  [el.results, el.archive, el.card, el.how].forEach(function (node) {
    node.addEventListener("click", function (e) {
      if (e.target === node) closeOverlay(node);
    });
  });

  document.querySelectorAll("[data-close]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeOverlay($(btn.dataset.close)); });
  });



  const EXAMPLES = [
    "why did RAM prices suddenly increase",
    "is intermittent fasting effective",
    "how do noise-cancelling headphones work"
  ];

  EXAMPLES.forEach(function (topic) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "example";
    b.textContent = topic;
    b.addEventListener("click", function () {
      sfx("confirm");
      el.input.value = topic;
      hideTitle();
      el.input.focus();
    });
    el.examples.appendChild(b);
  });



  function buildHowList() {
  el.howList.innerHTML = "";
  [["planner", ROLES.planner], ["researcher-0", ROLES.researcher],
   ["synthesizer", ROLES.synthesizer], ["verifier", ROLES.verifier]].forEach(function (pair) {
    const li = document.createElement("li");
    li.className = "how__item";
    const img = document.createElement("img");
    img.className = "how__portrait";
    img.alt = "";
    img.src = portrait(pair[0], 3);
    const text = document.createElement("div");
    const t = document.createElement("strong");
    t.textContent = pair[1].title + (pair[0] === "researcher-0" ? "s (2-5, in parallel)" : "");
    const p = document.createElement("span");
    p.textContent = pair[1].blurb;
    text.append(t, p);
    li.append(img, text);
    el.howList.appendChild(li);
  });
  }

  function menuItems() {
    return Array.prototype.slice.call(el.titleMenu.querySelectorAll(".menu__item"));
  }

  function setActive(item) {
    menuItems().forEach(function (m) { m.classList.toggle("is-active", m === item); });
  }

  function showTitle() {
    if (running) return;
    el.title.hidden = false;
    const first = menuItems()[0];
    setActive(first);
    first.focus({ preventScroll: true });
  }

  function hideTitle() { el.title.hidden = true; }

  el.title.addEventListener("click", function (e) {
    const item = e.target.closest(".menu__item");
    if (!item) return;
    const action = item.dataset.action;
    sfx("confirm");
    if (action === "new") {
      hideTitle();
      el.input.focus();
    } else if (action === "archive") {
      openArchive();
    } else if (action === "how") {
      openOverlay(el.how);
    }
  });

  el.title.addEventListener("focusin", function (e) {
    const item = e.target.closest(".menu__item");
    if (item) setActive(item);
  });


  el.title.addEventListener("pointerover", function (e) {
    const item = e.target.closest(".menu__item");
    if (item && !item.classList.contains("is-active")) { setActive(item); sfx("select"); }
  });


  el.title.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = menuItems();
    const cur = items.findIndex(function (m) { return m.classList.contains("is-active"); });
    const next = items[(cur + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    setActive(next);
    next.focus({ preventScroll: true });
    sfx("select");
  });

  el.menuBtn.addEventListener("click", function () { sfx("confirm"); showTitle(); });



  function paintSoundBtn() {
    const on = Sound.isEnabled();
    el.soundBtn.textContent = on ? "SND ON" : "SND OFF";
    el.soundBtn.setAttribute("aria-pressed", String(on));
  }
  el.soundBtn.addEventListener("click", function () { Sound.toggle(); paintSoundBtn(); });
  paintSoundBtn();



  /** The count feeds two things: the menu badge and the bookcase's spines. */
  function refreshArchiveCount() {
    const list = localReports();
    el.archiveCount.textContent = list.length ? "(" + list.length + ")" : "";
    GuildGame.setArchiveCount(list.length);
  }
  refreshArchiveCount();

  function openArchive() {
    el.archiveList.innerHTML = "";
    openOverlay(el.archive);

    const list = localReports();
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "sheet-sub";
      empty.textContent = "The archive is empty. Complete a quest to fill it.";
      el.archiveList.appendChild(empty);
      return;
    }
    list.forEach(function (entry) { el.archiveList.appendChild(archiveRow(entry)); });
    const first = el.archiveList.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }

  function localReports() {
    try {
      const saved = localStorage.getItem(REPORTS_KEY + "." + workspaceId);
      const list = saved ? JSON.parse(saved) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function saveLocalReport(data) {
    const entry = {
      filename: data.report_filename || ("report-" + Date.now() + ".md"),
      topic: data.topic || "",
      modified: Date.now() / 1000,
      words: (data.report || "").trim().split(/\s+/).filter(Boolean).length,
      has_trace: Array.isArray(data.trace) && data.trace.length > 0,
      mode: data.mode || mode,
      data: data
    };
    try {
      const list = localReports().filter(function (item) {
        return item.filename !== entry.filename;
      });
      list.unshift(entry);
      localStorage.setItem(REPORTS_KEY + "." + workspaceId, JSON.stringify(list.slice(0, 25)));
    } catch (err) {
      say("GUILD", "The report is complete, but this browser could not save its archive.", true);
    }
    refreshArchiveCount();
  }

  function archiveRow(entry) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "archive-row";

    const topic = document.createElement("span");
    topic.className = "archive-row__topic";
    topic.textContent = entry.topic;

    const meta = document.createElement("span");
    meta.className = "archive-row__meta";
    const d = new Date(entry.modified * 1000);
    meta.textContent =
      d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
      "  ·  " + entry.words.toLocaleString() + " words" +
      (entry.has_trace ? "" : "  ·  no trace");

    b.append(topic, meta);
    b.addEventListener("click", function () {
      sfx("confirm");
      meta.textContent = "Opening...";
      if (entry.data) showResults(entry.data, "archive");
      else meta.textContent = "Could not open this report.";
    });
    return b;
  }



  let cardAgent = null;

  function openCard(agentId) {
    sfx("select");
    cardAgent = agentId;
    renderCard();
    openOverlay(el.card);
  }

  /** Small DOM helper: element with a class and optional text. */
  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function section(label) {
    const s = node("section", "card__section");
    s.appendChild(node("h3", "card__label", label));
    return s;
  }

  function renderCard() {
    if (!cardAgent) return;
    const id = cardAgent;
    const role = roleOf(id);
    const events = agentLog.get(id) || [];
    const last = events[events.length - 1];
    const idx = researcherIndex(id);

    el.cardPortrait.src = portrait(id, 4);
    el.cardName.textContent = GuildGame.shortName(id);
    el.cardRole.textContent = role.title;

    const body = el.cardBody;
    body.innerHTML = "";
    body.appendChild(node("p", "card__blurb", role.blurb));


    const status = section("STATUS");
    const line = node("div", "card__status");
    const chipEl = node("span", "state-chip", last ? GuildGame.stateLabel(last.state) : "idle");
    chipEl.dataset.state = last ? last.state : "idle";
    line.append(chipEl, node("span", "card__status-text", last ? last.message : "Has not started yet."));
    status.appendChild(line);
    if (last && (idx >= 0 || id === "synthesizer")) {
      const meter = node("div", "member__meter card__meter");
      const fill = node("div", "member__fill");
      fill.style.width = progressPercent(last) + "%";
      meter.dataset.state = last.state;
      meter.appendChild(fill);
      status.appendChild(meter);
    }
    body.appendChild(status);


    if (idx >= 0 && run.subQuestions[idx]) {
      const q = section("LINE OF INQUIRY");
      q.appendChild(node("p", "card__question", run.subQuestions[idx]));
      body.appendChild(q);
      body.appendChild(sourcesSection(id, idx, events));
    }


    if (id === "planner" && run.subQuestions.length) {
      const plan = section("THE PLAN");
      const ol = node("ol", "card__plan");
      run.subQuestions.forEach(function (sq) { ol.appendChild(node("li", "", sq)); });
      plan.appendChild(ol);
      body.appendChild(plan);
    }


    if (id === "synthesizer" && run.complete) {
      const out = section("OUTPUT");
      const words = (run.complete.report || "").trim().split(/\s+/).length;
      out.appendChild(node("p", "card__question", "A " + words.toLocaleString() + "-word report."));
      const read = node("button", "btn btn--small btn--go", "READ THE REPORT");
      read.type = "button";
      read.addEventListener("click", function () {
        closeOverlay(el.card);
        showResults(run.complete, "live");
      });
      out.appendChild(read);
      body.appendChild(out);
    }


    if (id === "verifier" && run.complete && run.complete.verification_note) {
      const v = section("VERDICT");
      v.appendChild(node("blockquote", "card__verdict", run.complete.verification_note));
      body.appendChild(v);
    }


    const act = section("ACTIVITY");
    if (!events.length) {
      act.appendChild(node("p", "card__muted", "Nothing yet."));
    } else {
      const ol = node("ol", "timeline");
      events.forEach(function (ev) {
        const li = node("li", "timeline__item");
        li.dataset.state = ev.state;
        const offset = run.startTs ? Math.max(0, Math.round(ev.ts - run.startTs)) : 0;
        li.append(node("span", "timeline__t", "+" + offset + "s"),
                  node("span", "timeline__m", ev.message || ev.state));
        ol.appendChild(li);
      });
      act.appendChild(ol);
    }
    body.appendChild(act);
  }

  /**
   * Sources for one scout. While running we only know the domains it has
   * opened; once the run completes, the trace names the full URLs it actually
   * used, so the list upgrades to real links and marks what was unusable.
   */
  function sourcesSection(id, idx, events) {
    const sec = section("SOURCES");
    const opened = [];
    events.forEach(function (ev) {
      if (ev.state === "reading" && ev.url && opened.indexOf(ev.url) === -1) opened.push(ev.url);
    });

    const traced = run.complete && (run.complete.trace || []).find(function (t) {
      return t.step === "research" && t.question === run.subQuestions[idx];
    });

    const ul = node("ul", "sources");
    if (traced) {
      const used = traced.sources_found || [];
      used.forEach(function (url) {
        const li = node("li", "sources__item is-used");
        const a = node("a", "", url.replace(/^https?:\/\/(www\.)?/, ""));
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        li.append(node("span", "sources__mark", "✓"), a);
        ul.appendChild(li);
      });
      opened.forEach(function (domain) {
        const wasUsed = used.some(function (u) { return u.indexOf(domain) !== -1; });
        if (wasUsed) return;
        const li = node("li", "sources__item is-skipped");
        li.append(node("span", "sources__mark", "–"),
                  node("span", "", domain + " (unreadable or blocked)"));
        ul.appendChild(li);
      });
    } else {
      opened.forEach(function (domain, i) {
        const isCurrent = i === opened.length - 1 &&
          events.length && events[events.length - 1].state === "reading";
        const li = node("li", "sources__item" + (isCurrent ? " is-current" : ""));
        li.append(node("span", "sources__mark", isCurrent ? "▸" : "·"),
                  node("span", "", domain));
        ul.appendChild(li);
      });
    }

    if (!ul.children.length) {
      sec.appendChild(node("p", "card__muted", "No sources opened yet."));
    } else {
      sec.appendChild(ul);
    }
    return sec;
  }



  /** A plain-English next step for the errors this pipeline actually hits. */
  function hintFor(error) {
    const e = String(error || "").toLowerCase();
    if (/rate|429|quota|limit|groq api failed/.test(e)) {
      return "The free-tier API is probably rate-limiting. Wait a minute, then try again.";
    }
    if (/usable content/.test(e)) {
      return "No readable sources turned up. Try phrasing the topic more broadly.";
    }
    if (/search|recognizable|research question|starting point/.test(e)) {
      return "No model call was made. Try a clear, searchable topic so the guild can find reliable sources.";
    }
    if (/api[_ ]?key|unauthori[sz]ed|401|403/.test(e)) {
      return "An API key looks wrong. Check the keys in your .env file.";
    }
    return "The terminal running app.py has the full error.";
  }

  function showBanner(error) {
    el.bannerReason.textContent = error;
    el.bannerHint.textContent = hintFor(error);
    el.banner.hidden = false;
    el.bannerOk.focus({ preventScroll: true });
  }

  function hideBanner() { el.banner.hidden = true; el.input.focus({ preventScroll: true }); }
  el.bannerOk.addEventListener("click", hideBanner);



  function setRunning(on) {
    el.modeNormal.disabled = on;
    el.modeDeep.disabled = on;
    running = on;
    el.startBtn.disabled = on;
    el.input.disabled = on;
    el.menuBtn.disabled = on;
    el.startBtn.querySelector("span").textContent = on ? "WORKING" : "START";
    el.led.classList.toggle("on", on);
    el.model.classList.toggle("is-live", on);

    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    if (on) {
      const started = Date.now();
      // A 90-second wait with no clock feels broken; with a clock it feels

      clockTimer = setInterval(function () {
        const s = Math.floor((Date.now() - started) / 1000);
        el.model.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      }, 500);
    }
  }

  function resetRun(event) {
    members.clear();
    agentLog.clear();
    el.party.innerHTML = "";
    el.log.innerHTML = "";
    run.topic = event.topic || "";
    run.startTs = event.ts || Date.now() / 1000;
    run.subQuestions = [];
    run.complete = null;
    if (el.card && !el.card.hidden) closeOverlay(el.card);
    if (!el.results.hidden) closeOverlay(el.results);
    el.banner.hidden = true;
    hideTitle();
    GuildGame.reset();
  }



  function handleEvent(event) {
    switch (event.type) {

      case "run_started":
        resetRun(event);
        hideChip();
        GuildGame.setReportReady(false);
        GuildGame.endGathering();

        // send none, and get a plain elapsed clock.
        startClock(event.deadline || 0);
        say("GUILD", 'A new quest: "' + event.topic + '". The planner begins.', true);
        logLine(event, null, 'Quest accepted: "' + event.topic + '"', "system");
        member("planner");
        break;

      case "plan_ready": {
        const qs = event.sub_questions || [];
        run.subQuestions = qs.slice();


        GuildGame.setPartySize(qs.length);
        qs.forEach(function (q, i) {
          member("researcher-" + i);
          logLine(event, GuildGame.shortName("researcher-" + i), q);
        });
        member("synthesizer");
        member("verifier");
        sfx("summon");
        say("PLANNER", qs.length + " scouts will investigate in parallel.", true);
        logLine(event, null, "Plan ready: " + qs.length + " lines of inquiry.", "system");


        setTimeout(function () { GuildGame.inspectScouts(); }, 18000);
        break;
      }

      case "agent_state": {
        const history = agentLog.get(event.agent) || [];
        history.push(event);
        agentLog.set(event.agent, history);

        GuildGame.setAgentState(event.agent, event.state);
        updateMember(event);


        if (event.state === "done" && researcherIndex(event.agent) >= 0) {
          setTimeout(function () { GuildGame.inspectScouts(); }, 2500);
        }

        if (event.state === "done") sfx("done");
        else if (event.state === "failed") sfx("fail");
        else if (event.state === "waiting") sfx("wait");

        if (event.message) {

          const routine = researcherIndex(event.agent) >= 0 &&
            ["searching", "reading", "typing"].indexOf(event.state) !== -1;
          say(GuildGame.shortName(event.agent), event.message, !routine);
          logLine(event, GuildGame.shortName(event.agent), event.message, event.state);
        }
        break;
      }

      case "run_complete":
        run.complete = event;
        stopClock();
        saveLocalReport(event);
        showChip(event);
        sfx("fanfare");
        say("GUILD", "The report is complete and sealed.", true);
        logLine(event, null, "Report saved as " + event.report_filename, "done");


        GuildGame.setReportReady(true);
        GuildGame.fileReport(function () { refreshArchiveCount(); });


        setTimeout(function () { GuildGame.gatherScouts(); }, 2500);
        showResults(event, "live");
        break;

      case "run_failed":
        stopClock();
        sfx("fail");
        say("GUILD", "The quest has failed.", true);
        logLine(event, null, "FAILED: " + event.error, "failed");
        showBanner(event.error);
        break;



      case "phase":
        logLine(event, null, event.message || event.phase, "system");
        break;

      case "handoff":

        GuildGame.handoff(event.from_agent, event.to_agent);
        logLine(event, GuildGame.shortName(event.from_agent),
          "Hands findings to " + GuildGame.shortName(event.to_agent) + ".");
        break;

      case "round2": {
        const who = (event.assignments || []).map(function (a) {
          return GuildGame.shortName(a.agent || a);
        });
        say("PLANNER", "Gaps remain. " + (who.length || "No") +
          " scouts go back out.", true);
        logLine(event, null, "Second round: " + (who.join(", ") || "none"),
          "system");
        break;
      }

      case "section":


        if (event.status === "started") GuildGame.sectionFocus();
        logLine(event, "SCRIBE",
          (event.status === "done" ? "Finished section " : "Writing section ") +
          ((event.index || 0) + 1) + (event.total ? "/" + event.total : "") +
          ': "' + (event.title || "") + '"',
          event.status === "done" ? "done" : "typing");
        break;

      default:


        break;
    }


    if (cardAgent && !el.card.hidden &&
        (event.agent === cardAgent || event.type === "plan_ready" || event.type === "run_complete")) {
      renderCard();
    }
  }



  function statPill(key, value) {
    const d = node("div", "stat");
    d.append(node("span", "stat__k", key), node("span", "stat__v", value));
    return d;
  }

  function dash(v) { return v === null || v === undefined ? "—" : String(v); }

  function setMarkdownDownload(anchor, data) {
    const blob = new Blob([data.report || ""], { type: "text/markdown;charset=utf-8" });
    anchor.href = URL.createObjectURL(blob);
  }

  function showResults(data, mode) {
    lastReport = data.report || "";
    const live = mode === "live";

    el.resultTitle.textContent = live ? "QUEST COMPLETE" : "FROM THE ARCHIVE";
    el.resultTopic.textContent = data.topic || "";

    let time = "—";
    if (live && run.complete && run.startTs) {
      const secs = Math.max(1, Math.round(run.complete.ts - run.startTs));
      time = Math.floor(secs / 60) + "m " + (secs % 60) + "s";
    }

    const q = (data.sub_questions_used === null || data.sub_questions_used === undefined)
      ? "—" : data.sub_questions_used + "/" + data.sub_questions_total;

    el.resultStats.innerHTML = "";
    el.resultStats.append(
      statPill("QUESTIONS", q),
      statPill("SOURCES", dash(data.sources_total)),
      statPill("TIME", time),
      statPill("WORDS", lastReport.trim().split(/\s+/).length.toLocaleString())
    );

    renderReport(lastReport);

    setMarkdownDownload(el.download, data);
    el.download.setAttribute("download", data.report_filename);

    openOverlay(el.results);
    el.results.scrollTop = 0;
    el.report.scrollTop = 0;
  }

  el.closeBtn.addEventListener("click", function () { closeOverlay(el.results); });

  el.copyBtn.addEventListener("click", function () {
    const flash = function (t) {
      el.copyBtn.textContent = t;
      setTimeout(function () { el.copyBtn.textContent = "COPY"; }, 1500);
    };
    if (!navigator.clipboard) { flash("NO CLIPBOARD"); return; }
    navigator.clipboard.writeText(lastReport).then(function () { flash("COPIED"); },
                                                   function () { flash("FAILED"); });
  });

  el.pdfBtn.addEventListener("click", function () {
    window.print();
  });



  function extractMath(md) {
    const blocks = [];

    let out = md.replace(/\\\[([\s\S]*?)\\\]/g, function (_, tex) {
      blocks.push({ tex: tex, display: true });
      return "@@MATH" + (blocks.length - 1) + "@@";
    });
    out = out.replace(/\$\$([\s\S]*?)\$\$/g, function (_, tex) {
      blocks.push({ tex: tex, display: true });
      return "@@MATH" + (blocks.length - 1) + "@@";
    });
    out = out.replace(/\\\(([\s\S]*?)\\\)/g, function (_, tex) {
      blocks.push({ tex: tex, display: false });
      return "@@MATH" + (blocks.length - 1) + "@@";
    });
    return { md: out, blocks: blocks };
  }

  /** Swap the @@MATHn@@ placeholders for rendered formulas. */
  function restoreMath(root, blocks) {
    if (!blocks.length) return;
    const hasKatex = typeof window.katex !== "undefined";


    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      if (/@@MATH\d+@@/.test(walker.currentNode.nodeValue)) hits.push(walker.currentNode);
    }

    hits.forEach(function (node) {
      const frag = document.createDocumentFragment();
      const parts = node.nodeValue.split(/(@@MATH\d+@@)/);
      parts.forEach(function (part) {
        const m = /^@@MATH(\d+)@@$/.exec(part);
        if (!m) {
          if (part) frag.appendChild(document.createTextNode(part));
          return;
        }
        const b = blocks[Number(m[1])];
        const span = document.createElement(b.display ? "div" : "span");
        if (hasKatex) {
          try {
            // katex.renderToString output is generated by the library, not
            // by the model, so assigning it as HTML is safe.
            span.innerHTML = window.katex.renderToString(b.tex.trim(), {
              displayMode: b.display,
              throwOnError: false
            });
          } catch (err) {
            span.textContent = b.tex.trim();
          }
        } else {

          // backslash noise if the KaTeX CDN is unreachable.
          const code = document.createElement("code");
          code.textContent = b.tex.trim();
          span.appendChild(code);
        }
        frag.appendChild(span);
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  function renderReport(markdown) {
    el.report.innerHTML = "";

    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      // Last-resort fallback: at least keep the whitespace intact.
      const pre = document.createElement("pre");
      pre.textContent = markdown;
      el.report.appendChild(pre);
      return;
    }

    const math = extractMath(markdown);

    const rawHtml = marked.parse(math.md, {
      gfm: true,
      breaks: false
    });

    // Sanitise before insertion. Non-negotiable: this is LLM output built

    el.report.innerHTML = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "del", "code",
        "pre", "blockquote", "ul", "ol", "li", "a", "hr", "br",
        "table", "thead", "tbody", "tr", "th", "td", "sup", "sub", "span", "div"
      ],
      ALLOWED_ATTR: ["href", "title", "align", "colspan", "rowspan"]
    });

    restoreMath(el.report, math.blocks);




    el.report.querySelectorAll("table").forEach(function (t) {
      const wrap = document.createElement("div");
      wrap.className = "doc__table-wrap";
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });


    el.report.querySelectorAll("a[href]").forEach(function (a) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });




    const paras = el.report.querySelectorAll("p");
    for (let i = paras.length - 1; i >= 0; i--) {
      if (/verification note/i.test(paras[i].textContent)) {
        paras[i].classList.add("verify");
        const hr = paras[i].previousElementSibling;
        if (hr && hr.tagName === "HR") hr.remove();
        break;
      }
    }
  }



  socket.on("pipeline_event", handleEvent);

  socket.on("connect", function () {
    socket.emit("join_workspace", { workspace_id: workspaceId });
  });

  socket.on("workspace_ready", function () {
    workspaceReady = true;
  });

  socket.on("workspace_rejected", function (data) {
    workspaceReady = false;
    say("GUILD", data.reason || "Could not open this workspace.", true);
  });

  socket.on("catch_up", function (data) {
    // A page that connects mid-run replays what it missed, so refreshing
    // does not leave you staring at an empty room. Replayed events are

    setRunning(true);
    replaying = true;
    (data.events || []).forEach(handleEvent);
    replaying = false;
  });

  socket.on("run_rejected", function (data) {
    setRunning(false);
    say("GUILD", data.reason, true);
  });

  socket.on("run_finished", function () { setRunning(false); });

  socket.on("disconnect", function () {
    workspaceReady = false;
    setRunning(false);
    say("GUILD", "Lost contact with the server. Is app.py still running?", true);
  });

  socket.on("connect_error", function () {
    say("GUILD", "Cannot reach the server.", true);
  });



  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    const topic = el.input.value.trim();
    if (!topic || running) return;
    if (!workspaceReady) {
      say("GUILD", "The guild is still connecting. Try again in a moment.", true);
      return;
    }
    sfx("confirm");
    hideTitle();
    hideBannerQuietly();
    setRunning(true);
    say("GUILD", "Dispatching the guild...", true);
    socket.emit("start_run", {
      topic: topic,
      mode: mode,
      workspace_id: workspaceId
    });
  });


  el.input.addEventListener("input", function () { if (!el.title.hidden) hideTitle(); });

  function hideBannerQuietly() { el.banner.hidden = true; }


  showTitle();
})();
