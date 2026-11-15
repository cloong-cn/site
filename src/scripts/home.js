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
     Local details. On the hero's glass pill: the visitor's city, time and weather and their next sunrise or sunset.
     In the time card under "now": my side — the clock where I am, the sun's day there, and how far apart we are.
     Where anyone is comes from a time zone alone: no location prompt, no IP lookup
     ====================================================================== */
  telemetry();

  function telemetry() {
    function fill(sel, text) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].textContent = text;
    }
    var place = null; /* the visitor's */
    var timeCard = document.querySelector('[data-w-time]');
    var mine = timeCard ? { tz: timeCard.getAttribute('data-tz') } : null; /* mine; lat and lon once tz.json is in */
    var arcDone = document.querySelector('.w-arc-done');
    var arcSun = document.querySelector('.w-arc-sun');
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    /* the wall clock in a time zone, as minutes ahead of UTC (null for a name this browser does not know) */
    function offsetIn(tz, now) {
      try {
        var p = {};
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
          .formatToParts(new Date(now)).forEach(function (x) { p[x.type] = x.value; });
        return Math.round((Date.UTC(+p.year, p.month - 1, +p.day, p.hour % 24, +p.minute) - Math.floor(now / 60000) * 60000) / 60000);
      } catch (e) { return null; }
    }
    function hmAt(t, off) { var d = new Date(t + off * 60000); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
    function apart(off) {
      var d = off + new Date().getTimezoneOffset(), a = Math.abs(d), h = Math.floor(a / 60), m = a % 60;
      if (!d) return '和你同一时区';
      return (d > 0 ? '比你那边快 ' : '比你那边慢 ') + (h ? h + ' 小时' : '') + (m ? (h ? ' ' : '') + m + ' 分' : '');
    }

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
    /* the sun's day k days from today, at a place: today by the visitor's calendar, or (off given) by that place's own */
    function dayOf(now, k, where, off) {
      var noon;
      if (off == null) { var day = new Date(now); day.setHours(12, 0, 0, 0); day.setDate(day.getDate() + k); noon = +day; }
      else { var w = new Date(now + off * 60000); noon = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + k, 12) - off * 60000; }
      return sunDay(noon, where.lat, where.lon);
    }
    function nextSun(now) {
      for (var k = 0; k <= 1; k++) {
        var t = dayOf(now, k, place);
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
    /* how high the sun stands at a moment, in degrees above the horizon (below it: negative). The same formulas as
       sunDay above, carried on to the hour angle (as in SunCalc) */
    function sunAlt(t, lat, lon) {
      var d = t / DAY - 0.5 + J1970 - J2000, phi = lat * RAD;
      var M = RAD * (357.5291 + 0.98560028 * d);
      var L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
      var dec = Math.asin(Math.sin(OBL) * Math.sin(L)), ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
      var H = RAD * (280.16 + 360.9856235 * d) + lon * RAD - ra;
      return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
    }
    /* the time card's chart: the day from midnight to midnight across, the sun's real height up — one scale for every
       day of the year, so a winter noon stands lower than a summer one. The horizon is at y=50; straight up (+90°) is y=5 and straight down (−90°) y=95, so nothing is ever cut off */
    var arcTrack = document.querySelector('.w-arc-track');
    var GROUND = 50, SAMPLES = 144, curveKey = '', curve = [];
    function ax(f) { return 6 + 288 * f; }
    function ay(alt) { return GROUND - alt * 0.5; }
    function pathOf(pts) { return pts.length ? 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') : ''; }
    function drawSun(now, off) {
      var w = new Date(now + off * 60000), start = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - off * 60000;
      if (curveKey !== start + ',' + mine.lat + ',' + mine.lon) {
        curveKey = start + ',' + mine.lat + ',' + mine.lon;
        curve = [];
        for (var i = 0; i <= SAMPLES; i++) curve.push([ax(i / SAMPLES), ay(sunAlt(start + i * DAY / SAMPLES, mine.lat, mine.lon))]);
        if (arcTrack) arcTrack.setAttribute('d', pathOf(curve));
      }
      var f = (now - start) / DAY, alt = sunAlt(now, mine.lat, mine.lon), sun = [ax(f), ay(alt)];
      /* the daylight walked so far: the curve above the horizon, from sunrise up to now */
      var done = curve.filter(function (p, i) { return i / SAMPLES <= f && p[1] < GROUND; });
      if (alt > 0) done.push(sun);
      if (arcDone) arcDone.setAttribute('d', pathOf(done));
      if (timeCard) timeCard.classList.toggle('is-night', alt < -0.833); /* the sun's top edge under the horizon */
      if (arcSun) { arcSun.setAttribute('cx', sun[0].toFixed(1)); arcSun.setAttribute('cy', sun[1].toFixed(1)); }
    }
    var WEEK = '日一二三四五六';
    function dateAt(t, off) {
      var d = new Date(t + off * 60000);
      return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 周' + WEEK[d.getUTCDay()];
    }
    var clockSet = false;
    function tick() {
      var now = Date.now(), off = mine ? offsetIn(mine.tz, now) : null;
      rollAll('[data-hud-time]', hm(new Date(now)), !clockSet);
      if (off != null) {
        rollAll('[data-w-clock]', hmAt(now, off), !clockSet);
        fill('[data-w-date]', dateAt(now, off));
        fill('[data-w-diff]', apart(off));
      } else if (timeCard) timeCard.hidden = true; /* a time zone this browser cannot read: no card rather than a wrong clock */
      clockSet = true;
      if (place) fill('[data-hud-sun]', nextSun(now));
      if (off == null || mine.lat == null) return;
      drawSun(now, off);
      var d = dayOf(now, 0, mine, off);
      if (!d) return; /* polar day or night: the curve says it all */
      fill('[data-w-rise]', '日出 ' + hmAt(d.rise, off));
      fill('[data-w-set]', '日落 ' + hmAt(d.set, off));
    }
    tick();
    setInterval(tick, 10000);

    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* old browser */ }
    fetch(hero.getAttribute('data-tz-src')).then(function (r) { return r.json(); }).then(function (table) {
      function at(zone) { var name = typeof table[zone] === 'string' ? table[zone] : zone, c = table[name]; return Array.isArray(c) ? { name: name, lat: c[0], lon: c[1] } : null; }
      var v = at(tz), m = mine && at(mine.tz);
      if (v) place = { lat: v.lat, lon: v.lon, city: v.name.split('/').pop().replace(/_/g, ' ') };
      if (m) { mine.lat = m.lat; mine.lon = m.lon; }
    }).catch(function () { /* keep "当地" */ }).then(function () {
      tick();
      if (!place) { fill('[data-w-sky]', '没能确定你所在的城市'); return; }
      fill('[data-hud-city]', place.city);
      fill('[data-w-city]', place.city);
      weather();
    });

    /* WMO weather codes, as Open-Meteo reports them: the words, the kind of sky (its gradient, in home.css) and what
       moves in it (sky.js) — how cloudy, how hard it rains or snows, and whether there is sleet, hail or lightning */
    var WX = {
      0: ['晴', 'clear', { cloud: 0 }], 1: ['大致晴朗', 'clear', { cloud: 0.2 }], 2: ['多云', 'cloudy', { cloud: 0.55 }], 3: ['阴', 'overcast', { cloud: 1 }],
      45: ['有雾', 'fog', { cloud: 0.3, fog: 0.8 }], 48: ['雾凇', 'fog', { cloud: 0.3, fog: 0.95 }],
      51: ['小毛毛雨', 'drizzle', { cloud: 0.8, rain: 0.3, drizzle: true }], 53: ['毛毛雨', 'drizzle', { cloud: 0.85, rain: 0.5, drizzle: true }],
      55: ['较强毛毛雨', 'drizzle', { cloud: 0.9, rain: 0.75, drizzle: true }],
      56: ['冻毛毛雨', 'sleet', { cloud: 0.9, rain: 0.4, drizzle: true, sleet: true }], 57: ['强冻毛毛雨', 'sleet', { cloud: 0.9, rain: 0.7, drizzle: true, sleet: true }],
      61: ['小雨', 'rain', { cloud: 0.9, rain: 0.4 }], 63: ['中雨', 'rain', { cloud: 0.95, rain: 0.7 }], 65: ['大雨', 'heavy-rain', { cloud: 1, rain: 1 }],
      66: ['冻雨', 'sleet', { cloud: 0.95, rain: 0.5, sleet: true }], 67: ['强冻雨', 'sleet', { cloud: 1, rain: 0.9, sleet: true }],
      71: ['小雪', 'snow', { cloud: 0.85, snow: 0.35 }], 73: ['中雪', 'snow', { cloud: 0.9, snow: 0.65 }], 75: ['大雪', 'snow', { cloud: 1, snow: 1 }],
      77: ['米雪', 'snow', { cloud: 0.9, snow: 0.45 }],
      80: ['阵雨', 'rain', { cloud: 0.75, rain: 0.5 }], 81: ['较强阵雨', 'rain', { cloud: 0.85, rain: 0.75 }], 82: ['强阵雨', 'heavy-rain', { cloud: 1, rain: 1 }],
      85: ['阵雪', 'snow', { cloud: 0.8, snow: 0.5 }], 86: ['强阵雪', 'snow', { cloud: 0.95, snow: 1 }],
      95: ['雷阵雨', 'storm', { cloud: 1, rain: 0.8, storm: true }], 96: ['雷阵雨伴有冰雹', 'storm', { cloud: 1, rain: 0.7, storm: true, hail: true }],
      99: ['强雷阵雨伴有冰雹', 'storm', { cloud: 1, rain: 1, storm: true, hail: true }],
    };
    var BEAUFORT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    function force(kmh) { var n = 0; while (n < BEAUFORT.length && kmh >= BEAUFORT[n]) n++; return n; }
    function windName(kmh, from) {
      var f = force(kmh);
      return f ? ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round((from || 0) / 45) % 8] + '风 ' + f + ' 级' : '无风';
    }
    /* the weather in words and as a sky. Open-Meteo has no code for a typhoon, so the wind decides: at force 12
       (118 km/h, the line for 台风 in Chinese forecasts) the sky becomes a typhoon's; from force 8 it says 大风 */
    function sky(code, day, wind) {
      var e = WX[Number(code)] || ['', 'cloudy', { cloud: 0.5 }], fx = {}, k;
      for (k in e[2]) fx[k] = e[2][k];
      var text = e[0], kind = e[1], f = force(Number(wind) || 0);
      if (kind === 'clear' || kind === 'cloudy') kind += day ? '-day' : '-night';
      if (f >= 12) { kind = 'typhoon'; text = '台风级大风' + (fx.rain ? ' · ' + text : ''); fx.cloud = 1; fx.rain = Math.max(fx.rain || 0, 0.85); }
      else if (f >= 8) text = (text ? text + ' · ' : '') + '大风';
      return { text: text, kind: kind, fx: fx };
    }
    /* a sky to look at without waiting for the weather: ?sky=typhoon (or clear, cloudy, overcast, fog, drizzle, rain,
       heavy-rain, sleet, snow, storm, hail, gale), and &night=1. It changes only what this page shows */
    var SAMPLE = { clear: [0, 8], cloudy: [2, 12], overcast: [3, 14], fog: [45, 4], drizzle: [53, 10], rain: [63, 18], 'heavy-rain': [65, 30], sleet: [66, 16],
      snow: [73, 12], storm: [95, 34], hail: [99, 40], gale: [3, 70], typhoon: [65, 135] };
    function sample(w) {
      var q = /[?&]sky=([\w-]+)/.exec(location.search), s = q && SAMPLE[q[1]];
      if (!s) return w;
      var o = {}, k;
      for (k in w) o[k] = w[k];
      o.code = s[0]; o.wind = s[1]; o.dir = 300; o.day = /[?&]night=1/.test(location.search) ? 0 : 1;
      return o;
    }
    /* hand the weather to the canvas painter of a sky (one for the card, one for the week), made on first use */
    function paint(el, s, w, alt, quiet) {
      if (!el || !Site.sky) return;
      var c = el.querySelector('.w-sky-fx');
      var p = c && (c._sky || (c._sky = Site.sky.create(c)));
      if (!p) return;
      var st = { night: w.day === 0, wind: Number(w.wind) || 0, windDir: w.dir, sunAlt: alt, south: place.lat < 0, cloud: 0, rain: 0, snow: 0, fog: 0 };
      for (var k in s.fx) st[k] = s.fx[k];
      if (quiet) { st.rain *= 0.5; st.snow *= 0.5; } /* behind a list of words: the same weather, more sparsely */
      p.set(st);
    }
    /* the weather where the visitor is, from Open-Meteo: for the pill and the weather card */
    var weatherCard = document.querySelector('[data-w-weather]');
    function weather() {
      if (document.readyState !== 'complete') { window.addEventListener('load', weather); return; } /* after the page itself */
      var key = place.lat + ',' + place.lon, cached = null;
      try { cached = JSON.parse(localStorage.getItem('hud-weather-5') || 'null'); } catch (e) { /* no storage */ }
      if (cached && cached.k === key && Date.now() - cached.at < 20 * 60000) { showWeather(cached); return; }
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
      /* now, and the next seven days (today first), in one request; the days are dated by the visitor's own calendar */
      fetch('https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lon +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=7',
        { signal: ctrl ? ctrl.signal : undefined }).then(function (r) { return r.json(); }).then(function (j) {
        var c = j.current, dl = j.daily || {}, at = function (k, i) { return dl[k] ? dl[k][i] : null; };
        var days = (dl.time || []).map(function (t, i) {
          return { date: t, code: at('weather_code', i), hi: at('temperature_2m_max', i), lo: at('temperature_2m_min', i), rain: at('precipitation_probability_max', i), wind: at('wind_speed_10m_max', i) };
        }).filter(function (d) { return d.hi != null && d.lo != null; });
        var w = { k: key, at: Date.now(), temp: c.temperature_2m, feel: c.apparent_temperature, rh: c.relative_humidity_2m, code: c.weather_code, day: c.is_day,
          wind: c.wind_speed_10m, dir: c.wind_direction_10m, hi: days[0] && days[0].hi, lo: days[0] && days[0].lo, days: days };
        try { localStorage.setItem('hud-weather-5', JSON.stringify(w)); } catch (e) { /* no storage */ }
        showWeather(w);
      }).catch(function () { fill('[data-w-sky]', '暂时查不到天气'); }).then(function () { clearTimeout(timer); });
    }
    function deg(v) { return Math.round(v) + '°'; }
    /* the sky's look: its kind, night, and dawn or dusk (the sun within 6° of the horizon, for a clear or cloudy sky) */
    function dress(el, s, w, alt) {
      el.setAttribute('data-sky', s.kind);
      el.toggleAttribute('data-night', w.day === 0);
      el.toggleAttribute('data-dusk', /^(clear|cloudy)/.test(s.kind) && alt > -6 && alt < 6);
    }
    function showWeather(real) {
      var w = sample(real), t = Number(w.temp);
      if (isNaN(t)) return;
      fill('[data-hud-temp]', Math.round(t) + '°C');
      if (!weatherCard) return;
      var s = sky(w.code, w.day !== 0, w.wind), alt = sunAlt(Date.now(), place.lat, place.lon);
      dress(weatherCard, s, w, alt);
      paint(weatherCard, s, w, alt);
      rollAll('[data-w-temp]', deg(t));
      fill('[data-w-sky]', s.text || '现在');
      fill('[data-w-range]', w.hi != null && w.lo != null ? deg(w.lo) + ' / ' + deg(w.hi) : '');
      fill('[data-w-feel]', (w.feel != null ? '体感 ' + deg(w.feel) : '') + (w.rh != null ? ' · 湿度 ' + Math.round(w.rh) + '%' : ''));
      fill('[data-w-wind]', w.wind != null ? windName(w.wind, w.dir) : '');
      week(w, s, alt);
    }

    /* ---------- the week: the weather card opens a dialog with the next seven days, on the same sky ---------- */
    var weekDialog = document.querySelector('[data-w-week]');
    var weekList = document.querySelector('[data-w-days]');
    var weekOpen = document.querySelector('[data-w-week-open]');
    /* small line icons, one for each kind of sky (the days are all drawn by daylight) */
    var CLOUD = '<path d="M7.2 17.5h9.6a3.6 3.6 0 0 0 .5-7.16A5.2 5.2 0 0 0 7.3 11a3.27 3.27 0 0 0-.1 6.5z"/>';
    var UP = '<path d="M7.2 14h9.6a3.6 3.6 0 0 0 .5-7.16A5.2 5.2 0 0 0 7.3 7.5a3.27 3.27 0 0 0-.1 6.5z"/>';
    var ICON = {
      'clear-day': '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
      'cloudy-day': '<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 2.8v1.4M2.8 8.5h1.4M4.5 4.5l1 1M12.5 4.5l-1 1"/><path d="M9.4 19h8.4a3.2 3.2 0 0 0 .4-6.37 4.6 4.6 0 0 0-8.9.9 2.9 2.9 0 0 0 .1 5.47z"/>',
      overcast: CLOUD,
      fog: '<path d="M4 8h16M2.5 12h19M4 16h16M7 20h10"/>',
      drizzle: UP + '<path d="M9 17v1.2M12 18.5v1.2M15 17v1.2M10.5 21v.6M13.5 21v.6"/>',
      rain: UP + '<path d="M8.5 16.8l-1 3M12.5 16.8l-1 3M16.5 16.8l-1 3"/>',
      'heavy-rain': UP + '<path d="M7.5 16.5l-1.4 4.4M10.7 16.5l-1.4 4.4M13.9 16.5l-1.4 4.4M17.1 16.5l-1.4 4.4"/>',
      sleet: UP + '<path d="M9 16.8l-1 3M15 16.8l-1 3M12 18h.01M11 21.5h.01M16.5 21h.01"/>',
      snow: UP + '<path d="M8.5 18h.01M12 20h.01M15.5 18h.01M10 21.5h.01M14 21.5h.01"/>',
      storm: UP + '<path d="M12.8 14.5l-2.3 3.6h3l-2.3 3.6"/>',
      /* the typhoon sign of weather maps: an eye and two hooked arms */
      typhoon: '<circle cx="12" cy="12" r="2.6"/><path d="M14.6 12A6.6 6.6 0 0 0 8 5.4c-1.7 0-3.1.5-4.2 1.4M9.4 12A6.6 6.6 0 0 0 16 18.6c1.7 0 3.1-.5 4.2-1.4"/>',
    };
    function icon(kind) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[kind] || CLOUD) + '</svg>'; }
    function week(w, s, alt) {
      if (!weekDialog || !weekList || !weekOpen || !weekDialog.showModal || !w.days || w.days.length < 2) return;
      dress(weekDialog, s, w, alt);
      paint(weekDialog, s, w, alt, true);
      fill('[data-w-week-temp]', deg(w.temp));
      fill('[data-w-week-sky]', s.text + (w.lo != null && w.hi != null ? '  ' + deg(w.lo) + ' / ' + deg(w.hi) : ''));
      /* one scale for the whole week, so the bars can be read against each other */
      var lo = Math.min.apply(null, w.days.map(function (d) { return d.lo; }));
      var hi = Math.max.apply(null, w.days.map(function (d) { return d.hi; }));
      var range = Math.max(1, hi - lo), frac = function (v) { return Math.max(0, Math.min(1, (v - lo) / range)).toFixed(3); };
      weekList.innerHTML = w.days.map(function (d, i) {
        var day = sky(d.code, true, d.wind), t = [day.text, day.kind], p = String(d.date).split('-');
        var name = i === 0 ? '今天' : i === 1 ? '明天' : '周' + WEEK[new Date(+p[0], p[1] - 1, +p[2]).getDay()];
        var rain = d.rain != null && d.rain >= 20 ? '<small class="num">' + Math.round(d.rain) + '%</small>' : '';
        var dot = i === 0 && !isNaN(Number(w.temp)) ? '<b class="w-day-now" style="--x:' + frac(w.temp) + '"></b>' : '';
        return '<li class="w-day"><span class="w-day-name">' + name + '<small class="num">' + (+p[1]) + '/' + (+p[2]) + '</small></span>' +
          '<span class="w-day-icon">' + icon(t[1]) + rain + '</span><span class="w-day-sky">' + (t[0] || '—') + '</span>' +
          '<span class="w-day-lo num">' + deg(d.lo) + '</span>' +
          '<span class="w-day-bar"><i style="--l:' + frac(d.lo) + ';--r:' + (1 - frac(d.hi)).toFixed(3) + '"></i>' + dot + '</span>' +
          '<span class="w-day-hi num">' + deg(d.hi) + '</span></li>';
      }).join('');
      weekOpen.hidden = false;
      weatherCard.classList.add('has-week');
    }
    if (weekOpen && weekDialog && weekDialog.showModal) {
      weekOpen.addEventListener('click', function () { weekDialog.showModal(); });
      /* closed by its button, by Esc (the browser's own), or by a click outside it */
      weekDialog.addEventListener('click', function (e) {
        if (e.target === weekDialog || e.target.closest('[data-w-week-close]')) weekDialog.close();
      });
      weekDialog.addEventListener('close', function () { weekOpen.focus({ preventScroll: true }); });
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
