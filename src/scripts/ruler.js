/* The ruler navigation shared by the home page (its sections) and articles (their headings):
   ticks while collapsed, a glass index on hover or tap, scrubbing by touch, and the left/right switch. */
(function () {
  'use strict';

  var Site = (window.Site = window.Site || {});
  var html = document.documentElement;

  /* opts: go(i) moves to item i; wheel: true lets a wheel gesture over the index step one item;
     list: true makes the open index a plain list that scrolls by itself (an article's outline) */
  Site.ruler = function (nav, opts) {
    var ruler = nav.querySelector('.ruler');
    var ticks = nav.querySelectorAll('.tick');
    var items = nav.querySelectorAll('.dial-item');
    var win = nav.querySelector('.dial-window');
    var sideBtns = nav.querySelectorAll('[data-side-btn]');
    var N = items.length, current = 0, closeT = 0, openedAt = 0, browsedAt = 0;

    function isOpen() { return nav.getAttribute('data-open') === 'true'; }
    function setOpen(v) {
      clearTimeout(closeT);
      if (v === isOpen()) return;
      nav.setAttribute('data-open', v ? 'true' : 'false');
      ruler.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) { openedAt = performance.now(); if (opts.list) reveal(current, true); }
    }
    /* pos may be fractional (an article's reading position); the nearest item counts as current */
    function set(pos) {
      nav.style.setProperty('--index', pos);
      var i = Math.max(0, Math.min(N - 1, Math.floor(pos + 0.001)));
      var changed = i !== current;
      current = i;
      for (var k = 0; k < N; k++) {
        ticks[k].classList.toggle('is-active', k === i);
        items[k].setAttribute('aria-current', k === i ? 'true' : 'false');
        items[k].setAttribute('data-dist', String(Math.min(4, Math.round(Math.abs(k - pos)))));
      }
      /* the open list keeps the current entry in view, unless the visitor is browsing it */
      if (opts.list && changed && isOpen() && performance.now() - browsedAt > 1500) reveal(i, false);
    }

    /* ---- list mode: the list scrolls on its own; the page underneath stays put ---- */
    function maxScroll() { return Math.max(0, win.scrollHeight - win.clientHeight); }
    function fades() {
      win.classList.toggle('can-up', win.scrollTop > 1);
      win.classList.toggle('can-down', win.scrollTop < maxScroll() - 1);
    }
    /* scroll the list so entry i is visible: centred when the list opens, just inside the edge otherwise */
    function reveal(i, centre) {
      var it = items[i];
      if (!it) return;
      var top = it.offsetTop, h = it.offsetHeight, view = win.clientHeight, st = win.scrollTop, edge = 40, to = st;
      if (centre) to = top - (view - h) / 2;
      else if (top < st + edge) to = top - edge;
      else if (top + h > st + view - edge) to = top + h - view + edge;
      to = Math.max(0, Math.min(maxScroll(), to));
      if (Math.abs(to - st) > 1) {
        if (centre) win.scrollTop = to; else win.scrollTo({ top: to, behavior: 'smooth' });
      }
      fades();
    }
    function canScroll(dy) { return dy < 0 ? win.scrollTop > 0.5 : win.scrollTop < maxScroll() - 0.5; }
    if (opts.list && win) {
      win.addEventListener('scroll', fades, { passive: true });
      window.addEventListener('resize', fades);
      nav.addEventListener('wheel', function (e) {
        if (!isOpen()) return;
        var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? win.clientHeight : 1);
        if (!dy) return;
        browsedAt = performance.now();
        var inList = win.contains(e.target);
        if (inList && canScroll(dy)) return; /* the list scrolls natively; overscroll-behavior keeps it from passing on to the page */
        e.preventDefault();
        if (!inList && canScroll(dy)) win.scrollBy({ top: dy, behavior: Math.abs(dy) >= 40 ? 'smooth' : 'auto' });
      }, { passive: false });
      fades();
    }

    nav.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') setOpen(true); });
    nav.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(closeT);
      closeT = setTimeout(function () { setOpen(false); }, 280);
    });
    ruler.addEventListener('click', function (e) {
      if (performance.now() - openedAt < 500) return; /* just opened by hovering */
      var open = !isOpen();
      setOpen(open);
      if (open && e.detail === 0) setTimeout(function () { items[current].focus({ preventScroll: true }); }, 60);
    });
    nav.addEventListener('focusout', function (e) { if (!nav.contains(e.relatedTarget)) setOpen(false); });
    document.addEventListener('pointerdown', function (e) { if (!nav.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

    if (opts.wheel) {
      var wheelAt = 0, armed = true;
      nav.addEventListener('wheel', function (e) {
        var now = performance.now();
        if (now - wheelAt > 220) armed = true;
        wheelAt = now;
        if (armed && Math.abs(e.deltaY) > 8) { armed = false; opts.go(current + (e.deltaY > 0 ? 1 : -1)); }
      }, { passive: true });
    }

    /* touch: dragging on the ruler or the open index scrubs through the items like a picker wheel;
       the index opens while the finger moves, and swiping up goes forward as it does on the page */
    var STEP = 44, touch = null, listTouch = null, suppressClickUntil = 0;
    nav.addEventListener('touchstart', function (e) {
      touch = listTouch = null;
      if (e.touches.length !== 1) return;
      /* list mode: a finger on the open list scrolls the list itself */
      if (opts.list && isOpen() && win.contains(e.target)) { listTouch = { y: e.touches[0].clientY, block: null }; browsedAt = performance.now(); return; }
      touch = { y: e.touches[0].clientY, moved: false };
    }, { passive: true });
    nav.addEventListener('touchmove', function (e) {
      if (listTouch) {
        browsedAt = performance.now();
        /* decided on the first real move: if the list cannot scroll that way, nothing scrolls, not even the page */
        if (listTouch.block == null) {
          var dy = listTouch.y - e.touches[0].clientY;
          if (Math.abs(dy) < 2) return;
          listTouch.block = !canScroll(dy);
        }
        if (listTouch.block && e.cancelable) e.preventDefault();
        return;
      }
      if (!touch || e.touches.length !== 1) return;
      e.preventDefault();
      var dy = e.touches[0].clientY - touch.y;
      if (!touch.moved && Math.abs(dy) < 10) return;
      if (!touch.moved) { touch.moved = true; setOpen(true); }
      while (Math.abs(dy) >= STEP) {
        var step = dy < 0 ? 1 : -1;
        touch.y += -step * STEP;
        dy = e.touches[0].clientY - touch.y;
        if (current + step >= 0 && current + step < N) opts.go(current + step);
      }
    }, { passive: false });
    function touchEnd() {
      listTouch = null;
      if (!touch) return;
      if (touch.moved) {
        suppressClickUntil = performance.now() + 450; /* the lift that ends a drag is not a tap */
        clearTimeout(closeT);
        closeT = setTimeout(function () { setOpen(false); }, 900);
      }
      touch = null;
    }
    nav.addEventListener('touchend', touchEnd, { passive: true });
    nav.addEventListener('touchcancel', touchEnd, { passive: true });
    nav.addEventListener('click', function (e) {
      if (performance.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
    }, true);

    function setSide(side, save) {
      nav.setAttribute('data-side', side);
      html.setAttribute('data-nav-side', side);
      for (var i = 0; i < sideBtns.length; i++) {
        sideBtns[i].setAttribute('aria-pressed', String(sideBtns[i].getAttribute('data-side-btn') === side));
      }
      if (save) { try { localStorage.setItem('nav-side', side); } catch (e) { /* ignore */ } }
    }
    for (var b = 0; b < sideBtns.length; b++) {
      sideBtns[b].addEventListener('click', function () { setSide(this.getAttribute('data-side-btn'), true); });
    }
    setSide(html.getAttribute('data-nav-side') === 'right' ? 'right' : 'left', false);

    return { set: set, setOpen: setOpen, items: items };
  };
})();
