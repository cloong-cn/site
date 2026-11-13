// Images and videos referenced by articles and by site.config.mjs.
//
// Images (jpg / png / webp / avif under src/public/) are resized to a few widths and converted to AVIF and WebP,
// so each visitor downloads only the size their screen needs. Results are cached in .cache/images/, so only new
// or changed images cost time. Without the optional `sharp` package, images are used exactly as they are.
//
// Videos (mp4 / webm under src/public/) become a <video> player. A picture with the same name next to the video
// (demo.mp4 + demo.jpg) is used as its cover, and then nothing of the video loads until the visitor presses play.
// `npm run video` makes both from any clip.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { picture, placeholder } from '../src/templates/util.mjs';

export const ASSETS = 'A'; // replaced per page with the path to assets/
export const ROOT = 'R'; //   replaced per page with the path to the site root

/* the article column is 720 px wide: 1600 covers it on a 2× (retina) screen, 1200 a phone at 3× */
const WIDTHS = [480, 800, 1200, 1600];
const RASTER = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const VIDEO = /\.(mp4|webm|m4v|mov)$/i;
const VIDEO_WARN_MB = 100;

/* what an EXIF block says that matters here: does it carry a location (tag 0x8825 in the first directory), and when was
   the picture taken ("2026:03:14 09:30:00": 0x9003 in the camera's directory, else 0x0132 in the first one) */
