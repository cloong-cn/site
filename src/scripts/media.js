/* Pictures and videos in an article.
   - A picture opens full screen over a frosted backdrop, growing out of where it sits in the text.
   - Neighbouring pictures form a stack of cards: drag or swipe the top one away, or use the arrows.
   - Videos get quiet glass controls instead of each browser's own.
   - Code blocks get a copy button. */
(function () {
  'use strict';
  /* an article's text, or an album's timeline */
  var prose = document.querySelector('.prose, [data-album]');
  if (!prose) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var html = document.documentElement;
  var svg = function (body, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" aria-hidden="true">' + body + '</svg>'; };
  var line = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var ICON = {
    close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ' + line + '/>'),
    prev: svg('<path d="M14.5 5.5L8 12l6.5 6.5" ' + line + '/>'),
    next: svg('<path d="M9.5 5.5L16 12l-6.5 6.5" ' + line + '/>'),
    expand: svg('<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6" ' + line + '/>', 15),
    play: svg('<path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z" fill="currentColor"/>'),
    pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/>'),
    /* one speaker: the button's data-level shows its waves or the cross (blog.css) */
    sound: svg('<path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="currentColor"/><path class="v-1" d="M15.5 9a4.2 4.2 0 0 1 0 6" ' + line + '/><path class="v-2" d="M18 6.5a7.8 7.8 0 0 1 0 11" ' + line + '/><path class="v-x" d="M16 9.5l5 5M21 9.5l-5 5" ' + line + '/>'),
    check: '<svg class="cc-check" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" pathLength="1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    full: svg('<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" ' + line + '/>'),
    shrink: svg('<path d="M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5" ' + line + '/>'),
    web: svg('<rect x="3" y="5" width="18" height="14" rx="3" ' + line + '/><path d="M8 12.5V9.5h3M16 11.5v3h-3" ' + line + '/>'),
    webOff: svg('<rect x="3" y="5" width="18" height="14" rx="3" ' + line + '/><path d="M11 9.5v3H8M13 14.5v-3h3" ' + line + '/>'),
  };
  /* the page behind a full-window view stays still, and does not shift when its scrollbar goes */
  function pageLock(on) {
    if (on) {
      var gap = innerWidth - html.clientWidth;
      if (gap > 0) document.body.style.paddingRight = gap + 'px';
      html.classList.add('lb-lock');
    } else {
      html.classList.remove('lb-lock');
      document.body.style.paddingRight = '';
    }
  }
  function make(tag, cls, inner) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (inner != null) e.innerHTML = inner;
    return e;
  }
  function refract(el) { if (window.Site && Site.refract) Site.refract(el); }
  function button(cls, label, icon) {
    var b = make('button', cls, icon);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }

  /* the part of a box a picture of ratio r actually covers when it is fitted inside (object-fit: contain) */
  function contain(rect, r) {
    var w = rect.width, h = rect.height;
    if (w / h > r) w = h * r; else h = w / r;
    return { left: rect.left + (rect.width - w) / 2, top: rect.top + (rect.height - h) / 2, width: w, height: h };
  }
  function ratioOf(img) {
    var w = Number(img.getAttribute('width')) || img.naturalWidth || 16, h = Number(img.getAttribute('height')) || img.naturalHeight || 9;
    return { w: w, h: h, r: w / h };
  }
  function mainImg(fig) { return fig.querySelector('picture img, img:not(.media-fill)'); }

  /* ------------------------------------------------------------ full-screen view */
  var LB = null;
  function lightbox() {
    if (LB) return LB;
    var root = make('div', 'lightbox');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '查看图片');
    var backdrop = make('div', 'lb-backdrop');
    var box = make('div', 'lb-box');
    var cap = make('p', 'lb-cap mg');
    var count = make('span', 'lb-count mg');
    var close = button('lb-close mg mg-btn', '关闭', ICON.close);
    var prev = button('lb-prev mg mg-btn', '上一张', ICON.prev);
    var next = button('lb-next mg mg-btn', '下一张', ICON.next);
    var undo = button('lb-reset mg', '还原至原始大小', '还原');
    count.setAttribute('aria-live', 'polite');
    [backdrop, box, cap, count, close, prev, next, undo].forEach(function (e) { root.appendChild(e); });
    document.body.appendChild(root);
    [cap, count, close, prev, next].forEach(refract);

    var S = { items: [], i: 0, from: null, onClose: null, open: false, busy: false };

    function target(fig) {
      var m = ratioOf(mainImg(fig));
      var narrow = innerWidth < 720;
      var padX = narrow ? 12 : 64, top = narrow ? 68 : 76, bottom = narrow ? 92 : 96;
      var maxW = innerWidth - padX * 2, maxH = innerHeight - top - bottom;
      var s = Math.min(maxW / m.w, maxH / m.h, 1.25);
      var w = m.w * s, h = m.h * s;
      return { left: (innerWidth - w) / 2, top: top + (maxH - h) / 2, width: w, height: h };
    }
    function place(t) {
      rest = t;
      box.style.left = t.left + 'px';
      box.style.top = t.top + 'px';
      box.style.width = t.width + 'px';
      box.style.height = t.height + 'px';
    }
    /* transform that puts the box (at t) over rect r */
    function over(t, r) {
      return 'translate(' + (r.left - t.left) + 'px,' + (r.top - t.top) + 'px) scale(' + r.width / t.width + ',' + r.height / t.height + ')';
    }
    function fill(fig, t) {
      var img = mainImg(fig);
      box.innerHTML = '';
      /* what is already on screen shows at once; the sharper file fades in over it */
      box.style.backgroundImage = img.currentSrc ? 'url("' + img.currentSrc + '")' : '';
      var pic = img.closest('picture');
      var clone = (pic || img).cloneNode(true);
      [].forEach.call(clone.querySelectorAll ? clone.querySelectorAll('source, img') : [], function (e) { e.setAttribute('sizes', Math.round(t.width) + 'px'); });
      if (clone.tagName === 'IMG') clone.setAttribute('sizes', Math.round(t.width) + 'px');
      var big = clone.tagName === 'IMG' ? clone : clone.querySelector('img');
      big.removeAttribute('loading');
      big.className = 'lb-img';
      big.alt = img.alt;
      big.addEventListener('load', function () { big.classList.add('is-loaded'); });
      box.appendChild(clone);
      if (big.complete && big.naturalWidth) big.classList.add('is-loaded');
      var c = fig.querySelector('.media-cap');
      cap.textContent = c ? c.textContent : '';
      cap.hidden = !c;
      var n = S.items.length;
      count.textContent = (S.i + 1) + ' / ' + n;
      count.hidden = prev.hidden = next.hidden = n < 2;
    }

    function open(items, i, onClose, back) {
      if (S.open) return;
      S.items = items; S.i = i; S.onClose = onClose || null; S.open = true;
      S.from = back || document.activeElement;
      var fig = items[i], t = target(fig);
      clearZoom();
      pageLock(true);
      root.classList.add('is-open');
      place(t);
      fill(fig, t);
      var still = reduce.matches;
      box.style.transition = 'none';
      box.style.transform = still ? '' : over(t, contain(mainImg(fig).closest('.media').getBoundingClientRect(), ratioOf(mainImg(fig)).r));
      box.style.opacity = still ? '0' : '1';
      void box.offsetWidth;
      box.style.transition = '';
      box.style.transform = '';
      box.style.opacity = '1';
      root.classList.add('is-shown');
      close.focus({ preventScroll: true });
    }

    function shut() {
      if (!S.open) return;
      S.open = false;
      var fig = S.items[S.i];
      if (S.onClose) S.onClose(S.i); /* a stack turns to the picture last viewed */
      if (zoomed()) { /* closing from a turned or enlarged picture: it goes home from where it rests */
        box.style.transition = 'none';
        clearZoom();
        void box.offsetWidth;
        box.style.transition = '';
      }
      var t = box.getBoundingClientRect();
      var home = contain(fig.getBoundingClientRect(), ratioOf(mainImg(fig)).r);
      var visible = home.top + home.height > 0 && home.top < innerHeight && home.width > 0;
      root.classList.remove('is-shown');
      if (!reduce.matches && visible) box.style.transform = over(t, home);
      else box.style.opacity = '0';
      setTimeout(function () {
        root.classList.remove('is-open');
        box.innerHTML = '';
        box.style.transform = '';
        box.style.backgroundImage = '';
        pageLock(false);
        if (S.from && S.from.focus) S.from.focus({ preventScroll: true });
      }, reduce.matches ? 10 : 420);
    }

    function step(d) {
      var n = S.items.length;
      if (n < 2 || S.busy) return;
      S.i = (S.i + d + n) % n;
      var fig = S.items[S.i], t = target(fig);
      S.busy = true;
      clearZoom();
      box.style.transition = 'none';
      place(t);
      fill(fig, t);
      box.style.transform = reduce.matches ? '' : 'translateX(' + d * 48 + 'px)';
      box.style.opacity = '0';
      void box.offsetWidth;
      box.style.transition = '';
      box.style.transform = '';
      box.style.opacity = '1';
      setTimeout(function () { S.busy = false; }, 260);
    }

    close.addEventListener('click', shut);
    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    undo.addEventListener('click', function () { restore(); close.focus({ preventScroll: true }); });
    /* a click anywhere else closes, as in Photos. A finger has its own rules, below */
    root.addEventListener('click', function (e) { if (performance.now() - touchedAt > 700 && !e.target.closest('button')) shut(); });
    document.addEventListener('keydown', function (e) {
      if (!S.open) return;
      if (e.key === 'Escape') { e.preventDefault(); shut(); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Tab') { /* keep the focus inside */
        var f = zoomed() ? [close, undo] : [close, prev, next].filter(function (b) { return !b.hidden; });
        var k = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });
    addEventListener('resize', function () { if (S.open) { clearZoom(); place(target(S.items[S.i])); } });

    /* ---------- enlarging and turning ----------
       Two fingers enlarge and turn the picture, a double tap enlarges it where it was tapped. Z is how it stands: its
       centre moved by x, y from where it rests, its scale and its angle. While it stands any other way than at rest the
       arrows and the caption step aside for a button that puts it back, one finger moves it instead of turning the page,
       and a tap does not close the view. Letting go, it snaps to a quarter turn and keeps within the screen. */
    var rest = null, Z = { s: 1, r: 0, x: 0, y: 0 }, sharpened = false;
    function zoomed() { return Z.s > 1.02 || Z.r % 360 !== 0 || Math.abs(Z.x) > 1 || Math.abs(Z.y) > 1; }
    function mark() {
      root.classList.toggle('is-zoomed', zoomed());
      if (zoomed() && !sharpened) { /* the file for this many pixels, now that they can be seen */
        sharpened = true;
        [].forEach.call(box.querySelectorAll('source, img'), function (e) { e.setAttribute('sizes', Math.round(rest.width * 3) + 'px'); });
      }
    }
    function pose() {
      var cx = rest.width / 2, cy = rest.height / 2;
      box.style.transform = 'translate(' + (Z.x + cx) + 'px,' + (Z.y + cy) + 'px) rotate(' + Z.r + 'deg) scale(' + Z.s + ') translate(' + -cx + 'px,' + -cy + 'px)';
    }
    function clearZoom() {
      Z = { s: 1, r: 0, x: 0, y: 0 };
      sharpened = false;
      box.style.transform = '';
      root.classList.remove('is-zoomed');
    }
    /* as far as it may go on one axis: smaller than the screen, it stays centred; larger, no gap opens at its edges */
    function within(move, size, restCentre, screen) {
      var half = size / 2;
      if (size <= screen) return screen / 2 - restCentre;
      return Math.min(half - restCentre, Math.max(screen - half - restCentre, move));
    }
    function settle() {
      Z.r = Math.round(Z.r / 90) * 90;
      Z.s = Math.max(1, Math.min(5, Z.s));
      box.style.transition = '';
      if (Z.s <= 1.02 && Z.r % 360 === 0) { Z.s = 1; Z.x = 0; Z.y = 0; box.style.transform = ''; mark(); return; }
      var turned = Z.r % 180 !== 0;
      var w = (turned ? rest.height : rest.width) * Z.s, h = (turned ? rest.width : rest.height) * Z.s;
      Z.x = within(Z.x, w, rest.left + rest.width / 2, innerWidth);
      Z.y = within(Z.y, h, rest.top + rest.height / 2, innerHeight);
      pose();
      mark();
    }
    function restore() {
      box.style.transition = '';
      clearZoom();
    }

    /* ---------- fingers ----------
       One finger on a picture at rest: sideways for the next one, down to close. A tap outside the picture closes. */
    var fingers = {}, drag = null, pinch = null, pan = null, swiped = false, touchedAt = -1e4, lastTap = null;
    function count2() { return Object.keys(fingers).length; }
    function two() { var k = Object.keys(fingers); return [fingers[k[0]], fingers[k[1]]]; }
    function restCentre() { return { x: rest.left + rest.width / 2, y: rest.top + rest.height / 2 }; }
    function startPinch() {
      var p = two(), c = restCentre();
      pinch = {
        d: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1,
        a: Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x),
        mx: (p[0].x + p[1].x) / 2 - c.x, my: (p[0].y + p[1].y) / 2 - c.y,
        s: Z.s, r: Z.r, x: Z.x, y: Z.y, turning: 0,
      };
      pan = null;
    }
    function startPan(f) { pan = { x: f.x, y: f.y, ox: Z.x, oy: Z.y }; }
    function capture(id) { try { root.setPointerCapture(id); } catch (err) { /* ignore */ } }
    root.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      touchedAt = performance.now();
      if (e.target.closest('button')) return;
      /* a gesture whose end never reached us must not leave the picture where it was dragged to */
      if (e.isPrimary && count2()) {
        fingers = {};
        pinch = pan = null;
        if (drag) { box.style.transition = ''; box.style.transform = ''; backdrop.style.opacity = ''; drag = null; }
      }
      fingers[e.pointerId] = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId };
      if (count2() >= 2) {
        Object.keys(fingers).forEach(function (id) { capture(Number(id)); });
        if (drag) { drag = null; backdrop.style.opacity = ''; if (!zoomed()) box.style.transform = ''; }
        box.style.transition = 'none';
        swiped = true;
        startPinch();
      } else if (zoomed()) {
        swiped = false;
        box.style.transition = 'none';
        startPan(fingers[e.pointerId]);
      } else {
        drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId };
        swiped = false;
      }
    });
    root.addEventListener('pointermove', function (e) {
      var f = fingers[e.pointerId];
      if (!f) return;
      f.x = e.clientX; f.y = e.clientY;
      if (pinch && count2() >= 2) {
        var p = two(), c = restCentre();
        var d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
        var a = (Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) - pinch.a) * 180 / Math.PI;
        a = ((a + 540) % 360) - 180;
        /* enlarging is never perfectly straight: the turning starts only once it is plainly meant */
        if (!pinch.turning && Math.abs(a) > 14) pinch.turning = a > 0 ? 14 : -14;
        var turn = pinch.turning ? a - pinch.turning : 0;
        var s = Math.max(0.6, Math.min(6, pinch.s * d / pinch.d));
        var k = s / pinch.s, rad = turn * Math.PI / 180;
        var vx = pinch.x - pinch.mx, vy = pinch.y - pinch.my;
        Z.s = s;
        Z.r = pinch.r + turn;
        Z.x = (p[0].x + p[1].x) / 2 - c.x + (vx * Math.cos(rad) - vy * Math.sin(rad)) * k;
        Z.y = (p[0].y + p[1].y) / 2 - c.y + (vx * Math.sin(rad) + vy * Math.cos(rad)) * k;
        pose();
        mark();
        return;
      }
      if (pan) {
        if (Math.abs(f.x - pan.x) + Math.abs(f.y - pan.y) >= 6 && !swiped) { swiped = true; capture(e.pointerId); }
        if (!swiped) return;
        Z.x = pan.ox + f.x - pan.x;
        Z.y = pan.oy + f.y - pan.y;
        pose();
        return;
      }
      if (!drag) return;
      drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      if (Math.abs(drag.dx) + Math.abs(drag.dy) < 6) return;
      /* from here on the end of the gesture comes to us, wherever the finger lets go */
      if (!swiped) capture(drag.id);
      swiped = true;
      box.style.transition = 'none';
      if (Math.abs(drag.dy) > Math.abs(drag.dx)) {
        var down = Math.max(0, drag.dy);
        /* down closes, so the picture follows; up does nothing, so it only gives a little */
        box.style.transform = 'translateY(' + (drag.dy < 0 ? drag.dy * 0.18 : drag.dy) + 'px) scale(' + Math.max(0.85, 1 - down / 1500) + ')';
        backdrop.style.opacity = String(Math.max(0.35, 1 - down / 400));
      } else box.style.transform = 'translateX(' + drag.dx + 'px)';
    });
    /* a finger that came down and up in one place: outside the picture it closes the view; twice on it, it enlarges */
    function tapped(f) {
      var inside = f.x >= rest.left && f.x <= rest.left + rest.width && f.y >= rest.top && f.y <= rest.top + rest.height;
      var now = performance.now();
      if (lastTap && now - lastTap.at < 320 && Math.hypot(f.x - lastTap.x, f.y - lastTap.y) < 30) {
        lastTap = null;
        if (zoomed()) { restore(); return; }
        var c = restCentre();
        Z.s = 2.5;
        Z.x = -1.5 * (f.x - c.x);
        Z.y = -1.5 * (f.y - c.y);
        settle();
        return;
      }
      lastTap = { at: now, x: f.x, y: f.y };
      if (!inside && !zoomed()) shut();
    }
    function lift(e) {
      var f = fingers[e.pointerId];
      if (!f) return;
      delete fingers[e.pointerId];
      var n = count2();
      if (pinch) {
        if (n >= 2) { startPinch(); return; }
        pinch = null;
        if (n === 1) { startPan(two()[0]); return; }
        settle();
        return;
      }
      if (pan) {
        var moved = swiped;
        pan = null;
        if (moved) settle(); else if (e.type === 'pointerup') tapped(f);
        return;
      }
      if (drag) {
        var d = drag;
        drag = null;
        box.style.transition = '';
        backdrop.style.opacity = '';
        if (!swiped) { box.style.transform = ''; if (e.type === 'pointerup') tapped(f); return; }
        if (d.dy > 90 && Math.abs(d.dy) > Math.abs(d.dx)) shut();
        else if (d.dx < -60 && S.items.length > 1) step(1);
        else if (d.dx > 60 && S.items.length > 1) step(-1);
        else box.style.transform = '';
      }
    }
    root.addEventListener('pointerup', lift);
    root.addEventListener('pointercancel', lift);
    /* only its own: taking the capture over makes the finger's first element report losing it, and that bubbles up here */
    root.addEventListener('lostpointercapture', function (e) { if (e.target === root) lift(e); });
    root.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    root.addEventListener('gesturestart', function (e) { e.preventDefault(); }); /* Safari's own pinch of the whole page */

    LB = { open: open };
    return LB;
  }

  /* ------------------------------------------------------------ single pictures */
  [].forEach.call(prose.querySelectorAll('.media.is-image:not(.stack-card):not(.album-photo), .media.is-raw'), function (fig) {
    if (fig.closest('a')) return;
    var img = mainImg(fig);
    if (!img) return;
    /* the whole picture is clickable; the small glass button is there for the keyboard (and as a hint) */
    var zoom = button('media-zoom mg mg-btn', '放大查看' + (img.alt ? '：' + img.alt : '图片'), ICON.expand);
    fig.insertBefore(zoom, fig.firstChild); /* the caption stays the figure's last child */
    fig.addEventListener('click', function () { lightbox().open([fig], 0, null, zoom); });
  });

  /* ------------------------------------------------------------ an album: one long row of pictures to browse */
  var albumPhotos = [].slice.call(prose.querySelectorAll('.album-photo'));
  albumPhotos.forEach(function (fig, i) {
    function view() {
      /* back on the page, the picture last seen is in view */
      lightbox().open(albumPhotos, i, function (at) { albumPhotos[at].scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, fig);
    }
    fig.addEventListener('click', view);
    fig.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); view(); }
    });
  });

  /* ------------------------------------------------------------ stacks */
  [].forEach.call(prose.querySelectorAll('.stack'), function (root) {
    var cards = [].slice.call(root.querySelectorAll('.stack-card'));
    var n = cards.length, cur = 0, busy = false;
    var ui = make('div', 'stack-ui');
    var count = make('span', 'stack-count mg');
    var nav = make('div', 'stack-nav');
    var prev = button('mg mg-btn', '上一张', ICON.prev), next = button('mg mg-btn', '下一张', ICON.next);
    count.setAttribute('aria-live', 'polite');
    nav.appendChild(prev); nav.appendChild(next);
    ui.appendChild(count); ui.appendChild(nav);
    root.appendChild(ui);
    root.tabIndex = 0;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-roledescription', '图集');
    root.setAttribute('aria-label', '图集，共 ' + n + ' 张，左右方向键翻页，回车放大');

    function depth(i) { return (i - cur + n) % n; }
    function layout() {
      cards.forEach(function (c, i) {
        var d = depth(i);
        c.setAttribute('data-depth', String(Math.min(d, 3)));
        c.setAttribute('aria-hidden', d ? 'true' : 'false');
      });
      count.textContent = (cur + 1) + ' / ' + n;
    }
    function instant(c, fn) {
      c.classList.add('no-anim');
      fn();
      void c.offsetWidth;
      c.classList.remove('no-anim');
    }
    /* +1: the top card flies off to the left and goes to the back; -1: the last one comes back on top */
    function go(d) {
      if (busy) return;
      if (reduce.matches) { cur = (cur + d + n) % n; layout(); return; }
      busy = true;
      if (d > 0) {
        var top = cards[cur];
        top.classList.add('is-leaving');
        cur = (cur + 1) % n;
        layout();
        setTimeout(function () {
          instant(top, function () { top.classList.remove('is-leaving'); });
          busy = false;
        }, 450);
      } else {
        var back = cards[(cur - 1 + n) % n];
        instant(back, function () { back.classList.add('is-leaving'); back.setAttribute('data-depth', '0'); });
        cur = (cur - 1 + n) % n;
        layout();
        back.classList.remove('is-leaving');
        setTimeout(function () { busy = false; }, 450);
      }
    }
    function sync(i) { /* after browsing full screen: the stack turns to that picture, without animating */
      if (i === cur) return;
      cards.forEach(function (c) { c.classList.add('no-anim'); });
      cur = i;
      layout();
      void root.offsetWidth;
      cards.forEach(function (c) { c.classList.remove('no-anim'); });
    }
    function zoom() { lightbox().open(cards, cur, sync); }

    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    root.addEventListener('keydown', function (e) {
      if (e.target !== root) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(); }
    });
    root.addEventListener('dragstart', function (e) { e.preventDefault(); });

    /* dragging the top card: it follows the pointer and tilts a little; let go past ~70px to turn the page */
    var drag = null, dragged = false;
    root.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button') || busy) return;
      drag = { x: e.clientX, y: e.clientY, on: false, lx: e.clientX, lt: performance.now(), v: 0, id: e.pointerId };
      dragged = false;
    });
    root.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } /* a vertical swipe scrolls the page */
        if (Math.abs(dx) < 8) return;
        drag.on = dragged = true;
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        cards[cur].style.transition = 'none';
      }
      var now = performance.now();
      drag.v = (e.clientX - drag.lx) / Math.max(1, now - drag.lt);
      drag.lx = e.clientX; drag.lt = now; drag.dx = dx;
      cards[cur].style.transform = 'translateX(' + dx + 'px) rotate(' + dx * 0.02 + 'deg)';
    });
    function release() {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (!d.on) return;
      var top = cards[cur];
      top.style.transition = '';
      top.style.transform = '';
      /* far enough, or a quick flick that still went a little way */
      if (d.dx < -70 || (d.v < -0.5 && d.dx < -40)) go(1);
      else if (d.dx > 70 || (d.v > 0.5 && d.dx > 40)) go(-1);
    }
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('click', function (e) {
      if (dragged) { dragged = false; e.preventDefault(); e.stopPropagation(); return; }
      if (!e.target.closest('button')) zoom();
    }, true);

    layout();
  });

  /* ------------------------------------------------------------ videos */
  var players = [];
  var keyboard = false; /* was the last input a key press (rather than a mouse or finger)? */
  document.addEventListener('keydown', function () { keyboard = true; }, true);
  document.addEventListener('pointerdown', function () { keyboard = false; }, true);
  [].forEach.call(prose.querySelectorAll('.media.is-video'), function (fig) {
    var v = fig.querySelector('video');
    if (!v) return;
    v.controls = false;
    v.removeAttribute('controls');
    fig.setAttribute('data-state', 'idle');
    fig.setAttribute('data-ui', 'on');
    var big = button('player-big mg mg-btn', '播放', ICON.play);
    var bar = make('div', 'player-bar mg');
    /* buttons with two states hold both icons, one turning into the other (.pb-swap, blog.css) */
    var play = button('pb-btn pb-swap', '播放', ICON.play + ICON.pause);
    var time = make('span', 'pb-time', '0:00');
    var seek = make('input', 'pb-seek');
    var dur = make('span', 'pb-dur', '');
    var volBox = make('div', 'pb-vol');
    var mute = button('pb-btn', '静音', ICON.sound);
    var vol = make('input', 'pb-range pb-vol-range');
    var web = button('pb-btn pb-swap pb-web', '网页全屏', ICON.web + ICON.webOff);
    var full = button('pb-btn pb-swap', '全屏', ICON.full + ICON.shrink);
    seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.step = '1'; seek.value = '0';
    seek.setAttribute('aria-label', '播放进度');
    vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01';
    vol.setAttribute('aria-label', '音量');
    web.title = '网页全屏（铺满浏览器窗口）';
    full.title = '全屏';
    volBox.appendChild(vol); volBox.appendChild(mute); /* the slider opens to the left, so the button stays under the pointer */
    [play, time, seek, dur, volBox, web, full].forEach(function (e) { bar.appendChild(e); });
    fig.insertBefore(big, v); /* the caption stays the figure's last child */
    fig.insertBefore(bar, v);
    players.push(v);

    function fmt(t) {
      if (!isFinite(t)) return '';
      t = Math.max(0, Math.floor(t));
      var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
      return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (s < 10 ? '0' : '') + s;
    }
    var seeking = false, raf = 0, hideT = 0;
    function paint() {
      var p = v.duration ? v.currentTime / v.duration : 0;
      if (!seeking) seek.value = String(Math.round(p * 1000));
      seek.style.setProperty('--p', (p * 100).toFixed(2) + '%');
      time.textContent = fmt(v.currentTime) || '0:00';
    }
    function loop() { paint(); raf = v.paused ? 0 : requestAnimationFrame(loop); }
    function toggle() {
      if (v.paused || v.ended) { var p = v.play(); if (p && p.catch) p.catch(function () { /* blocked or failed */ }); }
      else v.pause();
    }
    /* the controls fade while the video plays and nothing moves; they stay while it is paused */
    function wake() {
      fig.setAttribute('data-ui', 'on');
      clearTimeout(hideT);
      hideT = setTimeout(function () {
        /* keyboard users keep the controls in view; the focus a mouse click leaves behind does not count */
        var at = document.activeElement;
        if (!v.paused && !(keyboard && at !== fig && fig.contains(at))) fig.setAttribute('data-ui', 'off');
      }, 2600);
    }

    /* volume: the slider opens from the speaker button. It is remembered for the next video. Dragging it to nothing
       means muted, so the speaker button brings back a volume that can be heard. Phones have their own volume keys and
       iOS ignores a page's volume altogether, so touch screens keep only the mute button (blog.css) */
    function paintVol() {
      var x = v.muted ? 0 : v.volume;
      vol.value = String(x);
      vol.style.setProperty('--p', (x * 100).toFixed(0) + '%');
      mute.setAttribute('data-level', x === 0 ? '0' : x < 0.5 ? '1' : '2');
      mute.setAttribute('aria-label', x === 0 ? '取消静音' : '静音');
    }
    try {
      var kept = parseFloat(localStorage.getItem('video-volume'));
      if (kept >= 0.05 && kept <= 1) v.volume = kept;
    } catch (e) { /* no storage */ }
    paintVol();

    /* the whole browser window, as against full screen: the figure stays where it is in the page and only its box
       changes, growing out of its place, so the video keeps playing. An empty block holds its place in the text */
    var webOn = false, spacer = null, morphing = null, homeRadius = '';
    function boxAt(r, radius) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: radius }; }
    function setWeb(on) {
      if (on === webOn || morphing) return;
      webOn = on;
      web.classList.toggle('is-alt', on);
      web.setAttribute('aria-label', on ? '退出网页全屏' : '网页全屏');
      web.title = on ? '退出网页全屏（Esc）' : '网页全屏（铺满浏览器窗口）';
      var whole = { left: 0, top: 0, width: innerWidth, height: innerHeight };
      var ease = { duration: reduce.matches ? 0 : 420, easing: 'cubic-bezier(.22,1,.36,1)' };
      if (on) {
        var from = fig.getBoundingClientRect(), cs = getComputedStyle(fig);
        homeRadius = cs.borderTopLeftRadius;
        spacer = make('div');
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.height = from.height + 'px';
        spacer.style.margin = cs.marginTop + ' 0 ' + cs.marginBottom;
        fig.parentNode.insertBefore(spacer, fig);
        pageLock(true);
        fig.classList.add('is-webfull');
        fig.tabIndex = -1;
        fig.focus({ preventScroll: true });
        morphing = fig.animate([boxAt(from, homeRadius), boxAt(whole, '0px')], ease);
        morphing.onfinish = morphing.oncancel = function () { morphing = null; };
      } else {
        morphing = fig.animate([boxAt(whole, '0px'), boxAt(spacer.getBoundingClientRect(), homeRadius)], ease);
        morphing.onfinish = morphing.oncancel = function () {
          morphing = null;
          fig.classList.remove('is-webfull');
          fig.removeAttribute('tabindex');
          spacer.remove();
          spacer = null;
          pageLock(false);
          web.focus({ preventScroll: true });
        };
      }
      wake();
    }
    web.addEventListener('click', function () { setWeb(!webOn); });
    document.addEventListener('keydown', function (e) {
      if (!webOn || document.fullscreenElement || document.webkitFullscreenElement) return;
      if (e.key === 'Escape') { e.preventDefault(); setWeb(false); return; }
      if (e.key === 'Tab') { /* the page behind is out of reach for now */
        var f = [play, seek, mute, vol, web, full].filter(function (c) { return c.offsetParent !== null; });
        var k = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        return;
      }
      if (e.target.closest && e.target.closest('button, input')) return; /* those keys already mean something there */
      if (e.key === ' ') { e.preventDefault(); toggle(); wake(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && v.duration) {
        e.preventDefault();
        v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + (e.key === 'ArrowLeft' ? -5 : 5)));
        paint();
        wake();
      }
    });

    v.addEventListener('play', function () {
      players.forEach(function (o) { if (o !== v && !o.paused) o.pause(); }); /* one video at a time */
      fig.setAttribute('data-state', 'playing');
      play.classList.add('is-alt'); play.setAttribute('aria-label', '暂停');
      if (!raf) raf = requestAnimationFrame(loop);
      wake();
    });
    v.addEventListener('pause', function () {
      if (!v.ended) fig.setAttribute('data-state', 'paused');
      play.classList.remove('is-alt'); play.setAttribute('aria-label', '播放');
      fig.setAttribute('data-ui', 'on');
      paint();
    });
    v.addEventListener('ended', function () { fig.setAttribute('data-state', 'ended'); big.setAttribute('aria-label', '重新播放'); });
    v.addEventListener('loadedmetadata', function () { dur.textContent = fmt(v.duration); paint(); });
    v.addEventListener('waiting', function () { fig.classList.add('is-waiting'); });
    v.addEventListener('playing', function () { fig.classList.remove('is-waiting'); });
    v.addEventListener('volumechange', function () {
      paintVol();
      if (!v.muted && v.volume >= 0.05) { try { localStorage.setItem('video-volume', String(v.volume)); } catch (e) { /* no storage */ } }
    });

    big.addEventListener('click', toggle);
    play.addEventListener('click', toggle);
    v.addEventListener('click', toggle);
    mute.addEventListener('click', function () {
      v.muted = !v.muted;
      if (!v.muted && v.volume < 0.05) v.volume = 0.6;
    });
    vol.addEventListener('input', function () {
      var x = Number(vol.value);
      v.muted = x === 0;
      if (x > 0) v.volume = x;
    });
    seek.addEventListener('input', function () {
      seeking = true;
      if (v.duration) v.currentTime = (Number(seek.value) / 1000) * v.duration;
      paint();
    });
    seek.addEventListener('change', function () { seeking = false; });
    full.addEventListener('click', function () {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (fig.requestFullscreen) fig.requestFullscreen();
      else if (fig.webkitRequestFullscreen) fig.webkitRequestFullscreen();
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); /* iPhone: only the video itself can go full screen */
    });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        var on = (document.fullscreenElement || document.webkitFullscreenElement) === fig;
        full.classList.toggle('is-alt', on);
        full.setAttribute('aria-label', on ? '退出全屏' : '全屏');
      });
    });
    fig.addEventListener('pointermove', wake);
    fig.addEventListener('pointerdown', wake);
    fig.addEventListener('focusin', wake);
  });

  /* pictures still loading fade in over their blurred stand-in, which then goes away. Only pictures this script
     has seen are hidden, so if it never ran they simply appear */
  [].forEach.call(prose.querySelectorAll('.media-ph'), function (ph) {
    var fig = ph.parentNode, img = fig.querySelector('picture img');
    if (!img) { ph.remove(); return; }
    function done() {
      fig.classList.remove('is-loading');
      setTimeout(function () { ph.remove(); }, 600);
    }
    /* downloaded is not yet drawn: wait for the decoding too, so nothing blank shows in between */
    function loaded() { if (img.decode) img.decode().then(done, done); else done(); }
    if (img.complete && img.naturalWidth) { loaded(); return; }
    fig.classList.add('is-loading');
    img.addEventListener('load', loaded, { once: true });
    img.addEventListener('error', done, { once: true });
  });

  /* every glass control made above bends the picture at its edges, where the browser can (glass.js) */
  [].forEach.call(prose.querySelectorAll('.mg, .media:not(.is-small):not(.is-raw) > .media-cap'), refract);

  /* ------------------------------------------------------------ code: copy button */
  [].forEach.call(prose.querySelectorAll('.code-copy'), function (b) {
    b.hidden = false;
    /* both words share one cell, so the button keeps its width: one leaves upward as the other comes in */
    b.innerHTML = '<span class="cc-in"><span class="cc-idle">复制</span><span class="cc-done">' + ICON.check + '<span>已复制</span></span></span>';
    var word = b.querySelector('.cc-done > span');
    var t = 0;
    b.addEventListener('click', function () {
      var text = b.closest('.codeblock').querySelector('code').textContent.replace(/\n$/, '');
      function done(ok) {
        word.textContent = ok ? '已复制' : '复制失败';
        b.classList.toggle('is-ok', ok);
        b.classList.add('is-done');
        b.setAttribute('aria-label', word.textContent);
        clearTimeout(t);
        t = setTimeout(function () { b.classList.remove('is-done', 'is-ok'); b.removeAttribute('aria-label'); }, 1600);
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
        done(ok);
      }
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
      else fallback();
    });
  });

  /* ------------------------------------------------------------ code: wrapping long lines
     The button shows only on blocks whose longest line does not fit. That is worked out from the column count the
     build wrote down, so no block has to be laid out to find out. Wrapping is remembered for the next articles. */
  var CH = 8.43; /* the width of one column at the code's font size */
  var wrapBlocks = [].slice.call(prose.querySelectorAll('.codeblock'));
  var wrapPref = false;
  try { wrapPref = localStorage.getItem('code-wrap') === '1'; } catch (e) { /* no storage */ }
  function fitWrap() {
    var room = prose.clientWidth - 40;
    wrapBlocks.forEach(function (block) {
      var cols = parseFloat(block.style.getPropertyValue('--cols')) || 0;
      var lines = parseFloat(block.style.getPropertyValue('--ln')) || 0;
      var gutter = block.classList.contains('has-lines') ? lines * CH + 40 : 0;
      var btn = block.querySelector('.code-wrap');
      if (!btn) return;
      var over = cols * CH + gutter > room;
      btn.hidden = !over;
      if (!over && block.classList.contains('is-wrap')) { block.classList.remove('is-wrap'); btn.setAttribute('aria-pressed', 'false'); }
      else if (over && wrapPref && !block.classList.contains('is-wrap')) { block.classList.add('is-wrap'); btn.setAttribute('aria-pressed', 'true'); }
    });
  }
  wrapBlocks.forEach(function (block) {
    var btn = block.querySelector('.code-wrap');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var on = block.classList.toggle('is-wrap');
      btn.setAttribute('aria-pressed', String(on));
      wrapPref = on;
      try { if (on) localStorage.setItem('code-wrap', '1'); else localStorage.removeItem('code-wrap'); } catch (e) { /* no storage */ }
    });
  });
  fitWrap();
  window.addEventListener('resize', fitWrap);

  /* ------------------------------------------------------------ code: folding long blocks */
  [].forEach.call(prose.querySelectorAll('.codeblock.is-long'), function (block) {
    var btn = block.querySelector('.code-fold');
    var pre = block.querySelector('pre');
    var label = btn.querySelector('.code-fold-label');
    btn.hidden = false;
    var t = 0, keepRaf = 0;
    function folded() { /* the height of the first lines, as the stylesheet folds them */
      var cs = getComputedStyle(pre);
      return parseFloat(getComputedStyle(block).getPropertyValue('--fold')) * parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop);
    }
    /* Folding takes the page's height away above the button, so left alone everything would jump under the reader.
       So for as long as the block changes height the page is scrolled to keep the button exactly where it is on screen:
       the reader's hand and eye stay put, and the code closes up towards them. Opening needs nothing: the button goes
       down with the code, and what is on screen stays. The browser's own scroll anchoring is off meanwhile, not to
       make the same correction twice. */
    function hold(on) { html.style.overflowAnchor = on ? 'none' : ''; }
    function glide(from, to, keep, done) {
      clearTimeout(t);
      cancelAnimationFrame(keepRaf);
      var y = btn.getBoundingClientRect().top;
      function steady() {
        var drift = btn.getBoundingClientRect().top - y;
        if (Math.abs(drift) >= 0.5) window.scrollBy({ top: drift, behavior: 'instant' });
      }
      hold(true);
      if (reduce.matches) { done(); if (keep) steady(); hold(false); return; }
      pre.style.maxHeight = from + 'px';
      void pre.offsetHeight;
      pre.style.transition = 'max-height .45s cubic-bezier(.22,1,.36,1)';
      pre.style.maxHeight = to + 'px';
      if (keep) (function follow() { steady(); keepRaf = requestAnimationFrame(follow); })();
      t = setTimeout(function () {
        cancelAnimationFrame(keepRaf);
        pre.style.transition = '';
        pre.style.maxHeight = '';
        done();
        if (keep) steady();
        hold(false);
      }, 470);
    }
    btn.addEventListener('click', function () {
      var open = !block.classList.contains('is-open');
      btn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? '收起' : '展开全部代码';
      if (open) {
        var from = pre.offsetHeight;
        block.classList.add('is-open');
        glide(from, pre.scrollHeight, false, function () {});
      } else {
        glide(pre.offsetHeight, folded(), true, function () { block.classList.remove('is-open'); });
      }
    });
  });
})();
