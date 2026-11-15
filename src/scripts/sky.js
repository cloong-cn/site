/* Weather skies: what moves over the weather card's background. The gradient underneath is CSS (home.css, .w-sky);
   this paints the rest into a canvas: the sun or the moon (in its real phase), stars, drifting clouds, fog, rain,
   sleet, snow, hail, gusts of wind and lightning.
   Site.sky.create(canvas) gives a painter, and painter.set(state) tells it the weather:
     { night, cloud 0-1, rain 0-1, drizzle, sleet, snow 0-1, hail, storm, fog 0-1,
       wind (km/h), windDir (degrees, where it blows from), sunAlt (degrees), south (southern hemisphere) }
   It only animates while the canvas is on screen and the tab is in front; with reduced motion it paints one still frame */
(function () {
  'use strict';

  var Site = window.Site = window.Site || {};
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var TAU = Math.PI * 2;

  /* the same "random" numbers on every visit, so the sky does not reshuffle on each repaint */
  function seeded(seed) {
    var s = seed % 2147483647 || 1;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  /* wind force on the Beaufort scale (the 级 of a Chinese forecast), from km/h */
  var BEAUFORT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  function beaufort(kmh) { var n = 0; while (n < BEAUFORT.length && kmh >= BEAUFORT[n]) n++; return n; }
  /* how far through its cycle the moon is: 0 new, 0.5 full (mean synodic month from a known new moon) */
  function moonPhase(t) { var p = (t / 86400000 + 2440587.5 - 2451550.26) / 29.530588853; return p - Math.floor(p); }

  /* a cloud, drawn once into a canvas of its own from soft puffs: tallest in the middle, flat underneath */
  function cloudSprite(rgb, seed) {
    var r = seeded(seed), c = document.createElement('canvas');
    c.width = 360; c.height = 170;
    var g = c.getContext('2d');
    for (var i = 0; i < 12; i++) {
      var u = r(), x = 60 + u * 240, mid = 1 - Math.abs(u - 0.5) * 2;
      var rad = 24 + 48 * mid * (0.6 + r() * 0.4), y = 112 - rad * 0.5 + (r() - 0.5) * 12;
      var gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(' + rgb + ',.5)');
      gr.addColorStop(0.55, 'rgba(' + rgb + ',.3)');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
    return c;
  }
  /* a long, flat band of mist */
  function fogSprite() {
    var c = document.createElement('canvas');
    c.width = 400; c.height = 100;
    var g = c.getContext('2d'), gr = g.createRadialGradient(200, 200, 0, 200, 200, 200);
    gr.addColorStop(0, 'rgba(255,255,255,.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.setTransform(1, 0, 0, 0.25, 0, 0);
    g.fillStyle = gr;
    g.fillRect(0, 0, 400, 400);
    return c;
  }

  function create(canvas) {
    var ctx = canvas && canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    var S = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, onScreen = !('IntersectionObserver' in window);
    var clouds = [], drops = [], flakes = [], stones = [], gusts = [], stars = [], mists = [];
    var sprites = null, tint = '', mist = null, flash = 0, bolt = null, boltAt = 0;

    /* which way the wind carries things across the screen: +1 to the right, -1 to the left (never quite still) */
    function side() {
      var s = Math.sin(((S.windDir == null ? 270 : S.windDir) + 180) * Math.PI / 180);
      return Math.abs(s) < 0.25 ? (s < 0 ? -0.25 : 0.25) : s;
    }
    /* sideways speed of what falls, px/s: a typhoon drives the rain nearly flat */
    function drift() { return side() * Math.min(S.wind || 0, 160) * 4.5; }

    function populate() {
      var r = seeded(7919), A = (W * H) / (400 * 240), i;
      var shade = S.storm || S.rain >= 0.9 ? '150,160,178' : S.night ? '150,166,196' : S.cloud >= 1 ? '228,232,239' : '255,255,255';
      if (shade !== tint) { tint = shade; sprites = [cloudSprite(shade, 11), cloudSprite(shade, 23), cloudSprite(shade, 37)]; }
      clouds = [];
      for (i = 0; i < Math.round(S.cloud * 7); i++) {
        var s = (0.5 + r() * 0.55) * (W / 360) * (S.cloud >= 1 ? 1.3 : 1);
        /* fainter when it snows: white on white would hide the words */
        clouds.push({ img: sprites[i % 3], s: s, x: r() * (W + 360 * s) - 360 * s, y: H * (-0.12 + r() * 0.5), a: (0.5 + r() * 0.5) * (S.snow ? 0.6 : 1), v: 0.6 + r() * 0.8 });
      }
      clouds.sort(function (a, b) { return a.s - b.s; }); /* the small, far ones first */
      stars = [];
      if (S.night) for (i = 0; i < Math.round(70 * A); i++) stars.push({ x: r() * W, y: r() * H * 0.8, r: 0.4 + r() * 1.1, a: 0.4 + r() * 0.6, ph: r() * TAU, sp: 0.6 + r() * 1.8 });
      drops = [];
      var nd = Math.round((S.drizzle ? 90 : 160) * (S.rain || 0) * A);
      for (i = 0; i < nd; i++) {
        drops.push({ x: r() * W, y: r() * H, a: 0.2 + r() * 0.45,
          l: S.drizzle ? 4 + r() * 5 : (10 + r() * 14) * (0.7 + S.rain * 0.6),
          v: (S.drizzle ? 230 : 640) * (0.75 + r() * 0.5) * (S.drizzle ? 1 : 0.8 + S.rain * 0.4) });
      }
      flakes = [];
      for (i = 0; i < Math.round(110 * (S.snow || 0) * A); i++) flakes.push({ x: r() * W, y: r() * H, r: 0.8 + r() * 2.4, v: 22 + r() * 48, ph: r() * TAU, f: 0.5 + r(), sw: 8 + r() * 18, a: 0.55 + r() * 0.45 });
      stones = [];
      if (S.hail) for (i = 0; i < Math.round(36 * A); i++) stones.push({ x: r() * W, y: r() * H, r: 1.3 + r() * 1.4, v: 520 + r() * 260 });
      gusts = [];
      var level = beaufort(S.wind || 0);
      for (i = 0; i < (level >= 6 ? (level - 5) * 3 : 0); i++) gusts.push({ x: r() * W, y: H * (0.1 + r() * 0.85), l: 40 + r() * 90, c: (r() - 0.5) * 18, v: 260 + (S.wind || 0) * 5 * (0.7 + r() * 0.6), a: 0.12 + r() * 0.2 });
      mists = [];
      if (S.fog) {
        if (!mist) mist = fogSprite();
        for (i = 0; i < 5; i++) mists.push({ x: r() * W - W * 0.3, y: H * (0.2 + i * 0.16) + (r() - 0.5) * 16, s: (W * (1.2 + r() * 0.6)) / 400, v: 4 + r() * 8, a: 0.55 + r() * 0.45 });
      }
    }

    function sun(now, a) {
      var alt = S.sunAlt == null ? 40 : S.sunAlt, low = Math.max(0, Math.min(1, (14 - alt) / 14));
      var m = Math.min(W, H), R = m * 1.15, x = W * 0.82, y = H * (0.12 + 0.24 * Math.max(0, Math.min(1, 1 - alt / 60)));
      /* lower in the sky it turns from white-gold to orange, as it really does */
      var core = low > 0.5 ? '255,214,166' : '255,248,226', halo = low > 0.5 ? '255,160,96' : '255,224,150';
      var g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, 'rgba(' + core + ',' + 0.95 * a + ')');
      g.addColorStop(0.07, 'rgba(' + core + ',' + 0.85 * a + ')');
      g.addColorStop(0.2, 'rgba(' + halo + ',' + 0.32 * a + ')');
      g.addColorStop(1, 'rgba(' + halo + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      /* a few long, faint beams, turning very slowly */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(x, y);
      ctx.rotate((now / 1000) * 0.03);
      ctx.fillStyle = 'rgb(' + core + ')';
      for (var i = 0; i < 7; i++) {
        ctx.rotate(TAU / 7);
        ctx.globalAlpha = 0.045 * a * (1 + 0.35 * Math.sin((now / 1000) * 0.4 + i * 1.7));
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 1.4, -R * 0.07); ctx.lineTo(R * 1.4, R * 0.07); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    /* the moon as it is tonight: lit on the right while waxing (seen from the north; mirrored in the south) */
    function moon(a) {
      var m = Math.min(W, H), x = W * 0.8, y = H * 0.22, r = m * 0.07, p = moonPhase(Date.now());
      var lit = (1 - Math.cos(TAU * p)) / 2;
      var g = ctx.createRadialGradient(x, y, r, x, y, r * 5);
      g.addColorStop(0, 'rgba(226,234,255,' + (0.08 + 0.2 * lit) * a + ')');
      g.addColorStop(1, 'rgba(226,234,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 5, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      if (S.south) ctx.scale(-1, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(243,239,226,.13)'; /* the dark part, faintly: earthshine */
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      var c = Math.cos(TAU * p), waxing = p < 0.5;
      ctx.fillStyle = '#f4f0e3';
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, !waxing);
      ctx.ellipse(0, 0, r * Math.abs(c), r, 0, Math.PI / 2, -Math.PI / 2, waxing ? c > 0 : c < 0);
      ctx.fill();
      ctx.restore();
    }

    function makeBolt() {
      var x = W * (0.2 + Math.random() * 0.6), y = 0, pts = [[x, y]], end = H * (0.5 + Math.random() * 0.35);
      while (y < end) { y += H * (0.05 + Math.random() * 0.07); x += (Math.random() - 0.5) * W * 0.09; pts.push([x, y]); }
      return { pts: pts, again: false };
    }

    function draw(now, dt) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var k = S.wind || 0, dir = side(), hv = drift(), t = now / 1000, i, p;

      if (stars.length) {
        var clear = 1 - S.cloud * 0.85;
        ctx.fillStyle = '#fff';
        for (i = 0; i < stars.length; i++) {
          p = stars[i];
          ctx.globalAlpha = Math.max(0, clear * p.a * (0.55 + 0.45 * Math.sin(t * p.sp + p.ph)));
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (S.cloud < 0.97) { if (S.night) moon(1 - S.cloud * 0.8); else sun(now, 1 - S.cloud * 0.8); }

      for (i = 0; i < clouds.length; i++) {
        p = clouds[i];
        var cw = 360 * p.s;
        p.x += (5 + k * 0.5) * dir * p.v * dt;
        if (dir > 0 && p.x > W) p.x = -cw;
        if (dir < 0 && p.x < -cw) p.x = W;
        ctx.globalAlpha = p.a;
        ctx.drawImage(p.img, p.x, p.y, cw, 170 * p.s);
      }
      for (i = 0; i < mists.length; i++) {
        p = mists[i];
        var mw = 400 * p.s;
        p.x += p.v * dir * dt;
        if (p.x > W) p.x = -mw;
        if (p.x < -mw) p.x = W;
        ctx.globalAlpha = p.a * S.fog;
        ctx.drawImage(mist, p.x, p.y - 50 * p.s * 0.5, mw, 100 * p.s * 0.5);
      }
      ctx.globalAlpha = 1;

      if (drops.length) {
        ctx.strokeStyle = S.sleet ? '#dcecff' : '#fff';
        ctx.lineWidth = S.drizzle ? 1 : 1.25;
        ctx.lineCap = 'round';
        for (i = 0; i < drops.length; i++) {
          p = drops[i];
          p.y += p.v * dt;
          p.x += hv * dt;
          if (p.y - p.l > H) { p.y = -Math.random() * 40; p.x = Math.random() * W; }
          if (p.x > W + 30) p.x -= W + 60;
          if (p.x < -30) p.x += W + 60;
          ctx.globalAlpha = p.a;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - (hv / p.v) * p.l, p.y - p.l); ctx.stroke();
          /* sleet: a frozen bead at the head of some drops */
          if (S.sleet && i % 3 === 0) { ctx.fillStyle = '#eef6ff'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, TAU); ctx.fill(); }
        }
      }
      if (flakes.length) {
        ctx.fillStyle = '#fff';
        for (i = 0; i < flakes.length; i++) {
          p = flakes[i];
          p.y += p.v * dt;
          p.x += (hv * 0.3 + Math.sin(t * p.f + p.ph) * p.sw) * dt;
          if (p.y - p.r > H) { p.y = -4; p.x = Math.random() * W; }
          if (p.x > W + 6) p.x -= W + 12;
          if (p.x < -6) p.x += W + 12;
          ctx.globalAlpha = p.a;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        }
      }
      if (stones.length) {
        ctx.fillStyle = '#f2f7ff';
        for (i = 0; i < stones.length; i++) {
          p = stones[i];
          p.y += p.v * dt;
          p.x += hv * 0.5 * dt;
          if (p.y > H + 4) { p.y = -4; p.x = Math.random() * W; }
          ctx.globalAlpha = 0.85;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        }
      }
      if (gusts.length) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        for (i = 0; i < gusts.length; i++) {
          p = gusts[i];
          p.x += p.v * dir * dt;
          if (dir > 0 && p.x - p.l > W) { p.x = -10; p.y = H * (0.1 + Math.random() * 0.85); }
          if (dir < 0 && p.x + p.l < 0) { p.x = W + 10; p.y = H * (0.1 + Math.random() * 0.85); }
          ctx.globalAlpha = p.a;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x - dir * p.l * 0.5, p.y + p.c, p.x - dir * p.l, p.y); ctx.stroke();
        }
      }

      /* lightning: every few seconds a bolt, a bright flash and a second, weaker flicker */
      if (S.storm && dt) {
        if (!boltAt) boltAt = now + 1200 + Math.random() * 2500;
        if (now > boltAt) { flash = 1; bolt = makeBolt(); boltAt = now + 3500 + Math.random() * 6000; }
      }
      if (flash > 0.02) {
        if (bolt && flash > 0.4) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, flash * 1.2);
          ctx.strokeStyle = '#f4f7ff';
          ctx.lineWidth = 2;
          ctx.shadowColor = 'rgba(190,210,255,.95)';
          ctx.shadowBlur = 14;
          ctx.beginPath();
          for (i = 0; i < bolt.pts.length; i++) ctx[i ? 'lineTo' : 'moveTo'](bolt.pts[i][0], bolt.pts[i][1]);
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = flash * 0.42;
        ctx.fillStyle = '#e6edff';
        ctx.fillRect(0, 0, W, H);
        flash *= Math.exp(-dt * 6);
        if (bolt && !bolt.again && flash < 0.25) { flash = 0.75; bolt.again = true; }
      }
      ctx.globalAlpha = 1;
    }

    /* size the canvas to its box; a new size (or a new weather) refills the sky */
    function fit(force) {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return false;
      if (force || w !== W || h !== H) {
        W = w; H = h;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        populate();
      }
      return true;
    }
    function live() { return S && onScreen && !document.hidden && !reduce.matches; }
    function frame(now) {
      raf = 0;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      draw(now, dt);
      if (live()) raf = requestAnimationFrame(frame);
    }
    function go(force) {
      if (!S || !fit(force)) return;
      if (live()) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
      else draw(performance.now(), 0); /* a still frame */
    }

    if (!onScreen) new IntersectionObserver(function (es) { onScreen = es[es.length - 1].isIntersecting; go(); }).observe(canvas);
    if ('ResizeObserver' in window) new ResizeObserver(function () { go(); }).observe(canvas);
    document.addEventListener('visibilitychange', function () { go(); });
    if (reduce.addEventListener) reduce.addEventListener('change', function () { go(); });

    return { set: function (state) { S = state; boltAt = 0; flash = 0; go(true); } };
  }

  Site.sky = { create: create, beaufort: beaufort };
})();
