// The albums come from two places, and show the same:
//
// 1. Made in the back office: the admin service keeps them in the database and, for each build, writes the published
//    ones into albums.json in the content folder (Albums.java). Their photos are uploads, in /media/.
//
// 2. Kept with the code: content/gallery/<name>/ holds the photos and, optionally, an album.json (see README, 图集).
//
//      { "title": "台北的春天", "description": "…", "cover": "a.jpg", "draft": false, "timeline": "day",
//        "days": { "2026-03-14": "第一天，阳明山" },
//        "photos": { "a.jpg": { "note": "山顶的风很大", "date": "2026-03-14", "alt": "…", "hidden": false } } }
//
//    Every photo in the folder counts, listed or not: it is enough to drop one in. This folder is read from the code
//    whatever CONTENT_DIR says, since what the server writes there comes from the database.
//
// A photo's date is the one written down, else the one the camera recorded, else one in its file name; photos without
// any come last. "timeline": "month" shows only the month, for an album that should not say which day you were where.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PHOTO = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const pad = (n) => String(n).padStart(2, '0');

/* '2026-03-14' or the camera's '2026:03:14 09:30:00' → a sortable '2026-03-14 09:30:00', or null */
function normal(v) {
  const m = /^(\d{4})[-:/.](\d{1,2})[-:/.](\d{1,2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(String(v || ''));
  if (!m) return null;
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${pad(mo)}-${pad(d)} ${m[4] || '00:00:00'}`;
}
const fromName = (file) => {
  const m = /(?:^|\D)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:\D|$)/.exec(file);
  return m ? normal(`${m[1]}-${m[2]}-${m[3]}`) : null;
};
function dayLabel(key, month) {
  const [y, m, d] = key.split('-');
  return month ? `${y} 年 ${Number(m)} 月` : `${Number(m)} 月 ${Number(d)} 日`;
}
function range(from, to) {
  if (!from) return '';
  const [y1, m1] = from.split('-'), [y2, m2] = to.split('-');
  const a = `${y1} 年 ${Number(m1)} 月`;
  if (y1 === y2 && m1 === m2) return a;
  return y1 === y2 ? `${a} – ${Number(m2)} 月` : `${a} – ${y2} 年 ${Number(m2)} 月`;
}

/* from either source: entries are { name, src, note, alt, date, hidden }, and cover is the name of one */
async function assemble({ slug, meta, entries, media, warn }) {
  const month = meta.timeline === 'month';
  const photos = [];
  for (const e of entries) {
    if (e.hidden === true) continue;
    const img = await media.image(e.src);
    /* no copy to show means nothing is shown: a photo is never published as it came from the camera */
    if (!img) { warn(`图集 ${slug}：${e.name} 处理不了（找不到文件、是动图，或者没有安装 sharp），没有发布`); continue; }
    if (img.gps) warn(`图集 ${slug}：${e.name} 的原图里有拍摄地点（GPS）。网页上发布的是去掉之后的版本，但原图不要提交到公开的仓库；用 npm run album 导入就不会有这个问题`);
    if (e.date && !normal(e.date)) warn(`图集 ${slug}：${e.name} 的日期 ${e.date} 看不懂（要写成 2026-03-14）`);
    photos.push({ file: e.name, src: e.src, img, note: String(e.note || ''), alt: String(e.alt || e.note || ''), when: normal(e.date) || normal(img.taken) || fromName(e.name) });
  }
  if (!photos.length) { warn(`图集 ${slug}：里面没有可以显示的照片`); return null; }
  photos.sort((a, b) => (a.when ? 0 : 1) - (b.when ? 0 : 1) || String(a.when).localeCompare(String(b.when)) || a.file.localeCompare(b.file));

  const groups = [];
  for (const p of photos) {
    const key = p.when ? (month ? p.when.slice(0, 7) : p.when.slice(0, 10)) : '';
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, year: key.slice(0, 4), label: key ? dayLabel(key, month) : '没有日期', note: String((meta.days || {})[key] || ''), photos: [] };
      groups.push(g);
    }
    g.photos.push(p);
  }
  const dated = photos.filter((p) => p.when);
  let cover = meta.cover ? photos.find((p) => p.file === meta.cover) : photos[0];
  if (!cover) { warn(`图集 ${slug}：封面 ${meta.cover} 不在这个图集里，用了第一张`); cover = photos[0]; }
  return {
    slug,
    title: String(meta.title || slug),
    description: String(meta.description || ''),
    draft: meta.draft === true,
    month,
    cover,
    photos,
    groups,
    latest: dated.length ? dated[dated.length - 1].when : '',
    span: dated.length ? range(dated[0].when, dated[dated.length - 1].when) : '',
  };
}

async function fromFolder(dir, media, dev, warn) {
  const albums = [];
  if (!existsSync(dir)) return albums;
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const slug = entry.name, folder = path.join(dir, slug);
    if (!SLUG.test(slug)) { warn(`图集 ${slug}：文件夹名只能用文字、数字、- 和 _，这个图集没有发布`); continue; }
    let meta = {};
    const jsonFile = path.join(folder, 'album.json');
    if (existsSync(jsonFile)) {
      try { meta = JSON.parse((await readFile(jsonFile, 'utf8')).replace(/^﻿/, '')); }
      catch (e) { warn(`图集 ${slug}：album.json 写错了（${e.message}），这个图集没有发布`); continue; }
    }
    if (meta.draft === true && !dev) continue;
    const notes = meta.photos && typeof meta.photos === 'object' ? meta.photos : {};
    const names = await readdir(folder);
    const files = names.filter((f) => PHOTO.test(f)).sort();
    for (const f of Object.keys(notes)) if (!files.includes(f)) warn(`图集 ${slug}：album.json 提到的 ${f} 不在文件夹里`);
    for (const f of names.filter((x) => /\.(heic|heif)$/i.test(x))) warn(`图集 ${slug}：${f} 是 HEIC 格式，用 npm run album 导入时也读不了，请先转成 JPG`);
    const entries = files.map((file) => ({ name: file, src: `/gallery/${slug}/${file}`, ...(notes[file] || {}) }));
    const album = await assemble({ slug, meta, entries, media, warn });
    if (album) albums.push(album);
  }
  return albums;
}

async function fromDatabase(file, media, warn) {
  if (!existsSync(file)) return [];
  let list;
  try { list = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { warn(`albums.json 读不了（${e.message}），后台的图集这次没有发布`); return []; }
  const albums = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || !SLUG.test(String(a.slug))) { warn(`albums.json 里有一个图集的网址不对：${a && a.slug}`); continue; }
    const entries = (Array.isArray(a.photos) ? a.photos : []).map((p) => ({ ...p, name: p.path, src: p.path }));
    /* a draft is never in this file */
    const album = await assemble({ slug: a.slug, meta: { ...a, draft: false, photos: undefined }, entries, media, warn });
    if (album) albums.push(album);
  }
  return albums;
}

export async function loadAlbums({ dir, dataFile, media, dev, warn }) {
  const stored = await fromDatabase(dataFile, media, warn);
  const taken = new Set(stored.map((a) => a.slug));
  const kept = [];
  for (const a of await fromFolder(dir, media, dev, warn)) {
    if (taken.has(a.slug)) warn(`图集 ${a.slug} 在后台和 content/gallery 里都有，显示的是后台的那个`);
    else kept.push(a);
  }
  /* the newest first; an album without dates last */
  return [...stored, ...kept].sort((a, b) => String(b.latest).localeCompare(String(a.latest)) || a.slug.localeCompare(b.slug));
}

/* the photos an article shows of an album: the cover, then others spread evenly over its time */
export function preview(album, n) {
  const count = Math.max(1, Math.min(12, n));
  const rest = album.photos.filter((p) => p !== album.cover);
  const picks = [album.cover];
  for (let i = 0; i < count - 1 && rest.length; i++) picks.push(rest[Math.floor((i * rest.length) / Math.min(count - 1, rest.length))]);
  return [...new Set(picks)];
}
