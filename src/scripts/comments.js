/* Comments under an article.
   - Loaded from the comment service on this server (server/) once the reader gets near the end of the page;
     if the service cannot be reached the section simply stays hidden.
   - New comments wait for approval; the writer sees their own as "审核中" until then (kept in their browser).
   - Everything a visitor wrote goes onto the page as text, never as HTML; only http(s) addresses become links. */
(function () {
  'use strict';
  var root = document.querySelector('[data-comments]');
  if (!root) return;

  var api = root.getAttribute('data-api');
  var slug = root.getAttribute('data-post');
  var demo = root.hasAttribute('data-demo');
  var list = root.querySelector('[data-list]');
  var empty = root.querySelector('[data-empty]');
  var notice = root.querySelector('[data-notice]');
  var countEl = root.querySelector('[data-count]');
  var form = root.querySelector('[data-form]');
  var status = form.querySelector('[data-status]');
  var submit = form.querySelector('[type="submit"]');
  var replying = form.querySelector('[data-replying]');
  var lenEl = form.querySelector('[data-len]');
  var field = function (n) { return form.elements.namedItem(n); };
  var textarea = field('content');
  var home = form.parentNode, homeNext = form.nextSibling;
  var MAX = 2000, DAY = 864e5;
  var comments = [], parent = 0, shownAt = 0, started = false, sending = false;

  var store = {
    get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function length(s) { return Array.from(s).length; }

  /* ------------------------------------------------------------ time */
  function ago(ms) {
    var s = (Date.now() - ms) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
    var d = new Date(ms);
    return (d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + ' 年 ') + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  function stamp(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ------------------------------------------------------------ text */
  function safeUrl(u) {
    try {
      var x = new URL(u);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
    } catch (e) { return null; }
  }
  function outLink(a, href) {
    a.href = href;
    a.target = '_blank';
    a.rel = 'nofollow ugc noopener noreferrer';
  }
  var URL_RE = /https?:\/\/[^\s<>"'`，。！？；：、（）《》【】「」]+/g;
  /* paragraphs on blank lines, line breaks kept, addresses as links */
  function textInto(el, text) {
    text.split(/\n{2,}/).forEach(function (para) {
      /* a paragraph whose every line starts with ">" is a quote (the selection bar's 引用 writes one) */
      var quote = /^>/.test(para) && para.split('\n').every(function (ln) { return /^>/.test(ln); });
      if (quote) para = para.replace(/^> ?/gm, '');
      var p = make(quote ? 'blockquote' : 'p');
      para.split('\n').forEach(function (ln, i) {
        if (i) p.appendChild(make('br'));
        var last = 0, m;
        URL_RE.lastIndex = 0;
        while ((m = URL_RE.exec(ln))) {
          var u = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
          if (m.index > last) p.appendChild(document.createTextNode(ln.slice(last, m.index)));
          var href = safeUrl(u);
          if (href) { var a = make('a', null, u); outLink(a, href); p.appendChild(a); }
          else p.appendChild(document.createTextNode(u));
          last = m.index + u.length;
          URL_RE.lastIndex = last;
        }
        if (last < ln.length) p.appendChild(document.createTextNode(ln.slice(last)));
      });
      el.appendChild(p);
    });
  }
  function initial(name) {
    var c = Array.from(String(name).trim())[0] || '?';
    return c.toUpperCase();
  }

  /* ------------------------------------------------------------ the visitor's own comments, until approved */
  var MINE = 'comments-mine';
  function mine() {
    return (store.get(MINE, {})[slug] || []).filter(function (c) { return c && Date.now() - c.at < 14 * DAY; });
  }
  function keepMine(items) {
    var all = store.get(MINE, {});
    if (items.length) all[slug] = items.slice(-20); else delete all[slug];
    store.set(MINE, all);
  }

  /* ------------------------------------------------------------ list */
  function badge(text, cls) { return make('span', 'cm-badge' + (cls ? ' ' + cls : ''), text); }

  function item(c, top, pending) {
    var li = make('li', 'cm-item' + (c.owner ? ' is-owner' : '') + (pending ? ' is-pending' : ''));
    if (!pending) li.id = 'comment-' + c.id;
    var av = make('div', 'cm-avatar', initial(c.name));
    av.setAttribute('aria-hidden', 'true');
    var body = make('div', 'cm-body');
    var meta = make('div', 'cm-meta');
    var href = c.url && safeUrl(c.url);
    var name = make(href ? 'a' : 'span', 'cm-name', c.name);
    if (href) outLink(name, href);
    meta.appendChild(name);
    if (c.owner) meta.appendChild(badge('作者'));
    if (pending) meta.appendChild(badge('审核中', 'is-pending'));
    var t = make(pending ? 'span' : 'a', 'cm-time', ago(c.at));
    t.title = stamp(c.at);
    if (!pending) t.href = '#comment-' + c.id;
    meta.appendChild(t);
    body.appendChild(meta);
    var text = make('div', 'cm-text');
    textInto(text, c.content);
    body.appendChild(text);
    if (!pending) {
      var tools = make('div', 'cm-tools');
      var r = make('button', 'cm-link cm-reply', '回复');
      r.type = 'button';
      r.setAttribute('data-reply', String(top));
      r.setAttribute('data-name', c.name);
      tools.appendChild(r);
      body.appendChild(tools);
    }
    li.appendChild(av);
    li.appendChild(body);
    return li;
  }

  function render() {
    var byId = {}, tops = [], replies = {};
    comments.forEach(function (c) { byId[c.id] = c; });
    comments.forEach(function (c) {
      if (c.parent && byId[c.parent]) (replies[c.parent] = replies[c.parent] || []).push(c);
      else tops.push(c);
    });
    /* own comments still waiting; approved ones are now in the list and are forgotten */
    var waiting = mine().filter(function (c) { return !byId[c.id]; });
    keepMine(waiting);

    var keep = form.parentNode !== home ? form : null;
    if (keep) home.insertBefore(form, homeNext);
    list.textContent = '';
    tops.forEach(function (c) {
      var li = item(c, c.id);
      var sub = make('ol', 'cm-replies');
      (replies[c.id] || []).forEach(function (r) { sub.appendChild(item(r, c.id)); });
      waiting.forEach(function (w) { if (w.parent === c.id) sub.appendChild(item(w, c.id, true)); });
      if (sub.children.length) li.lastChild.appendChild(sub);
      list.appendChild(li);
    });
    waiting.forEach(function (w) { if (!w.parent || !byId[w.parent]) list.appendChild(item(w, 0, true)); });
    countEl.textContent = comments.length ? String(comments.length) : '';
    empty.hidden = list.children.length > 0;
    if (keep && parent) {
      var host = document.getElementById('comment-' + parent);
      if (host) host.lastChild.appendChild(form); else cancelReply();
    }
  }

  /* ------------------------------------------------------------ loading */
  function reveal() {
    root.hidden = false;
    shownAt = Date.now();
  }
  function say(el, text, kind) {
    el.textContent = text || '';
    el.className = el.className.replace(/\s*is-(ok|error)/g, '') + (kind ? ' is-' + kind : '');
  }
  function goToHash() {
    var h = location.hash;
    if (!h) return;
    var el = h === '#comments' ? root : /^#comment-\d+$/.test(h) ? document.getElementById(h.slice(1)) : null;
    if (!el) return;
    el.scrollIntoView({ block: h === '#comments' ? 'start' : 'center' });
    if (el !== root) {
      el.classList.add('is-target');
      setTimeout(function () { el.classList.remove('is-target'); }, 2400);
    }
  }
  function load() {
    if (started) return;
    started = true;
    if (demo) {
      try { comments = JSON.parse(document.getElementById('cm-demo').textContent); } catch (e) { comments = []; }
      reveal(); render(); goToHash();
      if (window.Site && Site.stagger) Site.stagger(list.children, 8);
      return;
    }
    /* a slow connection gets a sign of life; a fast one never sees it */
    var waiting = null, waitT = setTimeout(function () {
      waiting = make('div', 'cm-loading');
      for (var i = 0; i < 5; i++) waiting.appendChild(make('i'));
      waiting.setAttribute('role', 'status');
      waiting.setAttribute('aria-label', '正在加载评论');
      root.parentNode.insertBefore(waiting, root);
    }, 300);
    fetch(api + '?post=' + encodeURIComponent(slug), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 503) return { unavailable: true };
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (d) {
        if (d.unavailable) {
          reveal(); render();
          notice.hidden = false;
          notice.textContent = '评论暂时加载不了，请稍后再来看看。';
          return;
        }
        if (!d || !Array.isArray(d.comments)) throw new Error('unexpected answer');
        comments = d.comments.filter(function (c) { return c && typeof c.id === 'number' && typeof c.content === 'string' && typeof c.name === 'string'; });
        reveal(); render(); goToHash();
        if (window.Site && Site.stagger) Site.stagger(list.children, 8);
      })
      .catch(function () {
        /* no comment service (not set up, or a local preview): stay out of the way. The local preview says why */
        if (!root.hasAttribute('data-dev')) return;
        reveal(); render();
        notice.hidden = false;
        notice.textContent = '本地预览没有连上评论服务，上线后这里会显示评论。想在本地试一试，见 README 的「评论」一节。';
      })
      .then(function () {
        clearTimeout(waitT);
        if (waiting) waiting.remove();
      });
  }
  var foot = root.parentNode.querySelector('.article-foot') || root.parentNode;
  if (/^#comment/.test(location.hash) || !('IntersectionObserver' in window)) load();
  else {
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); }
    }, { rootMargin: '900px 0px' });
    io.observe(foot);
  }
  window.addEventListener('hashchange', function () { if (/^#comment/.test(location.hash)) { load(); goToHash(); } });

  /* ------------------------------------------------------------ writing */
  var author = store.get('comment-author', {});
  ['name', 'email', 'url'].forEach(function (k) { if (typeof author[k] === 'string') field(k).value = author[k]; });
  var DRAFT = 'comment-draft:' + slug;
  try { textarea.value = sessionStorage.getItem(DRAFT) || ''; } catch (e) { /* ignore */ }

  function counter() {
    var n = length(textarea.value);
    lenEl.textContent = n > MAX - 300 ? n + ' / ' + MAX : '';
    lenEl.classList.toggle('is-over', n > MAX);
  }
  textarea.addEventListener('input', function () {
    counter();
    openForm();
    try { sessionStorage.setItem(DRAFT, textarea.value); } catch (e) { /* ignore */ }
  });
  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });
  counter();

  /* like a message field: one line of glass with a send button until you start; then it opens out for your name,
     email and site. It stays open while there is text, while you are replying, or while anything in it has focus */
  function openForm() {
    var text = !!textarea.value.trim();
    form.classList.toggle('is-open', text || parent > 0 || form.contains(document.activeElement));
    form.classList.toggle('has-text', text);
  }
  form.addEventListener('focusin', openForm);
  form.addEventListener('focusout', function () { setTimeout(openForm, 0); });
  openForm();

  function startReply(top, name, host) {
    parent = top;
    replying.hidden = false;
    replying.querySelector('[data-replying-name]').textContent = name;
    host.appendChild(form);
    say(status, '');
    textarea.focus();
    openForm();
  }
  function cancelReply() {
    parent = 0;
    replying.hidden = true;
    if (form.parentNode !== home) home.insertBefore(form, homeNext);
    openForm();
  }
  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-reply]');
    if (b) startReply(Number(b.getAttribute('data-reply')), b.getAttribute('data-name'), b.closest('.cm-item').lastChild);
  });
  replying.querySelector('[data-cancel]').addEventListener('click', function () { cancelReply(); textarea.focus(); });

  function post(data) {
    if (demo) return new Promise(function (ok) { setTimeout(function () { ok({ status: 202, body: { status: 'pending', id: -Date.now() } }); }, 500); });
    return fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(data),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; });
    });
  }

  function send() {
    if (sending) return;
    var data = {
      post: slug,
      parent: parent,
      name: field('name').value.trim(),
      email: field('email').value.trim(),
      url: field('url').value.trim(),
      content: textarea.value.trim(),
      website2: field('website2').value,
      t: 0,
    };
    var problem = !data.content ? ['请先写点内容', textarea]
      : length(data.content) > MAX ? ['评论太长了，最多 ' + MAX + ' 个字', textarea]
      : !data.name ? ['请填写昵称', field('name')]
      : data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? ['邮箱格式不对', field('email')]
      : null;
    if (problem) { say(status, problem[0], 'error'); problem[1].focus(); return; }

    sending = true;
    submit.disabled = true;
    say(status, '正在提交…');
    /* the service ignores forms sent within three seconds of appearing (that is how bots behave), so a restored
       draft sent right away waits a moment */
    new Promise(function (ok) { setTimeout(ok, Math.max(0, 3100 - (Date.now() - shownAt))); }).then(function () {
      data.t = Date.now() - shownAt;
      return post(data);
    }).then(function (res) {
      if (res.status === 202) {
        store.set('comment-author', { name: data.name, email: data.email, url: data.url });
        if (typeof res.body.id === 'number') {
          var own = mine();
          own.push({ id: res.body.id, parent: parent, name: data.name, url: data.url ? (/^https?:\/\//i.test(data.url) ? data.url : 'https://' + data.url) : null, content: data.content, at: Date.now() });
          keepMine(own);
        }
        textarea.value = '';
        try { sessionStorage.removeItem(DRAFT); } catch (e) { /* ignore */ }
        counter();
        cancelReply();
        textarea.blur();
        openForm();
        render();
        say(status, '已提交，审核通过后就会显示。', 'ok');
      } else {
        say(status, (res.body && typeof res.body.message === 'string' && res.body.message) || '没有提交成功，请稍后再试', 'error');
      }
    }, function () {
      say(status, '网络好像断了，没有提交成功', 'error');
    }).then(function () {
      sending = false;
      submit.disabled = false;
    });
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
})();
