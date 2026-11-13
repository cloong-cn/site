/* Small motions shared by the pages. All of them only answer something the visitor did, and none of them under
   "reduce motion":
   - Site.slide: a thumb moves to a new place, drawing out a little on the way.
   - Site.roll: the characters of a number or a time that changed roll into place.
   - Site.stagger: things that have just appeared rise in one after another.
   And when a link opens an article, the title that was clicked travels to its place on the new page. */
(function () {
  'use strict';
  var Site = (window.Site = window.Site || {});
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var canAnimate = !!Element.prototype.animate;

  Site.slide = function (el, x, w, instant) {
    /* from where it is right now, which may be halfway through the last move */
    var cs = getComputedStyle(el), m = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform) : null;
    var fx = m ? m.m41 : 0, fw = parseFloat(cs.width) || 0;
    if (el._slide) el._slide.cancel();
    el._slide = null;
    el.style.setProperty('--x', x + 'px');
    el.style.setProperty('--w', w + 'px');
    if (instant || !canAnimate || reduce.matches || !fw || (Math.abs(fx - x) < 1 && Math.abs(fw - w) < 1)) return;
    /* halfway it is a little longer, however far it goes: a long trip must not turn into a long bar */
    var d = x - fx, stretch = Math.min(Math.abs(d) * 0.22, 22), k = 0.5;
    var midW = fw + (w - fw) * k + stretch;
    var midX = fx + d * k - (d > 0 ? 0 : stretch);
    el._slide = el.animate([
      { transform: 'translateX(' + fx + 'px)', width: fw + 'px', easing: 'cubic-bezier(.45,0,.55,1)' },
      { transform: 'translateX(' + midX + 'px)', width: midW + 'px', offset: 0.45, easing: 'cubic-bezier(.22,1,.36,1)' },
      { transform: 'translateX(' + x + 'px)', width: w + 'px' },
    ], { duration: 400 });
    el._slide.onfinish = function () { el._slide = null; };
  };

  function rollChar(box, from, to, dir, delay) {
    var c = document.createElement('span');
    c.className = 'roll-c';
    c.textContent = to || '';
    box.appendChild(c);
    if (to) {
      c.animate([{ transform: 'translateY(' + dir * 0.6 + 'em)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 440, delay: delay, easing: 'cubic-bezier(.34,1.3,.64,1)', fill: 'backwards' });
    }
    if (from) {
      var old = document.createElement('span');
      old.className = 'roll-old';
      old.textContent = from;
      c.appendChild(old);
      old.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(' + -dir * 0.6 + 'em)', opacity: 0 }],
        { duration: 280, delay: delay, easing: 'ease-in', fill: 'both' }).onfinish = function () { old.remove(); };
    }
  }
  Site.roll = function (el, text, instant) {
    text = String(text);
    var was = el.getAttribute('data-roll');
    if (was === null) was = el.textContent;
    if (was === text) return;
    el.setAttribute('data-roll', text);
    if (instant || !canAnimate || reduce.matches) { el.textContent = text; return; }
    var dir = parseFloat(text) < parseFloat(was) ? -1 : 1; /* a number going down rolls the other way */
    el.textContent = '';
    /* a screen reader gets the plain text, not one character at a time */
    var plain = document.createElement('span'), box = document.createElement('span');
    plain.className = 'sr-only';
    plain.textContent = text;
    box.setAttribute('aria-hidden', 'true');
    el.appendChild(plain);
    el.appendChild(box);
    /* lined up from the right, so 9 → 10 changes the units as it should */
    var n = Math.max(was.length, text.length), k = 0;
    for (var i = 0; i < n; i++) {
      var a = was.charAt(i - (n - was.length)), b = text.charAt(i - (n - text.length));
      if (a === b) box.appendChild(document.createTextNode(b));
      else rollChar(box, a, b, dir, k++ * 35);
    }
  };

  Site.stagger = function (els, limit) {
    if (!canAnimate || reduce.matches) return;
    [].slice.call(els, 0, limit || 14).forEach(function (e, i) {
      e.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay: i * 28, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    });
  };

  /* Leaving for an article: the title clicked is the one to travel (base.css has the rest; on the article itself the
     stylesheet names the heading, since this script may not have run yet when that page first draws). An article has
     a title of its own taking that name, so it does not lend another. */
  var lent = null;
  function giveBack() { if (lent) { lent.style.viewTransitionName = ''; lent = null; } }
  window.addEventListener('pageswap', function (e) {
    if (!e.viewTransition || !e.activation || !e.activation.entry || document.querySelector('.article-title, .album-title')) return;
    var to = e.activation.entry.url.split('#')[0], links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].href.split('#')[0] !== to) continue;
      var t = links[i].querySelector('.title, .row-title, .w-title, .t');
      if (!t) continue;
      var r = t.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      t.style.viewTransitionName = 'post-title';
      lent = t;
      return;
    }
  });
  /* back from the article with this page still in memory: the title flies home first */
  window.addEventListener('pagereveal', function (e) {
    if (e.viewTransition) e.viewTransition.finished.then(giveBack, giveBack);
    else giveBack();
  });
})();
