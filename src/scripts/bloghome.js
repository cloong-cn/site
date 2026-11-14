/* The blog's front page:
   - the numbers at the top count up from nothing, once
   - cards rise into place as they scroll into view, a row's cards one just after another (data-reveal)
   - the year of writing fills in from left to right when it comes into view, a week at a time
   - on a narrow screen the year scrolls sideways: it opens at its end, this week
   None of it with "reduce motion" switched on, nor coming back to the page (it is simply as it was), nor without
   this script: then everything is just there. */
(function () {
  'use strict';
  var home = document.querySelector('[data-blog-home]');
  if (!home) return;

  var hm = home.querySelector('[data-hm-scroll]');
  if (hm) hm.scrollLeft = hm.scrollWidth;

  var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || (nav && nav.type === 'back_forward') || !('IntersectionObserver' in window)) return;

  /* ---------- the numbers: 0 → 8073, quick at first and settling at the end */
  function countUp(el, delay) {
    var text = el.textContent.trim(), m = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!m) return;
    var target = parseFloat(text), dec = m[2] ? m[2].length : 0, dur = 1000, t0 = 0;
    /* the width the number will end at, so the words after it do not move along */
    el.style.display = 'inline-block';
    el.style.minWidth = el.getBoundingClientRect().width + 'px';
    el.textContent = (0).toFixed(dec);
    requestAnimationFrame(function step(now) {
      if (!t0) t0 = now;
      var k = Math.min(1, Math.max(0, (now - t0 - delay) / dur)), e = 1 - Math.pow(1 - k, 4);
      el.textContent = k < 1 ? (target * e).toFixed(dec) : text;
      if (k < 1) requestAnimationFrame(step);
    });
  }
  [].forEach.call(home.querySelectorAll('[data-count]'), function (el, i) { countUp(el, 150 + i * 90); });

  /* ---------- rising into view */
  var heat = home.querySelector('.heatmap');
  if (heat) heat.classList.add('hm-wait');
  var items = [].slice.call(home.querySelectorAll('[data-reveal]'));
  items.forEach(function (el) { el.classList.add('is-hidden'); });
  var batch = 0, batchT = 0;
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
      if (el === heat) {
        setTimeout(function () { heat.classList.remove('hm-wait'); heat.classList.add('is-wave'); }, d + 200);
        setTimeout(function () { heat.classList.remove('is-wave'); }, d + 1600);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach(function (el) { io.observe(el); });
})();
