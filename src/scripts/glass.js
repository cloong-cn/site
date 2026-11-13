/* Liquid Glass, the refraction at the edges (base.css has the rest of the material: blur, tint, rims of light).
   For every element marked data-refract, an SVG filter bends what shows through it near the edges: a band around
   the rim pulls the background in from further inside, most at the very edge and fading to nothing a little way in,
   so the middle stays flat and readable. The bending comes from a displacement map drawn to the element's own size
   and shape (a rounded rectangle), redrawn when it changes size.
   Only Chromium browsers can put an SVG filter behind an element (backdrop-filter: url(#…)); Safari and Firefox keep
   the plain frosted glass. So does anyone with "reduce transparency" or "reduce motion" switched on. */
(function () {
  'use strict';
  /* Site.refract(el) does the same for controls that scripts make later (the video player, the lightbox) */
  var Site = (window.Site = window.Site || {});
  Site.refract = function () {};
  var els = document.querySelectorAll('[data-refract]');
  var chromium = !!window.chrome && /Chrome\//.test(navigator.userAgent); /* Chrome, Edge, Opera … */
  var quiet = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-reduced-motion: reduce)');
  if (!chromium || quiet.matches || !window.CSS || !CSS.supports('backdrop-filter', 'url(#a) blur(1px)')) return;

  var NS = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(NS, 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.style.position = 'absolute';
  document.body.appendChild(defs);

  /* the map: red moves what shows through left/right, green up/down; 128 means "stay". Each pixel within the band
     takes from further in, along the normal of the nearest edge, by (1 − depth/band)² */
  function draw(w, h, r, band) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
    var hw = w / 2, hh = h / 2;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = x + 0.5 - hw, py = y + 0.5 - hh;
        var qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
        var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        var dist = Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r; /* < 0 inside */
        var depth = -dist, m = depth >= 0 && depth < band ? Math.pow(1 - depth / band, 2) : 0;
        var nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { var l = Math.sqrt(qx * qx + qy * qy) || 1; nx = qx / l; ny = qy / l; }
        else if (qx > qy) nx = 1;
        else ny = 1;
        nx *= px < 0 ? -1 : 1;
        ny *= py < 0 ? -1 : 1;
        var i = (y * w + x) * 4;
        d[i] = Math.round(128 - nx * m * 127);
        d[i + 1] = Math.round(128 - ny * m * 127);
        d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  var n = 0;
  function attach(el) {
    var id = 'lg-' + (++n);
    var filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
    filter.setAttribute('width', '100%'); filter.setAttribute('height', '100%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    var map = document.createElementNS(NS, 'feImage');
    map.setAttribute('x', '0'); map.setAttribute('y', '0');
    map.setAttribute('preserveAspectRatio', 'none');
    map.setAttribute('result', 'map');
    var shift = document.createElementNS(NS, 'feDisplacementMap');
    shift.setAttribute('in', 'SourceGraphic');
    shift.setAttribute('in2', 'map');
    shift.setAttribute('xChannelSelector', 'R');
    shift.setAttribute('yChannelSelector', 'G');
    filter.appendChild(map);
    filter.appendChild(shift);
    defs.appendChild(filter);

    var size = '';
    function update() {
      var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (!w || !h || w + 'x' + h === size) return;
      size = w + 'x' + h;
      var r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, h / 2, w / 2);
      var band = Math.min(16, h / 2, w / 2);
      map.setAttribute('width', w); map.setAttribute('height', h);
      map.setAttribute('href', draw(w, h, r, band));
      shift.setAttribute('scale', (band * 1.4).toFixed(1));
      el.style.setProperty('--refract', 'url(#' + id + ')');
      el.classList.add('is-refracting');
    }
    update();
    if ('ResizeObserver' in window) new ResizeObserver(update).observe(el);
    else window.addEventListener('resize', update);
  }
  /* only once the page has loaded and settled: Chromium can leave an element unpainted when the filter arrives while
     the page is still jumping to a #link on load. The plain glass is there meanwhile */
  var ready = false, waiting = [];
  /* an element gets its map when it first comes near the screen: an article with a hundred pictures has a hundred
     zoom buttons, and most of them are never seen */
  var near = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      near.unobserve(e.target);
      attach(e.target);
    });
  }, { rootMargin: '300px' }) : null;
  function start(el) { if (near) near.observe(el); else attach(el); }
  function later(el) { if (ready) start(el); else waiting.push(el); }
  function settle() {
    setTimeout(function () {
      requestAnimationFrame(function () {
        ready = true;
        waiting.forEach(start);
        waiting = [];
      });
    }, 250);
  }
  if (document.readyState === 'complete') settle(); else window.addEventListener('load', settle);
  for (var i = 0; i < els.length; i++) later(els[i]);
  Site.refract = function (el) { if (el && !el.hasAttribute('data-refracted')) { el.setAttribute('data-refracted', ''); later(el); } };
  for (var k = 0; k < els.length; k++) els[k].setAttribute('data-refracted', '');
})();
