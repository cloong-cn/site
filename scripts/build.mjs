// Builds the static site into dist/.
//   npm run build                 production: drafts skipped, assets hashed, .gz/.br precompressed
//   node scripts/build.mjs --dev  local preview: drafts included, no compression
//   node scripts/build.mjs --preview   relative links, so the output also works from a sub-folder
// On the server the articles come from the database: the admin service writes them into a folder and builds with
//   CONTENT_DIR=<that folder> (blog/*.md, site.json, albums.json)  MEDIA_DIR=/srv/blog/media (uploaded pictures, /media/…)
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { marked } from 'marked';
import { layout } from '../src/templates/layout.mjs';
import { ymd } from '../src/templates/util.mjs';
import { homePage } from '../src/templates/home.mjs';
import { blogHomePage, archivePage, postPage, notFoundPage, adminPage, trapPage, redirectPage, commentsOn } from '../src/templates/blog.mjs';
import { galleryPage, albumPage } from '../src/templates/gallery.mjs';
import { createMedia, ASSETS, ROOT } from './media.mjs';
import { loadAlbums, preview } from './gallery.mjs';
import { codeBlock } from './highlight.mjs';
import { createFonts } from './fonts.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev');
const PREVIEW = args.has('--preview');
const OUT = path.resolve(root, process.env.OUT_DIR || 'dist');
const DEMO = process.env.COMMENTS_DEMO === '1'; /* sample comments instead of the comment service, for a preview */
const CONTENT = path.resolve(root, process.env.CONTENT_DIR || 'content');
const MEDIA_DIR = process.env.MEDIA_DIR || '';
const GALLERY_DIR = path.resolve(root, process.env.GALLERY_DIR || 'content/gallery'); /* in the code, whatever CONTENT_DIR says: see gallery.mjs */

const cfg = (await import(pathToFileURL(path.join(root, 'site.config.mjs')).href)).default;
cfg.url = String(cfg.url || '').replace(/\/+$/, '');

/* ---------------------------------------------------------------- content */

function frontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const unq = (v) => v.replace(/^(['"])(.*)\1$/, '$2');
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) { if (!Array.isArray(data[key])) data[key] = []; data[key].push(unq(item[1].trim())); continue; }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (v === '') data[key] = [];
    else if (/^\[.*\]$/.test(v)) data[key] = v.slice(1, -1).split(',').map((s) => unq(s.trim())).filter(Boolean);
    else if (v === 'true' || v === 'false') data[key] = v === 'true';
    else data[key] = unq(v);
  }
  return { data, body: src.slice(m[0].length) };
}

function plainText(mdText) {
  return mdText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^::gallery\[.*$/gm, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/<[^>]+>/g, ' ');
}

