/* The blog's front page:
   - cards rise into place as they scroll into view, a row's cards one just after another (data-reveal); with
     "reduce motion" switched on, or without this script, everything is simply there
   - on a narrow screen the year of writing scrolls sideways: it opens at its end, this week */
(function () {
  'use strict';
  var home = document.querySelector('[data-blog-home]');
  if (!home) return;

  var hm = home.querySelector('[data-hm-scroll]');
  if (hm) hm.scrollLeft = hm.scrollWidth;

  var items = [].slice.call(home.querySelectorAll('[data-reveal]'));
  if (!items.length || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  /* what is already on the first screen comes in at once, in order; the rest as it is reached */
  items.forEach(function (el) { el.classList.add('is-hidden'); });
  var seen = 0, batch = 0, batchT = 0;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      /* cards that come into view together are staggered a little */
      clearTimeout(batchT);
      batchT = setTimeout(function () { batch = 0; }, 120);
      var el = e.target, d = batch++ * 70;
      el.style.setProperty('--d', d + 'ms');
      el.classList.add('is-in');
      el.classList.remove('is-hidden');
      /* once it is up, its own transitions (the lift under the pointer) apply again, without the delay */
      setTimeout(function () { el.classList.remove('is-in'); el.style.removeProperty('--d'); }, d + 800);
      seen++;
      if (seen === items.length) io.disconnect();
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach(function (el) { io.observe(el); });
})();
