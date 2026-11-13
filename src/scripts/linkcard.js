/* Article links — a card over a link to another article of this blog: its date, reading time, title, summary and tags
   (and the section, for a link to one). It shows when the pointer rests on the link, or when the link gets keyboard
   focus; not on touch screens, where a tap simply follows the link. The card is a link too, so the pointer can move
   onto it and click. Everything it says is in the page already (#ref-data, written by the build): nothing is fetched. */
(function () {
  'use strict';
  /* footnotes use the same card: the note itself, read out of the list under the article */
  var data = document.getElementById('ref-data');
  var prose = document.querySelector('.prose');
  if (!prose || (!data && !prose.querySelector('a[data-fn]'))) return;
  var refs = {};
  try { if (data) refs = JSON.parse(data.textContent); } catch (e) { /* only footnotes then */ }
  var SEL = 'a[data-ref], a[data-fn]';

  var hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  var card = null, owner = null, showT = 0, hideT = 0;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function note(a) {
    var li = document.getElementById('fn-' + a.getAttribute('data-fn'));
    if (!li) return null;
    var el = document.createElement('div');
    el.className = 'ref-card glass is-note';
    el.id = 'ref-card';
    el.setAttribute('role', 'tooltip');
    var body = li.querySelector('p') ? li.querySelector('p').cloneNode(true) : li.cloneNode(true);
    [].forEach.call(body.querySelectorAll('.fn-back'), function (b) { b.remove(); });
    [].forEach.call(body.querySelectorAll('[id]'), function (x) { x.removeAttribute('id'); });
    while (body.firstChild) el.appendChild(body.firstChild);
    return el;
  }

  function build(a) {
    if (a.hasAttribute('data-fn')) return note(a);
    var r = refs[a.getAttribute('data-ref')];
    if (!r) return null;
    var part = a.getAttribute('data-part');
    var el = document.createElement('a');
    el.className = 'ref-card glass';
    el.id = 'ref-card';
    el.href = a.href;
    el.tabIndex = -1; /* the link itself is what the keyboard reaches; the card only describes it */
    el.setAttribute('role', 'tooltip');
    el.innerHTML = '<p class="rc-meta"><span class="num">' + esc(r.d) + '</span><span>阅读约 ' + esc(r.m) + ' 分钟</span></p>' +
      '<p class="rc-t">' + esc(r.t) + '</p>' +
      (part ? '<p class="rc-part">' + esc(part) + '</p>' : '') +
      (r.s ? '<p class="rc-s">' + esc(r.s) + '</p>' : '') +
      (r.g && r.g.length ? '<p class="rc-tags">' + esc(r.g.join(' · ')) + '</p>' : '');
    return el;
  }

  /* under the line of the link the pointer is on (a link can wrap onto two lines), or over it when there is no room */
  function place(el, a, pt) {
    var rects = a.getClientRects(), box = rects[0];
    if (pt) for (var i = 0; i < rects.length; i++) if (pt.y >= rects[i].top - 2 && pt.y <= rects[i].bottom + 2) { box = rects[i]; break; }
    if (!box) return false;
    var w = el.offsetWidth, h = el.offsetHeight, gap = 10, m = 16;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 64;
    var below = box.bottom + gap + h <= vh - m || box.top - gap - h < bar + m;
    var mid = pt && rects.length > 1 ? pt.x : box.left + box.width / 2;
    var left = Math.min(Math.max(m, mid - w / 2), vw - m - w);
    el.style.top = (below ? box.bottom + gap : box.top - gap - h) + 'px';
    el.style.left = left + 'px';
    el.style.setProperty('--ox', Math.round(mid - left) + 'px');
    el.style.setProperty('--oy', below ? '0' : '100%');
    el.style.setProperty('--dy', below ? '-4px' : '4px');
    return true;
  }

  function show(a, pt) {
    clearTimeout(hideT);
    if (owner === a && card) return;
    remove(true);
    var el = build(a);
    if (!el) return;
    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    if (!place(el, a, pt)) { el.remove(); return; }
    el.style.visibility = '';
    card = el;
    owner = a;
    a.setAttribute('aria-describedby', 'ref-card');
    el.addEventListener('pointerenter', function () { clearTimeout(hideT); });
    el.addEventListener('pointerleave', later);
  }

  function remove(now) {
    clearTimeout(hideT);
    if (!card) return;
    var el = card;
    card = null;
    if (owner) owner.removeAttribute('aria-describedby');
    owner = null;
    el.removeAttribute('id');
    if (now) { el.remove(); return; }
    el.classList.add('is-out');
    el.addEventListener('animationend', function () { el.remove(); }, { once: true });
    setTimeout(function () { el.remove(); }, 400);
  }

  /* a moment's grace, so the pointer can cross the gap from the link onto the card */
  function later() {
    clearTimeout(showT);
    clearTimeout(hideT);
    hideT = setTimeout(function () { remove(false); }, 160);
  }

  prose.addEventListener('pointerover', function (e) {
    if (!hover.matches || e.pointerType === 'touch') return;
    var a = e.target.closest && e.target.closest(SEL);
    if (!a || !prose.contains(a)) return;
    clearTimeout(hideT);
    if (owner === a) return;
    clearTimeout(showT);
    var pt = { x: e.clientX, y: e.clientY };
    /* the first card waits a little, so a pointer just passing over a link shows nothing; the next ones come quicker */
    showT = setTimeout(function () { show(a, pt); }, card ? 80 : 380);
  });
  prose.addEventListener('pointerout', function (e) {
    var a = e.target.closest && e.target.closest(SEL);
    if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    clearTimeout(showT);
    if (owner === a) later();
  });
  prose.addEventListener('focusin', function (e) {
    var a = e.target.closest && e.target.closest(SEL);
    if (a && a.matches(':focus-visible')) show(a);
  });
  prose.addEventListener('focusout', function (e) { if (owner && e.target === owner) remove(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') remove(false); });
  /* the card stays where it was put: when the page moves, it goes */
  window.addEventListener('scroll', function () { if (card) remove(true); }, { passive: true });
  window.addEventListener('resize', function () { if (card) remove(true); });
  window.addEventListener('pagehide', function () { clearTimeout(showT); remove(true); });
})();
