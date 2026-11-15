/* The back office. It lives at a secret address that only the server knows (admin.path); its API is right under it.
   Sign in with the admin password and the six-digit code from the authenticator app on your phone. Then:
   - Articles: write Markdown with a live preview. Everything is saved as you type (and kept in this browser until it
     is); "发布" puts the saved version on the site. Every save and every publish is a version you can go back to.
     Paste from SiYuan, web pages or Word and it becomes Markdown; pictures can be pasted or dropped in.
   - Import / export: Markdown files and zips with their pictures, both ways.
   - Albums: photos on a timeline, each with a note; an article can show a few of them.
   - Comments: approve, answer, delete.  Home page: the words on the home page.
   - Releases and backups: switch back to an earlier build, download the nightly backup.
   - Security: who tried the decoy sign-in pages.
   Everything visitors wrote is shown as text, and the page's security policy lets no other script run. */
(function () {
  'use strict';
  var root = document.querySelector('[data-admin]');
  if (!root) return;

  var API = location.pathname.replace(/[^/]*$/, '') + 'api/';
  var CSS = root.getAttribute('data-css');
  var SIYUAN = 'http://127.0.0.1:6806/';
  var $ = function (s, el) { return (el || root).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || root).querySelectorAll(s)); };
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, text) {
    var b = make('button', cls, text);
    b.type = 'button';
    return b;
  }
  function say(el, text, kind) {
    el.textContent = text || '';
    el.classList.remove('is-ok', 'is-error');
    if (kind) el.classList.add('is-' + kind);
  }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode, or full */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function clock(ms) { return stamp(ms).slice(11); }
  /* when a scheduled article goes up: "11-20 08:00" in the list, "11 月 20 日 08:00" in words */
  function whenShort(ms) { return stamp(ms).slice(5); }
  function whenText(ms) { var d = new Date(ms); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return '刚才';
    if (m < 60) return m + ' 分钟前';
    if (m < 1440) return Math.round(m / 60) + ' 小时前';
    return Math.round(m / 1440) + ' 天前';
  }
  function size(n) {
    return n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function safeUrl(u) {
    try {
      var x = new URL(u);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
    } catch (e) { return null; }
  }
  function escHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  /* a button that asks once more before it does something that cannot be taken back */
  function armed(b, question) {
    if (b.classList.contains('is-armed')) return true;
    var label = b.textContent;
    b.classList.add('is-armed');
    b.textContent = question;
    setTimeout(function () { b.classList.remove('is-armed'); b.textContent = label; }, 3000);
    return false;
  }

  /* ------------------------------------------------------------ talking to the admin service */
  function call(path, body, raw) {
    var opt = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opt.method = 'POST';
      if (raw) {
        opt.headers['Content-Type'] = raw;
        opt.body = body;
      } else {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify(body);
      }
    }
    return fetch(API + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.ok || r.status === 202) return b;
        var e = new Error(typeof b.message === 'string' ? b.message : '出错了（' + r.status + '）');
        e.status = r.status;
        e.code = b.error;
        if (r.status === 401 && path !== 'login' && signedIn) showLogin('登录已过期，请重新登录（没保存的内容还在这个浏览器里）');
        throw e;
      });
    }, function () {
      var e = new Error('连不上后台服务');
      e.status = 0;
      throw e;
    });
  }

  /* ------------------------------------------------------------ the note at the bottom */
  var toast = document.querySelector('[data-toast]');
  var toastText = toast.querySelector('[data-toast-text]');
  var toastPre = toast.querySelector('[data-toast-pre]');
  var toastTimer = 0;
  function note(text, kind, log) {
    clearTimeout(toastTimer);
    toast.hidden = false;
    toast.className = 'job-toast' + (kind ? ' is-' + kind : '');
    toastText.textContent = '';
    if (text instanceof Node) toastText.appendChild(text); else toastText.textContent = text;
    toastPre.textContent = log || '';
    toast.querySelector('[data-toast-log]').hidden = !log;
    if (!log) toastPre.hidden = true;
    if (kind === 'ok') toastTimer = setTimeout(function () { toast.hidden = true; }, 6000);
  }
  /* text with buttons in it: parts are strings or [label, action] */
  function noteWith(parts, kind, log) {
    var wrap = make('span');
    parts.forEach(function (p) {
      if (typeof p === 'string') wrap.appendChild(document.createTextNode(p));
      else if (p instanceof Node) wrap.appendChild(p);
      else {
        var b = button('cm-link', p[0]);
        b.addEventListener('click', function () { toast.hidden = true; p[1](); });
        wrap.appendChild(b);
        wrap.appendChild(document.createTextNode(' '));
      }
    });
    note(wrap, kind, log);
  }
  toast.querySelector('[data-toast-log]').addEventListener('click', function () { toastPre.hidden = !toastPre.hidden; });
  toast.querySelector('[data-toast-close]').addEventListener('click', function () { toast.hidden = true; });

  /* follows a background job (publish, import, roll back) until it ends */
  function follow(jobId, label) {
    note(label + '…', 'busy');
    return new Promise(function (resolve, reject) {
      (function poll() {
        call('jobs/' + jobId).then(function (j) {
          if (j.state === 'done') { resolve(j); return; }
          if (j.state === 'failed') {
            var e = new Error(j.error || '没有成功');
            e.code = j.code;
            e.log = j.log;
            reject(e);
            return;
          }
          var last = (j.log || '').trim().split('\n').pop();
          note(label + '…' + (j.state === 'queued' ? '（排队中）' : last ? '  ' + last.slice(0, 60) : ''), 'busy', j.log);
          setTimeout(poll, 700);
        }, reject);
      })();
    });
  }
  function linkTo(url, text) {
    var a = make('a', 'cm-link', text);
    if (safeUrl(url)) a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  /* ------------------------------------------------------------ signing in */
  var signedIn = false;
  var loginForm = $('[data-login]');
  function show(view) {
    $$('[data-view]').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== view; });
  }
  function showLogin(message) {
    signedIn = false;
    show('login');
    say($('[data-login-status]'), message || '', message ? 'error' : null);
    loginForm.elements.namedItem('password').focus();
  }
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = loginForm.elements.namedItem('password'), code = loginForm.elements.namedItem('code');
    if (!pw.value) { pw.focus(); return; }
    if (!/^\d{6}$/.test(code.value.replace(/\s/g, ''))) { say($('[data-login-status]'), '验证码是手机验证器上的 6 位数字', 'error'); code.focus(); return; }
    var b = loginForm.querySelector('[type="submit"]');
    b.disabled = true;
    say($('[data-login-status]'), '正在登录…');
    call('login', { password: pw.value, code: code.value.replace(/\s/g, '') }).then(function () {
      pw.value = '';
      code.value = '';
      say($('[data-login-status]'), '');
      call('me').then(start, function () { start({}); });
    }, function (err) {
      say($('[data-login-status]'), err.message, 'error');
      code.value = '';
      code.focus();
    }).then(function () { b.disabled = false; });
  });
  $('[data-logout]').addEventListener('click', function () {
    flushSave();
    call('logout', {}).catch(function () {}).then(function () { showLogin('已退出'); });
  });

  var me = {};
  function start(info) {
    me = info || {};
    signedIn = true;
    show('app');
    pendingCount();
    backupHint();
    if (me.ready === false) banner('服务器上还没有网站的代码：先在电脑上 git push 一次（README「第一次部署」），之后才能发布和上传图片。');
    route();
  }
  function banner(text, link) {
    var b = $('[data-banner]');
    b.textContent = '';
    if (!text) { b.hidden = true; return; }
    b.appendChild(document.createTextNode(text + ' '));
    if (link) { var a = make('a', 'cm-link', link[0]); a.href = link[1]; b.appendChild(a); }
    b.hidden = false;
  }

  /* ------------------------------------------------------------ panes and addresses (#/posts, #/edit/12 …) */
  var current = null;
  function route() {
    if (!signedIn) return;
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    var name = parts[0] || 'posts';
    var arg = parts.slice(1).join('/');
    var pane = name === 'edit' || name === 'new' ? 'editor' : name;
    if (!$('[data-pane="' + pane + '"]')) { location.hash = '#/posts'; return; }
    var sameAlbum = pane === 'album' && current === 'album' && al && String(al.id || 'new') === arg;
    /* an album is saved by hand: going away from unsaved changes is asked about */
    if (current === 'album' && !sameAlbum && albumDirty()) {
      if (!window.confirm('这个图集还有没保存的修改，确定离开吗？')) { location.hash = '#/album/' + (al.id || 'new'); return; }
      al = null;
    }
    if (current === 'editor' && (pane !== 'editor' || Number(arg) !== st.id)) flushSave();
    $$('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== pane; });
    $$('[data-tab]').forEach(function (t) {
      var on = t.getAttribute('data-tab') === (pane === 'editor' ? 'posts' : pane === 'album' ? 'albums' : pane);
      t.setAttribute('aria-current', on ? 'page' : 'false');
    });
    root.classList.toggle('is-editing', pane === 'editor');
    var was = current;
    current = pane;
    if (pane === 'posts') openPosts();
    else if (pane === 'editor') { if (!(was === 'editor' && Number(arg) === st.id && st.id)) openEditor(name === 'new' ? 0 : Number(arg) || 0); }
    else if (pane === 'albums') openAlbums();
    else if (pane === 'album') { if (!sameAlbum) openAlbum(arg); }
    else if (pane === 'comments') openComments();
    else if (pane === 'media') openMedia();
    else if (pane === 'site') openSite();
    else if (pane === 'deploys') openDeploys();
    else if (pane === 'security') openSecurity();
    if (pane !== 'editor' || was !== 'editor') window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ================================================================ articles */
  var allPosts = [], postFilter = 'all';
  var STATE = { draft: ['草稿', 'is-pending'], published: ['已发布', 'is-approved'], changed: ['有修改未发布', 'is-changed'] };
  function openPosts() {
    $('[data-export-all]').href = API + 'export';
    loadPosts();
  }
  function loadPosts() {
    var trash = postFilter === 'trash';
    return call('posts' + (trash ? '?trash=1' : '')).then(function (d) {
      allPosts = d.posts || [];
      drawPosts();
    }, function (err) { note(err.message, 'error'); });
  }
  function drawPosts() {
    var list = $('[data-post-list]');
    var q = $('[data-post-search]').value.trim().toLowerCase();
    var trash = postFilter === 'trash';
    list.textContent = '';
    allPosts.filter(function (p) {
      if (postFilter === 'draft' && p.state !== 'draft') return false;
      if (postFilter === 'published' && p.state === 'draft') return false;
      return !q || (p.title + ' ' + (p.tags || []).join(' ') + ' ' + p.slug).toLowerCase().indexOf(q) >= 0;
    }).forEach(function (p) {
      var li = make('li', 'post-item');
      var row = make(trash ? 'div' : 'a', 'post-link');
      if (!trash) row.href = '#/edit/' + p.id;
      var main = make('span', 'pi-main');
      main.appendChild(make('span', 'pi-title', p.title || p.slug));
      var meta = [p.date, (p.tags || []).join(' · '), p.words + ' 字'];
      if (trash) meta.push('删除于 ' + stamp(p.deleted) + '，' + Math.max(0, 30 - Math.floor((Date.now() - p.deleted) / 864e5)) + ' 天后彻底删除');
      else meta.push('改于 ' + ago(p.updated));
      main.appendChild(make('span', 'pi-meta', meta.filter(Boolean).join('  ·  ')));
      row.appendChild(main);
      if (trash) {
        var acts = make('span', 'pi-actions');
        var back = button('btn btn-ghost ad-btn', '恢复');
        back.addEventListener('click', function () {
          call('posts/restore', { id: p.id }).then(function () {
            noteWith(['已恢复成草稿。', ['打开', function () { location.hash = '#/edit/' + p.id; }]], 'ok');
            loadPosts();
          }, function (err) { note(err.message, 'error'); });
        });
        var gone = button('btn btn-ghost ad-btn ad-del', '彻底删除');
        gone.addEventListener('click', function () {
          if (!armed(gone, '确定？连历史版本一起删')) return;
          call('posts/purge', { id: p.id }).then(function () { note('已彻底删除', 'ok'); loadPosts(); }, function (err) { note(err.message, 'error'); });
        });
        acts.appendChild(back);
        acts.appendChild(gone);
        row.appendChild(acts);
      } else {
        var s = p.publishAt ? ['定时 ' + whenShort(p.publishAt), 'is-scheduled'] : STATE[p.state] || STATE.draft;
        var badgeEl = make('span', 'cm-badge ' + s[1], s[0]);
        if (p.publishAt) badgeEl.title = '将在 ' + whenText(p.publishAt) + ' 自动发布';
        row.appendChild(badgeEl);
      }
      li.appendChild(row);
      list.appendChild(li);
    });
    var empty = $('[data-post-empty]');
    empty.textContent = trash ? '回收站是空的。删除的文章会在这里留 30 天。' : allPosts.length ? '没有符合条件的文章。' : '还没有文章。点「新文章」开始写，或者「导入」已有的 Markdown 文件。';
    empty.hidden = list.children.length > 0;
  }
  $('[data-post-search]').addEventListener('input', drawPosts);
  $('[data-post-filter]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    var was = postFilter;
    postFilter = b.getAttribute('data-filter');
    $$('[data-filter]', $('[data-post-filter]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    if ((was === 'trash') !== (postFilter === 'trash')) loadPosts(); else drawPosts();
  });

  /* ---------------------------------------------------- import */
  var importBox = $('[data-import]');
  $('[data-import-open]').addEventListener('click', function () { importBox.hidden = !importBox.hidden; });
  $('[data-import-close]').addEventListener('click', function () { importBox.hidden = true; });
  var importInput = $('[data-import-file]');
  importInput.addEventListener('change', function () { importFiles(importInput.files); importInput.value = ''; });
  var drop = $('[data-import-drop]');
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('is-over');
    if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
  });
  function importFiles(files) {
    var list = Array.prototype.slice.call(files);
    var report = $('[data-import-report]');
    report.textContent = '';
    var mode = importBox.elements.namedItem('mode').value;
    var withSite = importBox.elements.namedItem('site').checked;
    var chain = Promise.resolve();
    list.forEach(function (file) {
      chain = chain.then(function () {
        if (!/\.(md|markdown|txt|zip)$/i.test(file.name)) { reportRow({ file: file.name, result: '失败', notes: ['只能导入 .md 文件或 .zip'] }); return; }
        if (file.size > 300 * 1024 * 1024) { reportRow({ file: file.name, result: '失败', notes: ['文件太大了（最多 300 MB）'] }); return; }
        var q = 'import?name=' + encodeURIComponent(file.name) + '&mode=' + mode + (withSite ? '&site=1' : '');
        note('正在上传 ' + file.name + '…', 'busy');
        return call(q, file, 'application/octet-stream').then(function (r) {
          return follow(r.job, '导入 ' + file.name);
        }).then(function (j) {
          (j.result.report || []).forEach(reportRow);
          note('导入完成：' + (j.result.added || 0) + ' 篇。导入的都是草稿，检查后再发布。', 'ok', j.log);
        }, function (err) {
          reportRow({ file: file.name, result: '失败', notes: [err.message] });
          note(err.message, 'error', err.log);
        });
      });
    });
    chain.then(function () { loadPosts(); });
  }
  function reportRow(r) {
    var li = make('li', 'ir-item');
    var kind = { 新建: 'is-approved', 覆盖: 'is-changed', 另存: 'is-approved', 跳过: '', 失败: 'is-error' }[r.result] || '';
    li.appendChild(make('span', 'cm-badge ' + kind, r.result));
    var main = make('span', 'ir-main');
    if (r.id) {
      var a = make('a', 'ir-title', r.title || r.file);
      a.href = '#/edit/' + r.id;
      main.appendChild(a);
    } else main.appendChild(make('span', 'ir-title', r.title || r.file));
    var notes = [r.title ? r.file : ''].concat(r.notes || []).filter(Boolean);
    if (notes.length) main.appendChild(make('span', 'ir-notes', notes.join('；')));
    li.appendChild(main);
    $('[data-import-report]').appendChild(li);
  }

  /* ================================================================ the editor */
  var ed = $('[data-editor]');
  var f = function (n) { return ed.elements.namedItem(n); };
  var body = f('body');
  var frame = $('[data-ed-frame]');
  var SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,119}$/u;
  function fresh() {
    return { id: 0, version: 0, state: 'draft', liveSlug: null, publishAt: null, extra: [], saved: '', savedAt: 0, saving: null, again: false,
      slugTouched: false, blocked: '', publishing: false, error: '' };
  }
  var st = fresh();

  function slugFrom(title) {
    return title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  function payload() {
    return {
      slug: f('slug').value.trim(),
      title: f('title').value.trim(),
      date: f('date').value,
      tags: f('tags').value.split(/[,，、]/).map(function (t) { return t.trim(); }).filter(Boolean),
      description: f('description').value.trim(),
      cover: f('cover').value.trim(),
      comments: f('comments').checked,
      body: body.value,
      extra: extraWith(st.extra),
    };
  }
  /* 系列, 更新日期 and 置顶 travel as lines of the article's other settings ("series: …", "updated: …",
     "pinned: true"), which the server keeps as they are and writes into the file the site is built from */
  var OWN = /^(series|updated|pinned)\s*[:=]/;
  function extraWith(extra) {
    var out = (extra || []).filter(function (l) { return !OWN.test(l); });
    var s = f('series').value.replace(/[\r\n]+/g, ' ').trim(), u = f('updated').value;
    if (s) out.push('series: ' + s);
    if (u) out.push('updated: ' + u);
    if (f('pinned').checked) out.push('pinned: true');
    return out;
  }
  function fromExtra(extra, key) {
    var re = new RegExp('^' + key + '\\s*[:=]\\s*(.*)$');
    for (var i = 0; i < (extra || []).length; i++) { var m = re.exec(extra[i]); if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2').trim(); }
    return '';
  }
  function snap() { return JSON.stringify(payload()); }
  function dirty() { return snap() !== st.saved; }
  function localKey() { return 'admin-draft:' + (st.id || 'new'); }
  function fill(p) {
    f('title').value = p.title || '';
    f('slug').value = p.slug || '';
    f('date').value = p.date || today();
    f('tags').value = (p.tags || []).join(', ');
    f('description').value = p.description || '';
    f('cover').value = p.cover || '';
    f('comments').checked = p.comments !== false;
    f('series').value = fromExtra(p.extra, 'series');
    f('updated').value = fromExtra(p.extra, 'updated');
    f('pinned').checked = fromExtra(p.extra, 'pinned') === 'true';
    body.value = p.body || '';
    extraHint();
  }

  /* 更多设置: folded or open as it was last left; folded, its title says which of its settings are set */
  var extraBox = $('[data-ed-extra]');
  try { extraBox.open = localStorage.getItem('admin-ed-extra') === '1'; } catch (e) { /* private mode */ }
  extraBox.addEventListener('toggle', function () { try { localStorage.setItem('admin-ed-extra', extraBox.open ? '1' : '0'); } catch (e) { /* ignore */ } });
  function extraHint() {
    var parts = [];
    if (f('cover').value.trim()) parts.push('分享图');
    if (f('series').value.trim()) parts.push('系列：' + f('series').value.trim());
    if (f('updated').value) parts.push('更新于 ' + f('updated').value);
    if (!f('comments').checked) parts.push('关闭了评论');
    if (f('pinned').checked) parts.push('置顶');
    $('[data-ed-extra-hint]').textContent = parts.join(' · ');
  }
  extraBox.addEventListener('input', extraHint);
  extraBox.addEventListener('change', extraHint);

  function buttons() {
    var badge = $('[data-ed-state]');
    var s = !st.id ? ['新文章', ''] : st.publishAt ? ['定时 ' + whenShort(st.publishAt), 'is-scheduled'] : STATE[st.state] || STATE.draft;
    badge.textContent = s[0];
    badge.className = 'cm-badge ' + s[1];
    badge.title = st.publishAt ? '将在 ' + whenText(st.publishAt) + ' 自动发布' : '';
    var pub = $('[data-ed-publish]');
    var changed = dirty() || st.state === 'changed';
    pub.textContent = st.state === 'draft' ? '发布' : changed ? '更新上线' : '已发布';
    pub.disabled = st.state === 'published' && !changed;
    $('[data-ed-unpublish]').hidden = st.state === 'draft';
    $('[data-ed-trash]').hidden = !st.id;
    $('[data-ed-history]').hidden = !st.id;
    $('[data-ed-export]').hidden = !st.id;
    $('[data-slug-preview]').textContent = f('slug').value || '…';
    var slugNote = $('[data-ed-slug-note]');
    var moved = st.liveSlug && f('slug').value.trim() && f('slug').value.trim() !== st.liveSlug;
    slugNote.hidden = !moved && st.blocked !== 'slug';
    slugNote.textContent = st.blocked === 'slug' ? st.error : moved ? '网址改了：发布后旧地址 /blog/' + st.liveSlug + '/ 会自动跳到新地址，评论也会跟过去。' : '';
    slugNote.classList.toggle('is-error', st.blocked === 'slug');
  }
  function status() {
    var s = $('[data-ed-saved]');
    var text, cls = '';
    if (st.saving) text = '正在保存…';
    else if (st.blocked === 'changed') { text = '没有保存：别处保存过更新的版本'; cls = 'is-error'; }
    else if (st.error && dirty()) { text = st.error; cls = 'is-error'; }
    else if (dirty()) { text = !st.id && !f('title').value.trim() ? '写个标题后自动保存' : '有修改，马上自动保存'; cls = 'is-dirty'; }
    else text = st.savedAt ? '已保存 ' + clock(st.savedAt) : '';
    s.textContent = text;
    s.className = 'ed-saved ' + cls;
  }

  function openEditor(id) {
    closeHistory();
    clearTimeout(saveTimer);
    st = fresh();
    setMode('write');
    $('[data-ed-more]').open = false;
    $('[data-ed-schedule-box]').hidden = true;
    /* the preview finds [[ ]] links among the articles in the list: opened straight from an address, it is still empty */
    if (!allPosts.length) call('posts').then(function (d) { allPosts = d.posts || []; schedulePreview(); }, function () {});
    if (!id) {
      fill({ date: today(), comments: true });
      st.saved = snap();
      afterLoad();
      f('title').focus();
      return;
    }
    ed.classList.add('is-loading');
    st.blocked = 'loading'; /* the fields still hold the article before: never saved as this one */
    var mine = st;
    call('posts/get?id=' + id).then(function (p) {
      if (mine !== st) return;
      if (p.deleted) { note('这篇文章在回收站里，先在「文章 → 回收站」里恢复', 'error'); location.hash = '#/posts'; return; }
      st.id = p.id;
      st.version = p.version;
      st.state = p.state;
      st.liveSlug = p.state === 'draft' ? null : p.liveSlug;
      st.publishAt = p.publishAt || null;
      st.extra = p.extra || [];
      st.savedAt = p.updated;
      st.slugTouched = true;
      fill(p);
      st.saved = snap();
      st.blocked = '';
      afterLoad();
    }, function (err) {
      note(err.message, 'error');
      location.hash = '#/posts';
    }).then(function () { ed.classList.remove('is-loading'); });
  }

  /* a copy of what you type is kept in this browser until the server has it, in case the tab or the network goes */
  function afterLoad() {
    buttons();
    status();
    count();
    linesDirty = true;
    scanImages();
    var saved = store.get(localKey());
    if (saved && saved.snap && saved.snap !== st.saved) {
      noteWith(['这台电脑上有 ' + stamp(saved.at) + ' 没保存上的内容。 ', ['恢复', function () {
        try {
          var p = JSON.parse(saved.snap);
          fill(p);
          if (Array.isArray(p.extra)) st.extra = p.extra;
          changed();
          preview();
        } catch (e) { /* not readable */ }
      }], ['不要了', function () { store.del(localKey()); }]], 'info');
    } else if (saved) store.del(localKey());
    preview();
  }

  var keepTimer = 0, saveTimer = 0, retryTimer = 0;
  function changed() {
    st.error = '';
    buttons();
    status();
    clearTimeout(keepTimer);
    keepTimer = setTimeout(function () {
      if (dirty()) store.set(localKey(), { snap: snap(), at: Date.now() });
    }, 600);
    schedulePreview();
    scheduleSave(2500);
    linesDirty = true;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanImages, 600);
    count();
  }
  ed.addEventListener('input', function (e) {
    if (e.target === f('title') && !st.slugTouched && !st.id) f('slug').value = slugFrom(f('title').value);
    if (e.target === f('slug')) { st.slugTouched = true; if (st.blocked === 'slug') st.blocked = ''; }
    changed();
  });
  ed.addEventListener('change', function (e) { if (e.target.type === 'checkbox') changed(); });
  window.addEventListener('beforeunload', function (e) {
    if (current === 'editor' && dirty()) { flushSave(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });

  function scheduleSave(ms) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (st.publishing) { scheduleSave(1500); return; }
      if (dirty() && !st.blocked && current === 'editor') save({ auto: true }).catch(function () {});
    }, ms);
  }
  /* leaving the editor, the tab, the page: save now what is not saved yet */
  function flushSave() {
    clearTimeout(saveTimer);
    if (current === 'editor' && signedIn && dirty() && !st.blocked && (st.id || f('title').value.trim())) save({ auto: true }).catch(function () {});
  }

  /* saves the working copy; resolves true when the server has it */
  function save(opts) {
    opts = opts || {};
    if (st.saving) {
      st.again = true;
      return st.saving;
    }
    var p = payload();
    if (!p.title) {
      if (!opts.auto) { note('请填写标题', 'error'); f('title').focus(); }
      status();
      return Promise.resolve(false);
    }
    if (!p.slug) {
      p.slug = slugFrom(p.title) || 'post-' + Date.now().toString(36);
      f('slug').value = p.slug;
    }
    var problem = !SLUG.test(p.slug) || p.slug.indexOf('..') >= 0 ? '网址只能用文字、数字和 - _ .（建议用英文，比如 spring-tips）'
      : !/^\d{4}-\d{2}-\d{2}$/.test(p.date) ? '请填写日期' : '';
    if (problem) {
      st.error = '没有保存：' + problem;
      status();
      if (!opts.auto) note(problem, 'error');
      return Promise.resolve(false);
    }
    var sent = JSON.stringify(p);
    var mine = st, id = st.id;
    st.saving = call('posts/save', Object.assign({ id: id, version: st.version, force: !!opts.force }, p)).then(function (r) {
      if (mine !== st) return true; /* another article was opened meanwhile */
      st.id = r.id;
      st.version = r.version;
      st.saved = sent;
      st.savedAt = r.updated || Date.now();
      st.blocked = '';
      st.error = '';
      if (st.state === 'published') st.state = 'changed';
      if (!id) {
        store.del('admin-draft:new');
        history.replaceState(null, '', '#/edit/' + r.id);
        st.slugTouched = true;
      }
      if (!dirty()) store.del(localKey());
      return true;
    }, function (err) {
      if (mine !== st) return false;
      if (err.code === 'changed') {
        st.blocked = 'changed';
        noteWith(['这篇文章在别的窗口或设备上保存过了，这里的修改还没保存。 ', ['用这里的内容覆盖', function () { st.blocked = ''; save({ force: true }); }],
          ['加载那边的版本', function () { store.set(localKey(), { snap: snap(), at: Date.now() }); openEditor(st.id); }]], 'error');
      } else if (err.code === 'slug_taken') {
        st.blocked = 'slug';
        st.error = err.message;
      } else if (err.code === 'trashed') {
        st.blocked = 'trashed';
        note(err.message, 'error');
      } else if (err.status === 0 || err.status >= 500) {
        st.error = '没有保存（' + (err.status ? '服务器出错' : '连不上') + '），稍后自动重试';
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { scheduleSave(0); }, 10000);
      } else if (err.status !== 401) {
        st.error = '没有保存：' + err.message;
        if (!opts.auto) note(err.message, 'error');
      }
      return false;
    }).then(function (ok) {
      mine.saving = null;
      if (mine !== st) return ok;
      buttons();
      status();
      if (st.again) {
        st.again = false;
        if (dirty() && !st.blocked) scheduleSave(200);
      }
      return ok;
    });
    status();
    return st.saving;
  }
  $('[data-ed-save]').addEventListener('click', function () {
    save({}).then(function (ok) { if (ok) note('已保存（网站上还没变，点「' + $('[data-ed-publish]').textContent + '」才会更新）', 'ok'); });
  });

  function publish() {
    if (st.publishing || st.saving) return;
    var title = f('title').value.trim();
    st.publishing = true;
    ed.classList.add('is-saving');
    var wasDraft = st.state === 'draft';
    (dirty() || !st.id ? save({}) : Promise.resolve(true)).then(function (ok) {
      if (!ok) throw new Error(st.error || '先保存成功才能发布');
      return call('posts/publish', { id: st.id, version: st.version });
    }).then(function (r) {
      return follow(r.job, (wasDraft ? '发布' : '更新上线') + '：' + title);
    }).then(function (j) {
      st.state = dirty() ? 'changed' : 'published';
      st.liveSlug = f('slug').value.trim();
      st.publishAt = null; /* published now: no longer waiting for its time */
      noteWith([wasDraft ? '已发布。 ' : '已更新上线。 ', linkTo(j.result.url, '查看文章')], 'ok', j.log);
    }).catch(function (err) {
      if (err.message) note(err.message, 'error', err.log);
    }).then(function () {
      st.publishing = false;
      ed.classList.remove('is-saving');
      buttons();
    });
  }
  $('[data-ed-publish]').addEventListener('click', publish);

  /* 定时发布: the article goes up by itself at the time chosen, with whatever is saved by then (the server checks every
     minute). Its date becomes that day when it was earlier. 发布 now, 撤下 or 删除 clear the time */
  var schedBox = $('[data-ed-schedule-box]'), schedAt = $('[data-sched-at]');
  function localInput(ms) { var d = new Date(ms); return stamp(ms).slice(0, 10) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function schedUi() {
    $('[data-sched-cancel]').hidden = !st.publishAt;
    $('[data-sched-set]').textContent = st.publishAt ? '改成这个时间' : '定时发布';
    $('[data-sched-note]').textContent = st.publishAt
      ? '已定在 ' + whenText(st.publishAt) + ' 自动发布。到时发布的是那时已经保存的内容，之前接着改也没关系。'
      : '到时会自动发布那时已经保存的内容（这里一直在自动保存），不用守着点发布。文章日期早于那天的，会改成那天。';
  }
  $('[data-ed-schedule]').addEventListener('click', function () {
    more.open = false;
    /* a suggestion: the next whole hour, at least an hour away */
    var next = new Date(Date.now() + 3600e3);
    next.setMinutes(0, 0, 0);
    schedAt.value = localInput(st.publishAt || next.getTime());
    schedAt.min = localInput(Date.now() + 120e3);
    schedBox.hidden = false;
    schedUi();
    schedAt.focus();
  });
  $('[data-sched-close]').addEventListener('click', function () { schedBox.hidden = true; });
  $('[data-sched-set]').addEventListener('click', function () {
    var t = schedAt.value ? new Date(schedAt.value).getTime() : NaN;
    if (!(t > Date.now() + 60e3)) { note('请选一个至少一分钟以后的时间', 'error'); schedAt.focus(); return; }
    var day = schedAt.value.slice(0, 10);
    if (f('date').value < day) { f('date').value = day; changed(); }
    (dirty() || !st.id ? save({}) : Promise.resolve(true)).then(function (ok) {
      if (!ok) throw new Error(st.error || '先保存成功才能定时发布');
      return call('posts/schedule', { id: st.id, at: t });
    }).then(function (r) {
      st.publishAt = r.publishAt || t;
      buttons();
      schedUi();
      schedBox.hidden = true;
      note('已定好：' + whenText(st.publishAt) + ' 自动发布', 'ok');
    }, function (err) { if (err.message) note(err.message, 'error'); });
  });
  $('[data-sched-cancel]').addEventListener('click', function () {
    call('posts/schedule', { id: st.id, at: 0 }).then(function () {
      st.publishAt = null;
      buttons();
      schedUi();
      schedBox.hidden = true;
      note('已取消定时发布', 'ok');
    }, function (err) { note(err.message, 'error'); });
  });

  /* the "更多" menu */
  var more = $('[data-ed-more]');
  document.addEventListener('click', function (e) { if (more.open && !more.contains(e.target)) more.open = false; });
  $('[data-ed-export]').addEventListener('click', function () {
    more.open = false;
    flushSave();
    location.href = API + 'export?ids=' + st.id;
  });
  $('[data-ed-unpublish]').addEventListener('click', function (e) {
    var b = e.currentTarget;
    if (!armed(b, '确定撤下？再点一次')) return;
    more.open = false;
    call('posts/unpublish', { id: st.id }).then(function (r) {
      return follow(r.job, '从网站撤下');
    }).then(function (j) {
      st.state = 'draft';
      st.liveSlug = null;
      st.publishAt = null;
      buttons();
      note('已从网站撤下，文章还在，成了草稿', 'ok', j.log);
    }, function (err) { note(err.message, 'error', err.log); });
  });
  $('[data-ed-trash]').addEventListener('click', function (e) {
    var b = e.currentTarget;
    if (!armed(b, '确定删除？再点一次')) return;
    more.open = false;
    var id = st.id, wasLive = st.state !== 'draft';
    clearTimeout(saveTimer);
    (dirty() ? save({ auto: true }) : Promise.resolve(true)).then(function () {
      return call('posts/trash', { id: id });
    }).then(function (r) {
      return r.job ? follow(r.job, '删除') : r;
    }).then(function () {
      store.del('admin-draft:' + id);
      st.blocked = 'trashed'; /* nothing more is saved from what is still in the fields */
      st.saved = snap();
      location.hash = '#/posts';
      noteWith(['已移到回收站（30 天内可以恢复）。 ', ['撤销', function () {
        /* back as it was: a published article goes back on the site */
        call('posts/restore', { id: id }).then(function () {
          if (!wasLive) return null;
          return call('posts/get?id=' + id).then(function (p) { return call('posts/publish', { id: id, version: p.version }); })
            .then(function (r) { return follow(r.job, '恢复并重新发布'); });
        }).then(function () {
          location.hash = '#/edit/' + id;
          note(wasLive ? '已恢复，网站上也回来了' : '已恢复成草稿', 'ok');
        }, function (err) { note(err.message, 'error', err.log); });
      }]], 'ok');
    }, function (err) { note(err.message, 'error', err.log); });
  });

  /* ---------------------------------------------------- editing helpers */
  function edit(start, end, text, selStart, selEnd) {
    body.focus();
    body.setSelectionRange(start, end);
    /* insertText keeps the browser's undo history (Ctrl+Z); setRangeText where it is not available */
    if (!document.execCommand || !document.execCommand('insertText', false, text)) body.setRangeText(text, start, end, 'end');
    body.setSelectionRange(start + (selStart == null ? text.length : selStart), start + (selEnd == null ? text.length : selEnd));
    changed();
  }
  /* replaces the whole text by changing only the part that differs, so the place you are at and Ctrl+Z stay */
  function setText(next) {
    var old = body.value;
    if (old === next) return;
    var a = 0, sel = body.selectionStart, top = body.scrollTop;
    while (a < old.length && a < next.length && old[a] === next[a]) a++;
    var b = 0;
    while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
    edit(a, old.length - b, next.slice(a, next.length - b));
    var at = sel <= a ? sel : sel + (next.length - old.length);
    body.setSelectionRange(at, at);
    body.scrollTop = top;
  }
  /* what has to go before a block (picture, code) so it starts a paragraph of its own, not inside a list or a line */
  function blankBefore(at) {
    var before = body.value.slice(0, at);
    return !before || /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
  }
  function lineRange() {
    var v = body.value, s = body.selectionStart, e = body.selectionEnd;
    if (e > s && v[e - 1] === '\n') e--;
    var ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', e);
    return [ls, le < 0 ? v.length : le];
  }
  var MARKER = /^(\s*)(#{1,6} |> ?|[-*+] (?:\[[ xX]\] )?|\d+[.)] )/;
  /* puts a mark in front of each selected line; when they all have it already, takes it away */
  function prefixLines(mark) {
    var r = lineRange(), lines = body.value.slice(r[0], r[1]).split('\n');
    var numbered = mark === '1. ';
    var has = lines.every(function (l) { return !l.trim() || (numbered ? /^\s*\d+[.)] /.test(l) : l.replace(/^\s*/, '').indexOf(mark) === 0); });
    var n = 0;
    var out = lines.map(function (l) {
      if (!l.trim() && lines.length > 1) return l;
      var m = MARKER.exec(l), lead = m ? m[1] : /^\s*/.exec(l)[0], rest = m ? l.slice(m[0].length) : l.slice(lead.length);
      if (has) return lead + rest;
      n++;
      return lead + (numbered ? n + '. ' : mark) + rest;
    }).join('\n');
    edit(r[0], r[1], out);
  }
  function wrap(before, after, placeholder) {
    var s = body.selectionStart, e = body.selectionEnd, sel = body.value.slice(s, e);
    if (sel && body.value.slice(s - before.length, s) === before && body.value.slice(e, e + after.length) === after) {
      edit(s - before.length, e + after.length, sel, 0, sel.length); /* already wrapped: unwrap */
      return;
    }
    sel = sel || placeholder;
    edit(s, e, before + sel + after, before.length, before.length + sel.length);
  }
  function link() {
    var s = body.selectionStart, e = body.selectionEnd, sel = body.value.slice(s, e) || '链接文字';
    edit(s, e, '[' + sel + '](https://)', sel.length + 3, sel.length + 11);
  }
  function block(text, selFrom, selTo) {
    var at = body.selectionStart, lead = blankBefore(at);
    edit(at, body.selectionEnd, lead + text, lead.length + selFrom, lead.length + selTo);
  }
  var fileInput = $('[data-ed-file]');
  $('.ed-toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cmd]');
    if (!b) return;
    var cmd = b.getAttribute('data-cmd');
    if (cmd === 'h2') prefixLines('## ');
    else if (cmd === 'h3') prefixLines('### ');
    else if (cmd === 'quote') prefixLines('> ');
    else if (cmd === 'list') prefixLines('- ');
    else if (cmd === 'olist') prefixLines('1. ');
    else if (cmd === 'task') prefixLines('- [ ] ');
    else if (cmd === 'bold') wrap('**', '**', '加粗的文字');
    else if (cmd === 'italic') wrap('*', '*', '斜体的文字');
    else if (cmd === 'mark') wrap('==', '==', '高亮的文字');
    else if (cmd === 'link') link();
    else if (cmd === 'code') {
      var code = body.value.slice(body.selectionStart, body.selectionEnd);
      block('```java\n' + code + '\n```\n', 3, 7);
    } else if (cmd === 'table') block('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n', 2, 5);
    else if (cmd === 'callout') {
      var sel = body.value.slice(body.selectionStart, body.selectionEnd) || '提示的内容';
      block('> [!TIP]\n' + sel.split('\n').map(function (l) { return '> ' + l; }).join('\n') + '\n', 11, 11 + sel.length);
    } else if (cmd === 'image') fileInput.click();
    else if (cmd === 'library') openPicker();
  });

  /* inside a ``` code block at this position? */
  function inFence(v, at) {
    var before = v.slice(0, at), n = 0, re = /^\s{0,3}(```|~~~)/gm;
    while (re.exec(before)) n++;
    return n % 2 === 1;
  }
  /* Tab / Shift+Tab: the selected lines (or the list item) move in or out; otherwise two spaces */
  function indent(out) {
    var v = body.value, s = body.selectionStart, e = body.selectionEnd;
    var r = lineRange(), line = v.slice(r[0], r[1]);
    var multi = v.slice(s, e).indexOf('\n') >= 0;
    if (!out && !multi && !MARKER.test(line)) { edit(s, e, '  '); return; }
    var lines = v.slice(r[0], r[1]).split('\n');
    var moved = lines.map(function (l) { return out ? l.replace(/^( {1,2}|\t)/, '') : (l ? '  ' + l : l); });
    var text = moved.join('\n');
    var shift = moved[0].length - lines[0].length;
    edit(r[0], r[1], text);
    if (!multi) body.setSelectionRange(Math.max(r[0], s + shift), Math.max(r[0], s + shift));
    else body.setSelectionRange(r[0], r[0] + text.length);
  }
  /* Enter in a list or quote: the next line gets the same mark (the next number); on an empty item it ends */
  function continueList() {
    var v = body.value, s = body.selectionStart;
    if (s !== body.selectionEnd) return false;
    var ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', s);
    if (le < 0) le = v.length;
    var before = v.slice(ls, s), after = v.slice(s, le);
    if (inFence(v, ls)) {
      var ind = /^[ \t]*/.exec(before)[0];
      if (!ind) return false;
      edit(s, s, '\n' + ind);
      return true;
    }
    var m = /^(\s*)([-*+]|(\d+)([.)]))( +)(\[[ xX]\] +)?/.exec(before);
    /* an empty item ends the list, with a blank line, so what comes next is a paragraph of its own */
    if (m) {
      if (!before.slice(m[0].length).trim() && !after.trim()) { edit(ls, le, '\n'); return true; }
      var mark = m[3] ? Number(m[3]) + 1 + m[4] : m[2];
      edit(s, s, '\n' + m[1] + mark + m[5] + (m[6] ? '[ ] ' : ''));
      return true;
    }
    var q = /^(\s*(?:> ?)+)/.exec(before);
    if (q) {
      if (!before.slice(q[0].length).trim() && !after.trim()) { edit(ls, le, '\n'); return true; }
      edit(s, s, '\n' + q[1].replace(/ ?$/, ' '));
      return true;
    }
    return false;
  }
  var plainPaste = false;
  /* ---------------------------------------------------- suggestions
     In the text, [[ followed by a few letters of a title or address lists the articles that match; in 标签, the tags
     already used (the most used first). Arrow keys and Enter or Tab choose, Escape closes; the pointer works too. */
  var acBox = null, acItems = [], acSel = 0, acPick = null;
  function acClose() { if (acBox) { acBox.remove(); acBox = null; } acItems = []; acPick = null; }
  function acShow(items, at, pick) {
    acClose();
    if (!items.length) return;
    acItems = items;
    acSel = 0;
    acPick = pick;
    acBox = make('div', 'ac-pop');
    acBox.setAttribute('role', 'listbox');
    items.forEach(function (it, i) {
      var row = make('button', 'ac-item' + (i === 0 ? ' is-on' : ''));
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.appendChild(make('span', 'ac-main', it.label));
      if (it.sub) row.appendChild(make('span', 'ac-sub', it.sub));
      row.addEventListener('mousedown', function (e) { e.preventDefault(); }); /* keep the caret where it is */
      row.addEventListener('click', function () { var p = acPick; acClose(); p(it); });
      acBox.appendChild(row);
    });
    document.body.appendChild(acBox);
    var w = acBox.offsetWidth, vw = document.documentElement.clientWidth;
    acBox.style.left = Math.max(8, Math.min(at.left, vw - w - 8)) + 'px';
    acBox.style.top = (at.bottom + 6 + acBox.offsetHeight > window.innerHeight ? at.top - acBox.offsetHeight - 6 : at.bottom + 6) + 'px';
  }
  function acMove(d) {
    if (!acBox) return;
    acSel = (acSel + d + acItems.length) % acItems.length;
    [].forEach.call(acBox.children, function (c, i) { c.classList.toggle('is-on', i === acSel); });
    acBox.children[acSel].scrollIntoView({ block: 'nearest' });
  }
  /* where the caret is on screen: a hidden copy of the textarea, laid out the same, measured up to the caret */
  function caretAt(ta, pos) {
    var cs = getComputedStyle(ta), m = document.createElement('div');
    ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'tabSize', 'wordBreak'].forEach(function (k) { m.style[k] = cs[k]; });
    m.style.position = 'absolute';
    m.style.visibility = 'hidden';
    m.style.whiteSpace = 'pre-wrap';
    m.style.overflowWrap = 'break-word';
    m.style.left = '-9999px';
    m.style.top = '0';
    m.textContent = ta.value.slice(0, pos);
    var mark = make('span', null, '​');
    m.appendChild(mark);
    document.body.appendChild(m);
    var r = ta.getBoundingClientRect(), line = parseFloat(cs.lineHeight) || 24;
    var left = r.left + mark.offsetLeft - ta.scrollLeft, top = r.top + mark.offsetTop - ta.scrollTop;
    m.remove();
    return { left: left, top: top, bottom: top + line };
  }
  function linkSuggest() {
    var at = body.selectionStart;
    if (at !== body.selectionEnd) { acClose(); return; }
    var m = /\[\[([^\[\]\n|#]{0,40})$/.exec(body.value.slice(Math.max(0, at - 44), at));
    if (!m) { acClose(); return; }
    var q = m[1].trim().toLowerCase();
    var list = allPosts.filter(function (p) { return !q || (p.title || '').toLowerCase().indexOf(q) >= 0 || p.slug.toLowerCase().indexOf(q) >= 0; })
      .filter(function (p) { return p.id !== st.id; })
      .slice(0, 8)
      .map(function (p) { return { label: p.title || p.slug, sub: '/blog/' + p.slug + '/' + (p.state === 'draft' ? ' · 草稿' : ''), slug: p.slug }; });
    acShow(list, caretAt(body, at - m[1].length - 2), function (it) {
      var end = body.selectionStart, start = end - m[1].length;
      var close = body.value.slice(end, end + 2) === ']]' ? '' : ']]';
      edit(start, end, it.slug + close);
    });
  }
  body.addEventListener('input', function (e) { if (!e.isComposing) linkSuggest(); });
  body.addEventListener('compositionend', linkSuggest);
  body.addEventListener('blur', function () { setTimeout(acClose, 120); });
  /* typing near the edge scrolls the text: the list follows the caret rather than closing */
  body.addEventListener('scroll', function () { if (acBox && document.activeElement === body) linkSuggest(); });
  /* the keys, while a list is open: before the editor's own Enter (lists) and Tab (indent) */
  function acKeys(e) {
    if (!acBox || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); acMove(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); var it = acItems[acSel], p = acPick; acClose(); p(it); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); acClose(); }
  }
  body.addEventListener('keydown', acKeys, true);

  /* tags: the ones already used, the part being typed narrowing them down */
  var tagInput = f('tags');
  function tagSuggest() {
    var v = tagInput.value, at = tagInput.selectionStart;
    var before = v.slice(0, at), start = Math.max(before.lastIndexOf(','), before.lastIndexOf('，'), before.lastIndexOf('、')) + 1;
    var q = before.slice(start).trim().toLowerCase();
    var have = v.split(/[,，、]/).map(function (t) { return t.trim().toLowerCase(); });
    var count = {};
    allPosts.forEach(function (p) { (p.tags || []).forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
    var list = Object.keys(count)
      .filter(function (t) { return t.toLowerCase().indexOf(q) >= 0 && have.indexOf(t.toLowerCase()) < 0; })
      .sort(function (a, b) { return count[b] - count[a] || a.localeCompare(b, 'zh'); })
      .slice(0, 8)
      .map(function (t) { return { label: t, sub: count[t] + ' 篇', tag: t }; });
    var r = tagInput.getBoundingClientRect();
    acShow(list, { left: r.left, top: r.top, bottom: r.bottom }, function (it) {
      var cur = tagInput.value, end = tagInput.selectionStart;
      var head = cur.slice(0, start).replace(/\s*$/, ''), tail = cur.slice(end).replace(/^[^,，、]*/, '');
      tagInput.value = (head ? head + ' ' : '') + it.tag + (tail ? '' : ', ') + tail;
      var caret = ((head ? head + ' ' : '') + it.tag + (tail ? '' : ', ')).length;
      tagInput.setSelectionRange(caret, caret);
      tagInput.focus();
      changed();
      tagSuggest();
    });
  }
  tagInput.addEventListener('focus', tagSuggest);
  tagInput.addEventListener('input', function (e) { if (!e.isComposing) tagSuggest(); });
  tagInput.addEventListener('compositionend', tagSuggest);
  tagInput.addEventListener('blur', function () { setTimeout(acClose, 120); });
  tagInput.addEventListener('keydown', acKeys, true);
  window.addEventListener('resize', acClose);

  body.addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return; /* typing Chinese: the input method owns these keys */
    var mod = e.metaKey || e.ctrlKey;
    var k = (e.key || '').toLowerCase();
    if (mod && e.shiftKey && k === 'v') { plainPaste = true; setTimeout(function () { plainPaste = false; }, 600); return; }
    if (mod && !e.shiftKey && !e.altKey) {
      if (k === 'b') { e.preventDefault(); wrap('**', '**', '加粗的文字'); return; }
      if (k === 'i') { e.preventDefault(); wrap('*', '*', '斜体的文字'); return; }
      if (k === 'k') { e.preventDefault(); link(); return; }
      if (k === 'e') { e.preventDefault(); wrap('`', '`', '代码'); return; }
    }
    if (e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); indent(e.shiftKey); return; }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && continueList()) e.preventDefault();
  });
  document.addEventListener('keydown', function (e) {
    if (current === 'editor' && (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key || '').toLowerCase() === 's') {
      e.preventDefault();
      save({}).then(function (ok) { if (ok) note('已保存', 'ok'); });
    }
  });

  /* ---------------------------------------------------- pictures: paste, drop or pick */
  function upload(file) {
    if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error('图片太大了（最多 25 MB）：' + (file.name || '')));
    return call('upload', file, file.type || 'application/octet-stream').then(function (r) { return r.path; });
  }
  function uploadFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|gif|avif|heic|svg)$/i.test(file.name)) { note('只能上传图片：' + file.name, 'error'); return; }
      var tag = '![上传中 ' + (file.name || '图片').replace(/[\[\]()]/g, '') + '…]()';
      var at = body.selectionStart;
      edit(at, body.selectionEnd, blankBefore(at) + tag + '\n\n');
      note('正在上传 ' + (file.name || '图片') + '…', 'busy');
      upload(file).then(function (path) {
        var i = body.value.indexOf(tag);
        var md = '![](' + path + ' "")';
        if (i >= 0) edit(i, i + tag.length, md, 2, 2);
        else edit(body.selectionStart, body.selectionStart, md + '\n');
        note('已上传。可以在 ![ ] 的方括号里写图片说明，引号里写图注。', 'ok');
      }, function (err) {
        var i = body.value.indexOf(tag);
        if (i >= 0) edit(i, i + tag.length, '');
        note(err.message, 'error');
      });
    });
  }
  fileInput.addEventListener('change', function () { uploadFiles(fileInput.files); fileInput.value = ''; });
  body.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); body.classList.add('is-drop'); } });
  body.addEventListener('dragleave', function () { body.classList.remove('is-drop'); });
  body.addEventListener('drop', function (e) {
    body.classList.remove('is-drop');
    if (e.dataTransfer && e.dataTransfer.files.length) {
      e.preventDefault();
      if (hasMissing(e.dataTransfer.files)) fillMissing(e.dataTransfer.files);
      else uploadFiles(e.dataTransfer.files);
    }
  });
  /* the share picture: double-click its field to pick one */
  f('cover').addEventListener('dblclick', function () {
    var pick = make('input');
    pick.type = 'file';
    pick.accept = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
    pick.addEventListener('change', function () {
      if (!pick.files[0]) return;
      note('正在上传…', 'busy');
      upload(pick.files[0]).then(function (path) { f('cover').value = path; changed(); note('分享图已上传', 'ok'); }, function (err) { note(err.message, 'error'); });
    });
    pick.click();
  });

  /* ---------------------------------------------------- pasting: SiYuan, web pages, Word → Markdown */
  var SIYUAN_HTML = /data-node-id=|data-type="Node|class="protyle/;
  var RICH = /<(h[1-6]|ul|ol|li|table|pre|blockquote|img|strong|b|em|i|a|code|hr|mark|del|s)\b/i;
  var LOOKS_MD = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|[^\n]*\|)|\*\*[^*\n]+\*\*|!?\[[^\]\n]*\]\([^)\n]+\)/;

  /* what SiYuan leaves in Markdown that means nothing on a web page (the server cleans imports the same way) */
  function cleanSiyuan(t) {
    return t.replace(/\u200b/g, '')
      .replace(/^\s*\{: [^}\n]*\}\s*$\n?/gm, '')
      .replace(/\s*\{: [^}\n]*\}$/gm, '')
      .replace(/^\s*(?:\{\{\{(?:row|col)|\}\}\})\s*$\n?/gm, '')
      .replace(/^\s*\{\{[^}\n]*\}\}\s*$\n?/gm, '')
      .replace(/\(\(\d{14}-[0-9a-z]{7}(?:\s+["']([^"'\n]*)["'])?\)\)/g, '$1')
      .replace(/\[([^\]\n]*)\]\(siyuan:\/\/[^)\s]*\)/g, '$1');
  }

  body.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    var types = Array.prototype.slice.call(cd.types || []);
    var html = types.indexOf('text/html') >= 0 ? cd.getData('text/html') : '';
    var plain = cd.getData('text/plain') || '';
    var files = cd.files;
    /* a picture (a screenshot, an image copied from a page) */
    if (files && files.length && (!html || /^\s*(<meta[^>]*>\s*)?(<img[^>]*>\s*)+$/i.test(html.replace(/<\/?(html|body)[^>]*>|<!--[\s\S]*?-->/gi, '')))) {
      e.preventDefault();
      uploadFiles(files);
      return;
    }
    if (plainPaste) { plainPaste = false; return; } /* Ctrl+Shift+V: exactly the text */
    /* a web address pasted over selected words: a link */
    var s = body.selectionStart, en = body.selectionEnd;
    if (en > s && /^https?:\/\/\S+$/.test(plain.trim()) && body.value.slice(s, en).indexOf('\n') < 0) {
      e.preventDefault();
      edit(s, en, '[' + body.value.slice(s, en) + '](' + plain.trim() + ')');
      return;
    }
    var siyuan = types.indexOf('text/siyuan') >= 0 || SIYUAN_HTML.test(html) || /\{: [^}\n]*id="\d{14}-/.test(plain);
    var md = null, how = '';
    if (siyuan) {
      md = cleanSiyuan(plain || htmlToMd(html));
      how = '思源';
    } else if (html && RICH.test(html) && !LOOKS_MD.test(plain)) {
      md = htmlToMd(html);
      how = '网页';
      if (!md.trim()) md = null;
    }
    if (md == null) return; /* plain text: the browser pastes it as it is */
    e.preventDefault();
    edit(s, en, md);
    var unresolved = refs(md).filter(function (r) { return kind(r) === 'missing'; });
    if (how === '思源' && unresolved.some(function (u) { return /^assets\//.test(u); })) fromSiyuan(true);
    else noteWith(['已把' + how + '的格式转成 Markdown（Ctrl+Z 撤销，Ctrl+Shift+V 粘贴纯文本）。' + (unresolved.length ? '里面的图片还要补上，见上方提示。' : '')], 'ok');
    uploadInlineData();
  });

  /* HTML from a web page, Word, Feishu, Notion … → Markdown. The HTML is only read (DOMParser runs nothing). */
  function htmlToMd(html) {
    /* style attributes renamed first: the page's security policy would otherwise complain about each one */
    var doc = new DOMParser().parseFromString(html.replace(/<[a-z][^>]*>/gi, function (t) { return t.replace(/\sstyle\s*=/gi, ' data-pstyle='); }), 'text/html');
    $$('script,style,meta,link,title,noscript,template,iframe,object,embed,svg,canvas,button,input:not([type=checkbox]),select,textarea', doc).forEach(function (n) { n.remove(); });
    var min = 7;
    $$('h1,h2,h3,h4,h5,h6', doc).forEach(function (h) { min = Math.min(min, Number(h.tagName[1])); });
    var shift = min < 7 ? 2 - min : 0; /* the article's title is the only first-level heading: pasted ones start at ## */
    var BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGURE|CENTER|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TR|TD|TH|HR|DL|DT|DD|FIGCAPTION|ADDRESS|DETAILS|SUMMARY)$/;
    function esc(t) {
      return t.replace(/\\/g, '\\\\').replace(/([`*_[\]])/g, '\\$1').replace(/<(?=[A-Za-z/!])/g, '&lt;');
    }
    function styleOf(el) { return (el.getAttribute && el.getAttribute('data-pstyle') || '').toLowerCase(); }
    function url(u) { return u.replace(/[()\s]/g, function (c) { return { '(': '%28', ')': '%29' }[c] || '%20'; }); }
    function around(mark, inner) {
      var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
      return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
    }
    function inline(node) {
      var out = '';
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { out += esc(n.nodeValue.replace(/[\s\u00a0]+/g, ' ')); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName, st = styleOf(n), inner;
        if (tag === 'BR') { out += '  \n'; return; }
        if (tag === 'IMG') { out += image(n); return; }
        if (tag === 'INPUT') { out += n.checked ? '[x] ' : '[ ] '; return; }
        if (BLOCK.test(tag)) { out += ' ' + inline(n) + ' '; return; }
        if (tag === 'CODE') {
          var code = n.textContent, ticks = '`';
          while (code.indexOf(ticks) >= 0) ticks += '`';
          out += code ? ticks + (code[0] === '`' ? ' ' : '') + code + (code[code.length - 1] === '`' ? ' ' : '') + ticks : '';
          return;
        }
        inner = inline(n);
        if ((tag === 'B' || tag === 'STRONG') && !/font-weight:\s*(normal|[1-4]00)/.test(st)) out += around('**', inner);
        else if (tag === 'EM' || tag === 'I' || (tag === 'SPAN' && /font-style:\s*italic/.test(st))) out += around('*', inner);
        else if (tag === 'SPAN' && /font-weight:\s*(bold|[6-9]00)/.test(st)) out += around('**', inner);
        else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE' || (tag === 'SPAN' && /line-through/.test(st))) out += around('~~', inner);
        else if (tag === 'MARK') out += around('==', inner);
        else if (tag === 'U' || tag === 'SUP' || tag === 'SUB' || tag === 'KBD') out += inner.trim() ? '<' + tag.toLowerCase() + '>' + inner + '</' + tag.toLowerCase() + '>' : inner;
        else if (tag === 'A') {
          var href = (n.getAttribute('href') || '').trim();
          var ok = /^(https?:|mailto:|\/|#)/i.test(href) && !/^javascript:/i.test(href);
          out += ok && inner.trim() ? '[' + inner.trim() + '](' + url(href) + ')' : inner;
        } else out += inner;
      });
      return out;
    }
    function image(img) {
      var src = img.getAttribute('src') || '';
      if (!src) return '';
      var alt = (img.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      return '![' + alt + '](' + url(src) + ')';
    }
    function lines(text, prefix, first) {
      return text.split('\n').map(function (l, i) { return (i === 0 && first != null ? first : prefix) + l; }).join('\n');
    }
    function para(text) {
      return text.split('\n').map(function (l) { return l.replace(/^ +| +$/g, function (m) { return m.length >= 2 && /  $/.test(l) ? '  ' : ''; }); })
        .join('\n').replace(/^(\s*)([#>+-]|\d+\.)(?=\s)/gm, '$1\\$2').trim();
    }
    function blocks(node, tight) {
      var out = [], run = '';
      function flush() { var p = para(run); if (p) out.push(p); run = ''; }
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { run += esc(n.nodeValue.replace(/[\s\u00a0]+/g, ' ')); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName;
        if (!BLOCK.test(tag)) {
          if (tag === 'BR') { run += '  \n'; return; }
          if (tag === 'IMG') { flush(); out.push(image(n)); return; }
          var w = doc.createElement('div'); /* in the parsed document: nothing of it touches the page */
          w.appendChild(n.cloneNode(true));
          run += inline(w);
          return;
        }
        flush();
        var m = /^H([1-6])$/.exec(tag);
        if (m) {
          var t = inline(n).replace(/\s+/g, ' ').trim();
          if (t) out.push('#'.repeat(Math.min(6, Math.max(2, Number(m[1]) + shift))) + ' ' + t);
        } else if (tag === 'UL' || tag === 'OL') out.push(list(n));
        else if (tag === 'BLOCKQUOTE') { var q = blocks(n); if (q) out.push(lines(q, '> ')); }
        else if (tag === 'PRE') {
          var codeEl = n.querySelector('code') || n;
          var lang = /(?:language|lang)-([\w+#.-]+)/.exec((codeEl.className || '') + ' ' + (n.className || ''));
          var code = codeEl.textContent.replace(/\n$/, ''), fence = '```';
          while (code.indexOf(fence) >= 0) fence += '`';
          out.push(fence + (lang ? lang[1].toLowerCase() : '') + '\n' + code + '\n' + fence);
        } else if (tag === 'TABLE') out.push(table(n));
        else if (tag === 'HR') out.push('---');
        else if (tag === 'FIGURE') {
          var img = n.querySelector('img'), cap = n.querySelector('figcaption');
          if (img) out.push(image(img).replace(/\)$/, cap && cap.textContent.trim() ? ' "' + cap.textContent.trim().replace(/"/g, '“') + '")' : ')'));
          else { var fb = blocks(n); if (fb) out.push(fb); }
        } else if (tag === 'LI') out.push(list({ tagName: 'UL', children: [n] }));
        else { var inner = blocks(n, tight); if (inner) out.push(inner); }
      });
      flush();
      return out.join(tight ? '\n' : '\n\n');
    }
    function list(el, depth) {
      var ordered = el.tagName === 'OL', n = Number(el.getAttribute && el.getAttribute('start')) || 1;
      return Array.prototype.filter.call(el.children, function (c) { return c.tagName === 'LI'; }).map(function (li) {
        var box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
        var task = box ? (box.checked ? '[x] ' : '[ ] ') : '';
        if (box) box.remove();
        var mark = ordered ? n++ + '. ' : '- ';
        var text = blocks(li, true) || '';
        return lines(text, ' '.repeat(mark.length), mark + task);
      }).join('\n');
    }
    function table(t) {
      var rows = Array.prototype.filter.call(t.querySelectorAll('tr'), function (r) { return r.closest('table') === t; }).map(function (r) {
        return Array.prototype.map.call(r.children, function (c) { return inline(c).replace(/\s*\n\s*/g, '<br>').replace(/\|/g, '\\|').trim(); });
      }).filter(function (r) { return r.length; });
      if (!rows.length) return '';
      var w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      var row = function (r) { while (r.length < w) r.push(''); return '| ' + r.join(' | ') + ' |'; };
      return [row(rows[0]), '|' + ' --- |'.repeat(w)].concat(rows.slice(1).map(row)).join('\n');
    }
    return blocks(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* pictures that came in as data: (pasted from Word or a page): uploaded and swapped for their address */
  function uploadInlineData() {
    refs(body.value).filter(function (u) { return /^data:image\/[a-z+.-]+;base64,/.test(u); }).forEach(function (u) {
      var blob;
      try {
        var raw = atob(u.slice(u.indexOf(',') + 1)), bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        blob = new Blob([bytes], { type: u.slice(5, u.indexOf(';')) });
      } catch (e) { return; }
      upload(blob).then(function (path) { replaceUrl(u, path); }, function (err) { note(err.message, 'error'); });
    });
  }

  /* ---------------------------------------------------- pictures that are not on the server yet */
  var IMG_RE = /!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)|<img\b[^>]*?\ssrc="([^"]+)"/g;
  function refs(text) {
    var out = [], m;
    /* pictures written as examples in code (a ``` block, or `![说明](路径)` in a line) are not pictures */
    text = text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, '').replace(/`[^`\n]+`/g, '');
    IMG_RE.lastIndex = 0;
    while ((m = IMG_RE.exec(text))) { var u = m[1] || m[2]; if (u && out.indexOf(u) < 0) out.push(u); }
    return out;
  }
  function kind(u) {
    /* an address on the site itself: an upload (/media/), or a file in the site's code (/images/, /videos/ …) */
    if (/^\/(?!\/)/.test(u)) return 'ok';
    if (/^https?:\/\//i.test(u)) return 'remote';
    if (/^data:/.test(u)) return 'data';
    if (!u || /^(#|上传中)/.test(u)) return 'ok';
    return 'missing';
  }
  function baseName(u) {
    var n = u.replace(/[?#].*$/, '').replace(/^.*[\/\\]/, '');
    try { n = decodeURIComponent(n); } catch (e) { /* as written */ }
    return n.toLowerCase();
  }
  var scanTimer = 0, missing = [];
  function scanImages() {
    var all = refs(body.value);
    missing = all.filter(function (u) { return kind(u) === 'missing'; });
    var remote = all.filter(function (u) { return kind(u) === 'remote'; }).length;
    var box = $('[data-ed-missing]');
    box.hidden = !missing.length && !remote;
    var t = '';
    if (missing.length) {
      t = '有 ' + missing.length + ' 张图片还在你的电脑里（' + missing.slice(0, 3).map(baseName).join('、') + (missing.length > 3 ? ' 等' : '') + '）：把这些图片文件拖到这里或者点「选择图片」，会按文件名自动换上。';
    }
    if (remote) t += (t ? ' ' : '') + remote + ' 张是外部图片（链接到别的网站），对方可能不让显示，建议下载后重新上传。';
    $('[data-ed-missing-text]').textContent = t;
    $('[data-ed-siyuan]').hidden = !missing.some(function (u) { return /^assets\//.test(u); });
  }
  function hasMissing(files) {
    return missing.length && Array.prototype.some.call(files, function (fl) { return missing.some(function (u) { return baseName(u) === fl.name.toLowerCase(); }); });
  }
  /* every place the text shows this picture now shows the uploaded one */
  function replaceUrl(from, to) {
    var v = body.value;
    [['](' + from, '](' + to], ['](<' + from + '>', '](' + to], ['src="' + from + '"', 'src="' + to + '"']].forEach(function (p) { v = v.split(p[0]).join(p[1]); });
    setText(v);
  }
  function fillMissing(files) {
    var list = Array.prototype.slice.call(files), done = 0, unmatched = [];
    var jobs = list.map(function (file) {
      var match = missing.filter(function (u) { return baseName(u) === file.name.toLowerCase(); });
      if (!match.length && list.length === 1 && missing.length === 1) match = missing.slice();
      if (!match.length) { unmatched.push(file.name); return Promise.resolve(); }
      return upload(file).then(function (path) { match.forEach(function (u) { replaceUrl(u, path); }); done++; });
    });
    note('正在上传 ' + list.length + ' 张图片…', 'busy');
    Promise.all(jobs.map(function (p) { return p.catch(function (e) { unmatched.push(e.message); }); })).then(function () {
      scanImages();
      note('换上了 ' + done + ' 张图片' + (unmatched.length ? '；没有对上：' + unmatched.join('、') : '') + (missing.length ? '；还差 ' + missing.length + ' 张' : ''), unmatched.length ? 'info' : 'ok');
    });
  }
  var missingBox = $('[data-ed-missing]');
  missingBox.addEventListener('dragover', function (e) { e.preventDefault(); missingBox.classList.add('is-over'); });
  missingBox.addEventListener('dragleave', function () { missingBox.classList.remove('is-over'); });
  missingBox.addEventListener('drop', function (e) {
    e.preventDefault();
    missingBox.classList.remove('is-over');
    if (e.dataTransfer && e.dataTransfer.files.length) fillMissing(e.dataTransfer.files);
  });
  var missingInput = $('[data-ed-missing-file]');
  missingInput.addEventListener('change', function () { fillMissing(missingInput.files); missingInput.value = ''; });
  /* SiYuan keeps pasted pictures in its workspace and serves them on this computer while it runs (port 6806) */
  function fromSiyuan(auto) {
    var wanted = missing.filter(function (u) { return /^assets\//.test(u); });
    if (!wanted.length) return;
    note('正在从思源取图片…', 'busy');
    var got = 0;
    Promise.all(wanted.map(function (u) {
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
      return fetch(SIYUAN + u.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'), { mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
        .then(function (b) { if (!/^image\//.test(b.type)) throw new Error('not a picture'); return upload(b); })
        .then(function (path) { replaceUrl(u, path); got++; })
        .catch(function () {})
        .then(function () { clearTimeout(timer); });
    })).then(function () {
      scanImages();
      if (got === wanted.length) note('从思源取回了 ' + got + ' 张图片，已经上传', 'ok');
      else note((got ? '从思源取回了 ' + got + ' 张，还差 ' + (wanted.length - got) + ' 张。' : (auto ? '内容已经转好了，但' : '') + '没能从思源取到图片（要思源正在运行；设置了访问授权码时取不到）。')
        + '可以把图片拖进来：思源里图片在工作空间的 data/assets 文件夹。', 'info');
    });
  }
  $('[data-ed-siyuan]').addEventListener('click', function () { fromSiyuan(false); });

  /* ---------------------------------------------------- preview */
  var CALLOUTS = { NOTE: '说明', TIP: '提示', IMPORTANT: '重要', WARNING: '注意', CAUTION: '警告' };
  /* the notes' icons, as scripts/build.mjs draws them */
  var CALLOUT_ICONS = {
    NOTE: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.4"/>',
    TIP: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    IMPORTANT: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/><path d="M12 8v3.5"/><path d="M12 14v.3"/>',
    WARNING: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 16.8v.2"/>',
    CAUTION: '<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M12 8v5"/><path d="M12 16v.2"/>',
  };
  /* Obsidian's other names for the same five (as scripts/build.mjs) */
  var CALLOUT_ALIAS = { INFO: 'NOTE', ABSTRACT: 'NOTE', SUMMARY: 'NOTE', TODO: 'NOTE', QUOTE: 'NOTE', EXAMPLE: 'NOTE', HINT: 'TIP', SUCCESS: 'TIP', CHECK: 'TIP', DONE: 'TIP', QUESTION: 'IMPORTANT', HELP: 'IMPORTANT', FAQ: 'IMPORTANT', ATTENTION: 'WARNING', FAILURE: 'CAUTION', FAIL: 'CAUTION', MISSING: 'CAUTION', DANGER: 'CAUTION', ERROR: 'CAUTION', BUG: 'CAUTION' };
  var mdReady = false;
  /* KaTeX (270 KB) and the code colours (400 KB) are fetched the first time the preview shows a formula or a code
     block; until they are there it shows the plain text, then draws itself again */
  var loading = {};
  function need(name, attr) {
    if (window[name]) return true;
    if (!loading[name]) {
      loading[name] = true;
      var s = document.createElement('script');
      s.src = root.getAttribute(attr);
      s.onload = function () { schedulePreview(); };
      s.onerror = function () { loading[name] = false; };
      document.head.appendChild(s);
    }
    return false;
  }
  function texPreview(src, display) {
    if (!need('katex', 'data-katex-src')) return '<code>' + escHtml(src) + '</code>';
    try { return window.katex.renderToString(src, { displayMode: display, output: 'mathml', throwOnError: true, strict: 'ignore' }); }
    catch (e) { return '<span class="wikilink is-missing" title="' + escHtml(String(e.message || e)) + '">' + escHtml(src) + '</span>'; }
  }
  /* footnotes of the article being shown: numbered as they are first used, listed at the end */
  var fnOrder = [], fnDefs = {};
  function render(md) {
    var m = window.marked;
    if (!m || !m.lexer) return '<pre>' + escHtml(md) + '</pre>';
    if (!mdReady) {
      m.use({
        gfm: true,
        /* ```math is a formula too; any other code block as marked draws it (false: its own renderer) */
        renderer: {
          code: function (t) {
            if (/^(math|latex|katex)$/i.test(t.lang || '')) return '<div class="math-display">' + texPreview(t.text, true) + '</div>\n';
            /* the same code block the article will show: colours, file name, line numbers, highlighted lines */
            if (need('SiteHighlight', 'data-hl-src')) { try { return window.SiteHighlight.codeBlock(t.text, t.lang || ''); } catch (e) { /* marked draws it plainly */ } }
            return false;
          },
        },
        extensions: [{
          /* formulas, by the same rules as the build; shown as MathML, which browsers draw by themselves (KaTeX's own
             HTML needs inline styles, which this page does not allow) */
          name: 'mathBlock', level: 'block',
          start: function (src) { var x = /^\$\$/m.exec(src); return x ? x.index : undefined; },
          tokenizer: function (src) {
            var x = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
            if (x) return { type: 'mathBlock', raw: x[0], text: x[1].trim() };
          },
          renderer: function (t) { return '<div class="math-display">' + texPreview(t.text, true) + '</div>\n'; },
        }, {
          name: 'mathInline', level: 'inline',
          start: function (src) { return src.indexOf('$'); },
          tokenizer: function (src) {
            var x = /^\$\$((?:\\.|[^\\$])+?)\$\$/.exec(src);
            if (x) return { type: 'mathInline', raw: x[0], text: x[1].trim(), display: true };
            x = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
            if (x) return { type: 'mathInline', raw: x[0], text: x[1], display: false };
          },
          renderer: function (t) { return texPreview(t.text, t.display); },
        }, {
          name: 'footnoteDef', level: 'block',
          start: function (src) { var x = /^\[\^[^\]\s]+\]:/m.exec(src); return x ? x.index : undefined; },
          tokenizer: function (src) {
            var x = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(src);
            if (x) return { type: 'footnoteDef', raw: x[0], id: x[1], tokens: this.lexer.inlineTokens(x[2].replace(/\n[ \t]+/g, '\n')) };
          },
          renderer: function (t) { fnDefs[t.id] = this.parser.parseInline(t.tokens); return ''; },
        }, {
          name: 'footnoteRef', level: 'inline',
          start: function (src) { return src.indexOf('[^'); },
          tokenizer: function (src) {
            var x = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
            if (x) return { type: 'footnoteRef', raw: x[0], id: x[1] };
          },
          renderer: function (t) {
            if (fnOrder.indexOf(t.id) < 0) fnOrder.push(t.id);
            var n = fnOrder.indexOf(t.id) + 1;
            return '<sup class="fn-ref"><a href="#fn-' + n + '">' + n + '</a></sup>';
          },
        }, {
          name: 'mark', level: 'inline',
          start: function (src) { return src.indexOf('=='); },
          tokenizer: function (src) {
            var x = /^==(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
            if (x) return { type: 'mark', raw: x[0], tokens: this.lexer.inlineTokens(x[1]) };
          },
          renderer: function (t) { return '<mark>' + this.parser.parseInline(t.tokens) + '</mark>'; },
        }, {
          /* [[网址]] / [[网址|文字]] / [[网址#小节]]: found by the same rules as the build (scripts/build.mjs, linkPosts),
             among the articles in the list; one that matches nothing shows grey, as on the site */
          name: 'wikilink', level: 'inline',
          start: function (src) { return src.indexOf('[['); },
          tokenizer: function (src) {
            var x = /^\[\[([^\[\]\n|#]*?)(?:#([^\[\]\n|]+?))?(?:\|([^\[\]\n]+?))?\]\]/.exec(src);
            if (x && (x[1].trim() || x[2])) return { type: 'wikilink', raw: x[0], to: x[1].trim(), part: (x[2] || '').trim(), label: (x[3] || '').trim() };
          },
          renderer: function (t) {
            if (!t.to) return '<a class="wikilink" href="#">' + escHtml(t.label || t.part) + '</a>';
            var key = t.to.replace(/\s+/g, ' ').toLowerCase();
            var p = allPosts.filter(function (q) { return q.slug === t.to || q.slug === t.to.replace(/\s+/g, '-'); })[0]
              || allPosts.filter(function (q) { return (q.title || '').replace(/\s+/g, ' ').trim().toLowerCase() === key; })[0];
            if (!p) return '<span class="wikilink is-missing" title="没有找到这篇文章">' + escHtml(t.label || t.to) + '</span>';
            var text = t.label || (p.title || p.slug) + (t.part ? ' › ' + t.part : '');
            return '<a class="wikilink" href="/blog/' + encodeURI(p.slug) + '/" title="' + escHtml(p.title || p.slug) + (p.state === 'draft' ? '（草稿：发布前站上不会出现这个链接）' : '') + '">' + escHtml(text) + '</a>';
          },
        }],
      });
      mdReady = true;
    }
    /* block by block, so each one knows the line it starts on (for scrolling the preview along) */
    fnOrder = []; fnDefs = {};
    var tokens = m.lexer(md), line = 0, html = '';
    tokens.forEach(function (t) {
      var at = line;
      line += (t.raw.match(/\n/g) || []).length;
      if (t.type === 'space') return;
      var one = [t];
      one.links = tokens.links;
      html += m.parser(one).replace(/^(\s*<[a-z][a-z0-9]*)/i, '$1 data-line="' + at + '"');
    });
    if (fnOrder.length) {
      html += '<section class="footnotes"><p class="fn-title">注释</p><ol>' + fnOrder.map(function (id, i) {
        return '<li id="fn-' + (i + 1) + '"><p>' + (fnDefs[id] != null ? fnDefs[id] : '<span class="wikilink is-missing">（这条脚注还没写内容：[^' + escHtml(id) + ']: …）</span>') + '</p></li>';
      }).join('') + '</ol></section>';
    }
    return html
      /* > [!TIP] 自己的标题, and [!TIP]- / [!TIP]+ for one that folds */
      .replace(/<blockquote([^>]*)>\s*<p>\[!([A-Za-z]+)\]([+-]?)([^\n<]*)([\s\S]*?)<\/blockquote>/g, function (x, attrs, name, fold, title, rest) {
        var type = CALLOUT_ALIAS[name.toUpperCase()] || name.toUpperCase();
        if (!CALLOUTS[type]) return x;
        var label = '<svg viewBox="0 0 24 24" aria-hidden="true">' + CALLOUT_ICONS[type] + '</svg>' + (title.trim() || CALLOUTS[type]);
        if (fold) label += '<svg class="callout-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
        var body = rest.replace(/^\s*<\/p>\s*/, '');
        if (body.trim() && !/^\s*<(p|ul|ol|pre|div|table|blockquote|h[1-6]|figure|details|aside|hr)\b/i.test(body)) body = '<p>' + body.replace(/^\s+/, '');
        if (fold) return '<details class="callout is-' + type.toLowerCase() + '"' + attrs + (fold === '+' ? ' open' : '') + '><summary class="callout-title">' + label + '</summary><div class="callout-body">' + body + '</div></details>';
        return '<aside class="callout is-' + type.toLowerCase() + '"' + attrs + '><p class="callout-title">' + label + '</p>' + body + '</aside>';
      })
      /* an album in an article: shown only by the build, which is what has its photos */
      .replace(/<p([^>]*)>::gallery\[([^\]\s<]+)\](?:\{show=(\d+)\})?<\/p>/g, function (x, attrs, name, n) {
        return '<aside class="callout is-note"' + attrs + '><p class="callout-title">图集</p><p>' + name + '：发布后在这里显示 ' + (n || 4) + ' 张预览和进入图集的链接</p></aside>';
      })
      .replace(/<table([^>]*)>/g, '<div class="table-wrap"$1><table>').replace(/<\/table>/g, '</table></div>')
      .replace(/(<img[^>]*?\ssrc=")\/(media|images)\//g, '$1' + API + 'files/$2/');
  }
  function setupFrame(el, cb) {
    var theme = document.documentElement.getAttribute('data-theme') || 'light';
    el.srcdoc = '<!doctype html><html lang="zh-CN" data-theme="' + theme + '" class="js"><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="' + CSS + '"></head><body class="post ed-preview-body"><article class="article ed-article">' +
      '<h1 class="article-title" data-pv-title></h1><p class="article-lead" data-pv-lead></p><div class="prose" data-pv></div></article></body></html>';
    el.addEventListener('load', cb, { once: true });
  }
  function docOf(el) { try { return el.contentDocument; } catch (e) { return null; } }
  function fillFrame(el, title, lead, md) {
    var d = docOf(el);
    if (!d || !d.querySelector('[data-pv]')) return false;
    d.querySelector('[data-pv-title]').textContent = title || '（标题）';
    var l = d.querySelector('[data-pv-lead]');
    l.textContent = lead || '';
    l.hidden = !lead;
    d.querySelector('[data-pv]').innerHTML = render(md);
    return true;
  }
  var frameReady = false, pvTimer = 0;
  function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(preview, 200); }
  function preview() {
    if (!frameReady) return;
    if (fillFrame(frame, f('title').value, f('description').value, body.value)) { blocksDirty = true; syncScroll(); }
  }
  /* the previews follow the theme switch */
  new MutationObserver(function () {
    [frame, $('[data-eh-frame]')].forEach(function (el) {
      var d = docOf(el);
      if (d && d.documentElement) d.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme'));
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* scrolling: the preview shows the part of the text at the top of the editor. Where each source line sits in the
     editor is measured with an invisible copy of the text that wraps the same way */
  var mirror = null, tops = [], linesDirty = true, blocksDirty = true, blockLines = [], blockTops = [];
  function measure() {
    if (!mirror) {
      mirror = make('div', 'ed-mirror');
      mirror.setAttribute('aria-hidden', 'true');
      body.parentNode.appendChild(mirror);
    }
    var cs = getComputedStyle(body);
    mirror.style.width = body.clientWidth + 'px';
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(function (k) { mirror.style[k] = cs[k]; });
    mirror.textContent = '';
    var frag = document.createDocumentFragment();
    body.value.split('\n').forEach(function (l) { frag.appendChild(make('div', null, l || '\u200b')); });
    mirror.appendChild(frag);
    tops = Array.prototype.map.call(mirror.children, function (c) { return c.offsetTop; });
    linesDirty = false;
  }
  function measureBlocks() {
    var d = docOf(frame);
    blockLines = [];
    blockTops = [];
    if (!d) return;
    var y = d.scrollingElement ? d.scrollingElement.scrollTop : 0;
    $$('.prose > [data-line]', d).forEach(function (el) {
      blockLines.push(Number(el.getAttribute('data-line')));
      blockTops.push(el.getBoundingClientRect().top + y);
    });
    blocksDirty = false;
  }
  function syncScroll() {
    var d = docOf(frame);
    if (!d || !d.scrollingElement || frame.offsetParent === null) return;
    if (linesDirty) measure();
    if (blocksDirty) measureBlocks();
    var se = d.scrollingElement, maxPv = se.scrollHeight - frame.clientHeight;
    var y = body.scrollTop, maxEd = body.scrollHeight - body.clientHeight;
    if (maxEd > 0 && y >= maxEd - 2) { se.scrollTop = maxPv; return; }
    var i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= y) i++;
    var span = (tops[i + 1] || tops[i] + 1) - tops[i];
    var at = i + Math.min(1, Math.max(0, (y - tops[i]) / span)); /* the source line at the top, with its fraction */
    if (!blockLines.length || at < blockLines[0]) { se.scrollTop = blockLines.length ? (at / Math.max(1, blockLines[0])) * blockTops[0] * 0.9 : 0; return; }
    var k = 0;
    while (k < blockLines.length - 1 && blockLines[k + 1] <= at) k++;
    var nextLine = k + 1 < blockLines.length ? blockLines[k + 1] : tops.length;
    var nextTop = k + 1 < blockLines.length ? blockTops[k + 1] : se.scrollHeight;
    var t = blockTops[k] + ((at - blockLines[k]) / Math.max(1, nextLine - blockLines[k])) * (nextTop - blockTops[k]);
    se.scrollTop = Math.min(maxPv, Math.max(0, t - 24));
  }
  body.addEventListener('scroll', function () { requestAnimationFrame(syncScroll); });
  window.addEventListener('resize', function () { linesDirty = true; blocksDirty = true; });
  function setMode(mode) {
    $('[data-ed-split]').setAttribute('data-mode', mode);
    $$('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode)); });
    if (mode === 'preview') preview();
  }
  $('.ed-mode').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]');
    if (b) setMode(b.getAttribute('data-mode'));
  });
  setupFrame(frame, function () { frameReady = true; preview(); });

  function count() {
    var t = body.value.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\]\([^)]*\)/g, ']');
    var cjk = (t.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    var words = (t.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    var n = cjk + words;
    $('[data-ed-count]').textContent = n ? n + ' 字 · 约 ' + Math.max(1, Math.round(cjk / 400 + words / 220)) + ' 分钟读完' : '';
  }

  /* ---------------------------------------------------- history */
  var hist = $('[data-ed-history-pane]'), histFrame = $('[data-eh-frame]'), histReady = false, histPick = null;
  var KIND = { save: '保存', publish: '发布', import: '导入', restore: '恢复' };
  setupFrame(histFrame, function () { histReady = true; });
  function closeHistory() {
    hist.hidden = true;
    root.classList.remove('is-history');
  }
  $('[data-eh-close]').addEventListener('click', closeHistory);
  $('[data-ed-history]').addEventListener('click', function () {
    more.open = false;
    flushSave();
    hist.hidden = false;
    root.classList.add('is-history');
    setMode('preview');
    $('[data-eh-view]').hidden = true;
    var list = $('[data-eh-list]');
    list.textContent = '';
    list.appendChild(make('li', 'eh-empty', '正在读取…'));
    call('posts/revisions?id=' + st.id).then(function (d) {
      list.textContent = '';
      (d.revisions || []).forEach(function (r, i) {
        var li = make('li');
        var b = button('eh-item', '');
        b.appendChild(make('span', 'eh-time', stamp(r.at)));
        b.appendChild(make('span', 'cm-badge ' + (r.kind === 'publish' ? 'is-approved' : ''), KIND[r.kind] || r.kind));
        if (r.live) b.appendChild(make('span', 'cm-badge is-approved', '网站上的版本'));
        b.appendChild(make('span', 'eh-meta', r.words + ' 字' + (i === 0 ? ' · 最新' : '')));
        b.addEventListener('click', function () { showRevision(r, b); });
        li.appendChild(b);
        list.appendChild(li);
      });
      if (!list.children.length) list.appendChild(make('li', 'eh-empty', '还没有历史版本。'));
    }, function (err) { list.textContent = ''; note(err.message, 'error'); });
  });
  function showRevision(r, b) {
    $$('.eh-item', hist).forEach(function (x) { x.classList.toggle('is-on', x === b); });
    call('posts/revision?id=' + r.id).then(function (v) {
      histPick = v;
      $('[data-eh-view]').hidden = false;
      $('[data-eh-which]').textContent = stamp(v.at) + ' ' + (KIND[v.kind] || '') + '的版本';
      if (histReady) fillFrame(histFrame, v.title, v.description, v.body);
    }, function (err) { note(err.message, 'error'); });
  }
  $('[data-eh-restore]').addEventListener('click', function () {
    if (!histPick) return;
    var v = histPick;
    fill(v);
    st.extra = v.extra || [];
    closeHistory();
    setMode('write');
    changed();
    preview();
    note('已换成 ' + stamp(v.at) + ' 的版本，会自动保存（现在的内容也留在历史里）。网站上要点「' + $('[data-ed-publish]').textContent + '」才会变。', 'ok');
  });

  /* ================================================================ comments */
  var filter = 'pending', before = 0, cbusy = false;
  var clist = $('[data-comment-list]'), moreBtn = $('[data-more]');
  function pendingCount() {
    call('comments/summary').then(function (s) {
      $('[data-pending]').textContent = s.pending ? String(s.pending) : '';
    }, function () { /* the comment pane shows problems */ });
  }
  function device(ua) {
    if (!ua) return '';
    var os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac'
      : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    var br = /Edg\//.test(ua) ? 'Edge' : /MicroMessenger/.test(ua) ? '微信' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari' : /bot|crawl|spider|curl|python|java|go-http|scan|wget/i.test(ua) ? '程序' : '';
    return [os, br].filter(Boolean).join(' · ') || '未知设备';
  }
  function commentItem(c) {
    var li = make('li', 'ad-item');
    li.setAttribute('data-id', String(c.id));
    li.setAttribute('data-status', c.status);
    if (c.parent) li.setAttribute('data-parent', String(c.parent));
    var top = make('div', 'ad-top');
    var pick = make('input');
    pick.type = 'checkbox';
    pick.className = 'ad-pick';
    pick.setAttribute('data-pick', '');
    pick.setAttribute('aria-label', '选择 ' + c.name + ' 的这条评论');
    top.appendChild(pick);
    top.appendChild(make('span', 'ad-name', c.name));
    if (c.owner) top.appendChild(make('span', 'cm-badge', '作者'));
    top.appendChild(make('span', 'cm-badge ' + (c.status === 'pending' ? 'is-pending' : 'is-approved'), c.status === 'pending' ? '待审核' : '已通过'));
    top.appendChild(make('span', 'ad-time', stamp(c.at)));
    li.appendChild(top);
    var where = make('div', 'ad-where');
    var post = allPosts.filter(function (p) { return p.slug === c.post; })[0];
    var a = make('a', 'ad-post', '《' + (post ? post.title : c.post) + '》');
    a.href = '/blog/' + encodeURI(c.post) + '/' + (c.status === 'approved' ? '#comment-' + c.id : '');
    a.target = '_blank';
    a.rel = 'noopener';
    where.appendChild(a);
    if (c.parent) where.appendChild(make('span', null, '回复 ' + (c.parentName || '#' + c.parent)));
    li.appendChild(where);
    li.appendChild(make('div', 'ad-text', c.content));
    var info = make('div', 'ad-info');
    if (c.email) { var m = make('a', null, c.email); m.href = 'mailto:' + c.email; info.appendChild(m); }
    var site = c.url && safeUrl(c.url);
    if (site) { var w = make('a', null, c.url.replace(/^https?:\/\//, '')); w.href = site; w.target = '_blank'; w.rel = 'nofollow noopener noreferrer'; info.appendChild(w); }
    if (c.ip) info.appendChild(make('span', null, '访客 ' + c.ip.slice(0, 8)));
    if (c.agent) { var dv = make('span', null, device(c.agent)); dv.title = c.agent; info.appendChild(dv); }
    li.appendChild(info);
    var actions = make('div', 'ad-actions');
    if (c.status === 'pending') actions.appendChild(button('btn btn-primary ad-btn', '通过')).setAttribute('data-act', 'approve');
    actions.appendChild(button('btn btn-ghost ad-btn', '回复')).setAttribute('data-act', 'reply');
    actions.appendChild(button('btn btn-ghost ad-btn ad-del', '删除')).setAttribute('data-act', 'delete');
    li.appendChild(actions);
    return li;
  }
  function replyBox(li) {
    var box = li.querySelector('.ad-replybox');
    if (box) { box.querySelector('textarea').focus(); return; }
    box = make('form', 'ad-replybox');
    var area = make('label', 'cm-box');
    var t = make('textarea');
    t.rows = 3;
    t.placeholder = li.getAttribute('data-status') === 'pending' ? '回复后这条评论会一起通过' : '以作者身份回复';
    area.appendChild(t);
    box.appendChild(area);
    var row = make('div', 'ad-replyrow');
    var cancel = button('btn btn-ghost ad-btn', '取消');
    var send = make('button', 'btn btn-primary ad-btn', '发送回复');
    send.type = 'submit';
    row.appendChild(cancel);
    row.appendChild(send);
    box.appendChild(row);
    cancel.addEventListener('click', function () { box.remove(); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); }
    });
    box.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = t.value.trim();
      if (!text) { t.focus(); return; }
      send.disabled = true;
      call('comments/reply', { id: Number(li.getAttribute('data-id')), content: text }).then(function () {
        note('已回复' + (li.getAttribute('data-status') === 'pending' ? '，这条评论也通过了' : ''), 'ok');
        reloadComments();
      }, function (err) { send.disabled = false; note(err.message, 'error'); });
    });
    li.appendChild(box);
    t.focus();
  }
  clist.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var li = b.closest('.ad-item'), id = Number(li.getAttribute('data-id')), act = b.getAttribute('data-act');
    if (act === 'reply') { replyBox(li); return; }
    if (act === 'delete' && !armed(b, '确认删除')) return;
    b.disabled = true;
    call('comments/' + act, { id: id }).then(function () {
      if (act === 'approve' && filter !== 'pending') reloadComments();
      else {
        li.classList.add('is-gone');
        setTimeout(function () {
          li.remove();
          if (act === 'delete') $$('.ad-item[data-parent="' + id + '"]', clist).forEach(function (x) { x.remove(); });
          $('[data-comment-empty]').hidden = clist.children.length > 0;
          batchState();
        }, 300);
      }
      pendingCount();
      note(act === 'approve' ? '已通过' : '已删除', 'ok');
    }, function (err) { b.disabled = false; note(err.message, 'error'); });
  });
  /* ---------- several at once: tick them, then 通过所选 or 删除所选 (one request each, one after another) */
  var batch = $('[data-batch]'), batchAll = $('[data-batch-all]');
  function picked() { return $$('[data-pick]:checked', clist).map(function (i) { return i.closest('.ad-item'); }); }
  function batchState() {
    var all = $$('[data-pick]', clist), on = picked();
    var pending = on.filter(function (li) { return li.getAttribute('data-status') === 'pending'; }).length;
    batch.hidden = !all.length;
    $('[data-batch-n]').textContent = on.length ? '已选 ' + on.length + ' 条' : '勾选几条评论，可以一起通过或删除';
    batchAll.checked = all.length > 0 && on.length === all.length;
    batchAll.indeterminate = on.length > 0 && on.length < all.length;
    $('[data-batch-act="approve"]', batch).disabled = !pending;
    $('[data-batch-act="delete"]', batch).disabled = !on.length;
    all.forEach(function (i) { i.closest('.ad-item').classList.toggle('is-picked', i.checked); });
  }
  clist.addEventListener('change', function (e) { if (e.target.matches('[data-pick]')) batchState(); });
  batchAll.addEventListener('change', function () {
    $$('[data-pick]', clist).forEach(function (i) { i.checked = batchAll.checked; });
    batchState();
  });
  batch.addEventListener('click', function (e) {
    var b = e.target.closest('[data-batch-act]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-batch-act');
    var items = picked().filter(function (li) { return act !== 'approve' || li.getAttribute('data-status') === 'pending'; });
    if (!items.length) return;
    if (act === 'delete' && !armed(b, '确认删除 ' + items.length + ' 条')) return;
    $$('[data-batch-act]', batch).forEach(function (x) { x.disabled = true; });
    var ok = 0, failed = 0;
    note((act === 'approve' ? '正在通过 ' : '正在删除 ') + items.length + ' 条…', 'busy');
    items.reduce(function (p, li) {
      return p.then(function () {
        return call('comments/' + act, { id: Number(li.getAttribute('data-id')) }).then(function () { ok++; }, function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      note((act === 'approve' ? '通过了 ' : '删除了 ') + ok + ' 条' + (failed ? '，' + failed + ' 条没有成功（可能已经被处理过）' : ''), failed ? 'error' : 'ok');
      reloadComments();
    });
  });

  function pageComments() {
    if (cbusy) return;
    cbusy = true;
    moreBtn.disabled = true;
    call('comments/list?status=' + filter + (before ? '&before=' + before : '')).then(function (d) {
      (d.comments || []).forEach(function (c) { clist.appendChild(commentItem(c)); before = c.id; });
      moreBtn.hidden = (d.comments || []).length < 50;
      $('[data-comment-empty]').hidden = clist.children.length > 0;
      batchState();
    }, function (err) { note(err.message, 'error'); }).then(function () { cbusy = false; moreBtn.disabled = false; });
  }
  function reloadComments() {
    before = 0;
    clist.textContent = '';
    moreBtn.hidden = true;
    pendingCount();
    pageComments();
  }
  function openComments() {
    /* article titles for the list (articles may have been added since) */
    call('posts').then(function (d) { allPosts = d.posts || []; }, function () {}).then(reloadComments);
  }
  $('[data-comment-filter]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b || b.getAttribute('data-filter') === filter) return;
    filter = b.getAttribute('data-filter');
    $$('[data-filter]', $('[data-comment-filter]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    reloadComments();
  });
  moreBtn.addEventListener('click', pageComments);

  /* ================================================================ pictures (图片)
     Every upload, with where it is used; in the editor the same pictures to choose from (从图片库选). The small copies
     come from files/thumb/… (the server makes them once). Only a picture nothing uses can be deleted. */
  var mediaFiles = [], mediaFilter = 'all';
  function bytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function usedText(file) {
    if (file.usedBy && file.usedBy.length) return '用在' + file.usedBy.slice(0, 3).join('、') + (file.usedBy.length > 3 ? ' 等 ' + file.usedBy.length + ' 处' : '');
    return file.history ? '只在历史版本里' : '没有用到（上传一周后自动清理）';
  }
  function mediaCard(file, pick) {
    var fig = make('figure', 'mg-item');
    var thumb = make(pick ? 'button' : 'a', 'mg-thumb');
    if (pick) { thumb.type = 'button'; thumb.setAttribute('aria-label', '插入这张图片'); }
    else { thumb.href = API + 'files' + file.path; thumb.target = '_blank'; thumb.rel = 'noopener'; thumb.setAttribute('aria-label', '看原图'); }
    var img = make('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = API + 'files/thumb' + file.path;
    thumb.appendChild(img);
    if (/\.svg$/i.test(file.path)) thumb.appendChild(make('span', 'mg-kind', 'SVG'));
    fig.appendChild(thumb);
    var cap = make('figcaption', 'mg-cap');
    cap.appendChild(make('span', 'mg-use' + (file.usedBy && file.usedBy.length ? '' : ' is-unused'), usedText(file)));
    cap.appendChild(make('span', 'mg-meta', stamp(file.at).slice(0, 10) + ' · ' + bytes(file.size)));
    if (pick) {
      thumb.addEventListener('click', function () { pick(file); });
    } else {
      var acts = make('span', 'mg-acts');
      var copy = button('cm-link', '复制写法');
      copy.addEventListener('click', function () {
        var md = '![](' + file.path + ')';
        (navigator.clipboard ? navigator.clipboard.writeText(md) : Promise.reject()).then(function () { note('已复制 ' + md + '，贴进文章就行', 'ok'); }, function () { window.prompt('复制这一行：', md); });
      });
      acts.appendChild(copy);
      if (!(file.usedBy && file.usedBy.length) && !file.history) {
        var del = button('cm-link mg-del', '删除');
        del.addEventListener('click', function () {
          if (!armed(del, '确认删除')) return;
          call('media/delete', { path: file.path }).then(function () {
            mediaFiles = mediaFiles.filter(function (x) { return x !== file; });
            fig.classList.add('is-gone');
            setTimeout(drawMedia, 250);
            note('已删除', 'ok');
          }, function (err) { note(err.message, 'error'); });
        });
        acts.appendChild(del);
      }
      cap.appendChild(acts);
    }
    fig.appendChild(cap);
    return fig;
  }
  function loadMedia() {
    return call('media').then(function (d) { mediaFiles = d.files || []; return mediaFiles; });
  }
  function drawMedia() {
    var grid = $('[data-media-grid]');
    grid.textContent = '';
    var unused = mediaFiles.filter(function (x) { return !(x.usedBy && x.usedBy.length); });
    var list = mediaFilter === 'unused' ? unused : mediaFiles;
    list.forEach(function (file) { grid.appendChild(mediaCard(file, null)); });
    var total = mediaFiles.reduce(function (n, x) { return n + (x.size || 0); }, 0);
    $('[data-media-sum]').textContent = mediaFiles.length ? '共 ' + mediaFiles.length + ' 张，' + bytes(total) + (unused.length ? '；' + unused.length + ' 张没在用' : '') : '';
    var empty = $('[data-media-empty]');
    empty.textContent = mediaFiles.length ? '没有没用到的图片。' : '还没有上传过图片。';
    empty.hidden = list.length > 0;
  }
  function openMedia() { loadMedia().then(drawMedia, function (err) { note(err.message, 'error'); }); }
  $('[data-media-filter]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (!b) return;
    mediaFilter = b.getAttribute('data-filter');
    $$('[data-filter]', $('[data-media-filter]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    drawMedia();
  });
  var mediaInput = $('[data-media-file]');
  mediaInput.addEventListener('change', function () {
    var list = Array.prototype.slice.call(mediaInput.files);
    mediaInput.value = '';
    if (!list.length) return;
    var done = 0, failed = [];
    note('正在上传 ' + list.length + ' 张…', 'busy');
    list.reduce(function (p, file) {
      return p.then(function () { return upload(file).then(function () { done++; }, function (e) { failed.push(e.message); }); });
    }, Promise.resolve()).then(function () {
      note('上传了 ' + done + ' 张' + (failed.length ? '；没成功：' + failed.join('、') : '') + '。还没用到的图片一周内要放进文章里，否则会被自动清理', failed.length ? 'error' : 'ok');
      openMedia();
    });
  });

  /* choosing one while writing: inserted where the caret is */
  var picker = $('[data-media-picker]');
  function openPicker() {
    var grid = $('[data-mp-grid]');
    grid.textContent = '';
    $('[data-mp-empty]').hidden = true;
    var at = body.selectionStart, to = body.selectionEnd;
    picker.showModal();
    loadMedia().then(function (files) {
      files.forEach(function (file) {
        grid.appendChild(mediaCard(file, function (chosen) {
          picker.close();
          body.focus();
          body.setSelectionRange(at, to);
          block('![](' + chosen.path + ')\n', 2, 2); /* the caret lands between [ ], for the picture's description */
          note('已插入。方括号里可以写图片说明', 'ok');
        }));
      });
      $('[data-mp-empty]').hidden = files.length > 0;
    }, function (err) { picker.close(); note(err.message, 'error'); });
  }
  $('[data-mp-close]').addEventListener('click', function () { picker.close(); });
  /* a click on the dimmed page around it (the dialog itself is the target there too, so by position) */
  picker.addEventListener('click', function (e) {
    if (e.target !== picker) return;
    var r = picker.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) picker.close();
  });

  /* ================================================================ home page */
  var SITE = [
    { title: '基本信息', fields: [
      ['name', '名字（主页大标题）', 40], ['brand', '左上角的品牌字', 40], ['role', '职业头衔', 60],
      ['title', '浏览器标签页上的标题', 80], ['description', '网站简介（搜索结果和分享时显示）', 200, true]] },
    { title: '首屏', fields: [['hero.intro', '自我介绍', 300, true], ['hero.now', '最近在忙的事（显示在“此刻”里，可以空着）', 100]] },
    { title: '链接', note: '显示在“关于”下面的按钮，比如 GitHub。地址以 https:// 或 mailto: 开头。',
      list: 'links', max: 8, item: [['label', '名称', 20], ['href', '地址', 300]], blank: function () { return { label: '', href: 'https://' }; } },
    { title: '博客', fields: [['blog.lead', '博客区的一句话介绍', 200]] },
    { title: '作品', fields: [['work.lead', '作品区的一句话介绍', 200]],
      note: '第一个作品显示成大图。截图最好是 16:10。',
      list: 'work.projects', max: 12, item: [['name', '项目名称', 40], ['desc', '一句话介绍', 200, true], ['stack', '技术栈', 80], ['source', '源码地址（可以空着）', 300], ['demo', '演示地址（可以空着）', 300], ['image', '截图（/media/ 或 /images/ 开头，可以空着）', 300], ['live', '动态画面（填 planet 显示首页那颗星球，可以空着）', 20]],
      blank: function () { return { name: '', desc: '', stack: '', source: '', demo: '', image: '', live: '' }; } },
    { title: '自托管服务', fields: [['lab.lead', '服务区的一句话介绍', 200]],
      list: 'lab.services', max: 12, item: [['name', '名称', 40], ['host', '地址（只给你自己看，不显示在主页上）', 80], ['status', '状态', 0]], blank: function () { return { name: '', host: '', status: 'up' }; } },
    { title: '关于', fields: [['about.statement', '介绍你自己', 600, true]],
      list: 'about.facts', max: 12, pair: true, item: [['0', '名称', 20], ['1', '内容', 80]], blank: function () { return ['', '']; } },
  ];
  var site = null, siteBase = 0;
  var siteForm = $('[data-site-form]');
  function getAt(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setAt(obj, path, value) {
    var keys = path.split('.'), last = keys.pop();
    var o = keys.reduce(function (o, k) { if (o[k] == null) o[k] = {}; return o[k]; }, obj);
    o[last] = value;
  }
  function input(path, label, max, area, value) {
    var wrap = make('label', 'cm-field' + (area ? ' is-area' : ''));
    var el;
    if (max === 0) {
      el = make('select');
      [['up', '运行中'], ['maintenance', '维护中']].forEach(function (o) { var op = make('option', null, o[1]); op.value = o[0]; el.appendChild(op); });
      wrap.classList.add('is-select');
    } else {
      el = make(area ? 'textarea' : 'input');
      if (area) el.rows = 2;
      el.maxLength = max;
      el.placeholder = ' ';
      el.autocomplete = 'off';
    }
    el.value = value == null ? '' : value;
    el.setAttribute('data-path', path);
    wrap.appendChild(el);
    wrap.appendChild(make('span', 'cm-label', label));
    return wrap;
  }
  function drawSite() {
    siteForm.textContent = '';
    SITE.forEach(function (sec) {
      var fs = make('fieldset', 'site-sec');
      fs.appendChild(make('legend', 'pane-h2', sec.title));
      if (sec.note) fs.appendChild(make('p', 'pane-sub', sec.note));
      (sec.fields || []).forEach(function (fd) { fs.appendChild(input(fd[0], fd[1], fd[2], fd[3], getAt(site, fd[0]))); });
      if (sec.list) {
        var items = getAt(site, sec.list) || [];
        if (!getAt(site, sec.list)) setAt(site, sec.list, items);
        var ol = make('ol', 'site-list');
        items.forEach(function (it, i) {
          var li = make('li', 'site-item');
          var grid = make('div', 'site-grid');
          sec.item.forEach(function (fd) { grid.appendChild(input(sec.list + '.' + i + '.' + fd[0], fd[1], fd[2], fd[3], it[fd[0]])); });
          li.appendChild(grid);
          var tools = make('div', 'site-tools');
          if (i > 0) tools.appendChild(button('cm-link', '上移')).setAttribute('data-site-move', sec.list + '|' + i + '|-1');
          if (i < items.length - 1) tools.appendChild(button('cm-link', '下移')).setAttribute('data-site-move', sec.list + '|' + i + '|1');
          tools.appendChild(button('cm-link site-remove', '删除')).setAttribute('data-site-remove', sec.list + '|' + i);
          li.appendChild(tools);
          ol.appendChild(li);
        });
        fs.appendChild(ol);
        if (items.length < sec.max) {
          var add = button('btn btn-ghost ad-btn', '添加一项');
          add.setAttribute('data-site-add', sec.list);
          fs.appendChild(add);
        }
      }
      siteForm.appendChild(fs);
    });
  }
  siteForm.addEventListener('input', function (e) {
    var p = e.target.getAttribute('data-path');
    if (p) setAt(site, p, e.target.value);
  });
  siteForm.addEventListener('change', function (e) {
    var p = e.target.getAttribute('data-path');
    if (p) setAt(site, p, e.target.value);
  });
  siteForm.addEventListener('click', function (e) {
    var t = e.target, sec;
    if (t.hasAttribute('data-site-add')) {
      var path = t.getAttribute('data-site-add');
      sec = SITE.filter(function (s) { return s.list === path; })[0];
      getAt(site, path).push(sec.blank());
      drawSite();
    } else if (t.hasAttribute('data-site-remove')) {
      var r = t.getAttribute('data-site-remove').split('|');
      getAt(site, r[0]).splice(Number(r[1]), 1);
      drawSite();
    } else if (t.hasAttribute('data-site-move')) {
      var m = t.getAttribute('data-site-move').split('|'), list = getAt(site, m[0]), i = Number(m[1]), j = i + Number(m[2]);
      var x = list[i];
      list[i] = list[j];
      list[j] = x;
      drawSite();
    }
  });
  /* ================================================================ albums
     Saved by hand and whole: a draft just stays on the server, and saving one that is on the site rebuilds the site.
     The photos are ordinary uploads, cleaned on the way in; the day each was taken comes back with the upload. */
  var al = null, alSaved = '', alUploading = false, alSlugTouched = false;
  var alForm = $('[data-al-form]'), alBox = $('[data-al-photos]'), alFile = $('[data-al-file]'), alDrop = $('[data-al-drop]');
  var alSaveBtn = $('[data-al-save]'), alToggle = $('[data-al-toggle]'), alDelete = $('[data-al-delete]');
  function alEl(n) { return alForm.elements.namedItem(n); }
  function alSnap() { return JSON.stringify({ slug: al.slug, draft: al.draft, data: al.data }); }
  function albumDirty() { return !!al && alSnap() !== alSaved; }
  function mediaUrl(path) { return API + 'files' + path; }
  function openAlbums() {
    var box = $('[data-album-list]');
    box.textContent = '';
    call('albums').then(function (d) {
      var list = d.albums || [];
      $('[data-album-empty]').hidden = list.length > 0;
      list.forEach(function (a) {
        var card = make('a', 'al-card');
        card.href = '#/album/' + a.id;
        var thumb = make('span', 'al-cover');
        if (a.cover) {
          var img = make('img');
          img.src = mediaUrl(a.cover);
          img.alt = '';
          img.loading = 'lazy';
          thumb.appendChild(img);
        }
        card.appendChild(thumb);
        var head = make('span', 'al-card-head');
        head.appendChild(make('span', 'pi-title', a.title));
        head.appendChild(make('span', 'cm-badge ' + (a.draft ? 'is-pending' : 'is-approved'), a.draft ? '草稿' : '已发布'));
        card.appendChild(head);
        card.appendChild(make('span', 'pi-meta', a.photos + ' 张  ·  改于 ' + ago(a.updated)));
        box.appendChild(card);
      });
    }, function (err) { note(err.message, 'error'); });
  }
  function openAlbum(arg) {
    al = null;
    alBox.textContent = '';
    alSaveBtn.disabled = alToggle.disabled = true;
    function ready(a) {
      al = a;
      al.data.days = al.data.days || {};
      al.data.photos = al.data.photos || [];
      alSlugTouched = !!al.id;
      alEl('title').value = al.data.title || '';
      alEl('slug').value = al.slug || '';
      alEl('description').value = al.data.description || '';
      alEl('timeline').value = al.data.timeline === 'month' ? 'month' : 'day';
      alSaved = alSnap();
      alDraw();
      alBar();
      if (!al.id) alEl('title').focus();
    }
    if (arg === 'new') {
      ready({ id: 0, version: 0, slug: '', draft: true, data: { title: '', description: '', timeline: 'day', cover: '', days: {}, photos: [] } });
      return;
    }
    call('albums/get?id=' + encodeURIComponent(arg)).then(ready, function (err) {
      note(err.message, 'error');
      location.hash = '#/albums';
    });
  }
  /* the state, and what the buttons do in it */
  function alBar() {
    if (!al) return;
    var dirty = albumDirty();
    var chip = $('[data-al-state]');
    chip.textContent = al.draft ? '草稿' : '已发布';
    chip.className = 'cm-badge ' + (al.draft ? 'is-pending' : 'is-approved');
    var status = $('[data-al-status]');
    status.textContent = alUploading ? '正在上传…' : dirty ? '有修改没保存' : al.id ? '已保存' : '';
    status.classList.toggle('is-dirty', dirty);
    alSaveBtn.textContent = al.draft ? '保存草稿' : '保存并更新网站';
    alToggle.textContent = al.draft ? '发布' : '撤下';
    alSaveBtn.disabled = alUploading || (!dirty && !!al.id);
    alToggle.disabled = alUploading || !al.data.photos.length;
    alDelete.hidden = !al.id;
    var view = $('[data-al-view]');
    view.hidden = al.draft || !al.id || !me.site;
    if (!view.hidden) view.href = String(me.site).replace(/\/+$/, '') + '/gallery/' + encodeURIComponent(al.slug) + '/';
    $('[data-al-ref]').hidden = !al.slug;
    $('[data-al-code]').textContent = '::gallery[' + al.slug + ']{show=4}';
  }
  function dayKey(p) { return p.date ? (al.data.timeline === 'month' ? p.date.slice(0, 7) : p.date) : ''; }
  function dayName(key) {
    if (!key) return '没有日期';
    var x = key.split('-');
    return x.length === 2 ? x[0] + ' 年 ' + Number(x[1]) + ' 月' : x[0] + ' 年 ' + Number(x[1]) + ' 月 ' + Number(x[2]) + ' 日';
  }
  function alSort() {
    al.data.photos.sort(function (a, b) {
      return (a.date ? 0 : 1) - (b.date ? 0 : 1) || String(a.date).localeCompare(String(b.date));
    });
  }
  function alDraw() {
    alBox.textContent = '';
    $('[data-al-empty]').hidden = al.data.photos.length > 0;
    var section = null, grid = null, key = null;
    al.data.photos.forEach(function (p, i) {
      var k = dayKey(p);
      if (!section || k !== key) {
        key = k;
        section = make('section', 'al-day');
        var head = make('div', 'al-day-head');
        head.appendChild(make('h2', 'al-day-name num', dayName(k)));
        if (k) {
          var said = make('input', 'al-day-note');
          said.placeholder = '写给' + (k.length === 7 ? '这个月' : '这一天') + '的话（可以空着）';
          said.maxLength = 300;
          said.value = al.data.days[k] || '';
          said.setAttribute('data-day', k);
          said.setAttribute('aria-label', dayName(k) + '的说明');
          head.appendChild(said);
        }
        section.appendChild(head);
        grid = make('ol', 'al-grid');
        section.appendChild(grid);
        alBox.appendChild(section);
      }
      var li = make('li', 'al-photo' + (p.hidden ? ' is-off' : ''));
      var pic = make('span', 'al-thumb');
      var img = make('img');
      img.src = mediaUrl(p.path);
      img.alt = '';
      img.loading = 'lazy';
      pic.appendChild(img);
      if (al.data.cover === p.path || (!al.data.cover && i === 0)) pic.appendChild(make('span', 'al-flag', '封面'));
      else if (p.hidden) pic.appendChild(make('span', 'al-flag', '已隐藏'));
      li.appendChild(pic);
      var text = make('input', 'al-note');
      text.placeholder = '备注';
      text.maxLength = 500;
      text.value = p.note || '';
      text.setAttribute('data-i', i);
      text.setAttribute('data-k', 'note');
      text.setAttribute('aria-label', '这张照片的备注');
      li.appendChild(text);
      var date = make('input', 'al-date num');
      date.type = 'date';
      date.value = p.date || '';
      date.setAttribute('data-i', i);
      date.setAttribute('data-k', 'date');
      date.setAttribute('aria-label', '拍摄日期');
      li.appendChild(date);
      var tools = make('div', 'al-tools');
      [['cover', '设为封面'], ['hide', p.hidden ? '显示' : '隐藏'], ['remove', '移除']].forEach(function (t) {
        var b = button('cm-link', t[1]);
        b.setAttribute('data-act', t[0]);
        b.setAttribute('data-i', i);
        tools.appendChild(b);
      });
      li.appendChild(tools);
      grid.appendChild(li);
    });
  }
  alForm.addEventListener('submit', function (e) { e.preventDefault(); });
  alForm.addEventListener('input', function (e) {
    if (!al) return;
    var n = e.target.name;
    if (n === 'title') {
      al.data.title = e.target.value;
      if (!alSlugTouched) { al.slug = slugFrom(e.target.value); alEl('slug').value = al.slug; }
    } else if (n === 'slug') {
      alSlugTouched = true;
      al.slug = e.target.value.trim();
    } else if (n === 'description') al.data.description = e.target.value;
    alBar();
  });
  alForm.addEventListener('change', function (e) {
    if (!al || e.target.name !== 'timeline') return;
    al.data.timeline = e.target.value;
    alDraw();
    alBar();
  });
  alBox.addEventListener('input', function (e) {
    if (!al) return;
    var day = e.target.getAttribute('data-day');
    if (day) al.data.days[day] = e.target.value;
    else if (e.target.getAttribute('data-k') === 'note') al.data.photos[Number(e.target.getAttribute('data-i'))].note = e.target.value;
    alBar();
  });
  alBox.addEventListener('change', function (e) {
    if (!al || e.target.getAttribute('data-k') !== 'date') return;
    al.data.photos[Number(e.target.getAttribute('data-i'))].date = e.target.value;
    alSort();
    alDraw();
    alBar();
  });
  alBox.addEventListener('click', function (e) {
    var act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (!act || !al) return;
    var i = Number(e.target.getAttribute('data-i')), p = al.data.photos[i];
    if (act === 'cover') al.data.cover = p.path;
    else if (act === 'hide') p.hidden = !p.hidden;
    else if (act === 'remove') {
      al.data.photos.splice(i, 1);
      if (al.data.cover === p.path) al.data.cover = '';
    }
    alDraw();
    alBar();
  });
  /* one at a time: each is decoded and saved again on the server */
  function alUpload(files) {
    /* an album holds photos: an SVG (a diagram) belongs in an article */
    var list = Array.prototype.filter.call(files, function (f) { return (/^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(f.name)) && !/svg/i.test(f.type || '') && !/\.svg$/i.test(f.name); });
    if (!list.length) { note('只能上传图片', 'error'); return; }
    if (alUploading || !al) return;
    alUploading = true;
    alBar();
    var failed = [], added = 0;
    (function next(i) {
      if (i >= list.length || !al) {
        alUploading = false;
        if (!al) return;
        alSort();
        alDraw();
        alBar();
        if (failed.length) note('上传了 ' + added + ' 张，' + failed.length + ' 张没成功', 'error', failed.join('\n'));
        else note('上传了 ' + added + ' 张。记得保存。', 'ok');
        return;
      }
      var file = list[i];
      note('正在上传 ' + (i + 1) + ' / ' + list.length + '：' + (file.name || '图片'), 'busy');
      var send = file.size > 25 * 1024 * 1024 ? Promise.reject(new Error('太大了（最多 25 MB）')) : call('upload', file, file.type || 'application/octet-stream');
      send.then(function (r) {
        if (!al) return;
        if (!al.data.photos.some(function (p) { return p.path === r.path; })) {
          al.data.photos.push({ path: r.path, note: '', alt: '', date: r.taken || '', hidden: false });
          added++;
        }
        if (added % 6 === 1) { alSort(); alDraw(); }
      }, function (err) {
        failed.push((file.name || '图片') + '：' + err.message);
      }).then(function () { next(i + 1); });
    })(0);
  }
  alFile.addEventListener('change', function () { alUpload(alFile.files); alFile.value = ''; });
  alDrop.addEventListener('dragover', function (e) { e.preventDefault(); alDrop.classList.add('is-over'); });
  alDrop.addEventListener('dragleave', function () { alDrop.classList.remove('is-over'); });
  alDrop.addEventListener('drop', function (e) {
    e.preventDefault();
    alDrop.classList.remove('is-over');
    if (e.dataTransfer && e.dataTransfer.files.length) alUpload(e.dataTransfer.files);
  });
  function alSave(draft, label) {
    if (!al || alUploading) return;
    if (!String(al.data.title || '').trim()) { note('图集要有个名字', 'error'); alEl('title').focus(); return; }
    if (!al.slug) { note('图集要有个网址', 'error'); alEl('slug').focus(); return; }
    alSaveBtn.disabled = alToggle.disabled = true;
    var was = al.draft;
    call('albums/save', { id: al.id, version: al.version, slug: al.slug, draft: draft, data: al.data }).then(function (r) {
      al.id = r.id;
      al.version = r.version;
      al.draft = draft;
      alSaved = alSnap();
      alSlugTouched = true;
      if (location.hash !== '#/album/' + r.id) location.hash = '#/album/' + r.id;
      alBar();
      if (!r.job) { note(label + '了', 'ok'); return null; }
      return follow(r.job, label).then(function (j) {
        var parts = [label + '了。'];
        if (!draft && me.site) parts.push(linkTo(String(me.site).replace(/\/+$/, '') + '/gallery/' + encodeURIComponent(al.slug) + '/', '在网站上看'));
        noteWith(parts, 'ok', j.log);
      });
    }).catch(function (err) {
      if (al) al.draft = was;
      note(err.message, 'error', err.log);
    }).then(alBar);
  }
  alSaveBtn.addEventListener('click', function () { if (al) alSave(al.draft, al.draft ? '保存' : '更新'); });
  alToggle.addEventListener('click', function () { if (al) alSave(!al.draft, al.draft ? '发布' : '撤下'); });
  alDelete.addEventListener('click', function () {
    if (!al || !armed(alDelete, '再点一次删除')) return;
    var id = al.id, title = al.data.title;
    call('albums/delete', { id: id }).then(function (r) {
      al = null;
      location.hash = '#/albums';
      if (!r.job) { note('已删除“' + title + '”', 'ok'); return null; }
      return follow(r.job, '删除图集').then(function (j) { note('已删除“' + title + '”，网站也更新了', 'ok', j.log); });
    }).catch(function (err) { note(err.message, 'error', err.log); });
  });
  $('[data-al-copy]').addEventListener('click', function () {
    var text = $('[data-al-code]').textContent;
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { note('已复制，粘贴到文章里单独一行', 'ok'); }, function () { note(text); });
    else note(text);
  });
  window.addEventListener('beforeunload', function (e) { if (albumDirty()) e.preventDefault(); });

  function openSite() {
    siteForm.textContent = '';
    call('site').then(function (d) {
      site = d.data || {};
      siteBase = d.base || 0;
      drawSite();
    }, function (err) { note(err.message, 'error'); });
  }
  var siteSave = $('[data-site-save]');
  siteSave.addEventListener('click', function () {
    if (!site) return;
    siteSave.disabled = true;
    call('site/save', { data: site, base: siteBase }).then(function (r) {
      siteBase = r.base || siteBase;
      return follow(r.job, '更新主页');
    }).then(function (j) {
      note('主页已更新', 'ok', j.log);
    }, function (err) { note(err.message, 'error', err.log); }).then(function () { siteSave.disabled = false; });
  });

  /* ================================================================ releases and backups */
  function buildTime(name) {
    var m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(name);
    return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] : name;
  }
  function openDeploys() {
    var bl = $('[data-builds]');
    bl.textContent = '';
    call('deploys').then(function (d) {
      $('[data-live]').textContent = d.live && d.live !== 'null' ? '网站现在是 ' + buildTime(d.live) + ' 构建的版本。' : '网站还没有发布过。';
      (d.builds || []).forEach(function (b) {
        var li = make('li', 'deploy-item' + (b.name === d.live ? ' is-live' : ''));
        var main = make('span', 'pi-main');
        main.appendChild(make('span', 'pi-title', b.label || '版本 ' + b.name));
        main.appendChild(make('span', 'pi-meta', buildTime(b.name) + '  ·  代码 ' + b.code));
        li.appendChild(main);
        if (b.name === d.live) li.appendChild(make('span', 'cm-badge is-approved', '当前'));
        else {
          var go = button('btn btn-ghost ad-btn', '切换到这个版本');
          go.setAttribute('data-build', b.name);
          li.appendChild(go);
        }
        bl.appendChild(li);
      });
    }, function (err) { note(err.message, 'error'); });
    drawBackups();
  }
  $('[data-builds]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-build]');
    if (!b || !armed(b, '确定切换？')) return;
    b.disabled = true;
    call('deploys/rollback', { build: b.getAttribute('data-build') }).then(function (r) {
      return follow(r.job, '切换版本');
    }).then(function () {
      note('网站已切换到这个版本', 'ok');
      openDeploys();
    }, function (err) { b.disabled = false; note(err.message, 'error', err.log); });
  });
  $('[data-publish-all]').addEventListener('click', function (e) {
    var b = e.currentTarget;
    b.disabled = true;
    call('publish-all', {}).then(function (r) { return follow(r.job, '重新发布全部'); }).then(function (j) {
      note('已重新发布', 'ok', j.log);
      openDeploys();
    }, function (err) { note(err.message, 'error', err.log); }).then(function () { b.disabled = false; });
  });
  var DAY = 864e5;
  /* the newest backup has to leave the server now and then: a reminder at the top after 30 days */
  function backupStale(b) {
    var latest = b.dumps && b.dumps[0];
    if (!b.enabled || !latest) return false;
    var off = b.offsite && Date.now() - b.offsite < 3 * DAY;
    return !off && (!b.downloaded || Date.now() - b.downloaded > 30 * DAY);
  }
  function backupHint() {
    call('backups').then(function (b) {
      var stale = backupStale(b);
      $('[data-backup-dot]').hidden = !(stale || !b.enabled);
      if (stale && me.ready !== false) banner(b.downloaded ? '已经 ' + Math.floor((Date.now() - b.downloaded) / DAY) + ' 天没把备份下载到服务器以外的地方了。' : '备份还从没下载到服务器以外的地方。', ['去下载', '#/deploys']);
    }, function () {});
  }
  function drawBackups() {
    var box = $('[data-backup]');
    box.textContent = '';
    call('backups').then(function (b) {
      var latest = b.dumps && b.dumps[0];
      var p = function (text, cls) { box.appendChild(make('p', 'bk-line' + (cls ? ' ' + cls : ''), text)); };
      if (!b.enabled) {
        p('还没有开启自动备份。在服务器上按 README「备份」装好 blog-backup.timer（几条命令），每天凌晨会自动备份数据库和图片。', 'is-warn');
      } else if (!latest) {
        p('自动备份已经开启，还没有运行过（每天凌晨运行一次）。', 'is-warn');
      } else {
        var old = Date.now() - latest.at > 2 * DAY;
        p('最近一次自动备份：' + stamp(latest.at) + '（' + size(latest.size) + '，服务器上保留 ' + b.dumps.length + ' 份）' + (old ? '。已经两天多没有新的备份了：在服务器上看看  systemctl status blog-backup.timer' : ''), old ? 'is-warn' : '');
      }
      p('上传的图片：' + b.mediaFiles + ' 张，' + size(b.mediaBytes || 0));
      p(b.offsite ? '上次自动传到服务器以外：' + stamp(b.offsite) : '没有设置自动传到服务器以外（可以在 /etc/blog/backup.conf 里配置 rclone，见 README）。');
      p(b.downloaded ? '上次下载到本地：' + stamp(b.downloaded) + '（' + ago(b.downloaded) + '）' : '还没有下载过到本地。', backupStale(b) ? 'is-warn' : '');
      var row = make('div', 'bk-actions');
      if (latest) {
        var a = make('a', 'btn btn-primary ad-btn', '下载最新备份（数据库 + 图片）');
        a.href = API + 'backups/download?name=' + encodeURIComponent(latest.name);
        a.setAttribute('download', '');
        a.addEventListener('click', function () { setTimeout(function () { drawBackups(); backupHint(); }, 4000); });
        row.appendChild(a);
      }
      var ex = make('a', 'btn btn-ghost ad-btn', '导出全部文章（Markdown）');
      ex.href = API + 'export';
      ex.setAttribute('download', '');
      row.appendChild(ex);
      box.appendChild(row);
    }, function (err) { note(err.message, 'error'); });
  }

  /* ================================================================ security: the decoy sign-in pages */
  function openSecurity() {
    var hits = $('[data-sec-hits]'), stats = $('[data-sec-stats]');
    hits.textContent = '';
    stats.textContent = '';
    call('security').then(function (d) {
      stats.appendChild(make('p', 'sec-stat', '过去 24 小时：假后台被打开 ' + d.day + ' 次，其中 ' + d.logins + ' 次尝试登录。一共记了 ' + d.total + ' 条（保留 90 天）。'));
      stats.appendChild(make('p', 'sec-stat is-dim', '你现在的地址是 ' + d.you + '。'));
      (d.hits || []).forEach(function (h) {
        var li = make('li', 'sec-item');
        var main = make('span', 'pi-main');
        var top = make('span', 'pi-title');
        top.appendChild(make('span', 'num', h.ip));
        top.appendChild(make('span', 'sec-path', h.path));
        main.appendChild(top);
        var meta = [stamp(h.at), device(h.agent)];
        if (h.user) meta.push('用户名 ' + h.user);
        var m = make('span', 'pi-meta', meta.join('  ·  '));
        if (h.agent) m.title = h.agent;
        main.appendChild(m);
        li.appendChild(main);
        li.appendChild(make('span', 'cm-badge ' + (h.kind === 'login' ? 'is-error' : ''), h.kind === 'login' ? '尝试登录' : '打开'));
        hits.appendChild(li);
      });
      if (!hits.children.length) hits.appendChild(make('li', 'sec-none', '还没有人来过。'));
    }, function (err) { note(err.message, 'error'); });
  }
  $('[data-sec-clear]').addEventListener('click', function (e) {
    if (!armed(e.currentTarget, '确定清空？')) return;
    call('security/clear', {}).then(function () { note('记录已清空', 'ok'); openSecurity(); }, function (err) { note(err.message, 'error'); });
  });

  /* ================================================================ start */
  call('me').then(start, function (err) {
    if (err.status === 401) showLogin();
    else {
      show('offline');
      $('[data-view="offline"]').textContent = err.status === 0 || err.status === 404 || err.status === 502 || err.status === 503
        ? '连不上后台服务。在服务器上用  systemctl status blog-admin  看看它是否在运行（本地预览没有后台服务）。'
        : err.message;
    }
  });
})();
