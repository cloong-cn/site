/* Article outline — the ruler lists the article's headings; its pointer follows the reading position
   and picking a heading scrolls to it. */
(function () {
  'use strict';
  var nav = document.querySelector('.sidenav[data-kind="toc"]');
  if (!nav || !window.Site || !Site.ruler) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var links = Array.prototype.slice.call(nav.querySelectorAll('.dial-item'));
  var heads = links.map(function (a) { return document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); });
  var N = heads.length;

  var pinned = -1, pinnedUntil = 0;
  function scrollToItem(i) {
    i = Math.max(0, Math.min(N - 1, i));
    var el = heads[i];
    if (!el) return;
    pinned = i; pinnedUntil = performance.now() + 1200; /* the item just picked stays current while the page glides there */
    ctl.set(i);
    section(i);
    el.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
    try { history.replaceState(null, '', i === 0 ? location.pathname + location.search : '#' + el.id); } catch (e) { /* ignore */ }
  }
  var ctl = Site.ruler(nav, { go: scrollToItem, wheel: false, list: true });
  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) { e.preventDefault(); scrollToItem(i); ctl.setOpen(false); });
  });

  /* many headings: tighten the ticks so the ruler never grows taller than about 60% of the screen */
  function fit() {
    var step = Math.max(12, Math.min(30, (window.innerHeight * 0.6) / Math.max(1, N - 1)));
    nav.style.setProperty('--step', step.toFixed(1) + 'px');
  }

  /* reading position: a line just below the sticky bar; the pointer glides between headings */
  var raf = 0;
  function update() {
    raf = 0;
    if (pinned >= 0 && performance.now() < pinnedUntil) { schedule(); return; }
    pinned = -1;
    var line = 110, pos = 0;
    for (var i = 0; i < N; i++) {
      var top = heads[i] ? heads[i].getBoundingClientRect().top : Infinity;
      if (top > line) break;
      var next = i + 1 < N && heads[i + 1] ? heads[i + 1].getBoundingClientRect().top : null;
      pos = next === null ? i : i + Math.max(0, Math.min(0.999, (line - top) / Math.max(1, next - top)));
    }
    /* at the very end of the page the last heading counts as reached, if it is on screen */
    var last = heads[N - 1];
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && last && last.getBoundingClientRect().top < window.innerHeight) pos = N - 1;
    ctl.set(pos);
    section(Math.floor(pos + 0.001));
    progress();
  }

  /* the section being read: its number tile lights up, also while you are in one of its sub-sections */
  var lit = -1;
  function section(i) {
    var s = Math.max(0, Math.min(N - 1, i));
    while (s > 0 && links[s].classList.contains('lv3')) s--;
    if (links[s].classList.contains('lv1')) s = -1;
    if (s === lit) return;
    if (lit >= 0) links[lit].classList.remove('is-section');
    if (s >= 0) links[s].classList.add('is-section');
    lit = s;
  }

  /* how much of the article has been read: from its first line to the end of its text (comments not counted) */
  var prose = document.querySelector('.prose');
  var pctEl = nav.querySelector('[data-read-pct]');
  function progress() {
    if (!prose || !pctEl) return;
    var r = prose.getBoundingClientRect();
    var p = Math.max(0, Math.min(1, (window.innerHeight * 0.7 - r.top) / Math.max(1, r.height)));
    nav.style.setProperty('--read', p.toFixed(3));
    pctEl.textContent = Math.round(p * 100) + '%';
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(update); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', function () { fit(); schedule(); });
  fit();
  update();
})();
