/* Something Ventured — the projection booth.
   Scroll-driven scenes, split-flap boards, the concierge (⌘K), the member card.
   No dependencies. Every scene degrades to a still frame without JS or with reduced motion. */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduce = mq('(prefers-reduced-motion: reduce)');
  var fine = mq('(hover: hover) and (pointer: fine)');
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var seg = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var E = {
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    in: function (t) { return t * t * t; },
    back: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var sfx = function (name) { if (window.SVSound) window.SVSound.play(name); };
  var store = {
    get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };
  var scrollToEl = function (el) {
    if (!el) return;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  /* ---------- set dressing: books, bottles, bulbs, scallops ---------- */
  function rng(seed) {
    return function () {
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var nums = function (s) { return s.split(',').map(Number); };
  var BOOKS = ['#9B2D4A', '#E0A93B', '#A9C8DA', '#F4E6D4', '#76B094', '#C9B6DA', '#EFC3C1', '#4A2F2A', '#C98F55', '#2F6B55', '#7EA6C0', '#D96C5F'];
  var BOTTLES = ['#E0A93B', '#9B2D4A', '#A9D3BE', '#F4E6D4', '#C9B6DA', '#2F6B55', '#D96C5F'];

  $$('[data-books]').forEach(function (g, gi) {
    var sc = parseFloat(g.getAttribute('data-scale') || '1'), r = rng(1234 + gi * 97);
    g.getAttribute('data-books').split(';').forEach(function (spec) {
      var a = nums(spec), x = a[0], y = a[1], x1 = a[2];
      while (x < x1 - 3 * sc) {
        var w = (4 + r() * 5) * sc, h = (15 + r() * 9) * sc;
        if (x + w > x1) break;
        if (r() < 0.07 && x + h < x1) {
          var n = 2 + Math.floor(r() * 2), bh = 4.2 * sc;
          for (var s = 0; s < n; s++) svg('rect', { x: x.toFixed(1), y: (y - (s + 1) * bh).toFixed(1), width: (h * 0.85).toFixed(1), height: (bh - 0.6 * sc).toFixed(1), fill: BOOKS[Math.floor(r() * BOOKS.length)] }, g);
          x += h * 0.85 + 2 * sc;
          continue;
        }
        var b = svg('rect', { x: x.toFixed(1), y: (y - h).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), fill: BOOKS[Math.floor(r() * BOOKS.length)] }, g);
        if (r() < 0.4) svg('rect', { x: x.toFixed(1), y: (y - h * 0.8).toFixed(1), width: w.toFixed(1), height: (1.1 * sc).toFixed(1), fill: 'rgba(255,255,255,.45)' }, g);
        if (r() < 0.05 && x + w + h * 0.3 < x1) {
          b.setAttribute('transform', 'rotate(' + (9 + r() * 8).toFixed(1) + ' ' + (x + w).toFixed(1) + ' ' + y + ')');
          x += h * 0.28;
        }
        x += w + (r() < 0.12 ? 3 * sc : 0.6 * sc);
      }
    });
  });

  $$('[data-bottles]').forEach(function (g, gi) {
    var r = rng(77 + gi);
    g.getAttribute('data-bottles').split(';').forEach(function (spec) {
      var a = nums(spec), x = a[0], y = a[1], x1 = a[2];
      while (x < x1 - 8) {
        var w = 6 + r() * 3, h = 11 + r() * 8, c = BOTTLES[Math.floor(r() * BOTTLES.length)];
        svg('rect', { x: x.toFixed(1), y: (y - h).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: '1.5', fill: c }, g);
        svg('rect', { x: (x + w / 2 - 1.3).toFixed(1), y: (y - h - 6).toFixed(1), width: '2.6', height: '6.5', fill: c }, g);
        x += w + 3 + r() * 3;
      }
    });
  });

  $$('[data-dancefloor]').forEach(function (g) {
    var a = nums(g.getAttribute('data-dancefloor')), r = rng(5);
    for (var y = a[1]; y < a[1] + a[3] - 1; y += 13) {
      for (var x = a[0]; x < a[0] + a[2]; x += 20) {
        var c = svg('rect', { x: x, y: y, width: 19, height: 12, class: 'df' }, g);
        c.style.animationDelay = (-r() * 2.4).toFixed(2) + 's';
      }
    }
  });

  $$('[data-bulbs]').forEach(function (g) {
    var a = nums(g.getAttribute('data-bulbs')), x = a[0], y = a[1], w = a[2], h = a[3], step = a[4], rr = Math.max(2.2, step * 0.22);
    var n = Math.round(w / step);
    for (var i = 0; i <= n; i++) { svg('circle', { cx: (x + i * w / n).toFixed(1), cy: y, r: rr }, g); svg('circle', { cx: (x + i * w / n).toFixed(1), cy: y + h, r: rr }, g); }
    var m = Math.max(1, Math.round(h / step));
    for (var j = 1; j < m; j++) { svg('circle', { cx: x, cy: (y + j * h / m).toFixed(1), r: rr }, g); svg('circle', { cx: x + w, cy: (y + j * h / m).toFixed(1), r: rr }, g); }
  });

  $$('[data-scallops]').forEach(function (g) {
    var a = nums(g.getAttribute('data-scallops'));
    for (var i = 0; i < a[3]; i++) svg('circle', { cx: a[0] + i * a[2] * 2, cy: a[1], r: a[2], fill: i % 2 ? '#9B2D4A' : '#F7EBDD' }, g);
  });

  $$('[data-ladder]').forEach(function (g) {
    g.getAttribute('data-ladder').split(';').forEach(function (spec) {
      var a = nums(spec), x0 = a[0], y0 = a[1], x1 = a[2], y1 = a[3], gap = a[4];
      svg('path', { d: 'M' + x0 + ' ' + y0 + 'L' + x1 + ' ' + y1 + 'M' + (x0 + gap) + ' ' + y0 + 'L' + (x1 + gap) + ' ' + y1, fill: 'none' }, g);
      for (var t = 0.08; t < 0.98; t += 0.085) {
        var x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        svg('path', { d: 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h' + gap, 'stroke-width': 4 }, g);
      }
    });
  });

  $$('[data-stringlights]').forEach(function (g) {
    var a = nums(g.getAttribute('data-stringlights')), n = a[6];
    for (var i = 1; i < n; i++) {
      var t = i / n, u = 1 - t;
      var x = u * u * a[0] + 2 * u * t * a[2] + t * t * a[4];
      var y = u * u * a[1] + 2 * u * t * a[3] + t * t * a[5];
      svg('circle', { cx: x.toFixed(1), cy: (y + 9).toFixed(1), r: 18, class: 'l-bulbglow' }, g);
      svg('path', { d: 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'v4', stroke: '#33211E', 'stroke-width': 1.5 }, g);
      svg('circle', { cx: x.toFixed(1), cy: (y + 9).toFixed(1), r: 5.5, class: 'l-bulb' }, g);
    }
  });

  /* ---------- split-flap cells ---------- */
  var CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·.-&';
  function makeCells(container, n) {
    var cells = [];
    for (var i = 0; i < n; i++) {
      var c = document.createElement('span');
      c.className = 'fc';
      c.appendChild(document.createElement('b')).textContent = ' ';
      container.appendChild(c);
      cells.push(c);
    }
    return cells;
  }
  function setCell(cell, ch, animate) {
    var b = cell.firstChild, prev = b.textContent;
    if (prev === ch) return;
    if (animate && !reduce) {
      cell.setAttribute('data-prev', prev);
      var a = !cell.classList.contains('fa');
      cell.classList.toggle('fa', a);
      cell.classList.toggle('fb', !a);
    }
    b.textContent = ch;
  }
  // flip a list of {el, target, wait} through random characters before landing
  function spin(list, onDone) {
    if (reduce) { list.forEach(function (c) { setCell(c.el, c.target, false); }); if (onDone) onDone(); return; }
    var r = rng(99);
    list.forEach(function (c) { c.steps = c.target === ' ' ? 0 : 4 + Math.floor(r() * 7); c.wait = c.wait || 0; });
    var timer = setInterval(function () {
      var active = 0, flipped = false;
      list.forEach(function (c) {
        if (c.steps <= 0) return;
        active++;
        if (c.wait > 0) { c.wait--; return; }
        c.steps--;
        setCell(c.el, c.steps === 0 ? c.target : CHARS.charAt(1 + Math.floor(Math.random() * (CHARS.length - 1))), true);
        flipped = true;
      });
      if (flipped) sfx('tick');
      if (!active) { clearInterval(timer); if (onDone) onDone(); }
    }, 62);
  }

  /* ---------- countdown: Library opens 2026.12.15, UTC+8 ---------- */
  var OPENING = Date.parse('2026-12-15T00:00:00+08:00');
  var count = $('[data-countdown]');
  if (count) {
    var sizes = { d: 3, h: 2, m: 2, s: 2 }, cdCells = {};
    Object.keys(sizes).forEach(function (k) { cdCells[k] = makeCells($('[data-cd="' + k + '"]', count), sizes[k]); });
    var parts = function () {
      var ms = Math.max(0, OPENING - Date.now()), s = Math.floor(ms / 1000);
      return { ms: ms, d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
    };
    var str = function (v, k) { var t = String(v); while (t.length < sizes[k]) t = '0' + t; return t.slice(-sizes[k]); };
    var first = parts(), cdIntro = [];
    Object.keys(sizes).forEach(function (k, gi) {
      var t = str(first[k], k);
      cdCells[k].forEach(function (c, i) { cdIntro.push({ el: c, target: t.charAt(i), wait: gi * 3 + i }); });
    });
    var cdLive = false;
    var tickCount = function () {
      var p = parts();
      if (p.ms <= 0) { count.setAttribute('data-open', ''); return; }
      if (!cdLive) return;
      Object.keys(sizes).forEach(function (k) { var t = str(p[k], k); cdCells[k].forEach(function (c, i) { setCell(c, t.charAt(i), true); }); });
    };
    if (first.ms <= 0) count.setAttribute('data-open', '');
    else setTimeout(function () { spin(cdIntro, function () { cdLive = true; tickCount(); }); }, store.get('sv-intro') ? 300 : 2600);
    setInterval(tickCount, 1000);
  }

  /* ---------- live clocks (Hangzhou time) ---------- */
  var handH = $('[data-hand="h"]'), handM = $('[data-hand="m"]'), boardClock = $('[data-clock]');
  function hzNow() {
    try {
      var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      var get = function (t) { for (var i = 0; i < p.length; i++) if (p[i].type === t) return +p[i].value; return 0; };
      return { h: get('hour') % 24, m: get('minute') };
    } catch (e) {
      var d = new Date(Date.now() + 8 * 3600000);
      return { h: d.getUTCHours(), m: d.getUTCMinutes() };
    }
  }
  function updateClocks() {
    var t = hzNow();
    if (handH) handH.setAttribute('transform', 'rotate(' + ((t.h % 12) * 30 + t.m * 0.5) + ')');
    if (handM) handM.setAttribute('transform', 'rotate(' + (t.m * 6) + ')');
    if (boardClock) boardClock.textContent = pad(t.h) + ':' + pad(t.m);
  }
  updateClocks();
  setInterval(updateClocks, 15000);

  /* ---------- departures board ---------- */
  var board = $('[data-board]'), runBoard = null;
  if (board) {
    var bcells = [];
    $$('.board__row', board).forEach(function (row, ri) {
      var parts = row.getAttribute('data-row').split('|');
      var plain = $('.board__plain', row);
      if (plain) plain.className = 'sr';
      [[parts[0], 5, 'y', 0], [parts[1], 18, 'd', 2], [parts[2], 12, 'r', 8]].forEach(function (s) {
        var grp = document.createElement('span');
        grp.className = 'flaps board__' + s[2];
        grp.setAttribute('aria-hidden', 'true');
        row.appendChild(grp);
        var text = s[0].toUpperCase();
        while (text.length < s[1]) text += ' ';
        makeCells(grp, s[1]).forEach(function (c, i) { bcells.push({ el: c, target: text.charAt(i), wait: ri * 2 + s[3] + Math.floor(i / 3) }); });
      });
    });
    runBoard = function () { spin(bcells); };
  }

  /* ---------- reveal on scroll ---------- */
  var onReveal = function (el) {
    if (el === board && runBoard) runBoard();
    if (el.hasAttribute('data-keys') && el._demo) el._demo();
  };
  var revealTargets = $$('[data-reveal], [data-board], [data-keys], [data-marquee]');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
        onReveal(e.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('is-in'); });
    setTimeout(function () { revealTargets.forEach(onReveal); }, 0);
  }

  /* ---------- key cabinet ---------- */
  var keys = $('[data-keys]');
  if (keys) {
    var keyBtns = $$('[data-keys-mode]', keys), touched = false;
    var setKeys = function (mode, byUser) {
      if (byUser) touched = true;
      if (keys.getAttribute('data-mode') === mode) return;
      keys.setAttribute('data-mode', mode);
      keyBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-keys-mode') === mode)); });
      if (mode === 'member') sfx('chime');
    };
    keyBtns.forEach(function (b) { b.addEventListener('click', function () { setKeys(b.getAttribute('data-keys-mode'), true); }); });
    keys._demo = function () { setTimeout(function () { if (!touched) setKeys('member'); }, 1600); };
  }

  /* ---------- library: day / night ---------- */
  var lib = $('#library'), libSwitch = $('[data-lib-switch]');
  var setLib = function (night) {
    if (!lib) return;
    lib.setAttribute('data-mode', night ? 'night' : 'day');
    if (libSwitch) libSwitch.setAttribute('aria-checked', String(night));
    sfx('switch');
  };
  if (libSwitch) libSwitch.addEventListener('click', function () { setLib(lib.getAttribute('data-mode') !== 'night'); });

  /* ---------- coming-attraction letters ---------- */
  $$('[data-letters]').forEach(function (p, pi) {
    var text = p.textContent.trim(), r = rng(500 + pi);
    p.setAttribute('aria-label', text);
    p.textContent = '';
    text.toUpperCase().split('').forEach(function (ch, i) {
      var s = document.createElement('span');
      s.className = ch === ' ' ? 'tile tile--sp' : 'tile';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch === ' ' ? '' : ch;
      s.style.setProperty('--r', ((r() - 0.5) * 3.2).toFixed(2) + 'deg');
      s.style.setProperty('--y', ((r() - 0.5) * 2.4).toFixed(1) + 'px');
      s.style.setProperty('--i', String(i + pi * 6));
      p.appendChild(s);
    });
  });

  /* =========================================================
     Scenes: sticky tracks whose progress drives a render().
     Progress is eased toward the scroll position for a smooth scrub.
     ========================================================= */
  var scenes = [];
  var addScene = function (track, render) { var s = { track: track, render: render, p: -1, t: 0 }; scenes.push(s); return s; };
  var measure = function (s) {
    var r = s.track.getBoundingClientRect(), total = s.track.offsetHeight - window.innerHeight;
    s.t = total > 0 ? clamp(-r.top / total, 0, 1) : (r.top < 0 ? 1 : 0);
    s.near = r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
  };
  var raf = 0;
  function frame() {
    raf = 0;
    var moving = false;
    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i];
      measure(s);
      if (s.p < 0) { s.p = s.t; s.render(s.p); continue; }
      if (Math.abs(s.p - s.t) < 0.0004) { if (s.p !== s.t) { s.p = s.t; s.render(s.p); } continue; }
      s.p = (reduce || !s.near) ? s.t : s.p + (s.t - s.p) * 0.16;
      s.render(s.p);
      moving = true;
    }
    hud();
    if (moving) raf = window.requestAnimationFrame(frame);
  }
  var kick = function () { if (!raf) raf = window.requestAnimationFrame(frame); };

  var live = !reduce && ('CSS' in window) && CSS.supports && CSS.supports('position', 'sticky');

  /* ---------- opening: the facade ---------- */
  var hero = $('.hero'), heroScene = $('[data-hero-scene]'), cam = $('[data-hero-cam]');
  var heroDoor = $('[data-hero-door]'), heroFade = $('[data-hero-fade]'), heroBottom = $('[data-hero-bottom]'), heroCities = $('.hero__cities');
  var snow = $('[data-snow]'), sctx = snow && snow.getContext ? snow.getContext('2d') : null, flakes = [], snowOn = false, snowRaf = 0;
  var dpr = Math.min(2, window.devicePixelRatio || 1);

  function layoutHero() {
    if (!heroScene) return;
    heroScene.style.maxWidth = '';
    var h = heroScene.clientHeight, w = Math.min(heroScene.clientWidth, h * 2.4);
    heroScene.style.maxWidth = Math.round(w) + 'px';
    var s = Math.max(w / 1600, h / 900);
    var ox = (w - 1600 * s) / 2 + 800 * s, oy = h - 900 * s + 826 * s;
    cam.style.transformOrigin = ox.toFixed(1) + 'px ' + oy.toFixed(1) + 'px';
    resizeSnow();
  }
  function resizeSnow() {
    if (!sctx) return;
    var w = snow.clientWidth, h = snow.clientHeight;
    snow.width = Math.round(w * dpr); snow.height = Math.round(h * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(clamp(w * h / 8000, 30, 150)), r = rng(42);
    flakes = [];
    for (var i = 0; i < n; i++) flakes.push({ x: r() * w, y: r() * h, r: 0.7 + r() * 1.9, v: 0.25 + r() * 0.7, ph: r() * 6.28, a: 0.5 + r() * 0.45 });
  }
  function snowLoop(t) {
    snowRaf = 0;
    if (!snowOn || !sctx) return;
    var w = snow.clientWidth, h = snow.clientHeight;
    sctx.clearRect(0, 0, w, h);
    sctx.fillStyle = '#FFFFFF';
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.y += f.v; f.x += Math.sin(t / 1700 + f.ph) * 0.32;
      if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
      sctx.globalAlpha = f.a;
      sctx.beginPath(); sctx.arc(f.x, f.y, f.r, 0, 6.2832); sctx.fill();
    }
    snowRaf = window.requestAnimationFrame(snowLoop);
  }
  if (hero && 'IntersectionObserver' in window && !reduce) {
    new IntersectionObserver(function (es) {
      snowOn = es[0].isIntersecting;
      if (snowOn && !snowRaf) snowRaf = window.requestAnimationFrame(snowLoop);
    }).observe(hero);
  }

  // cursor parallax on the facade: a set built in layers
  var layers = hero ? $$('.hl', hero).map(function (l) { return { el: l, d: parseFloat(l.getAttribute('data-depth')) || 0 }; }) : [];
  var px = 0, py = 0, cx = 0, cy = 0, parRaf = 0;
  function parallax() {
    parRaf = 0;
    cx += (px - cx) * 0.07; cy += (py - cy) * 0.07;
    layers.forEach(function (L) { L.el.setAttribute('transform', 'translate(' + (-cx * L.d * 30).toFixed(2) + ' ' + (-cy * L.d * 12).toFixed(2) + ')'); });
    if (Math.abs(px - cx) > 0.001 || Math.abs(py - cy) > 0.001) parRaf = window.requestAnimationFrame(parallax);
  }
  if (hero && fine && !reduce) {
    hero.addEventListener('pointermove', function (e) {
      px = e.clientX / window.innerWidth * 2 - 1; py = e.clientY / window.innerHeight * 2 - 1;
      if (!parRaf) parRaf = window.requestAnimationFrame(parallax);
    });
  }

  function renderHero(p) {
    var k = seg(p, 0, 0.22);
    heroBottom.style.opacity = (1 - k).toFixed(3);
    heroBottom.style.transform = 'translateY(' + (k * 26).toFixed(1) + 'px)';
    heroCities.style.opacity = (1 - k).toFixed(3);
    var d = E.inOut(seg(p, 0.1, 0.42));
    heroDoor.setAttribute('transform', 'translate(770 0) scale(' + Math.max(0.001, 1 - d).toFixed(3) + ' 1) translate(-770 0)');
    cam.style.transform = 'scale(' + (1 + E.in(seg(p, 0.03, 1)) * 7.5).toFixed(4) + ')';
    if (snow) snow.style.opacity = (1 - seg(p, 0, 0.3)).toFixed(3);
    heroFade.style.opacity = seg(p, 0.8, 0.98).toFixed(3);
  }
  if (hero && live) {
    hero.classList.add('is-live');
    addScene(hero, renderHero);
  }

  /* ---------- trailer: iris transitions between title cards ---------- */
  var trailer = $('.trailer'), tcards = $$('.tcard'), tSkip = $('.trailer__skip'), ticks = $$('[data-tick]'), lastTicks = -1;
  var T = [0.08, 0.3, 0.52, 0.74], TD = 0.15;
  function renderTrailer(p) {
    for (var i = 1; i < tcards.length; i++) {
      var a = T[i - 1], r = E.inOut(seg(p, a, a + TD)), c = tcards[i];
      var clip = 'circle(' + (r * 76).toFixed(2) + '% at 50% 50%)';
      c.style.clipPath = clip;
      c.style.webkitClipPath = clip;
      c.style.visibility = r > 0.001 ? 'visible' : 'hidden';
      c.style.setProperty('--q', seg(p, a + TD * 0.35, a + TD * 0.95).toFixed(3));
      tcards[i - 1].style.transform = r > 0 && r < 1 ? 'scale(' + (1 - 0.05 * r).toFixed(4) + ')' : '';
    }
    tcards[0].style.setProperty('--q', '1');
    var n = Math.floor(seg(p, T[1] + TD + 0.01, T[2] - 0.02) * 4.999);
    if (n !== lastTicks) {
      ticks.forEach(function (li, j) { li.classList.toggle('is-done', j < n); });
      if (lastTicks >= 0 && n > lastTicks) sfx('switch');
      lastTicks = n;
    }
    if (tSkip) tSkip.classList.toggle('is-gone', p > 0.9);
  }
  if (trailer && live) {
    trailer.classList.add('is-live');
    addScene($('.trailer__track', trailer), renderTrailer);
  }

  /* ---------- Hangzhou: a street folded into a building, then opened up ---------- */
  var fold = $('[data-scene="fold"]');
  if (fold && live) {
    var fu = {};
    $$('[data-fu]', fold).forEach(function (g) { fu[g.getAttribute('data-fu')] = { g: g, face: $('.fu__face', g) }; });
    var froof = $('[data-froof]', fold), flabels = $('[data-flabels]', fold), flegend = $('.fold__legend', fold);
    var glS = $('.f-gl--street', fold), glB = $('.f-gl--bldg', fold), fcaps = $$('.fold__caps li', fold), fcap = -1;
    var fsvg = $('.fold__svg', fold), narrow = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
    var VB0 = [0, 300, 1000, 420], VB1 = [270, 70, 460, 610], VBD = [0, 0, 1000, 720];
    var place = function (g, x, y, r) {
      g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')' + (Math.abs(r) > 0.01 ? ' rotate(' + r.toFixed(2) + ' 150 150)' : ''));
    };
    var renderFold = function (p) {
      var k2 = E.out(seg(p, 0.1, 0.3));
      var t3 = seg(p, 0.14, 0.42), k3x = E.inOut(t3), k3y = E.out(seg(p, 0.14, 0.36));
      var t1 = seg(p, 0.3, 0.48), k1 = E.inOut(t1);
      place(fu[2].g, 350, 490 - 150 * k2, 0);
      place(fu[3].g, 665 - 315 * k3x, 490 - 300 * k3y, Math.sin(t3 * Math.PI) * -7);
      place(fu[1].g, 35 + 315 * k1, 490, Math.sin(t1 * Math.PI) * 5);
      var kr = seg(p, 0.5, 0.62);
      froof.setAttribute('transform', 'translate(0 ' + (-80 * (1 - E.back(kr))).toFixed(1) + ')');
      froof.style.opacity = seg(p, 0.5, 0.55).toFixed(3);
      [3, 2, 1].forEach(function (f, i) {
        var kf = E.inOut(seg(p, 0.64 + i * 0.05, 0.76 + i * 0.05));
        fu[f].face.setAttribute('transform', 'translate(0 ' + (-152 * kf).toFixed(1) + ')');
      });
      flabels.style.opacity = seg(p, 0.8, 0.9).toFixed(3);
      if (flegend) flegend.style.opacity = seg(p, 0.8, 0.9).toFixed(3);
      glS.style.opacity = (1 - seg(p, 0.02, 0.1)).toFixed(3);
      glB.style.opacity = seg(p, 0.52, 0.62).toFixed(3);
      var vb = VBD;
      if (narrow && narrow.matches) {
        var kz = E.inOut(seg(p, 0.28, 0.6));
        vb = VB0.map(function (v, i) { return v + (VB1[i] - v) * kz; });
      }
      fsvg.setAttribute('viewBox', vb.map(function (v) { return v.toFixed(1); }).join(' '));
      var c = p < 0.1 ? 0 : p < 0.48 ? 1 : p < 0.64 ? 2 : 3;
      if (c !== fcap) {
        fcaps.forEach(function (li, i) { li.classList.toggle('is-on', i === c); });
        if (fcap >= 0) sfx(c === 3 ? 'whoosh' : 'switch');
        fcap = c;
      }
    };
    fold.classList.add('is-live');
    addScene(fold, renderFold);
  }

  /* ---------- membership: a lateral tracking shot through four rooms ---------- */
  var track = $('[data-scene="track"]'), rail = $('[data-rail]'), rooms = $$('.room'), dots = $$('.track__dots i');
  var trackDist = 0, lastX = 0, lastRoom = -1;
  function layoutTrack() {
    if (!track || !track.classList.contains('is-live')) return;
    var w = rooms[0].offsetWidth;
    trackDist = w * (rooms.length - 1);
    track.style.height = Math.round(window.innerHeight + trackDist) + 'px';
  }
  function renderTrack(p) {
    var x = -trackDist * p, v = x - lastX;
    lastX = x;
    var skew = clamp(v * 0.05, -7, 7);
    rail.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0) skewX(' + skew.toFixed(2) + 'deg)';
    var idx = Math.round(p * (rooms.length - 1));
    if (idx !== lastRoom) {
      rooms.forEach(function (r, i) { r.classList.toggle('is-on', i === idx); });
      dots.forEach(function (d, i) { d.classList.toggle('is-on', i === idx); });
      if (lastRoom >= 0) sfx('whoosh');
      lastRoom = idx;
    }
  }
  if (track && live && rooms.length) {
    track.classList.add('is-live');
    layoutTrack();
    addScene(track, renderTrack);
  } else {
    rooms.forEach(function (r) { r.classList.add('is-on'); });
  }

  /* ---------- HUD: nav state, chapter, timecode ---------- */
  var nav = $('[data-nav]'), hudEl = $('.hud'), tcEl = $('[data-hud-tc]'), chEl = $('[data-hud-chap]');
  var RUNTIME = 400; // the "film" runs 6'40" from top to bottom
  function hud() {
    var y = window.pageYOffset || root.scrollTop, max = root.scrollHeight - window.innerHeight;
    var f = Math.floor((max > 0 ? clamp(y / max, 0, 1) : 0) * RUNTIME * 24);
    if (tcEl) tcEl.textContent = '00:' + pad(Math.floor(f / 1440) % 60) + ':' + pad(Math.floor(f / 24) % 60) + ':' + pad(f % 24);
    var heroEnd = hero ? hero.offsetTop + hero.offsetHeight - (hero.classList.contains('is-live') ? window.innerHeight * 1.02 : (nav ? nav.offsetHeight : 64)) : 0;
    var past = y > heroEnd;
    if (nav) nav.classList.toggle('is-solid', past);
    if (hudEl) hudEl.classList.toggle('is-on', past);
  }
  if (chEl && 'IntersectionObserver' in window) {
    var chapIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) chEl.textContent = e.target.getAttribute('data-chapter'); });
    }, { rootMargin: '-50% 0px -50% 0px' });
    $$('[data-chapter]').forEach(function (s) { chapIO.observe(s); });
  }

  window.addEventListener('scroll', kick, { passive: true });
  var resizeT = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { layoutHero(); layoutTrack(); scenes.forEach(function (s) { s.p = -1; }); kick(); }, 120);
  });
  layoutHero();
  frame();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { layoutTrack(); kick(); });

  /* ---------- in-page links ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    var target = id.length > 1 ? document.getElementById(id.slice(1)) : null;
    if (!target) return;
    e.preventDefault();
    if (a.classList.contains('credits__rewind')) sfx('whoosh');
    scrollToEl(target);
  });

  /* ---------- opening titles: leader, curtain, once per session ---------- */
  var intro = $('[data-intro]');
  function endIntro() {
    if (!intro) return;
    intro.parentNode.removeChild(intro);
    intro = null;
    root.classList.remove('is-intro');
    kick();
  }
  if (intro) {
    if (reduce || store.get('sv-intro')) {
      endIntro();
    } else {
      store.set('sv-intro', '1');
      root.classList.add('is-intro');
      var num = $('[data-leader-num]'), lsvg = $('[data-leader-svg]'), timers = [];
      var sweep = function () {
        var a = !lsvg.classList.contains('sweep-a');
        lsvg.classList.toggle('sweep-a', a);
        lsvg.classList.toggle('sweep-b', !a);
      };
      var at = function (ms, fn) { timers.push(setTimeout(fn, ms)); };
      var skip = function () {
        timers.forEach(clearTimeout);
        intro.classList.add('is-title', 'is-open');
        setTimeout(endIntro, 700);
      };
      $('[data-intro-skip]', intro).addEventListener('click', skip);
      intro.addEventListener('click', skip);
      document.addEventListener('keydown', function onKey(e) { if (intro && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { skip(); } document.removeEventListener('keydown', onKey); });
      sweep();
      at(420, function () { num.textContent = '2'; sweep(); });
      at(840, function () { num.textContent = '1'; sweep(); });
      at(1260, function () { intro.classList.add('is-title'); });
      at(2350, function () { intro.classList.add('is-open'); });
      at(3550, endIntro);
    }
  }

  /* ---------- the application ---------- */
  var form = $('#apply-form'), applySec = $('#apply'), mcard = $('[data-mcard]');
  if (form && mcard) {
    var cardName = $('[data-card-name]'), cardSector = $('[data-card-sector]'), cardBase = $('[data-card-base]'), cardLead = $('[data-card-lead]');
    var defaults = { name: cardName.textContent, sector: cardSector.textContent, base: cardBase.textContent, lead: cardLead.textContent };
    var err = $('.reg__err', form), done = $('.reg__done', form), submit = $('button[type="submit"]', form);
    var val = function (name) {
      var checked = form.querySelector('input[name="' + name + '"]:checked');
      if (checked) return checked.value;
      var el = form.querySelector('[name="' + name + '"]');
      return el && el.type !== 'radio' ? (el.value || '').trim() : '';
    };
    var syncCard = function () {
      cardName.textContent = val('name') || defaults.name;
      cardSector.textContent = val('sector') || defaults.sector;
      cardBase.textContent = val('base') || defaults.base;
      cardLead.textContent = val('lead') || defaults.lead;
    };
    form.addEventListener('input', syncCard);
    form.addEventListener('change', syncCard);
    form.addEventListener('input', function (e) {
      var f = e.target.closest && e.target.closest('.field.is-invalid');
      if (f && (e.target.value || '').trim()) { f.classList.remove('is-invalid'); e.target.setAttribute('aria-invalid', 'false'); }
    });
    form.addEventListener('change', function (e) {
      if (e.target.name === 'sector') { var g = e.target.closest('.field'); if (g) g.classList.remove('is-invalid'); }
    });

    var validate = function () {
      var bad = null;
      ['name', 'venture', 'contact'].forEach(function (n) {
        var el = form.querySelector('[name="' + n + '"]'), ok = val(n).length > 0;
        el.closest('.field').classList.toggle('is-invalid', !ok);
        el.setAttribute('aria-invalid', String(!ok));
        if (!ok && !bad) bad = el;
      });
      var sectorOk = !!val('sector'), group = $('[aria-labelledby="g-sector"]', form);
      group.classList.toggle('is-invalid', !sectorOk);
      if (!sectorOk && !bad) bad = $('input[name="sector"]', form);
      return bad;
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (val('company_website')) return;
      var bad = validate();
      if (bad) { err.textContent = '请补全标 * 的信息。'; bad.focus(); return; }
      err.textContent = '';
      var payload = {
        name: val('name'), venture: val('venture'), sector: val('sector'), base: val('base'),
        lead: val('lead'), contact: val('contact'), thesis: val('thesis'),
        submitted_at: new Date().toISOString(), page: location.href
      };
      var endpoint = (form.getAttribute('data-endpoint') || '').trim();
      submit.disabled = true;
      var request = endpoint
        ? fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); })
        : new Promise(function (resolve) {
            if (window.console) window.console.info('[Something Ventured] data-endpoint is empty; nothing was sent.', payload);
            setTimeout(resolve, 600);
          });
      request.then(function () {
        if (mcard.classList.contains('is-flipped')) setFlip(false);
        form.classList.add('is-sent');
        var desk = $('.desk'), navH = nav ? nav.offsetHeight : 64;
        window.scrollTo(0, desk.getBoundingClientRect().top + window.pageYOffset - navH - 20);
        done.focus({ preventScroll: true });
        setTimeout(function () {
          applySec.classList.add('is-sent');
          sfx('thump');
          setTimeout(function () { sfx('bell'); }, 240);
        }, reduce ? 0 : 380);
      }).catch(function () {
        err.textContent = '提交没有成功，请稍后再试。';
      }).then(function () { submit.disabled = false; });
    });

    /* card: flip, tilt, foil */
    var flipBtn = $('[data-flip]');
    var setFlip = function (on) {
      mcard.classList.toggle('is-flipped', on);
      mcard.setAttribute('aria-pressed', String(on));
      if (flipBtn) flipBtn.setAttribute('aria-pressed', String(on));
      sfx('whoosh');
    };
    var toggleFlip = function () { setFlip(!mcard.classList.contains('is-flipped')); };
    mcard.addEventListener('click', toggleFlip);
    mcard.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFlip(); } });
    if (flipBtn) flipBtn.addEventListener('click', toggleFlip);

    var tiltTo = function (nx, ny) {
      mcard.style.setProperty('--ry', (nx * 16).toFixed(2) + 'deg');
      mcard.style.setProperty('--rx', (-ny * 12).toFixed(2) + 'deg');
      mcard.style.setProperty('--mx', ((nx + 0.5) * 100).toFixed(1) + '%');
      mcard.style.setProperty('--my', ((ny + 0.5) * 100).toFixed(1) + '%');
    };
    if (fine && !reduce) {
      mcard.addEventListener('pointermove', function (e) {
        var r = mcard.getBoundingClientRect();
        mcard.classList.add('is-tilting');
        tiltTo((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
      });
      mcard.addEventListener('pointerleave', function () { mcard.classList.remove('is-tilting'); tiltTo(0, 0); mcard.style.setProperty('--mx', '40%'); mcard.style.setProperty('--my', '30%'); });
    }

    // phones: tilt the device to move the foil (where the browser allows motion sensors)
    var gyro = $('[data-gyro]');
    if (gyro && !fine && !reduce && 'DeviceOrientationEvent' in window) {
      gyro.hidden = false;
      var onOrient = function (e) {
        if (e.gamma == null) return;
        mcard.classList.add('is-tilting');
        tiltTo(clamp(e.gamma, -30, 30) / 60, clamp((e.beta || 45) - 45, -30, 30) / 60);
      };
      gyro.addEventListener('click', function () {
        var ask = window.DeviceOrientationEvent.requestPermission;
        var go = ask ? ask.call(window.DeviceOrientationEvent) : Promise.resolve('granted');
        Promise.resolve(go).then(function (state) {
          if (state !== 'granted') throw new Error('denied');
          var seen = false;
          window.addEventListener('deviceorientation', function (e) { if (e.gamma != null) seen = true; onOrient(e); });
          gyro.setAttribute('aria-pressed', 'true');
          setTimeout(function () { if (!seen) gyro.hidden = true; }, 1500);
        }).catch(function () { gyro.hidden = true; });
      });
    }
  }

  /* ---------- sound toggle ---------- */
  var sndBtn = $('[data-sound]'), cgSound = $('[data-cg-sound]');
  var toggleSound = function () { if (window.SVSound) window.SVSound.toggle(); };
  if (sndBtn) {
    if (!window.SVSound || !window.SVSound.supported) sndBtn.hidden = true;
    sndBtn.addEventListener('click', toggleSound);
  }
  if (window.SVSound) {
    window.SVSound.onChange(function (on) {
      if (sndBtn) sndBtn.setAttribute('aria-pressed', String(on));
      root.classList.toggle('sound-on', on);
      if (cgSound) cgSound.textContent = on ? 'Sound off' : 'Sound on';
    });
  }

  /* ---------- the concierge (⌘K) ---------- */
  var cg = $('[data-concierge]');
  if (cg) {
    var cgInput = $('#cg-input'), cgItems = $$('[role="option"]', cg), cgIdx = 0, lastFocus = null;
    var visible = function () { return cgItems.filter(function (li) { return !li.hidden; }); };
    var mark = function () {
      var v = visible();
      cgItems.forEach(function (li) { li.setAttribute('aria-selected', 'false'); });
      var cur = v[cgIdx];
      if (cur) { cur.setAttribute('aria-selected', 'true'); cgInput.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
      else cgInput.removeAttribute('aria-activedescendant');
    };
    var filter = function () {
      var q = cgInput.value.trim().toLowerCase();
      cgItems.forEach(function (li) { li.hidden = !!q && (li.textContent + ' ' + (li.getAttribute('data-k') || '')).toLowerCase().indexOf(q) < 0; });
      cgIdx = 0; mark();
    };
    var open = function () {
      if (!cg.hidden) return;
      lastFocus = document.activeElement;
      cg.hidden = false;
      cgInput.value = '';
      filter();
      window.requestAnimationFrame(function () { cg.classList.add('is-open'); });
      cgInput.focus({ preventScroll: true });
      sfx('bell');
    };
    var close = function () {
      if (cg.hidden) return;
      cg.classList.remove('is-open');
      setTimeout(function () { cg.hidden = true; }, 260);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    };
    var go = function (li) {
      if (!li) return;
      var dest = li.getAttribute('data-go'), act = li.getAttribute('data-act');
      close();
      setTimeout(function () {
        if (act === 'sound') toggleSound();
        else if (act === 'lights') { scrollToEl(lib); setTimeout(function () { setLib(lib.getAttribute('data-mode') !== 'night'); }, reduce ? 0 : 800); }
        else if (dest) scrollToEl($(dest));
      }, 140);
    };
    $$('[data-concierge-open]').forEach(function (b) { b.addEventListener('click', open); });
    $$('[data-concierge-close]', cg).forEach(function (b) { b.addEventListener('click', close); });
    cgItems.forEach(function (li) {
      li.addEventListener('click', function () { go(li); });
      li.addEventListener('mousemove', function () { var i = visible().indexOf(li); if (i >= 0 && i !== cgIdx) { cgIdx = i; mark(); } });
    });
    cgInput.addEventListener('input', filter);
    cg.addEventListener('keydown', function (e) {
      var v = visible();
      if (e.key === 'ArrowDown') { e.preventDefault(); cgIdx = (cgIdx + 1) % Math.max(1, v.length); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cgIdx = (cgIdx - 1 + v.length) % Math.max(1, v.length); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(v[cgIdx]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); cgInput.focus(); }
      else if (!cgInput.value && /^[0-6]$/.test(e.key)) {
        var hit = cgItems.filter(function (li) { var k = li.querySelector('kbd'); return k && k.textContent === e.key; })[0];
        if (hit) { e.preventDefault(); go(hit); }
      }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (cg.hidden) open(); else close(); }
    });
  }

  /* ---------- cursor & magnetic buttons (mouse only) ---------- */
  if (fine && !reduce) {
    var cur = $('.cursor');
    if (cur) {
      root.classList.add('has-cursor');
      var ring = $('.cursor__ring', cur), dot = $('.cursor__dot', cur), lbl = $('[data-cursor-label]', cur);
      var mx = 0, my = 0, rx = 0, ry = 0, curRaf = 0, shown = false;
      var loop = function () {
        curRaf = 0;
        rx += (mx - rx) * 0.22; ry += (my - ry) * 0.22;
        ring.style.transform = 'translate(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px)';
        if (Math.abs(mx - rx) > 0.1 || Math.abs(my - ry) > 0.1) curRaf = window.requestAnimationFrame(loop);
      };
      window.addEventListener('pointermove', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        mx = e.clientX; my = e.clientY;
        dot.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
        if (!shown) { shown = true; rx = mx; ry = my; cur.classList.add('is-on'); }
        if (!curRaf) curRaf = window.requestAnimationFrame(loop);
      }, { passive: true });
      document.addEventListener('mouseover', function (e) {
        var t = e.target.closest && e.target.closest('a, button, [data-cursor], label, input, textarea, [role="option"]');
        var text = t && t.getAttribute('data-cursor');
        cur.classList.toggle('is-hover', !!t);
        cur.classList.toggle('has-label', !!text);
        cur.classList.toggle('is-text', !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')));
        lbl.textContent = text || '';
      });
      root.addEventListener('mouseleave', function () { cur.classList.remove('is-on'); shown = false; });
      window.addEventListener('mousedown', function () { cur.classList.add('is-down'); });
      window.addEventListener('mouseup', function () { cur.classList.remove('is-down'); });
    }
    $$('[data-magnetic]').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * 0.2).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
  }
})();
