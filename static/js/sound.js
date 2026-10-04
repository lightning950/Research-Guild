const Sound = (function () {
  "use strict";

  const STORAGE_KEY = "research-guild.sound";
  const MASTER_VOLUME = 0.13;

  let ctx = null;
  let master = null;
  let enabled = readPreference();
  const lastPlayed = {};



  // localStorage can throw (private windows, blocked site data), so every

  function readPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "off";
    } catch (e) {
      return true;
    }
  }

  function writePreference() {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch (e) {  }
  }



  /**
   * Create the audio graph on first user gesture. Safe to call repeatedly.
   * Returns false if this browser has no Web Audio at all.
   */
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  /**
   * One note. Every effect below is built from calls to this.
   *
   * `at` is seconds from now, `dur` the note length. The gain envelope ramps
   * in over 5ms and out exponentially: without the ramps, square waves
   * click audibly at the start and end of every note.
   */
  function note(freq, at, dur, opts) {
    const o = opts || {};
    const t0 = ctx.currentTime + at;

    const osc = ctx.createOscillator();
    osc.type = o.wave || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) {

      osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    }

    const g = ctx.createGain();
    const peak = o.volume === undefined ? 0.6 : o.volume;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }


  const N = {
    C4: 261.6, E4: 329.6, G4: 392.0, A4: 440.0,
    C5: 523.3, D5: 587.3, E5: 659.3, G5: 784.0, A5: 880.0,
    C6: 1046.5, E6: 1318.5
  };



  const EFFECTS = {


    blip:    { gap: 45,  play: function () { note(1400, 0, 0.022, { volume: 0.18 }); } },


    select:  { gap: 60,  play: function () { note(N.A5, 0, 0.04, { volume: 0.35 }); } },


    confirm: { gap: 150, play: function () {
      note(N.E5, 0, 0.06, { volume: 0.45 });
      note(N.A5, 0.06, 0.09, { volume: 0.45 });
    } },


    summon:  { gap: 400, play: function () {
      [N.C5, N.E5, N.G5, N.C6].forEach(function (f, i) {
        note(f, i * 0.055, 0.08, { volume: 0.4 });
      });
    } },


    done:    { gap: 140, play: function () {
      note(N.E6, 0, 0.05, { volume: 0.32 });
      note(N.C6 * 1.5, 0.05, 0.1, { volume: 0.32 });
    } },

    // Rate-limited and retrying: a low, soft bloop. Informative, not alarming.
    wait:    { gap: 600, play: function () {
      note(N.A4, 0, 0.14, { wave: "triangle", volume: 0.5, slideTo: N.E4 });
    } },


    fail:    { gap: 400, play: function () {
      note(N.G4, 0, 0.12, { volume: 0.4, slideTo: N.C4 });
      note(N.E4 * 0.75, 0.12, 0.22, { volume: 0.4, slideTo: 110 });
    } },



    fanfare: { gap: 2000, play: function () {
      const seq = [
        [N.C5, 0.00, 0.09], [N.E5, 0.09, 0.09], [N.G5, 0.18, 0.09],
        [N.C6, 0.27, 0.16], [N.G5, 0.45, 0.09], [N.C6, 0.54, 0.34]
      ];
      seq.forEach(function (s) { note(s[0], s[1], s[2], { volume: 0.42 }); });

      note(N.C4, 0.45, 0.45, { wave: "triangle", volume: 0.55 });
    } }
  };

  /** Play a named effect, respecting mute, unlock state and throttling. */
  function play(name) {
    if (!enabled || !ctx || ctx.state !== "running") return;
    const fx = EFFECTS[name];
    if (!fx) return;
    const now = performance.now();
    if (lastPlayed[name] && now - lastPlayed[name] < fx.gap) return;
    lastPlayed[name] = now;
    try {
      fx.play();
    } catch (e) {
      // Audio must never be able to break the app.
    }
  }

  function setEnabled(on) {
    enabled = !!on;
    writePreference();
    if (enabled) {
      unlock();
      play("select");
    }
  }

  return {
    unlock: unlock,
    play: play,
    isEnabled: function () { return enabled; },
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); return enabled; }
  };
})();