function readingMinutes(text) {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const words = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

/* how long a text is: Chinese characters plus Latin words, the way word counts are usually given for Chinese */
function wordCount(text) {
  const CJK_CHAR = /[㐀-鿿豈-﫿]/g;
  const cjk = (text.match(CJK_CHAR) || []).length;
  const words = (text.replace(CJK_CHAR, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return { cjk, words, total: cjk + words };
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section';
}

/* ==highlighted text== (SiYuan, Obsidian, Typora write it so) */
const highlight = {
  name: 'mark',
  level: 'inline',
  start: (src) => src.indexOf('=='),
  tokenizer(src) {
    const m = /^==(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
    if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
};

/* GitHub-style notes: a quote that starts with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION] */
const CALLOUTS = {
  NOTE: ['说明', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.4"/>'],
  TIP: ['提示', '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'],
  IMPORTANT: ['重要', '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/><path d="M12 8v3.5"/><path d="M12 14v.3"/>'],
  WARNING: ['注意', '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 16.8v.2"/>'],
  CAUTION: ['警告', '<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M12 8v5"/><path d="M12 16v.2"/>'],
};
/* a line break in the source between two Chinese characters is not a space: browsers would show one */
const CJK_BREAK = /([⺀-鿿豈-﫿＀-￯])\n(?=[⺀-鿿豈-﫿＀-￯])/g;
function enhance(html) {
  const used = new Set();
  return html
    .replace(/<(p|li|td|th)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => /<pre[\s>]/.test(inner) ? m : `<${tag}>${inner.replace(CJK_BREAK, '$1')}</${tag}>`)
    .replace(/<h([234])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => {
      let id = slugify(inner), n = 2;
      while (used.has(id)) id = `${slugify(inner)}-${n++}`;
      used.add(id);
      return `<h${level} id="${id}">${inner}</h${level}>`;
    })
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"')
    /* links within the site are resolved per page (the preview build uses relative paths) */
    .replace(/<a href="(\/[^"]*)"/g, '<a href="\uE000H$1\uE000"')
    .replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([\s\S]*?)<\/blockquote>/g, (m, type, rest) => {
      let body = rest.replace(/^\s*<\/p>\s*/, ''); /* the marker stood in a paragraph of its own */
      if (!/^\s*</.test(body)) body = '<p>' + body.replace(/^\s+/, ''); /* the text went on in the same paragraph */
      const [label, icon] = CALLOUTS[type];
      return `<aside class="callout is-${type.toLowerCase()}" role="note"><p class="callout-title"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${label}</p>${body}</aside>`;
    })
    /* wide tables scroll sideways inside the column instead of stretching the page */
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/* Anything in an article that could run code on the page goes: <script>, <style>, <object>…, onerror="…" and other
   event attributes, javascript: links. Only the owner writes articles, but an imported file may come from anywhere.
   This is the second line: every page's Content-Security-Policy (layout.mjs) already keeps such code from running. */
const SAFE_DATA = /^data:image\/(png|gif|jpe?g|webp|avif);/i;
function scrubTag(tag) {
  return tag
    .replace(/\s(on[a-z]+|srcdoc|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s(?:href|src|xlink:href|action|poster|data|background)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, attr, all, d, q, b) => {
      /* as the browser reads it: character references decoded, tabs and line breaks inside the scheme ignored */
      const v = (d ?? q ?? b ?? '')
        .replace(/&#(x[0-9a-f]+|\d+);?/gi, (x, n) => { try { return String.fromCodePoint(/^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n)); } catch { return ''; } })
        .replace(/&colon;/gi, ':').replace(/&(tab|newline);/gi, '').replace(/[\u0000-\u0020]+/g, '').toLowerCase();
      return /^(javascript|vbscript|livescript):/.test(v) || (v.startsWith('data:') && !SAFE_DATA.test(v)) ? `${attr}"#"` : m;
    });
}
function scrub(html) {
  let out = html, before;
  do {
    before = out;
    out = out
      .replace(/<(script|style|template|object|applet|frameset|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?(script|style|template|object|applet|frameset|frame|embed|base|meta|link|form|noscript)\b[^>]*>/gi, '');
  } while (out !== before);
  return out.replace(/<[a-z][^>]*>/gi, scrubTag);
}

function parseDate(v) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/* a line of its own in an article, ::gallery[name] or ::gallery[name]{show=6}: a few photos of that album as a stack of
   cards, and the way to the rest. Only those few load with the article */
const albumNotes = [];
function embedAlbums(html, slug) {
  return html.replace(/<p>::gallery\[([^\]\s<]+)\](?:\{show=(\d+)\})?<\/p>/g, (m, name, show) => {
    const album = albums.find((a) => a.slug === name);
    if (!album) { albumNotes.push(`文章 ${slug}：引用的图集 ${name} 不存在，或者还是草稿`); return ''; }
    const items = preview(album, show ? Number(show) : 4).map((p) => ({ kind: 'image', img: p.img, alt: p.alt, cap: p.note }));
    const label = album.photos.length > items.length ? `查看全部 ${album.photos.length} 张` : '打开图集';
    return `<div class="album-embed">${media.block(items)}<p class="album-more"><a href="H/gallery/${encodeURI(album.slug)}/"><span>${album.title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</span><span class="album-more-go">${label}<svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true"><path d="M1.2 1.2 5.8 6l-4.6 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span></a></p></div>`;
  });
}

const scrubbedFiles = [];
function scrubbed(html, file) {
  const clean = scrub(html);
  if (clean !== html) scrubbedFiles.push(file);
  return clean;
}

async function loadPosts() {
  const dir = path.join(CONTENT, 'blog');
  if (!existsSync(dir)) return [];
  marked.setOptions({ gfm: true });
  marked.use({ renderer: { code: (t) => codeBlock(t.text, t.lang) }, extensions: [highlight] }); /* code coloured like Xcode, see highlight.mjs */
  const posts = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const { data, body } = frontmatter(await readFile(path.join(dir, file), 'utf8'));
    if (data.draft === true && !DEV) continue;
    const slug = file.replace(/\.md$/, '').trim().replace(/\s+/g, '-');
    const text = plainText(body);
    const firstPara = text.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    const date = parseDate(data.date);
    const info = {};
    if (!date) console.warn(`  ! ${file}: missing or invalid "date" (use YYYY-MM-DD)`);
    posts.push({
      slug,
      title: data.title || slug,
      date: date || new Date(0),
      tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [],
      description: data.description || (firstPara.length > 120 ? firstPara.slice(0, 118) + '…' : firstPara),
      minutes: readingMinutes(text),
      words: wordCount(text).total,
      html: embedAlbums(await media.rewrite(enhance(scrubbed(marked.parse(body), file)), info), slug),
      draft: data.draft === true,
      comments: data.comments !== false,
      aliases: (Array.isArray(data.aliases) ? data.aliases : []).map(String),
    });
    /* the link preview: the picture named in `cover:`, else the article's first picture */
    const cover = data.cover ? '/' + String(data.cover).replace(/^\.?\//, '') : info.cover;
    posts[posts.length - 1].share = cover ? await media.shareImage(cover) : null;
    /* and a small version of it for the home page's list */
    posts[posts.length - 1].thumb = cover ? await media.image(cover) : null;
  }
  return posts.sort((a, b) => b.date - a.date || a.slug.localeCompare(b.slug));
}

function tagIndex(posts) {
  const map = new Map();
  for (const p of posts) for (const t of p.tags) map.set(t, (map.get(t) || 0) + 1);
  return [...map].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/* ----------------------------------------------------------------- assets */

const files = {}; // logical name -> hashed path inside assets/
const scriptText = {}; // bundle name -> its source, for the Chinese font cut
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

async function put(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}
async function emit(logical, buf) {
  const ext = path.extname(logical);
  const rel = `${logical.slice(0, -ext.length)}.${hash(buf)}${ext}`;
  await put(path.join(OUT, 'assets', rel), buf);
  files[logical] = rel;
  return rel;
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}
function stripJsComments(js) {
  // the sources only use /* */ comments and never put comment markers inside strings or regexes
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n');
}

async function buildAssets() {
  for (const f of (await readdir(path.join(root, 'src/fonts'))).filter((f) => f.endsWith('.woff2'))) {
    await emit(`fonts/${f}`, await readFile(path.join(root, 'src/fonts', f)));
  }
  await put(path.join(OUT, 'assets/fonts/OFL-Inter.txt'), await readFile(path.join(root, 'src/fonts/OFL-Inter.txt')));
  await put(path.join(OUT, 'assets/fonts/OFL-NotoSansSC.txt'), await readFile(path.join(root, 'src/fonts/source/OFL-NotoSansSC.txt')));

  let css = '';
  for (const f of ['base.css', 'home.css', 'blog.css']) css += (await readFile(path.join(root, 'src/styles', f), 'utf8')) + '\n';
  css = css.replace(/url\(fonts\/([\w.-]+\.woff2)\)/g, (m, name) => `url(${files[`fonts/${name}`]})`);
  await emit('site.css', Buffer.from(minifyCss(css)));

  const js = async (name) => stripJsComments(await readFile(path.join(root, 'src/scripts', name), 'utf8'));
  const bundle = async (...names) => Buffer.from((await Promise.all(names.map(js))).join(';\n'));
  /* the words these scripts put on screen get into each page's Chinese font too */
  for (const [name, parts] of [['site-home.js', ['theme.js', 'theme-icon.js', 'motion.js', 'nav.js', 'glass.js', 'scene.js', 'home.js']], ['site-blog.js', ['theme.js', 'theme-icon.js', 'motion.js', 'nav.js', 'glass.js', 'ruler.js', 'archive.js', 'toc.js', 'media.js', 'comments.js']]]) {
    const buf = await bundle(...parts);
    scriptText[name] = buf.toString();
    await emit(name, buf);
  }
  await emit('site-admin.js', await bundle('theme.js', 'theme-icon.js', 'admin.js'));
  /* the admin editor's preview turns Markdown into HTML in the browser with the same library the build uses */
  await emit('admin-marked.js', await readFile(path.join(root, 'node_modules/marked/lib/marked.umd.js')));
  await emit('admin.css', Buffer.from(minifyCss(await readFile(path.join(root, 'src/styles/admin.css'), 'utf8'))));

  await emit('tz.json', await readFile(path.join(root, 'src/data/tz.json'))); /* time zone -> city, for the telemetry bar */

  const pub = path.join(root, 'src/public');
  for (const f of await readdir(pub, { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    const from = path.join(f.parentPath || f.path, f.name);
    const to = path.join(OUT, path.relative(pub, from));
    if (await media.copy(from, to)) continue; /* see media.mjs: originals of processed pictures, location data */
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

/* ------------------------------------------------------------------ pages */

function context(pagePath) {
  const depth = pagePath.replace(/[^/]*$/, '').split('/').filter(Boolean).length;
  const rel = PREVIEW ? (depth ? '../'.repeat(depth) : './') : '/';
  return {
    files,
    dev: DEV,
    preview: PREVIEW,
    demo: DEMO,
    root: rel,
    asset: (p) => `${rel}assets/${p}`,
    href: (p) => {
      if (!PREVIEW) return p;
      const m = /^([^?#]*)(.*)$/.exec(p);
      let file = m[1].replace(/^\//, '');
      if (file === '' || file.endsWith('/')) file += 'index.html';
      return rel + file + m[2];
    },
  };
}

/* a page as HTML, in memory: the Chinese font is cut only after all of them are known (fonts.mjs) */
function renderPage(page) {
  const ctx = context(page.path);
  const built = page.render(ctx);
  /* article images and videos point at assets/ and the site root through placeholders, resolved per page */
  const html = layout(cfg, ctx, built).replaceAll(ASSETS, ctx.asset('')).replaceAll(ROOT, ctx.root)
    .replace(/\uE000H([^\uE000]*)\uE000/g, (m, p) => ctx.href(p));
  return { path: page.path, ctx, html, extra: (built.scripts || []).map((s) => scriptText[s] || '').join(''), fonts: !built.csp };
}

async function writePage(r) {
  let html = r.html;
  /* the Chinese font; the admin and decoy pages allow no inline style */
  if (r.fonts) {
    const faces = await fonts.faces(html, r.extra, r.ctx.asset);
    if (faces) html = html.replace('</head>', () => `${faces}\n</head>`);
  }
  const out = r.path.endsWith('/') ? path.join(OUT, r.path, 'index.html') : path.join(OUT, r.path);
  await put(out, html);
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function rss(posts) {
  const items = posts.slice(0, 30).map((p) => `<item><title>${xml(p.title)}</title><link>${cfg.url}/blog/${encodeURI(p.slug)}/</link><guid isPermaLink="true">${cfg.url}/blog/${encodeURI(p.slug)}/</guid><pubDate>${p.date.toUTCString()}</pubDate><description>${xml(p.description)}</description><content:encoded><![CDATA[${absolute(p.html).replaceAll(']]>', ']]]]><![CDATA[>')}]]></content:encoded>${p.tags.map((t) => `<category>${xml(t)}</category>`).join('')}</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${xml(cfg.name)}</title>
<link>${cfg.url}/</link>
<description>${xml(cfg.description)}</description>
<language>${xml(cfg.lang)}</language>
<atom:link href="${cfg.url}/rss.xml" rel="self" type="application/rss+xml"/>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

function sitemap(posts) {
  const latest = posts[0] ? ymd(posts[0].date) : '';
  const shown = albums.filter((a) => !a.draft);
  const urls = [['/', latest], ['/blog/', latest], ['/blog/archive/', latest], ...posts.map((p) => [`/blog/${encodeURI(p.slug)}/`, ymd(p.date)]), ...(shown.length ? [['/gallery/', '']] : []), ...shown.map((a) => [`/gallery/${encodeURI(a.slug)}/`, ''])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `<url><loc>${cfg.url}${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

/* an article's HTML with every link absolute, for the feed */
function absolute(html) {
  return html
    .replaceAll(ASSETS, `${cfg.url}/assets/`)
    .replaceAll(ROOT, `${cfg.url}/`)
    .replace(/\uE000H([^\uE000]*)\uE000/g, (m, p) => cfg.url + p)
    .replace(/<button[^>]*>[\s\S]*?<\/button>/g, '')
    .replace(/<span class="media-ph"[^>]*><\/span>/g, ''); /* the blurred stand-ins mean nothing in a feed reader */
}

/* ------------------------------------------------------------- checks */

const SAMPLE_OG = 'a4c7cbe7f3f72043'; /* og.jpg as it ships, with the placeholder name in it */

/* things worth fixing, printed after the build: links in articles that lead nowhere, a second top-level heading,
   and (for the real build) what is still a placeholder or a sample */
async function checks(posts) {
  const notes = [];
  const pub = path.join(root, 'src/public');
  const known = new Set(['/', '/blog/', '/blog/archive/', '/rss.xml', '/sitemap.xml', '/robots.txt', '/404.html', ...posts.map((p) => `/blog/${p.slug}/`), '/gallery/', ...albums.map((a) => `/gallery/${a.slug}/`)]);
  notes.push(...albumNotes);
  if (posts.some((p) => p.slug === 'archive')) notes.push('文章 archive：这个网址是「全部文章」页用的，这篇文章会被它盖住，换一个文件名（网址）');
  for (const f of await readdir(pub, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) known.add('/' + path.relative(pub, path.join(f.parentPath || f.path, f.name)).split(path.sep).join('/'));
  }
  for (const p of posts) {
    for (const m of p.html.matchAll(/\uE000H([^\uE000]*)\uE000/g)) {
      let target = m[1].replace(/[?#].*$/, '');
      try { target = decodeURI(target); } catch { /* keep as written */ }
      if (!target || known.has(target) || known.has(target + '/') || target.startsWith('/assets/')) continue;
      notes.push(`文章 ${p.slug}：链接 ${m[1]} 指向的页面或文件不存在`);
    }
    if (cfg.comments?.enabled && p.comments !== false && !commentsOn(cfg, p)) notes.push(`文章 ${p.slug}：文件名里有评论服务不接受的字符（只能用文字、数字、- _ .），这篇不会显示评论区`);
    if (/<h1[\s>]/.test(p.html)) notes.push(`文章 ${p.slug}：正文里有一级标题（#）。文章标题本身就是一级标题，正文的标题从 ## 开始`);
  }
  if (!DEV && !PREVIEW) {
    const holes = [];
    (function walk(v, at) {
      if (typeof v === 'string') {
        if (/\[[^\]]+\]|Your Name|yourname\./i.test(v) || /^https:\/\/(github\.com|x\.com|twitter\.com)\/?$/.test(v)) holes.push(at);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) if (k !== 'media') walk(v[k], at ? `${at}.${k}` : k);
    })(cfg, '');
    if (holes.length) notes.push(`content/site.json 或 site.config.mjs 里还有 ${holes.length} 处占位内容：${holes.slice(0, 8).join('、')}${holes.length > 8 ? ' ……' : ''}`);
    const og = path.join(pub, 'og.jpg');
    if (existsSync(og) && hash(await readFile(og)).slice(0, 10) === SAMPLE_OG.slice(0, 10)) notes.push('src/public/og.jpg（分享到微信、X 时的预览图）还是示例图，上面写着 Your Name');
    const samples = posts.filter((p) => p.title.startsWith('示例文章')).map((p) => p.slug);
    if (samples.length) notes.push(`示例文章还在：content/blog/ 里的 ${samples.join('、')}`);
    const demo = [...known].filter((f) => /^\/(images\/demo-|videos\/demo\.)/.test(f));
    if (demo.length) notes.push(`示例图片和视频还在：${demo.map((f) => 'src/public' + f).join('、')}`);
  }
  for (const f of scrubbedFiles) notes.push(`文章 ${f.replace(/\.md$/, '')}：里面有能在网页上运行的代码（<script>、onerror= 之类），发布时已经去掉`);
  if (notes.length) console.log(`\n${!DEV && !PREVIEW ? '上线前' : ''}检查：\n${notes.map((n) => '  · ' + n).join('\n')}\n`);
}

/* ------------------------------------------------------------ compression */

async function precompress(dir) {
  let count = 0;
  for (const f of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!f.isFile() || !/\.(html|css|js|xml|txt|svg|json)$/.test(f.name)) continue;
    const file = path.join(f.parentPath || f.path, f.name);
    const buf = await readFile(file);
    if (buf.length < 600) continue;
    await writeFile(file + '.gz', zlib.gzipSync(buf, { level: 9 }));
    await writeFile(file + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
    count++;
  }
  return count;
}

/* ------------------------------------------------------------------- main */

const t0 = Date.now();
await rm(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); /* Windows: a file just served can stay locked for a moment */
await mkdir(OUT, { recursive: true });

const media = await createMedia({ root, out: OUT, log: (m) => console.log(m), mediaDir: MEDIA_DIR, galleryDir: GALLERY_DIR });
const fonts = await createFonts({ root, out: OUT, log: (m) => console.log(m) });
const albums = await loadAlbums({ dir: GALLERY_DIR, dataFile: path.join(CONTENT, 'albums.json'), media, dev: DEV, warn: (m) => albumNotes.push(m) });
cfg.hasGallery = albums.length > 0;
for (const a of albums) a.share = await media.shareImage(a.cover.src);
const posts = await loadPosts();
const tags = tagIndex(posts);
/* project screenshots on the home page go through the same image pipeline */
for (const p of cfg.work?.projects || []) if (p.image && p.image.startsWith('/')) p.media = await media.image(p.image);
await buildAssets();

const pages = [
  { path: '/', render: (ctx) => homePage(cfg, ctx, posts, tags) },
  { path: '/blog/', render: (ctx) => blogHomePage(cfg, ctx, posts, tags) },
  ...posts.map((p, i) => ({ path: `/blog/${p.slug}/`, render: (ctx) => postPage(cfg, ctx, p, posts[i + 1], posts[i - 1]) })),
  /* after the articles, so an article that happens to be called "archive" cannot take its place (checks() warns) */
  { path: '/blog/archive/', render: (ctx) => archivePage(cfg, ctx, posts, tags) },
  ...(albums.length ? [{ path: '/gallery/', render: (ctx) => galleryPage(cfg, ctx, albums) }] : []),
  ...albums.map((a) => ({ path: `/gallery/${a.slug}/`, render: (ctx) => albumPage(cfg, ctx, a) })),
  { path: '/404.html', render: (ctx) => notFoundPage(cfg, ctx) },
  /* the admin page: Nginx / Caddy show it only at its secret address (admin.path), never at /_admin/ itself;
     /admin/, /wp-login.php … get the decoy page instead */
  ...(cfg.admin?.enabled ? [{ path: '/_admin/', render: (ctx) => adminPage(cfg, ctx, posts) }, { path: '/_trap/', render: (ctx) => trapPage(cfg, ctx) }] : []),
];
/* an article moved to a new address: the old one forwards to it */
const taken = new Set(['archive', ...posts.map((p) => p.slug)]);
for (const p of posts) {
  for (const a of p.aliases) {
    if (!a || taken.has(a) || !/^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u.test(a)) continue;
    taken.add(a);
    pages.push({ path: `/blog/${a}/`, render: (ctx) => redirectPage(cfg, ctx, `/blog/${p.slug}/`, p.title) });
  }
}
const rendered = pages.map(renderPage);
await fonts.plan(rendered.filter((r) => r.fonts));
for (const r of rendered) await writePage(r);
await media.copyNeeded();

await put(path.join(OUT, 'rss.xml'), rss(posts.filter((p) => !p.draft)));
await put(path.join(OUT, 'sitemap.xml'), sitemap(posts.filter((p) => !p.draft)));
await put(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${cfg.url}/sitemap.xml\n`);

await checks(posts);
const compressed = DEV || PREVIEW ? 0 : await precompress(OUT);
console.log(`built ${pages.length} pages, ${posts.length} posts${DEV ? ' (drafts included)' : ''}${compressed ? `, ${compressed} files precompressed` : ''} in ${Date.now() - t0} ms → ${path.relative(root, OUT) || '.'}/`);