export function readExif(exif) {
  const out = { gps: false, taken: null };
  try {
    if (!exif || exif.length < 14) return out;
    const o = exif.toString('latin1', 0, 6) === 'Exif\0\0' ? 6 : 0;
    const le = exif.toString('latin1', o, o + 2) === 'II';
    const u16 = (p) => (le ? exif.readUInt16LE(p) : exif.readUInt16BE(p));
    const u32 = (p) => (le ? exif.readUInt32LE(p) : exif.readUInt32BE(p));
    const entries = (dir) => { const list = []; for (let i = 0, n = u16(dir); i < n; i++) list.push(dir + 2 + i * 12); return list; };
    const text = (e) => exif.toString('latin1', o + u32(e + 8), o + u32(e + 8) + 19);
    const first = o + u32(o + 4);
    let sub = 0, modified = null;
    for (const e of entries(first)) {
      const tag = u16(e);
      if (tag === 0x8825) out.gps = true;
      else if (tag === 0x8769) sub = o + u32(e + 8);
      else if (tag === 0x0132) modified = text(e);
    }
    if (sub) for (const e of entries(sub)) if (u16(e) === 0x9003) out.taken = text(e);
    if (!out.taken) out.taken = modified;
    if (out.taken && !/^\d{4}:\d{2}:\d{2}/.test(out.taken)) out.taken = null;
  } catch { /* not a readable EXIF block */ }
  return out;
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescAttr = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export async function createMedia({ root, out, log, mediaDir, galleryDir }) {
  const pub = path.join(root, 'src/public');
  /* /media/… are the pictures uploaded in the admin editor: on the server in /srv/blog/media (MEDIA_DIR) */
  const media = mediaDir ? path.resolve(mediaDir) : null;
  const needed = new Set(); /* uploaded pictures a page uses as they are (animated GIFs): copied into the site */
  const fileOf = (src) => {
    if (src.startsWith('/media/')) {
      if (!media) return null;
      const f = path.join(media, src.slice('/media/'.length));
      return f.startsWith(media + path.sep) ? f : null;
    }
    /* the photos of the albums (gallery.mjs): only ever published through their compressed copies */
    if (src.startsWith('/gallery/')) {
      if (!galleryDir) return null;
      const f = path.join(galleryDir, src.slice('/gallery/'.length));
      return f.startsWith(path.resolve(galleryDir) + path.sep) ? f : null;
    }
    const f = path.join(pub, src);
    return f.startsWith(pub + path.sep) ? f : null;
  };
  const cacheDir = path.join(root, '.cache/images');
  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    log('提示：没有安装 sharp，图片会原样使用、不做压缩。运行 npm install 安装后就会自动压缩。');
  }
  const warned = new Set();
  const warn = (msg) => { if (!warned.has(msg)) { warned.add(msg); log(msg); } };
  const memo = new Map();
  const done = new Set(); /* source files the pages use only through their compressed copies */
  let processed = 0;

  /* a site path such as /images/a.jpg → { w, h, avif: [[path, width]…], webp: […] } (paths relative to assets/),
     or null when it is not ours to process */
  function image(src) {
    if (!memo.has(src)) memo.set(src, processImage(src));
    return memo.get(src);
  }

  async function processImage(src) {
    if (!sharp || !RASTER.test(src)) return null;
    const file = fileOf(src);
    if (!file || !existsSync(file)) { warn(src.startsWith('/media/') ? `找不到图片 ${src}（后台上传的图片在 MEDIA_DIR 里）` : `找不到图片 ${src}（应该放在 src/public${src}）`); return null; }
    const buf = await readFile(file);
    const id = createHash('sha256').update(buf).digest('hex').slice(0, 10);
    let meta;
    try { meta = await sharp(buf).metadata(); } catch { warn(`读不了图片 ${src}，按原样使用`); return null; }
    if ((meta.pages || 1) > 1) return null; /* animated: keep it as it is */
    const turned = (meta.orientation || 1) >= 5; /* phone photos stored sideways, upright only via their EXIF tag */
    const W = turned ? meta.height : meta.width, H = turned ? meta.width : meta.height;
    const widths = [...new Set([...WIDTHS.filter((w) => w < W), Math.min(W, WIDTHS[WIDTHS.length - 1])])];
    /* screenshots (png) keep sharper text; photos can be compressed harder */
    const shot = /\.png$/i.test(src);
    const q = { avif: shot ? 62 : 50, webp: shot ? 88 : 78 };
    /* an album's photo keeps nothing of its file name either, which can hold a date or a place */
    const name = src.startsWith('/gallery/') ? 'photo' : (path.basename(src, path.extname(src)).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'img').slice(0, 40);
    const result = { w: widths[widths.length - 1], h: Math.round((widths[widths.length - 1] * H) / W), avif: [], webp: [], ...readExif(meta.exif) };
    await mkdir(cacheDir, { recursive: true });
    await mkdir(path.join(out, 'assets/img'), { recursive: true });
    let fresh = false;
    for (const w of widths) {
      for (const fmt of ['avif', 'webp']) {
        const cached = path.join(cacheDir, `${id}-${w}-${fmt}${q[fmt]}.${fmt}`);
        let data;
        if (existsSync(cached)) data = await readFile(cached);
        else {
          fresh = true;
          const pipe = sharp(buf).rotate().resize({ width: w, withoutEnlargement: true });
          data = await (fmt === 'avif' ? pipe.avif({ quality: q.avif, effort: 4 }) : pipe.webp({ quality: q.webp, effort: 5 })).toBuffer();
          await writeFile(cached, data);
        }
        const rel = `img/${name}-${id}-${w}.${fmt}`;
        await writeFile(path.join(out, 'assets', rel), data);
        result[fmt].push([rel, w]);
      }
    }
    /* a tiny copy written straight into the page: what shows, blurred, until the picture itself has loaded */
    const tiny = path.join(cacheDir, `${id}-lqip.webp`);
    let lq;
    if (existsSync(tiny)) lq = await readFile(tiny);
    else {
      lq = await sharp(buf).rotate().resize({ width: 16 }).webp({ quality: 40, effort: 6 }).toBuffer();
      await writeFile(tiny, lq);
    }
    result.lqip = `data:image/webp;base64,${lq.toString('base64')}`;
    if (fresh) { processed++; log(`  图片 ${src}：${W}×${H} → ${widths.join(' / ')} 像素宽，AVIF + WebP`); }
    done.add(file);
    result.src = src;
    return result;
  }

  /* a video → { html, w, h } (w and h come from its cover, when it has one) */
  async function video(src, alt) {
    const file = path.join(pub, src);
    if (!file.startsWith(pub + path.sep) || !existsSync(file)) { warn(`找不到视频 ${src}（应该放在 src/public${src}）`); }
    else {
      const mb = (await stat(file)).size / 1048576;
      if (mb > VIDEO_WARN_MB) warn(`视频 ${src} 有 ${mb.toFixed(0)} MB：每播放一次就消耗这么多服务器流量，建议先用 npm run video 压缩`);
      if (/\.mov$/i.test(src)) warn(`视频 ${src} 是 .mov：iPhone 拍的 .mov 多半是 HEVC 编码，Windows 和安卓的浏览器放不了，建议用 npm run video 转成 mp4`);
    }
    /* a picture with the same name is the cover */
    const stem = src.replace(/\.[^.]+$/, '');
    let poster = '', w = 0, h = 0;
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      if (!existsSync(path.join(pub, stem + ext))) continue;
      const img = await image(stem + ext);
      if (img) {
        const pick = img.webp.find(([, x]) => x >= 1200) || img.webp[img.webp.length - 1];
        poster = ASSETS + pick[0];
        w = img.w; h = img.h;
      } else poster = ROOT + encodeURI(stem.slice(1) + ext);
      break;
    }
    const url = ROOT + encodeURI(src.slice(1));
    /* with a cover nothing loads before play; without one, just enough to show the first frame.
       controls stay for visitors without JavaScript; the script swaps them for its own */
    const html = `<video controls playsinline preload="${poster ? 'none' : 'metadata'}"${poster ? ` poster="${poster}"` : ''}${w ? ` width="${w}" height="${h}"` : ''} src="${poster ? url : url + '#t=0.001'}"${alt ? ` aria-label="${escAttr(alt)}"` : ''}></video>`;
    return { html, w, h };
  }

  /* an SVG (a diagram, say) stays a vector: shown as it is, sized from its own width/height or viewBox so the page
     does not jump. diagram.dark.svg next to diagram.svg is the version shown in the dark theme */
  async function svg(src, alt, cap) {
    const raw = { kind: 'raw', src: ROOT + encodeURI(src.slice(1)), alt, cap };
    const file = fileOf(src);
    if (!file || !existsSync(file)) { warn(src.startsWith('/media/') ? `找不到图片 ${src}（后台上传的图片在 MEDIA_DIR 里）` : `找不到图片 ${src}（应该放在 src/public${src}）`); return raw; }
    const tag = (/<svg\b[^>]*>/i.exec(await readFile(file, 'utf8')) || [''])[0];
    const num = (n) => { const m = new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, 'i').exec(tag); return m ? parseFloat(m[1]) : 0; };
    let w = num('width'), h = num('height');
    const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
    if ((!w || !h) && vb) {
      const vw = parseFloat(vb[1]), vh = parseFloat(vb[2]);
      if (w) h = (w * vh) / vw; else if (h) w = (h * vw) / vh; else { w = vw; h = vh; }
    }
    if (!w || !h) warn(`SVG ${src} 里没有写尺寸（width、height 或 viewBox），显示时可能撑满整栏`);
    const twin = /\.dark\.svg$/i.test(src) ? null : src.replace(/\.svg$/i, '.dark.svg');
    const twinFile = twin && fileOf(twin);
    const dark = twinFile && existsSync(twinFile) ? twin : null;
    for (const s of [src, dark]) if (s && s.startsWith('/media/')) needed.add(s);
    return { kind: 'svg', src, dark, w: Math.round(w), h: Math.round(h), alt, cap };
  }

  /* one image or video from the article, as data: rendered once we know whether it sits in a stack */
  async function item(attrs) {
    let src = attrs.src || '';
    const alt = attrs.alt || '', cap = attrs.title || '';
    if (/^([a-z][\w+.-]*:|\/\/)/i.test(src)) return { kind: 'raw', src, alt, cap };
    src = '/' + src.replace(/^\.?\//, '');
    let local = src;
    try { local = decodeURI(src); } catch { /* keep as written */ }
    if (/\.(heic|heif)$/i.test(local)) warn(`图片 ${local} 是 HEIC 格式，大部分浏览器显示不了：在 iPhone 上导出成 JPG（设置 → 相机 → 格式 → 兼容性最佳），或者用电脑转成 JPG`);
    if (VIDEO.test(local)) return { kind: 'video', ...(await video(local, alt)), cap };
    if (/\.svg$/i.test(local)) return svg(local, alt, cap);
    const img = await image(local);
    if (!img && local.startsWith('/media/')) needed.add(local);
    return img ? { kind: 'image', img, alt, cap } : { kind: 'raw', src: ROOT + encodeURI(local.slice(1)), alt, cap };
  }

  const SIZES = '(min-width: 800px) 720px, calc(100vw - 48px)';
  const caption = (cap) => (cap ? `<figcaption class="media-cap">${escAttr(cap)}</figcaption>` : '');
  /* the box's shape and natural width, so the page never jumps while the picture loads */
  const shape = (w, h) => `--ar:${(w / h).toFixed(4)};--w:${w}px`;

  function figure(it) {
    if (it.kind === 'image') {
      /* small pictures keep the caption underneath rather than on top */
      const small = it.img.w < 400;
      return `<figure class="media is-image${small ? ' is-small' : ''}" style="${shape(it.img.w, it.img.h)}">${small ? '' : placeholder(it.img)}${picture(it.img, ASSETS, { alt: it.alt, sizes: SIZES, eager: it.eager })}${caption(it.cap)}</figure>`;
    }
    if (it.kind === 'video') return `<figure class="media is-video"${it.w ? ` style="${shape(it.w, it.h)}"` : ''}>${it.html}${caption(it.cap)}</figure>`;
    if (it.kind === 'svg') {
      const size = it.w && it.h ? ` width="${it.w}" height="${it.h}"` : '';
      const img = (s, cls) => `<img${cls ? ` class="${cls}"` : ''} src="${ROOT}${encodeURI(s.slice(1))}" alt="${escAttr(it.alt)}"${size} loading="lazy" decoding="async">`;
      return `<figure class="media is-raw is-svg${it.dark ? ' has-dark' : ''}"${it.w && it.h ? ` style="--w:${it.w}px"` : ''}>${img(it.src, it.dark ? 'svg-light' : '')}${it.dark ? img(it.dark, 'svg-dark') : ''}${caption(it.cap)}</figure>`;
    }
    return `<figure class="media is-raw"><img src="${escAttr(it.src)}" alt="${escAttr(it.alt)}" loading="lazy" decoding="async">${caption(it.cap)}</figure>`;
  }

  /* two or more pictures in a row: a stack of cards, shaped like the first one. A picture of another shape
     sits inside its card over a blurred copy of itself */
  function stack(items) {
    const r0 = items[0].img.w / items[0].img.h;
    const R = Math.min(16 / 9, Math.max(4 / 5, r0));
    const cards = items.map((it, i) => {
      const r = it.img.w / it.img.h;
      const fill = Math.abs(r - R) / R > 0.03 ? `<img class="media-fill" src="${ASSETS}${it.img.webp[0][0]}" alt="" aria-hidden="true" loading="lazy" decoding="async">` : '';
      return `<figure class="media is-image stack-card" data-depth="${Math.min(i, 3)}">${placeholder(it.img)}${fill}${picture(it.img, ASSETS, { alt: it.alt, sizes: SIZES, eager: it.eager })}${caption(it.cap)}</figure>`;
    });
    return `<div class="stack" style="--ar:${R.toFixed(4)}" data-count="${items.length}">\n${cards.join('\n')}\n</div>`;
  }

  const attrsOf = (s) => {
    const a = {};
    for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) a[m[1]] = unescAttr(m[2]);
    return a;
  };

  /* rewrites the <img> tags marked produced for an article: pictures, videos, captions, stacks */
  async function rewrite(html, info = {}) {
    const store = [];
    const token = (k) => `${k}`;
    /* paragraphs holding nothing but images: each image becomes a figure (a token for now) */
    let out = '', last = 0;
    for (const m of html.matchAll(/<p>((?:\s*<img [^>]*>\s*(?:<br>)?)+)\s*<\/p>/g)) {
      out += html.slice(last, m.index);
      last = m.index + m[0].length;
      const tokens = [];
      for (const t of m[1].matchAll(/<img ([^>]*?)>/g)) {
        const it = await item(attrsOf(t[1]));
        /* a picture right at the start of the article is on the first screen: it is fetched first, not lazily */
        if (it.kind === 'image' && m.index < 1200 && !store.some((s) => s.eager)) it.eager = true;
        store.push(it);
        tokens.push(token(store.length - 1));
      }
      out += tokens.join('\n');
    }
    out += html.slice(last);

    /* images inside running text stay in the line */
    let inl = '';
    last = 0;
    for (const m of out.matchAll(/<img ([^>]*?)>/g)) {
      inl += out.slice(last, m.index);
      last = m.index + m[0].length;
      const it = await item(attrsOf(m[1]));
      if (it.kind === 'image') inl += `<img class="inline" src="${ASSETS}${it.img.webp[0][0]}" alt="${escAttr(it.alt)}" width="${it.img.w}" height="${it.img.h}" loading="lazy" decoding="async">`;
      else if (it.kind === 'video') inl += figure(it);
      else if (it.kind === 'svg') inl += `<img class="inline" src="${ROOT}${encodeURI(it.src.slice(1))}" alt="${escAttr(it.alt)}" loading="lazy" decoding="async">`;
      else inl += `<img class="inline" src="${escAttr(it.src)}" alt="${escAttr(it.alt)}" loading="lazy" decoding="async">`;
    }
    out = inl + out.slice(last);

    const first = store.find((it) => it.kind === 'image');
    if (first) info.cover = first.img.src; /* the post's first picture: its link preview */

    /* runs of figures with nothing but white space between them: neighbouring pictures form a stack */
    out = out.replace(/\d+(?:\s*\d+)*/g, (run) => {
      const ids = [...run.matchAll(/(\d+)/g)].map((x) => Number(x[1]));
      const parts = [];
      let group = [];
      const flush = () => {
        if (group.length >= 2) parts.push(stack(group));
        else group.forEach((it) => parts.push(figure(it)));
        group = [];
      };
      for (const k of ids) {
        if (store[k].kind === 'image') group.push(store[k]);
        else { flush(); parts.push(figure(store[k])); }
      }
      flush();
      return parts.join('\n');
    });
    return out;
  }

  /* a 1200×630 JPEG for link previews (WeChat, X, Telegram …), cut from a picture → path inside assets/ */
  async function shareImage(src) {
    const img = await image(src);
    if (!img) return null;
    const buf = await readFile(fileOf(src));
    const id = createHash('sha256').update(buf).digest('hex').slice(0, 10);
    const cached = path.join(cacheDir, `${id}-og.jpg`);
    let data;
    if (existsSync(cached)) data = await readFile(cached);
    else {
      data = await sharp(buf).rotate().resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      await writeFile(cached, data);
    }
    const rel = `img/share-${id}.jpg`;
    await writeFile(path.join(out, 'assets', rel), data);
    return rel;
  }

  /* copying src/public into the site: pictures the pages only use in compressed form stay behind (the originals
     keep the camera's data, location included); any other photo that records where it was taken is published
     without it. Returns true when it took care of the file. */
  async function copy(from, to) {
    if (done.has(from)) return true;
    if (!sharp || !/\.(jpe?g|png|webp|tiff?)$/i.test(from)) return false;
    let meta;
    try { meta = await sharp(from).metadata(); } catch { return false; }
    if (!readExif(meta.exif).gps) return false;
    const pipe = sharp(from).rotate();
    const ext = path.extname(from).toLowerCase();
    const outBuf = await (ext === '.png' ? pipe.png() : ext === '.webp' ? pipe.webp({ quality: 90 }) : pipe.jpeg({ quality: 92, mozjpeg: true })).toBuffer();
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, outBuf);
    log(`  ${path.relative(pub, from)} 记录了拍摄地点（GPS），发布的这一份已经去掉`);
    return true;
  }

  /* the uploaded pictures pages use unprocessed, into the site's media/ */
  async function copyNeeded() {
    for (const src of needed) {
      const from = fileOf(src);
      if (!from || !existsSync(from)) continue;
      const to = path.join(out, src);
      await mkdir(path.dirname(to), { recursive: true });
      await writeFile(to, await readFile(from));
    }
  }

  /* pictures as an article shows them, from data: one figure, or a stack of cards */
  const block = (items) => (items.length >= 2 ? stack(items) : items.map(figure).join('\n'));

  return { image, rewrite, block, shareImage, copy, copyNeeded, get processed() { return processed; } };
}
