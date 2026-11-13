/* Sharing an article, or a few words of it.
   - The 分享 button opens a small menu: the system's own share sheet (where there is one), copy the link, a picture to
     share, X, Weibo.
   - Selecting words in the text brings up a bar over them: copy a link that lights those words up when opened
     (#hl=…, see article.js), make a picture of the quote, or quote them in a comment.
   - The picture is drawn here, on a canvas, in the page's own fonts and colours: the quote (or the title and summary),
     the article's title and date, the site's name and address. It can be saved, copied or handed to the share sheet.
   Nothing is sent anywhere: X and Weibo only get a link opened in a new tab when chosen. */
(function () {
  'use strict';
  var article = document.querySelector('.article[data-share-title]');
  var prose = article && article.querySelector('.prose');
  if (!article || !prose) return;
  var info = {
    title: article.getAttribute('data-share-title'),
    desc: article.getAttribute('data-share-desc') || '',
    date: article.getAttribute('data-share-date') || '',
    site: article.getAttribute('data-share-site') || document.title,
  };
  var url = function () { return location.origin + location.pathname; };
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  var I = {
    sys: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10V2.2M5 4.8 8 1.8l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.2 7H4a1.5 1.5 0 0 0-1.5 1.5v4.8A1.5 1.5 0 0 0 4 14.8h8a1.5 1.5 0 0 0 1.5-1.5V8.5A1.5 1.5 0 0 0 12 7h-1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    link: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.6 9.4a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M9.4 6.6a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.8-.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2.2" stroke="currentColor" stroke-width="1.5"/><circle cx="5.8" cy="6.2" r="1.2" fill="currentColor"/><path d="m2.5 11.5 3.3-3.1 2.4 2.2 2-1.8 3.3 3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    quote: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 3.5h11v7.2H8.2L5 13.3v-2.6H2.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.5 6.4h5M5.5 8.4h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M12.2 1.5h2.2L9.6 7 15.2 14.5h-4.4L7.4 10l-4 4.5H1.2l5.2-5.9L1 1.5h4.5l3.1 4.1zm-.8 11.7h1.2L4.7 2.7H3.4z"/></svg>',
    weibo: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.6 13.6c-3 0-5.3-1.4-5.3-3.3 0-1 .6-2.2 1.8-3.4 1.6-1.6 3.5-2.4 4.2-1.7.3.3.3.8.1 1.4 1-.4 2-.4 2.4.1.2.3.2.7 0 1.2 1.2.4 2 1 2 2 0 2-2.4 3.7-5.2 3.7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="6.4" cy="10.4" r="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M11 2.8a3.4 3.4 0 0 1 3.4 4M10.9 4.8a1.4 1.4 0 0 1 1.5 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  };

  function copyLink(link, done) {
    Site.copy(link).then(function () { Site.toast(done || '已复制链接'); }, function () { Site.toast('没能复制，请从地址栏复制', false); });
  }
  function systemShare(data) {
    return navigator.share(data).catch(function (e) { if (e && e.name !== 'AbortError') Site.toast('没能打开系统分享', false); });
  }

  /* ---------------------------------------------------------- the menu under 分享 */
  var btn = article.querySelector('[data-share]');
  var menu = null;
  function closeMenu(back) {
    if (!menu) return;
    menu.remove();
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    if (back) btn.focus();
  }
  function openMenu() {
    var items = [];
    if (navigator.share) items.push(['sys', '系统分享…', function () { systemShare({ title: info.title, text: info.desc, url: url() }); }]);
    items.push(['link', '复制链接', function () { copyLink(url()); }]);
    items.push(['image', '生成分享图', function () { picture(null); }]);
    items.push(['x', '分享到 X', 'https://x.com/intent/post?text=' + encodeURIComponent(info.title) + '&url=' + encodeURIComponent(url())]);
    items.push(['weibo', '分享到微博', 'https://service.weibo.com/share/share.php?title=' + encodeURIComponent(info.title) + '&url=' + encodeURIComponent(url())]);
    menu = document.createElement('div');
    menu.className = 'share-menu glass';
    menu.setAttribute('role', 'menu');
    items.forEach(function (it) {
      var el = document.createElement(typeof it[2] === 'string' ? 'a' : 'button');
      el.setAttribute('role', 'menuitem');
      el.innerHTML = I[it[0]] + '<span></span>';
      el.lastChild.textContent = it[1];
      if (typeof it[2] === 'string') { el.href = it[2]; el.target = '_blank'; el.rel = 'noopener'; el.addEventListener('click', function () { closeMenu(); }); }
      else { el.type = 'button'; el.addEventListener('click', function () { closeMenu(); it[2](); }); }
      menu.appendChild(el);
    });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(), w = menu.offsetWidth, vw = document.documentElement.clientWidth;
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.left = Math.max(16, Math.min(r.right - w, vw - 16 - w)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]').focus();
  }
  if (btn) {
    btn.addEventListener('click', function () { if (menu) closeMenu(); else openMenu(); });
    document.addEventListener('pointerdown', function (e) { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', function (e) {
      if (!menu) return;
      var all = [].slice.call(menu.querySelectorAll('[role="menuitem"]')), i = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length].focus(); }
      else if (e.key === 'Tab') closeMenu();
    });
    window.addEventListener('scroll', function () { closeMenu(); }, { passive: true });
    window.addEventListener('resize', function () { closeMenu(); });
  }

  /* ---------------------------------------------------------- the bar over selected words */
  var bar = null, chosen = '', barT = 0;
  function selected() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!prose.contains(range.commonAncestorContainer)) return null;
    var text = sel.toString().replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (text.replace(/\s/g, '').length < 2) return null;
    return { range: range, text: text };
  }
  /* the link: the words with the white space taken out; a long passage by its first and last few */
  function quoteLink(text) {
    var s = text.replace(/\s+/g, '');
    var part = s.length <= 40 ? encodeURIComponent(s) : encodeURIComponent(s.slice(0, 14)) + ',' + encodeURIComponent(s.slice(-14));
    return url() + '#hl=' + part;
  }
  function commentsOpen() {
    var c = document.querySelector('[data-comments]');
    return c && !c.hidden && c.querySelector('textarea[name="content"]') ? c : null;
  }
  function quoteInComment(text) {
    var c = commentsOpen();
    if (!c) return;
    var ta = c.querySelector('textarea[name="content"]');
    var q = Array.from(text).slice(0, 300).join('') + (Array.from(text).length > 300 ? '…' : '');
    var block = q.split('\n').filter(Boolean).map(function (l) { return '> ' + l; }).join('\n') + '\n\n';
    ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, '') + '\n\n' : '') + block;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(function () { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 350);
  }
  function hideBar() { if (bar) { bar.remove(); bar = null; } }
  function placeBar(range) {
    var rects = range.getClientRects();
    if (!rects.length || !bar) return;
    var first = rects[0], last = rects[rects.length - 1];
    var w = bar.offsetWidth, h = bar.offsetHeight, vw = document.documentElement.clientWidth, m = 12;
    /* with a mouse, over the first line; on a touch screen, under the last line, out of the system's own menu */
    var above = fine.matches && first.top - h - 10 > 72;
    var top = above ? first.top - h - 10 : last.bottom + 12;
    var mid = above ? first.left + first.width / 2 : last.left + last.width / 2;
    bar.style.top = Math.min(top, window.innerHeight - h - m) + 'px';
    bar.style.left = Math.max(m, Math.min(mid - w / 2, vw - m - w)) + 'px';
  }
  function showBar(s) {
    chosen = s.text;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sel-bar glass';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '分享选中的文字');
      var add = function (icon, label, fnc) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = I[icon] + '<span></span>';
        b.lastChild.textContent = label;
        /* pressing it must not take the selection away */
        b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { var t = chosen; fnc(t); });
        bar.appendChild(b);
      };
      add('link', '复制链接', function (t) { copyLink(quoteLink(t), '已复制链接，打开时会标出这段文字'); });
      add('image', '分享图片', function (t) { hideBar(); picture(t); });
      if (commentsOpen()) add('quote', '引用', function (t) { hideBar(); window.getSelection().removeAllRanges(); quoteInComment(t); });
      document.body.appendChild(bar);
    }
    placeBar(s.range);
  }
  function check() {
    clearTimeout(barT);
    barT = setTimeout(function () {
      var s = selected();
      if (s) showBar(s); else hideBar();
    }, fine.matches ? 60 : 250);
  }
  document.addEventListener('selectionchange', check);
  window.addEventListener('scroll', function () {
    if (!bar) return;
    var s = selected();
    if (s) placeBar(s.range); else hideBar();
  }, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideBar(); });

  /* ---------------------------------------------------------- the picture */
  var W = 1080, PAD = 88;
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function fontOf(sel) { var el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : 'sans-serif'; }
  /* lines of at most `width`: Latin words kept whole, Chinese broken between any two characters, and no line starting
     with a closing mark (it stays at the end of the line before) */
  var NO_START = /^[，。、；：！？）」』”’》〉】…—,.;:!?)\]}%]/;
  function wrap(ctx, text, width, maxLines) {
    var lines = [];
    text.split('\n').forEach(function (para) {
      var units = para.match(/[A-Za-z0-9_@#$%&+\-'.\/:]+\s*|\s+|./gu) || [];
      var line = '';
      units.forEach(function (u) {
        if (ctx.measureText(line + u).width <= width || !line) { line += u; return; }
        if (NO_START.test(u)) { line += u; return; }
        lines.push(line.replace(/\s+$/, ''));
        line = u.replace(/^\s+/, '');
      });
      if (line.trim()) lines.push(line.replace(/\s+$/, ''));
    });
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var lastLine = lines[maxLines - 1];
      while (lastLine && ctx.measureText(lastLine + '…').width > width) lastLine = Array.from(lastLine).slice(0, -1).join('');
      lines[maxLines - 1] = lastLine + '…';
    }
    return lines;
  }
  function draw(quote, theme) {
    var dark = theme === 'dark';
    var C = {
      bg: dark ? '#111113' : '#ffffff', text: dark ? '#f5f5f7' : '#1d1d1f', text2: dark ? '#a1a1a6' : '#424245',
      text3: dark ? '#86868b' : '#6e6e73', line: dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)', accent: cssVar('--link') || '#2997ff',
    };
    var sans = fontOf('.prose'), display = fontOf('.article-title');
    var c = document.createElement('canvas'), g = c.getContext('2d');
    var inner = W - PAD * 2;
    /* measure first, then size the canvas and draw */
    var big = quote
      ? { font: '500 46px ' + sans, lh: 78, text: quote, max: 12 }
      : { font: '600 64px ' + display, lh: 86, text: info.title, max: 4 };
    g.font = big.font;
    var bigLines = wrap(g, big.text, inner, big.max);
    var sub = null;
    if (!quote && info.desc) { g.font = '400 34px ' + sans; sub = wrap(g, info.desc, inner, 4); }
    g.font = '600 32px ' + display;
    var titleLines = quote ? wrap(g, info.title, inner, 2) : [];
    var host = location.host + location.pathname.replace(/\/$/, '');
    var y = PAD + 52 + 56 + (quote ? 70 : 0);
    var h = y + bigLines.length * big.lh + (sub ? 28 + sub.length * 54 : 0) + 72 + 1 + 48 + titleLines.length * 46 + 44 + PAD;
    c.width = W;
    c.height = Math.max(Math.round(W * 0.75), h);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, c.width, c.height);
    /* a band of the link colour along the top */
    var band = g.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, C.accent);
    band.addColorStop(1, dark ? '#5e5ce6' : '#5856d6');
    g.fillStyle = band;
    g.fillRect(0, 0, W, 10);
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.text3;
    g.font = '500 28px ' + sans;
    g.fillText(info.site, PAD, PAD + 28);
    y = PAD + 52 + 56;
    if (quote) {
      g.fillStyle = C.accent;
      g.font = '600 150px Georgia, "Times New Roman", serif';
      g.fillText('“', PAD - 8, y + 70);
      y += 70;
    }
    g.fillStyle = C.text;
    g.font = big.font;
    bigLines.forEach(function (l) { y += big.lh; g.fillText(l, PAD, y - (big.lh - 46) / 2); });
    if (sub) {
      y += 28;
      g.fillStyle = C.text2;
      g.font = '400 34px ' + sans;
      sub.forEach(function (l) { y += 54; g.fillText(l, PAD, y - 10); });
    }
    y = Math.max(y + 72, c.height - PAD - 44 - titleLines.length * 46 - 48);
    g.fillStyle = C.line;
    g.fillRect(PAD, y, inner, 2);
    y += 48;
    g.fillStyle = C.text;
    g.font = '600 32px ' + display;
    titleLines.forEach(function (l) { y += 46; g.fillText(l, PAD, y - 10); });
    g.fillStyle = C.text3;
    g.font = '400 26px ' + sans;
    y += 44;
    g.fillText((info.date ? info.date + '  ·  ' : '') + host, PAD, y - 8);
    return c;
  }
  /* the fonts must be there before drawing, or the canvas uses a fallback */
  function ready(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var sans = fontOf('.prose'), display = fontOf('.article-title');
    return Promise.all([
      document.fonts.load('500 46px ' + sans, text), document.fonts.load('600 64px ' + display, info.title),
      document.fonts.load('400 26px ' + sans, info.desc + info.date + info.site),
    ]).catch(function () {});
  }

  var dlg = null;
  function picture(quote) {
    var theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var blob = null, canvas = null;
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.className = 'share-dialog';
    dlg.setAttribute('aria-label', '分享图片');
    var canCopy = !!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
    dlg.innerHTML = '<div class="sd-head"><p class="sd-title">分享图片</p><button class="icon-btn sd-close" type="button" aria-label="关闭">' + I.close + '</button></div>' +
      '<img class="sd-img is-busy" alt="分享图片的预览">' +
      '<div class="sd-foot"><div class="seg" role="group" aria-label="图片的颜色"><button type="button" data-t="light">浅色</button><button type="button" data-t="dark">深色</button></div>' +
      (canCopy ? '<button class="btn btn-ghost" type="button" data-copy>复制图片</button>' : '') +
      '<button class="btn btn-ghost" type="button" data-share-file hidden>分享…</button>' +
      '<a class="btn btn-primary" data-save download="share.png">保存图片</a>' +
      '<p class="sd-hint" data-hint></p></div>';
    document.body.appendChild(dlg);
    var img = dlg.querySelector('.sd-img'), save = dlg.querySelector('[data-save]'), hint = dlg.querySelector('[data-hint]');
    var shareBtn = dlg.querySelector('[data-share-file]');
    save.download = (info.title || 'share').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) + '.png';
    /* phones save a picture by pressing on it */
    hint.textContent = fine.matches ? '' : '也可以长按图片保存。';
    function render() {
      [].forEach.call(dlg.querySelectorAll('[data-t]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-t') === theme)); });
      img.classList.add('is-busy');
      ready((quote || '') + info.title).then(function () {
        canvas = draw(quote, theme);
        var data = canvas.toDataURL('image/png');
        img.src = data;
        save.href = data;
        img.classList.remove('is-busy');
        canvas.toBlob(function (b) {
          blob = b;
          var file = b && new File([b], save.download, { type: 'image/png' });
          shareBtn.hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
        }, 'image/png');
      });
    }
    dlg.querySelector('.sd-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('close', function () { var d = dlg; setTimeout(function () { if (d) d.remove(); }, 0); dlg = null; });
    /* a click on the dimmed page around it (the dialog itself is the target there too, so by position) */
    dlg.addEventListener('click', function (e) {
      if (e.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    [].forEach.call(dlg.querySelectorAll('[data-t]'), function (b) { b.addEventListener('click', function () { theme = b.getAttribute('data-t'); render(); }); });
    var copyBtn = dlg.querySelector('[data-copy]');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      if (!blob) return;
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () { Site.toast('已复制图片'); }, function () { Site.toast('这个浏览器不让复制图片，请保存后再发', false); });
    });
    shareBtn.addEventListener('click', function () {
      if (!blob) return;
      systemShare({ files: [new File([blob], save.download, { type: 'image/png' })], title: info.title, text: quote ? quote.slice(0, 80) : info.title });
    });
    dlg.showModal();
    render();
  }
})();
