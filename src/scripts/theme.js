/* Theme — follows the visitor's local time (daytime = light, night = dark) until they choose one.
   Toggling uses a View Transition: the new theme is revealed through a pixel-block edge that spreads
   from the button, with a glass shimmer on the blocks at the edge.
   Flash-free by design: CSS transitions are off while the new snapshot is taken, the new view starts
   fully clipped, every block switches exactly once, and pages can preload what the new theme needs. */
(function () {
  'use strict';

  var html = document.documentElement;
  var KEY = 'theme-override';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var busy = false;

  function autoTheme() {
    var d = new Date();
    var h = d.getHours() + d.getMinutes() / 60;
    return Math.sin(Math.PI * (h - 6) / 12) > 0.1 ? 'light' : 'dark';
  }
  function current() { return html.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function override() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      return o && o.exp > Date.now() ? o.t : null;
    } catch (e) { return null; }
  }
  function remember(t) {
    try {
      if (t === autoTheme()) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify({ t: t, exp: Date.now() + 6 * 3600 * 1000 }));
    } catch (e) { /* private mode: the choice just isn't kept */ }
  }
  function label(t) {
    var text = t === 'light' ? '切换到黑夜模式' : '切换到白天模式';
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) { btns[i].setAttribute('aria-label', text); btns[i].setAttribute('title', text); }
  }
  function apply(t) {
    html.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#ffffff' : '#000000');
    label(t);
    document.dispatchEvent(new CustomEvent('site:theme', { detail: { theme: t } }));
  }

  /* ---------- pixel reveal ---------- */
  var CS = 20, BAND = 140, DUR = 1000, FRAMES = 48;

  function radius(p, maxR) { return (1 - Math.cos(Math.PI * p)) / 2 * (maxR + BAND); }
  function makeGrid(W, H) {
    var cols = Math.ceil(W / CS), rows = Math.ceil(H / CS), noise = new Float32Array(cols * rows);
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
        noise[j * cols + i] = h - Math.floor(h);
      }
    }
    return { cols: cols, rows: rows, noise: noise };
  }
  /* each block has its own fixed threshold, so once the wave reaches it, it stays revealed */
  function clipPath(g, o, R, W, H, full) {
    if (full) return 'path("M0 0H' + Math.ceil(W) + 'V' + Math.ceil(H) + 'H0Z")';
    var out = '';
    for (var j = 0; j < g.rows; j++) {
      var cy = j * CS + CS / 2, run = -1;
      for (var i = 0; i <= g.cols; i++) {
        var on = false;
        if (i < g.cols) {
          var cx = i * CS + CS / 2, dx = cx - o.x, dy = cy - o.y;
          on = Math.sqrt(dx * dx + dy * dy) < R - BAND + g.noise[j * g.cols + i] * BAND;
        }
        if (on && run < 0) run = i;
        else if (!on && run >= 0) {
          out += 'M' + run * CS + ' ' + j * CS + 'h' + (i - run) * CS + 'v' + CS + 'h' + (run - i) * CS + 'z';
          run = -1;
        }
      }
    }
    return 'path("' + (out || 'M0 0z') + '")';
  }
  /* glass blocks shimmer just ahead of the edge and fade out just behind it */
  function shimmer(g, o, maxR, W, H) {
    var cvs = document.querySelector('.vt-overlay');
    if (!cvs || !cvs.getContext) return;
    var ctx = cvs.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var t0 = performance.now();
    function frame(now) {
      var p = (now - t0) / DUR;
      ctx.clearRect(0, 0, W, H);
      if (p >= 1) return;
      var R = radius(p, maxR), fade = p < 0.85 ? 1 : (1 - p) / 0.15;
      for (var j = 0; j < g.rows; j++) {
        var cy = j * CS + CS / 2;
        for (var i = 0; i < g.cols; i++) {
          var cx = i * CS + CS / 2, dx = cx - o.x, dy = cy - o.y;
          var diff = R - BAND + g.noise[j * g.cols + i] * BAND - Math.sqrt(dx * dx + dy * dy);
          if (diff < -26 || diff > 64) continue;
          var k = (diff < 0 ? (1 + diff / 26) * 0.35 : 1 - diff / 64) * fade;
          var x = i * CS + 1.5, y = j * CS + 1.5, s = CS - 3;
          ctx.fillStyle = 'rgba(255,255,255,' + (0.16 * k).toFixed(3) + ')';
          ctx.fillRect(x, y, s, s);
          ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * k).toFixed(3) + ')';
          ctx.fillRect(x, y, s, 1);
          ctx.fillRect(x, y, 1, s);
          ctx.fillStyle = 'rgba(0,0,0,' + (0.18 * k).toFixed(3) + ')';
          ctx.fillRect(x, y + s - 1, s, 1);
          ctx.fillRect(x + s - 1, y, 1, s);
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function switchTo(next, origin) {
    if (busy || next === current()) return Promise.resolve();
    busy = true;
    remember(next);
    return Promise.resolve().then(function () {
      if (!document.startViewTransition || reduce.matches) { apply(next); return null; }
      var W = window.innerWidth, H = window.innerHeight;
      var o = origin || { x: W - 44, y: 36 };
      var maxR = Math.sqrt(Math.pow(Math.max(o.x, W - o.x), 2) + Math.pow(Math.max(o.y, H - o.y), 2)) + 20;
      var g = makeGrid(W, H);
      var vt = document.startViewTransition(function () {
        html.classList.add('vt-running', 'vt-overlay-on');
        apply(next);
      });
      return vt.ready.then(function () {
        var frames = [];
        /* step-end: hold each frame until the next. Interpolating between two path() shapes that happen to
           have the same number of rectangles would morph them into stray bars */
        for (var k = 0; k <= FRAMES; k++) frames.push({ clipPath: clipPath(g, o, radius(k / FRAMES, maxR), W, H, k === FRAMES), easing: 'step-end' });
        html.animate(frames, { duration: DUR, easing: 'linear', fill: 'forwards', pseudoElement: '::view-transition-new(root)' });
        shimmer(g, o, maxR, W, H);
        return vt.finished;
      });
    }).catch(function () {
      if (current() !== next) apply(next);
    }).then(function () {
      html.classList.remove('vt-running', 'vt-overlay-on');
      busy = false;
      document.dispatchEvent(new CustomEvent('site:theme-settled')); /* the switch has finished drawing */
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    var r = btn.getBoundingClientRect();
    switchTo(current() === 'light' ? 'dark' : 'light', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });

  /* while no manual choice is active, follow the clock (a plain crossfade at dawn and dusk) */
  setInterval(function () {
    if (busy || override()) return;
    var t = autoTheme();
    if (t !== current()) { apply(t); document.dispatchEvent(new CustomEvent('site:theme-settled')); }
  }, 60000);

  label(current());

  window.Site = window.Site || {};
  window.Site.theme = {
    current: current,
    override: override,
    switchTo: switchTo,
  };
})();
