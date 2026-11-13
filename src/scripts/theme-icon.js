/* The theme button's icon: a moon or a sun drawn in dots, in the same pixels as the wave that changes the theme. On a
   switch the dots burst out, pick up a little colour (amber towards day, blue towards night), and settle into the other
   shape, stepping from cell to cell. Under the pointer they shimmer. As before, the icon shows what a click will bring:
   the sun at night, the moon by day. Without JavaScript the button is hidden, so it needs no other icon. */
(function () {
  'use strict';
  var buttons = document.querySelectorAll('[data-theme-toggle]');
  if (!buttons.length) return;

  var html = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var N = 11, MARGIN = 3, C = (N - 1) / 2, DUR = 720;
  var REVEAL = 170; /* the wave takes this long to uncover the button; the dots wait, so the burst can be seen */

  var SUN = [
    '.....#.....',
    '.#...#...#.',
    '...........',
    '....###....',
    '...#####...',
    '##.#####.##',
    '...#####...',
    '....###....',
    '...........',
    '.#...#...#.',
    '.....#.....',
  ];
  var MOON = [
    '....##.....',
    '..###....#.',
    '.###....###',
    '.###.....#.',
    '####.......',
    '####.......',
    '####.......',
    '#####.....#',
    '.#####...##',
    '..########.',
    '....#####..',
  ];
  function cells(rows) {
    var out = [];
    rows.forEach(function (row, y) {
      for (var x = 0; x < row.length; x++) if (row.charAt(x) === '#') out.push({ x: x, y: y });
    });
    return out;
  }
  var SHAPES = { sun: cells(SUN), moon: cells(MOON) };
  /* around the centre, so a dot travels to a neighbour on the other shape rather than across the icon */
  function byAngle(list) {
    return list.slice().sort(function (a, b) {
      return Math.atan2(a.y - C, a.x - C) - Math.atan2(b.y - C, b.x - C) || Math.hypot(a.x - C, a.y - C) - Math.hypot(b.x - C, b.y - C);
    });
  }
  function shapeFor(theme) { return theme === 'light' ? 'moon' : 'sun'; } /* what a click will bring */
  function theme() { return html.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function rgb(css) {
    var m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(css);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
  }
  function mix(a, b, k) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' + Math.round(a[1] + (b[1] - a[1]) * k) + ',' + Math.round(a[2] + (b[2] - a[2]) * k) + ')';
  }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  [].forEach.call(buttons, function (btn) {
    var canvas = document.createElement('canvas');
    canvas.className = 'px-icon';
    canvas.setAttribute('aria-hidden', 'true');
    btn.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var pitch = 2, dot = 2, raf = 0, hover = false, shown = shapeFor(theme());

    /* whole device pixels, so the dots stay sharp: with room for a gap on fine screens, touching on coarse ones */
    function size() {
      var dpr = window.devicePixelRatio || 1;
      pitch = Math.max(2, Math.round(1.9 * dpr));
      dot = pitch >= 3 ? Math.round(pitch * 0.72) : pitch;
      var side = (N + MARGIN * 2) * pitch;
      canvas.width = canvas.height = side;
      canvas.style.width = canvas.style.height = side / dpr + 'px';
      canvas.style.marginLeft = canvas.style.marginTop = -side / dpr / 2 + 'px';
    }
    function put(x, y) {
      ctx.fillRect((Math.round(x) + MARGIN) * pitch, (Math.round(y) + MARGIN) * pitch, dot, dot);
    }
    function still() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = getComputedStyle(btn).color;
      ctx.globalAlpha = 1;
      SHAPES[shown].forEach(function (c) { put(c.x, c.y); });
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

    function shimmer(now) {
      if (!hover) { raf = 0; still(); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = getComputedStyle(btn).color;
      SHAPES[shown].forEach(function (c) {
        ctx.globalAlpha = 0.74 + 0.26 * Math.sin(now * 0.006 - (c.x + c.y) * 0.75);
        put(c.x, c.y);
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(shimmer);
    }

    function morph(to, accent) {
      stop();
      var a = byAngle(SHAPES[shown]), b = byAngle(SHAPES[to]);
      var n = Math.max(a.length, b.length), dots = [];
      for (var i = 0; i < n; i++) {
        var f = a[Math.floor((i * a.length) / n)], t = b[Math.floor((i * b.length) / n)];
        dots.push({ fx: f.x, fy: f.y, tx: t.x, ty: t.y, delay: Math.random() * 0.22, angle: Math.atan2(f.y - C, f.x - C) + (Math.random() - 0.5) * 0.9, reach: 1 + Math.random() * 2 });
      }
      var base = rgb(getComputedStyle(btn).color), t0 = performance.now() + (html.classList.contains('vt-running') ? REVEAL : 0);
      shown = to;
      function frame(now) {
        var p = Math.max(0, (now - t0) / DUR);
        if (p >= 1) {
          raf = 0;
          if (hover) raf = requestAnimationFrame(shimmer); else still();
          return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        dots.forEach(function (d) {
          var q = Math.max(0, Math.min(1, (p - d.delay) / (1 - d.delay))), e = ease(q), lift = Math.sin(Math.PI * q);
          ctx.fillStyle = mix(base, accent, lift);
          put(d.fx + (d.tx - d.fx) * e + Math.cos(d.angle) * lift * d.reach, d.fy + (d.ty - d.fy) * e + Math.sin(d.angle) * lift * d.reach);
        });
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    }

    size();
    still();
    btn.addEventListener('pointerenter', function (e) {
      if (e.pointerType !== 'mouse' || reduce.matches) return;
      hover = true;
      if (!raf) raf = requestAnimationFrame(shimmer);
    });
    btn.addEventListener('pointerleave', function () { hover = false; });
    document.addEventListener('site:theme', function (e) {
      var t = (e.detail && e.detail.theme) || theme(), to = shapeFor(t);
      if (reduce.matches || to === shown) { stop(); shown = to; still(); return; }
      morph(to, t === 'light' ? [255, 170, 40] : [90, 150, 255]);
      /* the glow, once: amber towards day, blue towards night */
      btn.classList.remove('is-flash', 'to-day', 'to-night');
      void btn.offsetWidth;
      btn.classList.add('is-flash', t === 'light' ? 'to-day' : 'to-night');
    });
    btn.addEventListener('animationend', function () { btn.classList.remove('is-flash'); });
    window.addEventListener('resize', function () { if (!raf) { size(); still(); } });
  });
})();
