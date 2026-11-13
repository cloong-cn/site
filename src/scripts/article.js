/* Article page — small things around the text:
   - Site.toast: a short note at the bottom of the screen ("已复制链接"), used here and by share.js
   - Site.copy: puts text on the clipboard, with the old way for browsers that lack the new one
   - every section heading gets a button beside it that copies the link to that section
   - an article written (or last changed) more than a year ago says so above the text; worked out here rather than at
     the build, so the age is right on the day it is read
   - a long series list shows only the parts near this one until asked for all
   - a link with #hl=… (share.js makes them from selected words) lights those words up and scrolls to them */
(function () {
  'use strict';
  window.Site = window.Site || {};
  var CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var toastEl = null, toastT = 0;
  Site.toast = function (text, ok) {
    clearTimeout(toastT);
    if (toastEl) toastEl.remove();
    var el = toastEl = document.createElement('div');
    el.className = 'toast glass';
    el.setAttribute('role', 'status');
    el.innerHTML = (ok === false ? '' : CHECK) + '<span></span>';
    el.lastChild.textContent = text;
    document.body.appendChild(el);
    toastT = setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); if (toastEl === el) toastEl = null; }, 250);
    }, 1800);
  };

  Site.copy = function (text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t);
      t.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { /* not allowed */ }
      t.remove();
      if (done) ok(); else fail(new Error('copy'));
    });
  };

  var prose = document.querySelector('.prose');
  if (!prose) return;
  var here = function () { return location.origin + location.pathname; };

  /* ---------- the link to a section ---------- */
  var LINK = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.6 9.4a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M9.4 6.6a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.8-.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  [].forEach.call(prose.querySelectorAll('h2[id], h3[id]'), function (h) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'h-anchor';
    b.setAttribute('aria-label', '复制这一节的链接');
    b.innerHTML = LINK;
    b.addEventListener('click', function () {
      var url = here() + '#' + encodeURIComponent(h.id);
      try { history.replaceState(null, '', '#' + encodeURIComponent(h.id)); } catch (e) { /* ignore */ }
      Site.copy(url).then(function () { Site.toast('已复制这一节的链接'); }, function () { Site.toast('没能复制，请从地址栏复制', false); });
    });
    h.insertBefore(b, h.firstChild);
  });

  /* ---------- written long ago ---------- */
  var age = document.querySelector('[data-age]');
  if (age) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(age.getAttribute('data-age'));
    var then = m && new Date(+m[1], m[2] - 1, +m[3]);
    var days = then ? (Date.now() - then) / 864e5 : 0;
    if (days > 365) {
      var years = Math.floor(days / 365);
      age.textContent = (age.hasAttribute('data-updated') ? '这篇文章最后一次更新是在 ' : '这篇文章写于 ') + years + ' 年多以前（' + m[1] + ' 年 ' + (+m[2]) + ' 月），里面提到的版本和做法可能已经变了。';
      age.hidden = false;
    }
  }

  /* ---------- the whole series ---------- */
  var more = document.querySelector('[data-series-more]');
  if (more) more.addEventListener('click', function () { more.closest('.series').classList.add('is-all'); more.remove(); });

  /* ---------- words a shared link points at ----------
     #hl=<words> or #hl=<first words>,<last words>, matched with all white space taken out (a selection's line breaks
     never quite match the page's). The words are wrapped in <mark>, one per text node they run through. */
  function textNodes() {
    var out = [], w = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest('button, .code-head, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function highlight() {
    var h = /^#hl=([^&]*)/.exec(location.hash);
    if (!h) return;
    var parts;
    try { parts = h[1].split(',').map(function (s) { return decodeURIComponent(s).replace(/\s+/g, ''); }).filter(Boolean); } catch (e) { return; }
    if (!parts.length) return;
    [].forEach.call(prose.querySelectorAll('mark.hl-shared'), function (mk) { mk.replaceWith(document.createTextNode(mk.textContent)); });
    prose.normalize();
    var nodes = textNodes(), hay = '', at = [];
    nodes.forEach(function (n, ni) {
      var s = n.data;
      for (var i = 0; i < s.length; i++) if (!/\s/.test(s[i])) { hay += s[i]; at.push([ni, i]); }
    });
    var from = hay.indexOf(parts[0]);
    if (from < 0) return;
    var to = from + parts[0].length;
    if (parts[1]) {
      var end = hay.indexOf(parts[1], to - Math.min(parts[0].length, parts[1].length));
      if (end < 0 || end - from > 6000) return;
      to = end + parts[1].length;
    }
    /* from the last node back, so splitting one never moves the next one's offsets */
    var spans = [];
    for (var k = from; k < to; k++) {
      var last = spans[spans.length - 1];
      if (last && last.n === at[k][0]) last.end = at[k][1] + 1;
      else spans.push({ n: at[k][0], start: at[k][1], end: at[k][1] + 1 });
    }
    var marks = [];
    for (var j = spans.length - 1; j >= 0; j--) {
      var sp = spans[j], r = document.createRange();
      r.setStart(nodes[sp.n], sp.start);
      r.setEnd(nodes[sp.n], sp.end);
      var mk = document.createElement('mark');
      mk.className = 'hl-shared';
      try { r.surroundContents(mk); marks.unshift(mk); } catch (e) { /* across elements: skip that piece */ }
    }
    if (!marks.length) return;
    /* a long code block folded shut opens first */
    var fold = marks[0].closest('.codeblock.is-long:not(.is-open)');
    if (fold && fold.querySelector('.code-fold')) fold.querySelector('.code-fold').click();
    setTimeout(function () {
      marks[0].scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      setTimeout(function () { marks.forEach(function (x) { x.classList.add('is-faded'); }); }, 2600);
    }, 120);
  }
  if (document.readyState === 'complete') highlight(); else window.addEventListener('load', highlight);
  window.addEventListener('hashchange', highlight);
})();
