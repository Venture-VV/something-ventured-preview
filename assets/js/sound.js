/* Something Ventured — sound.
   A small pizzicato score and a handful of effects, synthesised in the browser
   (Karplus–Strong plucked strings, no audio files). Off until the visitor turns it on. */
(function () {
  'use strict';

  var Ctx = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, music = null, sfxBus = null, noiseBuf = null;
  var notes = {};
  var enabled = false, timer = null, nextTime = 0, step = 0, lastTick = 0;
  var listeners = [];

  var BPM = 112, EIGHTH = 60 / BPM / 2;
  // Dm · Gm · C · F · Bb · Gm · A · A7 — eight bars of arpeggios, root on the bass.
  var BARS = [
    { bass: 38, arp: [62, 69, 74, 69, 65, 69, 74, 69], mel: [74, 72] },
    { bass: 43, arp: [55, 62, 67, 62, 58, 62, 67, 62], mel: [70, 67] },
    { bass: 36, arp: [60, 67, 72, 67, 64, 67, 72, 67], mel: [67, 64] },
    { bass: 41, arp: [53, 60, 65, 60, 57, 60, 65, 60], mel: [69, 72] },
    { bass: 46, arp: [58, 65, 70, 65, 62, 65, 70, 65], mel: [74, 70] },
    { bass: 43, arp: [55, 62, 67, 62, 58, 62, 67, 62], mel: [67, 70] },
    { bass: 45, arp: [57, 64, 69, 64, 61, 64, 69, 64], mel: [69, 73] },
    { bass: 45, arp: [57, 64, 67, 64, 61, 64, 67, 69], mel: [76, 73] }
  ];

  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // Karplus–Strong: a burst of filtered noise circulating through a short, slightly lossy delay line.
  function pluck(m, seconds, bright) {
    var sr = ctx.sampleRate, len = Math.floor(sr * seconds);
    var N = Math.max(2, Math.round(sr / freq(m)));
    var buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
    var ring = new Float32Array(N), prev = 0, i;
    for (i = 0; i < N; i++) { prev += bright * ((Math.random() * 2 - 1) - prev); ring[i] = prev; }
    var idx = 0, decay = m < 48 ? 0.9975 : 0.9962;
    for (i = 0; i < len; i++) {
      var a = ring[idx], b = ring[(idx + 1) % N];
      out[i] = a;
      ring[idx] = decay * 0.5 * (a + b);
      idx = (idx + 1) % N;
    }
    var fade = Math.floor(sr * 0.08);
    for (i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    return buf;
  }

  function impulse(seconds, decay) {
    var sr = ctx.sampleRate, len = Math.floor(sr * seconds), ir = ctx.createBuffer(2, len, sr);
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return ir;
  }

  function init() {
    if (ctx || !Ctx) return !!ctx;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ctx.destination);

    var warm = ctx.createBiquadFilter();
    warm.type = 'lowpass'; warm.frequency.value = 3800;
    music = ctx.createGain(); music.gain.value = 0.55;
    music.connect(warm); warm.connect(master);

    var verb = ctx.createConvolver(); verb.buffer = impulse(2.4, 3.2);
    var send = ctx.createGain(); send.gain.value = 0.22;
    music.connect(send); send.connect(verb); verb.connect(master);

    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8;
    sfxBus.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var nd = noiseBuf.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    var used = {};
    BARS.forEach(function (b) { used[b.bass] = 1; b.arp.forEach(function (m) { used[m] = 1; }); b.mel.forEach(function (m) { used[m] = 1; }); });
    Object.keys(used).forEach(function (m) { notes[m] = pluck(+m, +m < 48 ? 2.2 : 1.5, +m < 48 ? 0.35 : 0.6); });
    return true;
  }

  function play(m, t, vel, pan) {
    var src = ctx.createBufferSource();
    src.buffer = notes[m];
    var g = ctx.createGain();
    g.gain.value = vel;
    src.connect(g);
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner(); p.pan.value = pan || 0;
      g.connect(p); p.connect(music);
    } else {
      g.connect(music);
    }
    src.start(t);
  }

  function playStep(s, t) {
    var loop = Math.floor(s / 64), bar = BARS[Math.floor(s / 8) % 8], e = s % 8;
    var human = function () { return (Math.random() - 0.5) * 0.012; };
    play(bar.arp[e], t + human(), (e % 2 ? 0.34 : 0.46) + Math.random() * 0.08, e % 2 ? 0.22 : -0.22);
    if (e === 0 || e === 4) play(bar.bass, t, 0.62, 0);
    // every other pass, a tremolo melody on top — the balalaika touch
    if (loop % 2 === 1 && (e === 0 || e === 4)) {
      var m = bar.mel[e === 0 ? 0 : 1];
      for (var k = 0; k < 8; k++) play(m, t + k * EIGHTH / 2, 0.21 - k * 0.016, 0.08);
    }
  }

  function schedule() {
    while (nextTime < ctx.currentTime + 0.14) {
      playStep(step, nextTime);
      nextTime += EIGHTH;
      step = (step + 1) % 128;
    }
  }

  function noise(t, dur, type, f, q, peak) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    return flt;
  }

  function tone(t, f, dur, peak, type) {
    var o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = f;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  var FX = {
    tick: function () {
      var t = ctx.currentTime;
      if (t - lastTick < 0.028) return;
      lastTick = t;
      noise(t, 0.028, 'bandpass', 1600 + Math.random() * 1800, 2.2, 0.16);
    },
    switch: function () {
      var t = ctx.currentTime;
      noise(t, 0.03, 'bandpass', 1100, 3, 0.35);
      noise(t + 0.045, 0.03, 'bandpass', 2400, 3, 0.22);
    },
    bell: function () {
      var t = ctx.currentTime, base = 1480;
      tone(t, base, 1.8, 0.22); tone(t, base * 2.76, 0.9, 0.08); tone(t, base * 5.4, 0.45, 0.04); tone(t, base * 1.002, 1.6, 0.12);
    },
    thump: function () {
      var t = ctx.currentTime;
      var o = tone(t, 150, 0.32, 0.7);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.2);
      noise(t, 0.12, 'lowpass', 700, 0.7, 0.4);
    },
    whoosh: function () {
      var t = ctx.currentTime;
      var f = noise(t, 0.42, 'bandpass', 300, 0.8, 0.12);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.36);
    },
    chime: function () {
      var t = ctx.currentTime;
      [0, 3, 5, 7, 10, 12].forEach(function (s, i) { tone(t + i * 0.09, 880 * Math.pow(2, s / 12), 0.9, 0.06); });
    }
  };

  function emit() { listeners.forEach(function (fn) { fn(enabled); }); }

  function set(on) {
    if (on === enabled) return;
    if (on) {
      if (!init()) return;
      enabled = true;
      ctx.resume();
      nextTime = ctx.currentTime + 0.08;
      step = 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
      timer = setInterval(schedule, 25);
      schedule();
    } else {
      enabled = false;
      clearInterval(timer); timer = null;
      if (ctx) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
        setTimeout(function () { if (!enabled) ctx.suspend(); }, 700);
      }
    }
    emit();
  }

  document.addEventListener('visibilitychange', function () {
    if (!ctx || !enabled) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  window.SVSound = {
    get enabled() { return enabled; },
    supported: !!Ctx,
    set: set,
    toggle: function () { set(!enabled); },
    play: function (name) { if (enabled && ctx && FX[name]) FX[name](); },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
