/* Blog archive — search and tag filter over the full list (all posts are in the page).
   The tags are a segmented control whose thumb slides to the one chosen. What is typed into the search filters the
   list and, at the same time, drops the best matches into a glass panel under the search pill: arrow keys move
   through them, Enter opens one, Escape closes the panel. */
(function () {
  'use strict';
  var root = document.querySelector('[data-archive]');
  if (!root) return;

  var input = root.querySelector('input[type="search"]');
  var seg = root.querySelector('[data-seg]');
  var thumb = seg && seg.querySelector('.seg-thumb');
  var pop = root.querySelector('[data-search-pop]');
  var wrap = root.querySelector('[data-search-wrap]');
  var chips = Array.prototype.slice.call(root.querySelectorAll('[data-tag]'));
  var rows = Array.prototype.slice.call(root.querySelectorAll('[data-post]'));
  var years = Array.prototype.slice.call(root.querySelectorAll('[data-year]'));
  var empty = root.querySelector('[data-empty]');
  var count = root.querySelector('[data-count]');
  var params = new URLSearchParams(location.search);
  var state = { tag: params.get('tag') || '', q: params.get('q') || '' };

  if (state.tag && !chips.some(function (c) { return c.getAttribute('data-tag') === state.tag; })) state.tag = '';
  input.value = state.q;

  /* ---------- the thumb under the chosen tag ---------- */
  function slide(instant) {
    if (!thumb) return;
    var on = chips.filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; })[0];
    if (!on) return;
    Site.slide(thumb, on.offsetLeft, on.offsetWidth, instant);
    /* a long row of tags scrolls: keep the chosen one in view */
    var l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < seg.scrollLeft || r > seg.scrollLeft + seg.clientWidth) seg.scrollTo({ left: l - 24, behavior: instant ? 'auto' : 'smooth' });
  }

  function render(instant) {
    var q = state.q.trim().toLowerCase(), shown = 0;
    rows.forEach(function (row) {
      var tags = row.getAttribute('data-tags').split('|');
      var ok = (!state.tag || tags.indexOf(state.tag) >= 0) && (!q || row.getAttribute('data-search').indexOf(q) >= 0);
      row.hidden = !ok;
      if (ok) shown++;
    });
    years.forEach(function (y) {
      var n = y.querySelectorAll('[data-post]:not([hidden])').length;
      y.hidden = n === 0;
      var label = y.querySelector('[data-year-count]');
      if (label) label.textContent = n + ' 篇';
    });
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-tag') === state.tag)); });
    empty.hidden = shown > 0;
    Site.roll(count, shown, instant);
    slide(instant);

    var url = new URL(location.href);
    if (state.tag) url.searchParams.set('tag', state.tag); else url.searchParams.delete('tag');
    if (state.q.trim()) url.searchParams.set('q', state.q.trim()); else url.searchParams.delete('q');
    try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* ignore */ }
  }

  /* ---------- the panel of matches ---------- */
  var items = rows.map(function (row) {
    var a = row.querySelector('a');
    return { href: a.getAttribute('href'), title: row.querySelector('.title').textContent, date: row.getAttribute('data-date') || '', tags: row.getAttribute('data-tags').split('|').filter(Boolean), search: row.getAttribute('data-search') };
  });
  var sel = -1, links = [];
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mark(title, q) {
    var i = title.toLowerCase().indexOf(q);
    return i < 0 ? esc(title) : esc(title.slice(0, i)) + '<mark>' + esc(title.slice(i, i + q.length)) + '</mark>' + esc(title.slice(i + q.length));
  }
  function open(v) {
    pop.hidden = !v;
    input.setAttribute('aria-expanded', String(v));
    if (!v) { sel = -1; input.removeAttribute('aria-activedescendant'); }
  }
  function suggest() {
    var q = input.value.trim().toLowerCase();
    if (!q || document.activeElement !== input) { open(false); return; }
    /* titles that match come first, then the rest that match anywhere */
    var hits = items.filter(function (it) { return it.search.indexOf(q) >= 0; })
      .sort(function (a, b) { return (b.title.toLowerCase().indexOf(q) >= 0) - (a.title.toLowerCase().indexOf(q) >= 0); })
      .slice(0, 6);
    pop.innerHTML = hits.length
      ? hits.map(function (it, i) { return '<a id="sr-' + i + '" role="option" aria-selected="false" href="' + esc(it.href) + '"><span class="t">' + mark(it.title, q) + '</span><span class="m">' + esc(it.date) + (it.tags.length ? '　' + esc(it.tags.join('、')) : '') + '</span></a>'; }).join('')
      : '<p class="none">没有找到相关文章</p>';
    links = Array.prototype.slice.call(pop.querySelectorAll('a'));
    sel = -1;
    var opening = pop.hidden;
    open(true);
    if (opening) Site.stagger(links); /* only as the panel opens: not again at every letter typed */
  }
  function choose(i) {
    if (!links.length) return;
    sel = (i + links.length) % links.length;
    links.forEach(function (a, k) { a.setAttribute('aria-selected', String(k === sel)); });
    input.setAttribute('aria-activedescendant', links[sel].id);
    links[sel].scrollIntoView({ block: 'nearest' });
  }

  var t = 0;
  input.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(function () { state.q = input.value; render(); suggest(); }, 80);
  });
  input.addEventListener('focus', suggest);
  input.addEventListener('keydown', function (e) {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); choose(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); choose(sel - 1); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); location.href = links[sel].href; }
    else if (e.key === 'Escape') open(false);
  });
  document.addEventListener('pointerdown', function (e) { if (!wrap.contains(e.target)) open(false); });
  wrap.addEventListener('focusout', function (e) { if (!wrap.contains(e.relatedTarget)) open(false); });

  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      state.tag = c.getAttribute('data-tag');
      render();
      Site.stagger(root.querySelectorAll('.year:not([hidden]) .year-head, [data-post]:not([hidden])'));
    });
  });
  window.addEventListener('resize', function () { slide(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { slide(true); });
  render(true);
})();
