/* Home — one page that scrolls: the planet scene on top, then the writing, the work and a word about me.
   Here: the hero's entrance, the top bar, the planet and the line of local details under it. */
(function () {
  'use strict';

  var html = document.documentElement;
  var hero = document.querySelector('.sec-hero');
  if (!hero) return;

  var Site = window.Site || {};
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* the entrance (the light rising, the words coming in) plays once per visit; back on the home page later in the
     same visit, everything is simply there. It is the page's one choreographed motion: the rest only answers the visitor */
  var again = false;
  try { again = sessionStorage.getItem('home-intro') === '1'; sessionStorage.setItem('home-intro', '1'); } catch (e) { /* storage blocked */ }
  if (again) {
    hero.classList.add('is-instant', 'is-active');
    requestAnimationFrame(function () { requestAnimationFrame(function () { hero.classList.remove('is-instant'); }); });
  } else requestAnimationFrame(function () { hero.classList.add('is-active'); });

  /* ======================================================================
     Top bar: glass once the planet has scrolled away; the section in view is marked
     ====================================================================== */
  var bar = document.querySelector('.topbar');
  var links = document.querySelectorAll('[data-top-link]');
  var marked = null;
  /* the planet on screen at all: the shooting stars wait for it */
  var heroOnScreen = true;
  function syncBar() {
    var y = window.scrollY, barH = bar ? bar.offsetHeight : 56;
    heroOnScreen = y < hero.offsetHeight;
    /* glass a little before the planet has gone, so the pill at its foot never slides under bare words */
    html.classList.toggle('top-solid', y >= hero.offsetHeight - barH - 72);
    /* the section crossing the line a third of the way down the screen is the one being read */
    var line = window.innerHeight / 3, id = '';
    for (var i = 0; i < links.length; i++) {
      var sec = document.getElementById(links[i].getAttribute('data-top-link'));
      if (sec && sec.getBoundingClientRect().top <= line) id = sec.id;
    }
    if (id === marked) return;
    marked = id;
    for (var k = 0; k < links.length; k++) {
      if (links[k].getAttribute('data-top-link') === id) links[k].setAttribute('aria-current', 'true');
      else links[k].removeAttribute('aria-current');
    }
  }
  window.addEventListener('scroll', syncBar, { passive: true });
  syncBar();

  /* ======================================================================
     Hero
     ====================================================================== */
  var canvas = hero.querySelector('.hero-canvas');
  var nameEl = hero.querySelector('.hero-name');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var scene = canvas && Site.scene ? Site.scene.create(canvas) : null;

  /* composition: a huge planet whose horizon rises from the lower left to the right; the sun (or moon)
     stands over the slope, clear of the text, at a height set by the visitor's local time */
  var S = { w: 0, h: 0, dpr: 1, day: false, cx: 0, cy: 0, R: 0, lx: 0, ly: 0, lr: 20, leak: 0, px: -1e4, py: -1e4, pon: 0,
    mx: 0, my: 0, ma: 0, mi: 0, ml: 1, D: 0, limb: 0 };
  function layout() {
    var w = hero.clientWidth, h = hero.clientHeight, land = w / h > 0.8;
    S.w = w; S.h = h;
    S.dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8e6 / (w * h))); /* at most ~8 million pixels to shade */
    S.R = land ? 1.3 * w : 1.35 * w;
    S.cx = (land ? 0.86 : 0.88) * w;
    S.cy = (land ? 0.58 : 0.72) * h + S.R;
    S.lx = (land ? (h < 560 ? 0.8 : 0.66) : 0.56) * w;
    S.lr = Math.max(14, Math.min(28, 0.03 * Math.min(w, h) + 6));
    S.D = (land ? 0.21 : 0.15) * h;
    S.limb = S.cy - Math.sqrt(S.R * S.R - Math.pow(S.lx - S.cx, 2));
    if (canvas) {
      canvas.width = Math.round(w * S.dpr);
      canvas.height = Math.round(h * S.dpr);
    }
  }
  function altitude() {
    var d = new Date(), h = d.getHours() + d.getMinutes() / 60;
    var light = Site.theme ? Site.theme.current() === 'light' : false;
    var a = light ? Math.sin(Math.PI * (h - 6) / 12) : Math.sin(Math.PI * ((((h + 12) % 24) - 6) / 12));
    if (Site.theme && Site.theme.override() && a < 0.3) a = 0.62;
    return Math.max(0.2, Math.min(1, a));
  }
  function draw() {
    if (!scene) return;
    S.day = html.getAttribute('data-theme') === 'light';
    /* how far the light's centre stands above the horizon; the edge flares as it clears it */
    var lh = Math.sqrt(Math.pow(S.lx - S.cx, 2) + Math.pow(S.ly - S.cy, 2)) - S.R;
    S.leak = Math.exp(-Math.pow((lh - 0.3 * S.lr) / (1.8 * S.lr), 2));
    scene.draw(S);
  }

  /* one animation loop for everything that moves: the rising light and the odd shooting star */
  var RISE = 2800, riseAt = -1, parked = false, meteor = null, loopRaf = 0;
  function step(now) {
    if (loopRaf) cancelAnimationFrame(loopRaf);
    loopRaf = 0;
    var rest = S.limb - altitude() * S.D, hidden = S.limb + S.lr * 2.6;
    if (parked) S.ly = hidden;
    else if (riseAt >= 0) {
      var p = (now - riseAt) / RISE;
      if (p >= 1) { riseAt = -1; S.ly = rest; }
      else S.ly = hidden + (rest - hidden) * (1 - Math.pow(1 - p, 3));
    } else S.ly = rest;
    S.mi = 0;
    if (meteor) {
      var k = (now - meteor.t0) / meteor.dur;
      if (k >= 1) meteor = null;
      else {
        S.mx = meteor.x + Math.cos(meteor.a) * meteor.dist * k;
        S.my = meteor.y + Math.sin(meteor.a) * meteor.dist * k;
        S.ma = meteor.a;
        S.ml = meteor.len * Math.min(1, k * 3);                 /* the trail grows, then the streak fades */
        S.mi = Math.sin(Math.PI * Math.min(1, k * 1.15)) * meteor.b;
      }
    }
    draw();
    if (riseAt >= 0 || meteor) loopRaf = requestAnimationFrame(step);
  }
  function kick() { if (!loopRaf) loopRaf = requestAnimationFrame(step); }
  function rise() {
    parked = false;
    riseAt = reduce.matches ? -1 : performance.now();
    step(performance.now());
  }
  layout();
  if (again) step(performance.now()); else rise();
  /* on a theme switch the new scene appears with its light still below the horizon; it rises once the
     pixel wave has finished, so the two motions never compete */
  document.addEventListener('site:theme', function () { parked = !reduce.matches; riseAt = -1; meteor = null; step(performance.now()); });
  document.addEventListener('site:theme-settled', rise);
  setInterval(function () { if (riseAt < 0 && !parked) step(performance.now()); }, 5 * 60 * 1000);

  /* a shooting star every 15-45 s or so, only at night, only while the hero is on screen */
  function shootingStar() {
    var right = Math.random() < 0.5, ang = (right ? 0.32 : Math.PI - 0.32) + (Math.random() - 0.5) * 0.3;
    meteor = {
      t0: performance.now(), dur: 650 + Math.random() * 450,
      x: S.w * (right ? 0.18 + Math.random() * 0.45 : 0.4 + Math.random() * 0.5), y: S.h * (0.04 + Math.random() * 0.26),
      a: ang, dist: Math.min(S.w, 900) * (0.22 + Math.random() * 0.18), len: 90 + Math.random() * 110, b: 0.7 + Math.random() * 0.5,
    };
    kick();
  }
  function scheduleMeteor() {
    setTimeout(function () {
      if (!reduce.matches && scene && heroOnScreen && !document.hidden && !S.day && !meteor && riseAt < 0 && !parked) shootingStar();
      scheduleMeteor();
    }, 15000 + Math.random() * 30000);
  }
  scheduleMeteor();
  Site.shootingStar = shootingStar; /* handy from the console */

  /* pointer: the edge catches a glint under the mouse, the name a soft sheen */
  var mx = -999, my = -999, pRaf = 0;
  function pointerFrame() {
    pRaf = 0;
    var on = mx > -999, r = hero.getBoundingClientRect();
    if (scene) {
      S.px = on ? mx - r.left : -1e4;
      S.py = on ? my - r.top : -1e4;
      var pd = Math.abs(Math.sqrt(Math.pow(S.px - S.cx, 2) + Math.pow(S.py - S.cy, 2)) - S.R);
      S.pon = on ? Math.exp(-pd / 220) : 0;
      if (!loopRaf) draw();
    }
    if (nameEl) {
      var n = nameEl.getBoundingClientRect();
      nameEl.style.setProperty('--gx', on ? (mx - n.left) + 'px' : '20%');
      nameEl.style.setProperty('--gy', on ? (my - n.top) + 'px' : '20%');
    }
  }
  if (finePointer.matches) {
    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      mx = e.clientX; my = e.clientY;
      if (!pRaf) pRaf = requestAnimationFrame(pointerFrame);
    });
    hero.addEventListener('pointerleave', function () {
      mx = my = -999;
      if (!pRaf) pRaf = requestAnimationFrame(pointerFrame);
    });
  }

  /* ======================================================================
     Local details: the visitor's city, time and weather, and the sun's day there — on the hero's glass pill and in
     the cards of the "now" section. Where they are comes from the time zone alone: no location prompt, no IP lookup
     ====================================================================== */
  telemetry();

  function telemetry() {
    function fill(sel, text) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].textContent = text;
    }
    var place = null;
    var timeCard = document.querySelector('[data-w-time]');
    var arcDone = document.querySelector('.w-arc-done');
    var arcSun = document.querySelector('.w-arc-sun');
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

    /* sunrise and sunset (formulas after Astronomy Answers, accurate to about a minute) */
    var RAD = Math.PI / 180, DAY = 86400000, J1970 = 2440588, J2000 = 2451545, OBL = RAD * 23.4397;
    function sunDay(date, lat, lon) {
      var lw = -lon * RAD, phi = lat * RAD;
      var d = date / DAY - 0.5 + J1970 - J2000;
      var n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
      var ds = 0.0009 + lw / (2 * Math.PI) + n;
      var M = RAD * (357.5291 + 0.98560028 * ds);
      var L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
      var dec = Math.asin(Math.sin(OBL) * Math.sin(L));
      var noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      var w = Math.acos((Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
      if (isNaN(w)) return null; /* polar day or night */
      var toMs = function (j) { return (j + 0.5 - J1970) * DAY; };
      var set = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      return { rise: toMs(noon - (set - noon)), set: toMs(set) };
    }
    function dayOf(now, offset) {
      var day = new Date(now); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() + (offset || 0));
      return sunDay(+day, place.lat, place.lon);
    }
    function nextSun(now) {
      for (var k = 0; k <= 1; k++) {
        var t = dayOf(now, k);
        if (!t) return '';
        if (t.rise > now) return '日出 ' + hm(new Date(t.rise));
        if (t.set > now) return '日落 ' + hm(new Date(t.set));
      }
      return '';
    }
    /* the time rolls over each minute, like the digits of a clock; on arriving at the page it is simply there */
    function rollAll(sel, text, instant) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) Site.roll(els[i], text, instant);
    }
    var clockSet = false;
    function tick() {
      var now = Date.now(), t = hm(new Date(now));
      rollAll('[data-hud-time], [data-w-clock]', t, !clockSet);
      clockSet = true;
      if (!place) return;
      fill('[data-hud-sun]', nextSun(now));
      var d = dayOf(now, 0);
      if (!d) return;
      fill('[data-w-rise]', '日出 ' + hm(new Date(d.rise)));
      fill('[data-w-set]', '日落 ' + hm(new Date(d.set)));
      /* the time card: the sun's path from sunrise to sunset, walked so far, and where it is now */
      var p = (now - d.rise) / (d.set - d.rise), up = p > 0 && p < 1;
      if (timeCard) timeCard.classList.toggle('is-night', !up);
      if (arcDone) arcDone.style.strokeDasharray = (up ? p * 100 : p >= 1 ? 100 : 0).toFixed(1) + ' 100';
      if (arcSun) {
        var th = Math.PI * (1 - Math.max(0, Math.min(1, p)));
        arcSun.setAttribute('cx', up ? (150 + 136 * Math.cos(th)).toFixed(1) : -20);
        arcSun.setAttribute('cy', up ? (88 - 76 * Math.sin(th)).toFixed(1) : -20);
      }
    }
    tick();
    setInterval(tick, 10000);

    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* old browser */ }
    fetch(hero.getAttribute('data-tz-src')).then(function (r) { return r.json(); }).then(function (table) {
      var name = typeof table[tz] === 'string' ? table[tz] : tz, c = table[name];
      if (Array.isArray(c)) place = { lat: c[0], lon: c[1], city: name.split('/').pop().replace(/_/g, ' ') };
    }).catch(function () { /* keep "当地" */ }).then(function () {
      if (!place) { fill('[data-w-sky]', '没能确定你所在的城市'); return; }
      fill('[data-hud-city]', place.city);
      fill('[data-w-city]', place.city);
      tick();
      weather();
    });

    /* WMO weather codes, as Open-Meteo reports them */
    function sky(code) {
      var c = Number(code);
      if (c === 0) return '晴';
      if (c === 1) return '大致晴朗';
      if (c === 2) return '多云';
      if (c === 3) return '阴';
      if (c === 45 || c === 48) return '有雾';
      if (c >= 51 && c <= 57) return '毛毛雨';
      if (c >= 61 && c <= 67) return '下雨';
      if (c >= 71 && c <= 77) return '下雪';
      if (c >= 80 && c <= 82) return '阵雨';
      if (c === 85 || c === 86) return '阵雪';
      if (c >= 95) return '雷雨';
      return '';
    }
    function weather() {
      if (document.readyState !== 'complete') { window.addEventListener('load', weather); return; } /* after the page itself */
      var key = place.lat + ',' + place.lon, cached = null;
      try { cached = JSON.parse(localStorage.getItem('hud-weather-2') || 'null'); } catch (e) { /* no storage */ }
      if (cached && cached.k === key && Date.now() - cached.at < 20 * 60000) { showWeather(cached); return; }
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
      fetch('https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lon + '&current=temperature_2m,relative_humidity_2m,weather_code',
        { signal: ctrl ? ctrl.signal : undefined }).then(function (r) { return r.json(); }).then(function (j) {
        var w = { k: key, at: Date.now(), temp: j.current.temperature_2m, rh: j.current.relative_humidity_2m, code: j.current.weather_code };
        try { localStorage.setItem('hud-weather-2', JSON.stringify(w)); } catch (e) { /* no storage */ }
        showWeather(w);
      }).catch(function () { fill('[data-w-sky]', '暂时查不到天气'); }).then(function () { clearTimeout(timer); });
    }
    function showWeather(w) {
      var t = Number(w.temp);
      if (isNaN(t)) return;
      fill('[data-hud-temp]', Math.round(t) + '°C');
      rollAll('[data-w-temp]', Math.round(t) + '°');
      fill('[data-w-sky]', sky(w.code) || '现在');
      if (w.rh != null) fill('[data-w-humid]', '湿度 ' + Math.round(w.rh) + '%');
    }
  }

  /* ======================================================================
     The featured project's tile: the same scene, live, at the size of the tile. It follows the theme and catches
     the pointer like the big one, and is only drawn once the tile comes near the screen
     ====================================================================== */
  var liveCanvas = document.querySelector('[data-live="planet"]');
  var live = null;
  var LS = { w: 0, h: 0, dpr: 1, day: false, cx: 0, cy: 0, R: 0, lx: 0, ly: 0, lr: 12, leak: 0, px: -1e4, py: -1e4, pon: 0, mx: 0, my: 0, ma: 0, mi: 0, ml: 1 };
  function liveLayout() {
    if (!live) return;
    var w = liveCanvas.clientWidth, h = liveCanvas.clientHeight;
    if (!w || !h) return;
    LS.w = w; LS.h = h;
    LS.dpr = Math.min(window.devicePixelRatio || 1, 2);
    LS.R = 1.7 * w;
    LS.cx = 0.66 * w;
    LS.cy = 0.6 * h + LS.R;
    LS.lx = 0.76 * w;
    LS.lr = Math.max(8, Math.min(15, 0.025 * w));
    LS.ly = LS.cy - Math.sqrt(LS.R * LS.R - Math.pow(LS.lx - LS.cx, 2)) - 0.2 * h;
    liveCanvas.width = Math.round(w * LS.dpr);
    liveCanvas.height = Math.round(h * LS.dpr);
    liveDraw();
  }
  function liveDraw() {
    if (!live) return;
    LS.day = html.getAttribute('data-theme') === 'light';
    var lh = Math.sqrt(Math.pow(LS.lx - LS.cx, 2) + Math.pow(LS.ly - LS.cy, 2)) - LS.R;
    LS.leak = Math.exp(-Math.pow((lh - 0.3 * LS.lr) / (1.8 * LS.lr), 2));
    live.draw(LS);
  }
  function liveStart() {
    if (live || !liveCanvas || !Site.scene) return;
    live = Site.scene.create(liveCanvas);
    liveLayout();
  }
  if (liveCanvas) {
    if ('IntersectionObserver' in window) {
      var lio = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { lio.disconnect(); liveStart(); } }, { rootMargin: '300px' });
      lio.observe(liveCanvas);
    } else liveStart();
    document.addEventListener('site:theme', liveDraw);
    if (finePointer.matches) {
      var lRaf = 0, lx = -999, ly = -999;
      var liveFrame = function () {
        lRaf = 0;
        if (!live) return;
        var r = liveCanvas.getBoundingClientRect(), on = lx > -999;
        LS.px = on ? lx - r.left : -1e4;
        LS.py = on ? ly - r.top : -1e4;
        var pd = Math.abs(Math.sqrt(Math.pow(LS.px - LS.cx, 2) + Math.pow(LS.py - LS.cy, 2)) - LS.R);
        LS.pon = on ? Math.exp(-pd / 160) : 0;
        liveDraw();
      };
      var tileEl = liveCanvas.closest('.tile') || liveCanvas;
      tileEl.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse') return;
        lx = e.clientX; ly = e.clientY;
        if (!lRaf) lRaf = requestAnimationFrame(liveFrame);
      });
      tileEl.addEventListener('pointerleave', function () { lx = ly = -999; if (!lRaf) lRaf = requestAnimationFrame(liveFrame); });
    }
  }

  /* the blurred stand-ins under the screenshots go once the pictures are there */
  [].forEach.call(document.querySelectorAll('.tile-media .media-ph'), function (ph) {
    var img = ph.parentNode.querySelector('img');
    function gone() { ph.remove(); }
    /* downloaded is not yet drawn: wait for the decoding too, so nothing blank shows in between */
    function loaded() { if (img.decode) img.decode().then(gone, gone); else gone(); }
    if (!img) gone();
    else if (img.complete && img.naturalWidth) loaded();
    else img.addEventListener('load', loaded, { once: true });
  });

  var resizeT = 0, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      /* a phone's address bar showing or hiding changes only the height: keep the scene as it is then */
      if (window.innerWidth === lastW && Math.abs(hero.clientHeight - S.h) < 120) return;
      lastW = window.innerWidth;
      layout();
      step(performance.now());
      liveLayout();
      syncBar();
    }, 120);
  });
})();
