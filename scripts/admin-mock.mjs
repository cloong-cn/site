// A stand-in for the admin service (server/, Java + PostgreSQL), for looking at and working on the admin page on your
// own computer:  npm run dev:admin  → http://localhost:4321/_admin/
// It answers the same addresses with the same kind of answers (server/src/blog/server/Admin.java lists them), from
// sample data: the articles in content/blog/, content/site.json, the sample album, and made-up comments, releases,
// backups and decoy-page visits. Everything you change lives in memory only: nothing is written to your files, nothing
// is built or published, and restarting the dev server starts over. Any password and code sign in.
import { readFile, readdir, mkdir, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const DAY = 864e5;

/* ------------------------------------------------------------------ the articles in content/blog */

function frontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, extra: [], body: src };
  const data = {}, extra = [];
  const KNOWN = new Set(['title', 'date', 'tags', 'description', 'cover', 'comments', 'draft', 'aliases']);
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (!KNOWN.has(key)) { if (raw.trim()) extra.push(line.trim()); continue; }
    const v = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    data[key] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2')).filter(Boolean)
      : v === 'true' ? true : v === 'false' ? false : v;
  }
  return { data, extra, body: src.slice(m[0].length).replace(/^\s+/, '') };
}

const words = (text) => {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  return cjk + (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
};

export async function createAdminMock({ root }) {
  const now = Date.now();
  const media = path.join(os.tmpdir(), 'blog-admin-demo', 'media'); /* pictures uploaded while trying it out */
  const galleryDir = path.join(root, 'content/gallery/sample');

  /* ---------- articles: the working copy, the published copy, and their versions */
  const posts = [];
  const revisions = [];
  let nextRev = 1;
  const files = existsSync(path.join(root, 'content/blog')) ? (await readdir(path.join(root, 'content/blog'))).filter((f) => f.endsWith('.md')).sort() : [];
  for (const [i, f] of files.entries()) {
    const { data, extra, body } = frontmatter(await readFile(path.join(root, 'content/blog', f), 'utf8'));
    const p = {
      id: i + 1, version: 1,
      post: {
        slug: f.replace(/\.md$/, ''), title: data.title || f, date: data.date || new Date().toISOString().slice(0, 10),
        tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [], description: data.description || '',
        cover: data.cover || '', comments: data.comments !== false, body, extra,
      },
      aliases: Array.isArray(data.aliases) ? data.aliases : [],
      updated: now - (i + 1) * 3.7 * 3600e3, deleted: null, live: null, firstPublished: null, publishAt: null,
    };
    if (data.draft !== true) { p.live = structuredClone(p.post); p.firstPublished = Date.parse(p.post.date) || now - 30 * DAY; }
    posts.push(p);
    /* a couple of earlier versions, so 历史版本 has something to show */
    const older = structuredClone(p.post);
    older.body = older.body.split('\n').slice(0, Math.max(8, Math.floor(older.body.split('\n').length * 0.6))).join('\n');
    revisions.push({ id: nextRev++, postId: p.id, kind: 'save', at: p.updated - 2 * DAY, post: older });
    revisions.push({ id: nextRev++, postId: p.id, kind: p.live ? 'publish' : 'save', at: p.updated, post: structuredClone(p.post) });
  }
  /* one article already in the trash */
  if (posts.length) {
    const t = structuredClone(posts[posts.length - 1]);
    Object.assign(t, { id: posts.length + 1, live: null, deleted: now - 3 * DAY, updated: now - 4 * DAY });
    Object.assign(t.post, { slug: 'old-notes', title: '一篇删掉的旧笔记', tags: ['草稿'], body: '这篇在回收站里，30 天内可以恢复。' });
    posts.push(t);
  }
  const state = (p) => (!p.live ? 'draft' : JSON.stringify(p.live) !== JSON.stringify(p.post) ? 'changed' : 'published');
  const listItem = (p) => ({
    id: p.id, slug: p.post.slug, title: p.post.title, date: p.post.date, tags: p.post.tags, words: words(p.post.body),
    state: state(p), updated: p.updated, publishAt: p.publishAt, ...(p.deleted ? { deleted: p.deleted } : {}),
  });
  const byId = (id) => posts.find((p) => p.id === Number(id));

  /* ---------- the home page */
  let site = { data: JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8')), base: 0 };

  /* ---------- the sample album: its photos are shown from content/gallery/sample through files/media/demo/… */
  const albums = [];
  if (existsSync(path.join(galleryDir, 'album.json'))) {
    const a = JSON.parse(await readFile(path.join(galleryDir, 'album.json'), 'utf8'));
    const photos = Object.entries(a.photos || {}).map(([name, p]) => ({ path: `/media/demo/${name}`, note: p.note || '', alt: p.alt || '', date: p.date || '', hidden: !!p.hidden }));
    albums.push({ id: 1, slug: 'sample', draft: a.draft !== false, version: 1, updated: now - 5 * DAY, data: { title: a.title || '示例图集', description: a.description || '', timeline: a.timeline || 'day', cover: '', days: a.days || {}, photos } });
  }

  /* ---------- comments */
  const slugs = posts.filter((p) => p.live).map((p) => p.post.slug);
  const s = (i) => slugs[i % Math.max(1, slugs.length)] || 'hello';
  let nextComment = 9;
  const comments = [
    { id: 8, post: s(0), parent: null, name: '路过的读者', email: 'reader@example.com', url: null, content: '这套构建流程很有意思，想问一下字体裁剪大概要多久？', status: 'pending', owner: false, at: now - 40 * 60e3 },
    { id: 7, post: s(1), parent: null, name: 'Mia', email: '', url: 'https://example.com', content: '代码块的配色好舒服 👍', status: 'pending', owner: false, at: now - 3 * 3600e3 },
    { id: 6, post: s(0), parent: null, name: 'cheap-pills-online', email: 'spam@example.net', url: 'https://spam.example.net', content: 'Great post! Visit my site for the best deals …', status: 'pending', owner: false, at: now - 9 * 3600e3 },
    { id: 5, post: s(2), parent: 4, name: site.data.name, email: '', url: null, content: '谢谢！后面我单独写一篇。', status: 'approved', owner: true, at: now - 2 * DAY },
    { id: 4, post: s(2), parent: null, name: '林间', email: 'lin@example.com', url: null, content: '写得很清楚，正好在找 Java 21 虚拟线程的实际用法。\n想问一下：连接池满的时候怎么排查？', status: 'approved', owner: false, at: now - 3 * DAY },
    { id: 3, post: s(1), parent: null, name: 'K', email: '', url: null, content: '> 文章里那句「能自己掌控的部分尽量自己写」\n\n同意，依赖少了心里踏实。', status: 'approved', owner: false, at: now - 6 * DAY },
  ].map((c) => ({ ...c, ip: createHash('sha256').update(String(c.id)).digest('hex').slice(0, 12), agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' }));

  /* ---------- releases, backups, the decoy pages */
  const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 8) + '-' + new Date(t).toISOString().slice(11, 19).replace(/:/g, '');
  const builds = [0, 1, 3, 6, 9].map((d, i) => {
    const t = now - d * DAY - i * 3600e3;
    return { name: `${stamp(t)}-${['k3v9', 'a8x2', 'm4q1', 'p7z0', 'c2w5'][i]}`, label: ['发布：' + (posts[0]?.post.title || ''), '更新主页', '发布：' + (posts[1]?.post.title || ''), '重新发布全部', '发布：' + (posts[2]?.post.title || '')][i] };
  }).map((b) => ({ ...b, code: b.name.slice(16) }));
  let live = builds[0].name;
  const backups = {
    enabled: true,
    dumps: [0, 1, 2].map((d) => ({ name: `blog-${stamp(now - d * DAY).slice(0, 8)}-030000.dump`, size: 812345 - d * 4096, at: now - d * DAY })),
    mediaFiles: 37, mediaBytes: 48_500_000, offsite: now - DAY, downloaded: now - 12 * DAY,
  };
  let hits = [
    ['/wp-login.php', 'login', 'admin'], ['/admin/', 'visit', null], ['/wp-admin/', 'visit', null], ['/login', 'login', 'root'],
    ['/phpmyadmin/', 'visit', null], ['/administrator/', 'visit', null], ['/wp-login.php', 'login', 'test'], ['/dashboard', 'visit', null],
  ].map(([p, kind, user], i) => ({ id: 20 - i, ip: `203.0.113.${40 + i * 7}`, kind, path: p, agent: i % 2 ? 'python-requests/2.32' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', user, at: now - i * 5.5 * 3600e3 }));

  /* ---------- background jobs: a few lines of progress, then done */
  const jobs = new Map();
  let nextJob = 1;
  function job(label, lines, finish) {
    const j = { id: 'demo' + nextJob++, label, state: 'queued', error: null, code: null, created: Date.now(), ended: null, log: '', result: {} };
    jobs.set(j.id, j);
    const all = ['（本地预览：不会真的构建或上线）', ...lines];
    let k = 0;
    const tick = () => {
      j.state = 'running';
      if (k < all.length) { j.log += all[k++] + '\n'; setTimeout(tick, 350); return; }
      try {
        const out = finish ? finish(j) : null;
        if (out && out.error) { j.state = 'failed'; j.error = out.error; } else j.state = 'done';
      } catch (e) { j.state = 'failed'; j.error = String(e.message || e); }
      j.ended = Date.now();
    };
    setTimeout(tick, 250);
    return j;
  }
  const BUILD_LINES = ['构建网站', '处理图片和字体', '检查链接', '切换到新版本'];
  function release(j, label) {
    const name = `${stamp(Date.now())}-${Math.random().toString(36).slice(2, 6)}`;
    builds.unshift({ name, code: name.slice(16), label });
    builds.splice(5);
    live = name;
    j.result.live = name;
    j.log += '已上线\n';
  }

  /* publishing an article: by the button (as the editor showed it) or by the clock (定时发布: whatever is saved) */
  function publishJob(p, label) {
    return job(label, BUILD_LINES, (jj) => {
      if (p.deleted) return { error: '这篇文章在回收站里' };
      if (p.live && p.live.slug !== p.post.slug) p.aliases = [...new Set([...p.aliases, p.live.slug])];
      p.live = structuredClone(p.post);
      p.firstPublished = p.firstPublished || Date.now();
      p.publishAt = null;
      revisions.push({ id: nextRev++, postId: p.id, kind: 'publish', at: Date.now(), post: structuredClone(p.post) });
      release(jj, label);
      jj.result.url = 'http://localhost:4321/blog/' + p.post.slug + '/';
    });
  }
  /* the clock: what the real service does every minute, here every ten seconds */
  setInterval(() => {
    for (const p of posts) {
      if (!p.publishAt || p.deleted || p.publishAt > Date.now()) continue;
      p.publishAt = null;
      publishJob(p, '定时发布：' + p.post.title);
    }
  }, 10_000).unref();

  /* ---------- the picture library: what was uploaded here, and the sample album's photos */
  const removedDemo = new Set();
  const thumbs = new Map();
  async function library() {
    const out = [];
    const add = async (file, p) => { try { const st = await stat(file); out.push({ path: p, size: st.size, at: st.mtimeMs }); } catch { /* gone */ } };
    if (existsSync(media)) {
      for (const year of await readdir(media)) {
        if (!/^\d{4}$/.test(year)) continue;
        for (const name of await readdir(path.join(media, year))) await add(path.join(media, year, name), '/media/' + year + '/' + name);
      }
    }
    if (existsSync(galleryDir)) {
      for (const name of await readdir(galleryDir)) if (/\.(jpe?g|png|webp)$/i.test(name) && !removedDemo.has(name)) await add(path.join(galleryDir, name), '/media/demo/' + name);
    }
    /* where each one is shown now; and everything that ever had it (versions too) */
    const users = new Map(), ever = new Set();
    const seen = (text, who) => {
      for (const m of String(text).match(/\/media\/[\w./-]+?\.(?:jpe?g|png|webp|gif|svg)/g) || []) {
        ever.add(m);
        if (!who) continue;
        const l = users.get(m) || users.set(m, []).get(m);
        if (!l.includes(who)) l.push(who);
      }
    };
    for (const p of posts) {
      seen(p.post.body + ' ' + p.post.cover, '《' + p.post.title + '》' + (p.deleted ? '（回收站里）' : ''));
      if (p.live) seen(p.live.body + ' ' + p.live.cover, '《' + p.post.title + '》');
    }
    for (const a of albums) seen(JSON.stringify(a.data), '图集「' + a.data.title + '」');
    seen(JSON.stringify(site.data), '主页');
    for (const r of revisions) seen(r.post.body + ' ' + r.post.cover, null);
    return out.map((x) => ({ ...x, usedBy: users.get(x.path) || [], history: !users.get(x.path) && ever.has(x.path) })).sort((a, b) => b.at - a.at);
  }

  /* ------------------------------------------------------------------ answering */

  let signedIn = true;
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const fail = (res, status, code, message) => send(res, status, { error: code, message });
  const body = (req) => new Promise((ok) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => ok(Buffer.concat(parts))); });
  const json = async (req) => { try { return JSON.parse((await body(req)).toString() || '{}'); } catch { return {}; } };
  const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml' };

  return async function handle(req, res, route, query) {
    const q = new URLSearchParams(query || '');
    const method = req.method;
    if (route === 'login') { await json(req); signedIn = true; send(res, 200, { ok: true, name: site.data.name }); return; }
    if (!signedIn) { fail(res, 401, 'auth', '请先登录'); return; }

    if (route.startsWith('files/thumb/media/')) {
      const rel = route.slice('files/thumb/media/'.length);
      const file = rel.startsWith('demo/') ? path.join(galleryDir, path.basename(rel)) : path.join(media, rel);
      const base = rel.startsWith('demo/') ? galleryDir : media;
      if (!path.resolve(file).startsWith(path.resolve(base)) || !existsSync(file)) { fail(res, 404, 'not_found', '没有这张图片'); return; }
      let out = thumbs.get(file), type = 'image/webp';
      if (!out && /\.(svg|gif)$/i.test(file)) { out = await readFile(file); type = TYPES[path.extname(file).toLowerCase()]; }
      else if (!out) {
        try { out = await (await import('sharp')).default(file).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(); thumbs.set(file, out); }
        catch { out = await readFile(file); type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'; }
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=300' });
      res.end(out);
      return;
    }
    if (route.startsWith('files/')) {
      const rel = route.slice('files/'.length);
      let file = null;
      if (rel.startsWith('media/demo/')) file = path.join(galleryDir, path.basename(rel));
      else if (rel.startsWith('media/')) file = path.join(media, rel.slice('media/'.length));
      else if (rel.startsWith('images/')) file = path.join(root, 'src/public', rel);
      const base = rel.startsWith('media/demo/') ? galleryDir : rel.startsWith('media/') ? media : path.join(root, 'src/public');
      if (!file || !path.resolve(file).startsWith(path.resolve(base)) || !existsSync(file)) { fail(res, 404, 'not_found', '没有这个文件'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      res.end(await readFile(file));
      return;
    }
    if (route.startsWith('jobs/')) {
      const j = jobs.get(route.slice(5));
      if (!j) { fail(res, 404, 'not_found', '没有这个任务（后台服务可能刚重启过）'); return; }
      send(res, 200, j);
      return;
    }

    switch (route) {
      case 'logout': signedIn = false; send(res, 200, { ok: true }); return;
      case 'me': send(res, 200, { name: site.data.name, site: 'http://localhost:4321', ip: '127.0.0.1', ready: true }); return;

      case 'posts': send(res, 200, { posts: posts.filter((p) => (q.get('trash') === '1') === !!p.deleted).sort((a, b) => b.updated - a.updated).map(listItem) }); return;
      case 'posts/get': {
        const p = byId(q.get('id'));
        if (!p) { fail(res, 404, 'not_found', '没有这篇文章'); return; }
        send(res, 200, { ...structuredClone(p.post), id: p.id, version: p.version, state: state(p), liveSlug: p.live ? p.live.slug : null, aliases: p.aliases, updated: p.updated, firstPublished: p.firstPublished, publishAt: p.publishAt, ...(p.deleted ? { deleted: p.deleted } : {}) });
        return;
      }
      case 'posts/save': {
        const d = await json(req);
        const id = Number(d.id) || 0;
        const slug = String(d.slug || '').trim();
        if (!slug) { fail(res, 400, 'slug', '网址不能空着'); return; }
        if (posts.some((p) => p.post.slug === slug && p.id !== id && !p.deleted)) { fail(res, 409, 'slug_taken', `已经有一篇文章用了这个网址（/blog/${slug}/），换一个`); return; }
        let p = id ? byId(id) : null;
        if (id && !p) { fail(res, 404, 'not_found', '没有这篇文章'); return; }
        if (p && Number(d.version) !== p.version && !d.force) { fail(res, 409, 'changed', '这篇文章在别的窗口或设备上保存过了'); return; }
        const post = { slug, title: String(d.title || ''), date: String(d.date || ''), tags: Array.isArray(d.tags) ? d.tags : [], description: String(d.description || ''), cover: String(d.cover || ''), comments: d.comments !== false, body: String(d.body || ''), extra: Array.isArray(d.extra) ? d.extra : [] };
        if (!p) { p = { id: Math.max(0, ...posts.map((x) => x.id)) + 1, version: 0, post, aliases: [], updated: 0, deleted: null, live: null, firstPublished: null, publishAt: null }; posts.push(p); }
        p.post = post;
        p.version++;
        p.updated = Date.now();
        revisions.push({ id: nextRev++, postId: p.id, kind: 'save', at: p.updated, post: structuredClone(post) });
        send(res, 200, { id: p.id, version: p.version, updated: p.updated });
        return;
      }
      case 'posts/publish': {
        const d = await json(req), p = byId(d.id);
        if (!p) { fail(res, 404, 'not_found', '没有这篇文章'); return; }
        if (Number(d.version) !== p.version) { fail(res, 409, 'changed', '这篇文章在别的窗口或设备上保存过了，刷新后再发布'); return; }
        send(res, 202, { job: publishJob(p, '发布：' + p.post.title).id });
        return;
      }
      case 'posts/schedule': {
        const d = await json(req), p = byId(d.id), at = Number(d.at) || 0;
        if (!p || p.deleted) { fail(res, 409, 'trashed', '这篇文章在回收站里'); return; }
        if (!at) { p.publishAt = null; send(res, 200, { ok: true }); return; }
        if (at < Date.now() + 60e3) { fail(res, 400, 'at', '定时发布的时间要在一分钟以后'); return; }
        if (at > Date.now() + 366 * DAY) { fail(res, 400, 'at', '定时发布最多定在一年以内'); return; }
        p.publishAt = at;
        send(res, 200, { ok: true, publishAt: at });
        return;
      }
      case 'posts/unpublish': {
        const p = byId((await json(req)).id);
        if (!p || !p.live) { fail(res, 409, 'not_published', '这篇文章没有发布'); return; }
        send(res, 202, { job: job('撤下：' + p.post.title, BUILD_LINES, (jj) => { p.live = null; p.publishAt = null; release(jj, '撤下：' + p.post.title); jj.log += '已从网站上撤下，文章还在，成了草稿\n'; }).id });
        return;
      }
      case 'posts/trash': {
        const p = byId((await json(req)).id);
        if (!p || p.deleted) { fail(res, 409, 'trashed', '已经在回收站里了'); return; }
        p.publishAt = null;
        if (!p.live) { p.deleted = Date.now(); send(res, 200, { ok: true }); return; }
        send(res, 202, { job: job('删除：' + p.post.title, BUILD_LINES, (jj) => { p.live = null; p.deleted = Date.now(); release(jj, '删除：' + p.post.title); }).id });
        return;
      }
      case 'posts/restore': { const p = byId((await json(req)).id); if (p) p.deleted = null; send(res, 200, { ok: true }); return; }
      case 'posts/purge': {
        const id = Number((await json(req)).id), i = posts.findIndex((p) => p.id === id && p.deleted);
        if (i < 0) { fail(res, 404, 'not_found', '回收站里没有这篇文章'); return; }
        posts.splice(i, 1);
        send(res, 200, { ok: true });
        return;
      }
      case 'posts/revisions': {
        const p = byId(q.get('id'));
        const list = revisions.filter((r) => r.postId === Number(q.get('id'))).sort((a, b) => b.at - a.at);
        send(res, 200, { revisions: list.map((r) => ({ id: r.id, kind: r.kind, title: r.post.title, slug: r.post.slug, words: words(r.post.body), at: r.at, live: !!(p && p.live && JSON.stringify(p.live) === JSON.stringify(r.post)) })) });
        return;
      }
      case 'posts/revision': {
        const r = revisions.find((x) => x.id === Number(q.get('id')));
        if (!r) { fail(res, 404, 'not_found', '没有这个版本'); return; }
        send(res, 200, { ...structuredClone(r.post), id: r.id, post: r.postId, kind: r.kind, at: r.at });
        return;
      }

      case 'upload': {
        const data = await body(req);
        if (!data.length) { fail(res, 400, 'empty', '文件是空的'); return; }
        const head = data.subarray(0, 4096).toString('utf8');
        const ext = data[0] === 0xff && data[1] === 0xd8 ? 'jpg' : data[0] === 0x89 && data[1] === 0x50 ? 'png' : data.subarray(0, 4).toString() === 'GIF8' ? 'gif'
          : data.subarray(8, 12).toString() === 'WEBP' ? 'webp' : /<svg[\s>]/.test(head) ? 'svg' : null;
        if (!ext) { fail(res, 415, 'not_image', '只能上传 JPG、PNG、WebP、GIF、AVIF 或 SVG 图片'); return; }
        const rel = `${new Date().getFullYear()}/${createHash('sha256').update(data).digest('hex').slice(0, 16)}.${ext}`;
        await mkdir(path.dirname(path.join(media, rel)), { recursive: true });
        await writeFile(path.join(media, rel), data);
        let width = 0, height = 0;
        try { const sharp = (await import('sharp')).default; const m = await sharp(data).metadata(); width = m.width || 0; height = m.height || 0; } catch { /* no sharp: no size */ }
        send(res, 200, { path: '/media/' + rel, width, height });
        return;
      }
      case 'media': send(res, 200, { files: await library() }); return;
      case 'media/delete': {
        const p = String((await json(req)).path || '');
        const item = (await library()).find((x) => x.path === p);
        if (!item) { fail(res, 404, 'not_found', '没有这张图片'); return; }
        if (item.usedBy.length || item.history) { fail(res, 409, 'in_use', '这张图片还有地方在用（文章、历史版本、图集或主页），不能删除'); return; }
        if (p.startsWith('/media/demo/')) removedDemo.add(path.basename(p)); /* a sample photo: only hidden, the file stays */
        else await unlink(path.join(media, p.slice('/media/'.length)));
        send(res, 200, { ok: true });
        return;
      }
      case 'import': {
        await body(req);
        send(res, 202, { job: job('导入：' + (q.get('name') || '文件'), ['读取文件'], () => ({ error: '本地预览不能导入：导入要用真正的后台服务（文章存进数据库）' })).id });
        return;
      }
      case 'export': case 'backups/download':
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="local-preview.txt"` });
        res.end('本地预览不能导出：导出和下载备份要用真正的后台服务。\n');
        return;

      case 'site': send(res, 200, structuredClone(site)); return;
      case 'site/save': {
        const d = await json(req);
        site = { data: d.data || site.data, base: (Number(site.base) || 0) + 1 };
        send(res, 202, { job: job('更新主页', BUILD_LINES, (jj) => release(jj, '更新主页')).id, base: site.base });
        return;
      }
      case 'site/revisions': send(res, 200, { revisions: [] }); return;

      case 'albums': send(res, 200, { albums: albums.map((a) => ({ id: a.id, slug: a.slug, draft: a.draft, version: a.version, title: a.data.title, photos: a.data.photos.length, cover: a.data.cover || a.data.photos[0]?.path || null, updated: a.updated })) }); return;
      case 'albums/get': {
        const a = albums.find((x) => x.id === Number(q.get('id')));
        if (!a) { fail(res, 404, 'not_found', '没有这个图集'); return; }
        send(res, 200, { id: a.id, slug: a.slug, draft: a.draft, version: a.version, data: structuredClone(a.data) });
        return;
      }
      case 'albums/save': {
        const d = await json(req);
        let a = albums.find((x) => x.id === Number(d.id));
        const wasLive = a ? !a.draft : false;
        if (!a) { a = { id: Math.max(0, ...albums.map((x) => x.id)) + 1, version: 0 }; albums.push(a); }
        Object.assign(a, { slug: String(d.slug || ''), draft: d.draft !== false, data: d.data, version: a.version + 1, updated: Date.now() });
        if (a.draft && !wasLive) { send(res, 200, { id: a.id, version: a.version }); return; }
        send(res, 202, { id: a.id, version: a.version, job: job('更新图集：' + (d.data?.title || ''), BUILD_LINES, (jj) => release(jj, '更新图集')).id });
        return;
      }
      case 'albums/delete': {
        const id = Number((await json(req)).id), i = albums.findIndex((a) => a.id === id);
        const wasLive = i >= 0 && !albums[i].draft;
        if (i >= 0) albums.splice(i, 1);
        if (!wasLive) { send(res, 200, { ok: true }); return; }
        send(res, 202, { job: job('删除图集', BUILD_LINES, (jj) => release(jj, '删除图集')).id });
        return;
      }

      case 'comments/summary': send(res, 200, { pending: comments.filter((c) => c.status === 'pending').length }); return;
      case 'comments/list': {
        const status = ['approved', 'all'].includes(q.get('status')) ? q.get('status') : 'pending';
        const before = Number(q.get('before')) || 0;
        const list = comments.filter((c) => (status === 'all' || c.status === status) && (!before || c.id < before)).sort((a, b) => b.id - a.id).slice(0, 50);
        send(res, 200, { comments: list.map((c) => ({ ...c, parentName: c.parent ? comments.find((p) => p.id === c.parent)?.name || null : null })) });
        return;
      }
      case 'comments/approve': {
        const id = Number((await json(req)).id);
        const c = comments.find((x) => x.id === id && x.status === 'pending');
        if (!c) { fail(res, 404, 'not_found', '这条评论不存在或已经通过'); return; }
        c.status = 'approved';
        send(res, 200, { ok: true });
        return;
      }
      case 'comments/delete': {
        const id = Number((await json(req)).id);
        const i = comments.findIndex((x) => x.id === id);
        if (i < 0) { fail(res, 404, 'not_found', '这条评论不存在'); return; }
        comments.splice(i, 1);
        send(res, 200, { ok: true });
        return;
      }
      case 'comments/reply': {
        const d = await json(req), c = comments.find((x) => x.id === Number(d.id));
        if (!c) { fail(res, 404, 'not_found', '这条评论不存在'); return; }
        if (!String(d.content || '').trim()) { fail(res, 400, 'content', '请填写回复内容'); return; }
        c.status = 'approved';
        const id = nextComment++;
        comments.push({ id, post: c.post, parent: c.parent || c.id, name: site.data.name, email: '', url: null, content: String(d.content).trim(), status: 'approved', owner: true, at: Date.now(), ip: '', agent: '' });
        send(res, 200, { ok: true, id });
        return;
      }

      case 'deploys': send(res, 200, { live, builds }); return;
      case 'deploys/rollback': {
        const name = String((await json(req)).build || '');
        if (!builds.some((b) => b.name === name)) { fail(res, 400, 'build', '版本名不对'); return; }
        send(res, 202, { job: job('切换到版本 ' + name, ['切换'], (jj) => { live = name; jj.result.live = name; jj.log += '网站已切换到 ' + name + '\n'; }).id });
        return;
      }
      case 'publish-all': send(res, 202, { job: job('重新发布全部', BUILD_LINES, (jj) => release(jj, '重新发布全部')).id }); return;
      case 'backups': send(res, 200, structuredClone(backups)); return;

      case 'security': {
        const dayAgo = Date.now() - DAY;
        send(res, 200, { hits, day: hits.filter((h) => h.at > dayAgo).length, logins: hits.filter((h) => h.kind === 'login' && h.at > dayAgo).length, total: hits.length, you: '127.0.0.1' });
        return;
      }
      case 'security/clear': hits = []; send(res, 200, { ok: true }); return;

      default: fail(res, 404, 'not_found', `没有这个地址（${method} ${route}）`);
    }
  };
}
