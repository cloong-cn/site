/* The top bar's capsule: a smaller capsule slides under the link of where you are. Pages mark that link with
   aria-current (the home page changes it as you scroll, home.js); this only follows the mark. */
(function () {
  'use strict';
  var pill = document.querySelector('[data-nav-pill]');
  if (!pill) return;
  var box = pill.querySelector('.nav-links');
  var thumb = pill.querySelector('.nav-thumb');
  var links = box.querySelectorAll('a');

  function place(instant) {
    var cur = box.querySelector('a[aria-current]');
    if (!cur) { thumb.classList.remove('is-on'); return; }
    Site.slide(thumb, cur.offsetLeft, cur.offsetWidth, instant);
    thumb.classList.add('is-on');
  }
  place(true); /* the first placement does not slide in from the left edge */

  if ('MutationObserver' in window) {
    new MutationObserver(function () { place(false); }).observe(box, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  }
  /* the web font arriving changes the links' widths */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(true); });
  window.addEventListener('resize', function () { place(true); });
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function () {
      /* on the home page the bar follows the scroll; here it answers the click straight away */
      if (this.getAttribute('href').charAt(0) !== '#') return;
      for (var k = 0; k < links.length; k++) links[k].removeAttribute('aria-current');
      this.setAttribute('aria-current', 'true');
    });
  }
})();
