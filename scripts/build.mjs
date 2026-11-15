// Builds the static site into dist/.
//   npm run build                 production: drafts skipped, assets hashed, .gz/.br precompressed
//   node scripts/build.mjs --dev  local preview: drafts included, no compression
//   node scripts/build.mjs --preview   relative links, so the output also works from a sub-folder
// On the server the articles come from the database: the admin service writes them into a folder and builds with
//   CONTENT_DIR=<that folder> (blog/*.md, site.json, albums.json)  MEDIA_DIR=/srv/blog/media (uploaded pictures, /media/…)
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { marked } from 'marked';
import katex from 'katex';
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

/* a package's folder, found the way Node finds it for an import: node_modules here or in any folder above, so a
   checkout without its own node_modules (a git worktree inside the main one, say) still builds */
const searchPaths = createRequire(import.meta.url).resolve.paths('') || [];
function pkgDir(name) {
  for (const dir of searchPaths) if (existsSync(path.join(dir, name, 'package.json'))) return path.join(dir, name);
  throw new Error(`找不到 ${name}：先运行 npm install`);
}

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

/* [[网址]], [[网址|文字]], [[网址#小节]], [[#本文的小节]] — a link to another article, as SiYuan and Obsidian write it.
   Which article it means is known only once all are read: here it becomes a placeholder, resolved by linkPosts() */
const WIKI = /^\[\[([^\[\]\n|#]*?)(?:#([^\[\]\n|]+?))?(?:\|([^\[\]\n]+?))?\]\]/;
const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = WIKI.exec(src);
    if (m && (m[1].trim() || m[2])) return { type: 'wikilink', raw: m[0], to: m[1].trim(), part: (m[2] || '').trim(), label: (m[3] || '').trim() };
  },
  renderer: (t) => `W${encodeURIComponent(JSON.stringify([t.to, t.part, t.label]))}`,
};

/* maths, typeset by KaTeX while building: $…$ within a line, $$…$$ on lines of its own (or a ```math block). Visitors
   get finished HTML and the fonts it uses, no script; only pages with a formula load KaTeX's stylesheet (post.math).
   A $ that opens must be followed by something other than a space, one that closes must follow something other than
   a space and not be followed by a digit, so "$5 和 $10" stays text; \$ is always a dollar sign. */
let math = { used: false, file: '' };
function tex(src, display) {
  math.used = true;
  const opts = { displayMode: display, output: 'htmlAndMathml', strict: 'ignore' };
  try { return katex.renderToString(src, { ...opts, throwOnError: true }); }
  catch (e) {
    linkNotes.push(`文章 ${math.file}：公式 ${src.length > 40 ? src.slice(0, 40) + '…' : src} 写得不对（${String(e.message || e).replace(/^KaTeX parse error:\s*/, '')}）`);
    try { return katex.renderToString(src, { ...opts, throwOnError: false }); } catch { return `<code>${src.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code>`; }
  }
}
const mathBlock = {
  name: 'mathBlock',
  level: 'block',
  start: (src) => { const m = /^\$\$/m.exec(src); return m ? m.index : undefined; },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
  },
  renderer: (t) => `<div class="math-display">${tex(t.text, true)}</div>\n`,
};
const mathInline = {
  name: 'mathInline',
  level: 'inline',
  start: (src) => src.indexOf('$'),
  tokenizer(src) {
    let m = /^\$\$((?:\\.|[^\\$])+?)\$\$/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
    m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
  },
  renderer: (t) => tex(t.text, t.display),
};
/* how formulas sit in an article (appended to KaTeX's own stylesheet): a formula wider than the column scrolls
   sideways on its own instead of stretching the page */
const KATEX_SITE = `.prose .katex{font-size:1.12em}
.prose .math-display{margin:1.6em 0;overflow-x:auto;overflow-y:hidden;padding:.3em 0;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.prose .math-display .katex-display{margin:0}
.prose .math-display>.katex-display>.katex{text-align:center}
.prose .katex-error{color:var(--c-caution)}
.prose :is(h2,h3) .katex{font-size:1em}`;

/* the feed: readers show MathML themselves, without KaTeX's stylesheet the HTML copy would be a jumble */
function feedMath(html) {
  let out = html, at;
  while ((at = out.indexOf('<span class="katex-html"')) >= 0) {
    let depth = 0, i = at;
    const re = /<span\b|<\/span>/g;
    re.lastIndex = at;
    let m;
    while ((m = re.exec(out))) {
      depth += m[0] === '</span>' ? -1 : 1;
      if (depth === 0) { i = m.index + m[0].length; break; }
    }
    if (depth !== 0) break;
    out = out.slice(0, at) + out.slice(i);
  }
  return out;
}

/* footnotes, as GitHub and Obsidian write them: [^1] in the text, and somewhere (usually at the end) a line of its own
   "[^1]: the note", whose next lines belong to it when indented. They are numbered in the order they are first
   referred to, and listed under the article (footnoteList). One article at a time: loadPosts() resets this */
let fn = null;
const resetFootnotes = () => { fn = { order: [], defs: new Map(), refs: new Map() }; };
const fnNum = (id) => { if (!fn.order.includes(id)) fn.order.push(id); return fn.order.indexOf(id) + 1; };
const footnoteDef = {
  name: 'footnoteDef',
  level: 'block',
  start: (src) => { const m = /^\[\^[^\]\s]+\]:/m.exec(src); return m ? m.index : undefined; },
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(src);
    if (m) return { type: 'footnoteDef', raw: m[0], id: m[1], tokens: this.lexer.inlineTokens(m[2].replace(/\n[ \t]+/g, '\n')) };
  },
  renderer(t) { fn.defs.set(t.id, this.parser.parseInline(t.tokens)); return ''; },
};
const footnoteRef = {
  name: 'footnoteRef',
  level: 'inline',
  start: (src) => src.indexOf('[^'),
  tokenizer(src) {
    const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
    if (m) return { type: 'footnoteRef', raw: m[0], id: m[1] };
  },
  renderer(t) {
    const n = fnNum(t.id), k = (fn.refs.get(t.id) || 0) + 1;
    fn.refs.set(t.id, k);
    /* U+2060 (word joiner): the number stays on the line of the word it belongs to */
    return `⁠<sup class="fn-ref" id="fnref-${n}${k > 1 ? '-' + k : ''}"><a href="#fn-${n}" data-fn="${n}" aria-label="注释 ${n}">${n}</a></sup>`;
  },
};
/* the notes under the article, each with a way back to where it was referred to */
function footnoteList(file) {
  if (!fn.order.length) return '';
  const items = fn.order.map((id, i) => {
    const n = i + 1;
    const body = fn.defs.get(id);
    if (body == null) linkNotes.push(`文章 ${file.replace(/\.md$/, '')}：脚注 [^${id}] 只在正文里用了，没有写内容（[^${id}]: …）`);
    const back = Array.from({ length: fn.refs.get(id) || 1 }, (_, k) => `<a class="fn-back" href="#fnref-${n}${k ? '-' + (k + 1) : ''}" aria-label="回到正文第 ${k + 1} 处">↩${k ? `<sup>${k + 1}</sup>` : ''}</a>`).join('');
    return `<li id="fn-${n}"><p>${body ?? ''} ${back}</p></li>`;
  });
  for (const id of fn.defs.keys()) if (!fn.order.includes(id)) linkNotes.push(`文章 ${file.replace(/\.md$/, '')}：脚注 [^${id}] 写了内容，但正文里没有用到`);
  return `<section class="footnotes" aria-label="注释"><p class="fn-title">注释</p><ol>${items.join('')}</ol></section>`;
}

/* GitHub-style notes: a quote that starts with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION].
   As in Obsidian, words after the marker are the note's own title, and [!TIP]- or [!TIP]+ makes it fold (closed or
   open); Obsidian's other names for the same five are understood too */
const CALLOUTS = {
  NOTE: ['说明', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.4"/>'],
  TIP: ['提示', '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'],
  IMPORTANT: ['重要', '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5z"/><path d="M12 8v3.5"/><path d="M12 14v.3"/>'],
  WARNING: ['注意', '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 16.8v.2"/>'],
  CAUTION: ['警告', '<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M12 8v5"/><path d="M12 16v.2"/>'],
};
const CALLOUT_ALIAS = { INFO: 'NOTE', ABSTRACT: 'NOTE', SUMMARY: 'NOTE', TODO: 'NOTE', QUOTE: 'NOTE', EXAMPLE: 'NOTE', HINT: 'TIP', SUCCESS: 'TIP', CHECK: 'TIP', DONE: 'TIP', QUESTION: 'IMPORTANT', HELP: 'IMPORTANT', FAQ: 'IMPORTANT', ATTENTION: 'WARNING', FAILURE: 'CAUTION', FAIL: 'CAUTION', MISSING: 'CAUTION', DANGER: 'CAUTION', ERROR: 'CAUTION', BUG: 'CAUTION' };
/* a line break in the source between two Chinese characters is not a space: browsers would show one */
const CJK_BREAK = /([⺀-鿿豈-﫿＀-￯])\n(?=[⺀-鿿豈-﫿＀-￯])/g;
function enhance(html) {
  const used = new Set();
  return callouts(html)
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
    /* wide tables scroll sideways inside the column instead of stretching the page */
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/* > [!TIP] \u2026: run before enhance() joins Chinese lines, while the line break that ends a note's title is still there */
function callouts(html) {
  return html
    .replace(/<blockquote>\s*<p>\[!([A-Za-z]+)\]([\s\S]*?)<\/blockquote>/g, (m, name, rest) => {
      const type = CALLOUT_ALIAS[name.toUpperCase()] || name.toUpperCase();
      if (!CALLOUTS[type]) return m;
      let fold = '';
      if (/^[+-]/.test(rest)) { fold = rest[0]; rest = rest.slice(1); }
      /* a title on the marker's own line */
      const t = /^[ \t]*([^\n<]*?)[ \t]*(?=\n|<\/p>)/.exec(rest);
      const title = t && t[1] ? t[1] : '';
      if (title) rest = rest.slice(t[0].length);
      let body = rest.replace(/^\s*<\/p>\s*/, ''); /* the marker stood in a paragraph of its own */
      /* the text went on in the same paragraph (it may start with <code> or <a>: only a block tag means it did not) */
      if (body.trim() && !/^\s*<(p|ul|ol|pre|div|table|blockquote|h[1-6]|figure|details|aside|hr)\b/i.test(body)) body = '<p>' + body.replace(/^\s+/, '');
      const [label, icon] = CALLOUTS[type];
      const head = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>${title || label}`;
      if (fold) return `<details class="callout is-${type.toLowerCase()}"${fold === '+' ? ' open' : ''}><summary class="callout-title">${head}<svg class="callout-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><div class="callout-body">${body}</div></details>`;
      return `<aside class="callout is-${type.toLowerCase()}" role="note"><p class="callout-title">${head}</p>${body}</aside>`;
    });
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

/* an article's Markdown as HTML, its footnotes listed at the end */
function article(body, file) {
  resetFootnotes();
  math = { used: false, file: file.replace(/.md$/, '') };
  const html = marked.parse(body);
  return html + footnoteList(file);
}

async function loadPosts() {
  const dir = path.join(CONTENT, 'blog');
  if (!existsSync(dir)) return [];
  marked.setOptions({ gfm: true });
  marked.use({ renderer: { code: (t) => (/^(math|latex|katex)$/i.test(t.lang || '') ? `<div class="math-display">${tex(t.text, true)}</div>
` : codeBlock(t.text, t.lang)) }, extensions: [highlight, wikilink, footnoteDef, footnoteRef, mathBlock, mathInline] }); /* code coloured like Xcode, see highlight.mjs */
  const posts = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    const { data, body } = frontmatter(await readFile(path.join(dir, file), 'utf8'));
    if (data.draft === true && !DEV) continue;
    const slug = file.replace(/\.md$/, '').trim().replace(/\s+/g, '-');
    const text = plainText(body);
    const firstPara = text.split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    const date = parseDate(data.date);
    const updated = parseDate(data.updated);
    if (data.updated && !updated) console.warn(`  ! ${file}: invalid "updated" (use YYYY-MM-DD)`);
    const info = {};
    if (!date) console.warn(`  ! ${file}: missing or invalid "date" (use YYYY-MM-DD)`);
    posts.push({
      slug,
      title: data.title || slug,
      date: date || new Date(0),
      /* updated: a later day the article was changed; shown beside the date, and for search engines */
      updated: updated && date && updated > date ? updated : null,
      series: data.series ? String(data.series).trim() : '',
      tags: Array.isArray(data.tags) ? data.tags : data.tags ? [String(data.tags)] : [],
      description: data.description || (firstPara.length > 120 ? firstPara.slice(0, 118) + '…' : firstPara),
      minutes: readingMinutes(text),
      words: wordCount(text).total,
      html: embedAlbums(await media.rewrite(enhance(scrubbed(article(body, file), file)), info), slug),
      math: math.used, /* this article has a formula: its page loads KaTeX's stylesheet */
      draft: data.draft === true,
      pinned: data.pinned === true, /* shown in the big card on the blog's front page */
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

/* ------------------------------------------------------ links between articles */

const linkNotes = [];
const stripTags = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

/* the words around a link to `slug`, the link's own words marked, for the list of articles that mention it */
function around(html, slug) {
  const attr = `data-ref="${escHtml(slug)}"`;
  for (const m of html.matchAll(/<(p|li|td|th|h[234])\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (!m[2].includes(attr)) continue;
    const at = m[2].indexOf(attr);
    const open = m[2].lastIndexOf('<a ', at), close = m[2].indexOf('</a>', at);
    const inner = m[2].slice(0, open) + '' + m[2].slice(m[2].indexOf('>', at) + 1, close) + '' + m[2].slice(close + 4);
    let text = stripTags(inner).replace(/\s+/g, ' ').trim();
    const MAX = 110;
    if (text.length > MAX) {
      const from = Math.max(0, text.indexOf('') - 36);
      text = (from ? '…' : '') + text.slice(from, from + MAX) + (from + MAX < text.length ? '…' : '');
    }
    let out = escHtml(text);
    if (out.includes('') && !out.includes('')) out += '';
    if (out.includes('') && !out.includes('')) out = out.replace('', '');
    return out.replace('', '<b>').replace('', '</b>');
  }
  return '';
}

/* [[ ]] becomes a link (or, when nothing matches, a grey word and a note after the build); then every link from one
   article to another, [[ ]] or plain Markdown, is marked with data-ref, and each article learns who mentions it */
function linkPosts(posts) {
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  for (const p of posts) for (const a of p.aliases) if (!bySlug.has(a)) bySlug.set(a, p);
  const byTitle = new Map();
  for (const p of posts) if (!byTitle.has(norm(p.title))) byTitle.set(norm(p.title), p);
  const find = (to) => bySlug.get(to) || bySlug.get(to.replace(/\s+/g, '-')) || byTitle.get(norm(to));
  const heads = new Map();
  const headsOf = (p) => {
    if (!heads.has(p)) heads.set(p, [...p.html.matchAll(/<h([234]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map((m) => ({ id: m[2], text: stripTags(m[3]).trim() })));
    return heads.get(p);
  };

  for (const p of posts) {
    p.html = p.html.replace(/W([^]*)/g, (m, data) => {
      const [to, part, label] = JSON.parse(decodeURIComponent(data));
      const target = to ? find(to) : p;
      const written = `[[${to}${part ? '#' + part : ''}]]`;
      if (!target) {
        linkNotes.push(`文章 ${p.slug}：${written} 找不到要链接的文章（网址、旧网址和标题都对不上，或者那篇还是草稿）`);
        return `<span class="wikilink is-missing" title="没有找到这篇文章">${escHtml(label || to)}</span>`;
      }
      let h = null;
      if (part) {
        h = headsOf(target).find((x) => norm(x.text) === norm(part) || x.id === part || x.id === slugify(part));
        if (!h) linkNotes.push(`文章 ${p.slug}：${written} 的小节「${part}」在《${target.title}》里没有，链接会打开文章开头`);
      }
      if (target === p) return h ? `<a class="wikilink" href="#${escHtml(h.id)}">${escHtml(label || h.text)}</a>` : escHtml(label || part);
      const text = label || (h ? `${target.title} › ${h.text}` : target.title);
      return `<a class="wikilink" href="H/blog/${encodeURI(target.slug)}/${h ? '#' + escHtml(h.id) : ''}"${h ? ` data-part="${escHtml(h.text)}"` : ''}>${escHtml(text)}</a>`;
    });
  }

  const ref = (path) => {
    let s = path.replace(/^\/blog\//, '').replace(/[/?#].*$/, '');
    try { s = decodeURIComponent(s); } catch { /* as written */ }
    return bySlug.get(s);
  };
  for (const p of posts) {
    p.links = new Set();
    p.backlinks = [];
    p.html = p.html.replace(/<a ([^>]*?)href="H(\/blog\/[^"]+)"/g, (m, before, to) => {
      const t = ref(to);
      if (!t || t === p) return m;
      p.links.add(t);
      return `<a ${before}href="H${to}" data-ref="${escHtml(t.slug)}"`;
    });
  }
  /* newest first, as the posts are */
  for (const src of posts) for (const t of src.links) t.backlinks.push({ post: src, context: around(src.html, t.slug) });

  /* a project on the home page can point at the article that tells its story: work.projects[].post is written as
     inside [[ ]] — the article's address, title or old address, and #a section if wanted. It becomes postHref here */
  for (const pr of cfg.work?.projects || []) {
    delete pr.postHref;
    if (!pr.post) continue;
    const [to, part] = String(pr.post).split('#').map((s) => s.trim());
    const target = find(to.replace(/^\/?blog\//, '').replace(/\/+$/, ''));
    if (!target) { linkNotes.push(`主页作品「${pr.name}」：介绍文章 ${pr.post} 找不到（网址、旧网址和标题都对不上，或者那篇还是草稿），先不显示这个链接`); continue; }
    const h = part ? headsOf(target).find((x) => norm(x.text) === norm(part) || x.id === part || x.id === slugify(part)) : null;
    if (part && !h) linkNotes.push(`主页作品「${pr.name}」：小节「${part}」在《${target.title}》里没有，链接会打开文章开头`);
    pr.postHref = `/blog/${encodeURI(target.slug)}/${h ? '#' + encodeURIComponent(h.id) : ''}`;
  }
}

/* series: the articles that share a `series:` name, oldest first. Related: up to three others that share the most
   tags (newer first among equals), leaving out the series, which has a box of its own */
function relate(posts) {
  const series = new Map();
  for (const p of [...posts].reverse()) if (p.series) (series.get(p.series) || series.set(p.series, []).get(p.series)).push(p);
  for (const p of posts) {
    p.seriesPosts = p.series ? series.get(p.series) : null;
    if (p.seriesPosts && p.seriesPosts.length < 2) p.seriesPosts = null;
    const tags = new Set(p.tags);
    p.related = posts
      .filter((q) => q !== p && !(p.series && q.series === p.series))
      .map((q) => ({ q, n: q.tags.filter((t) => tags.has(t)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || b.q.date - a.q.date)
      .slice(0, 3)
      .map((x) => x.q);
  }
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

  /* KaTeX's stylesheet, for the pages with a formula: only the woff2 fonts (every browser this site supports reads
     them), each loaded only when a formula on the page uses it */
  const kdir = path.join(pkgDir('katex'), 'dist');
  let kcss = (await readFile(path.join(kdir, 'katex.min.css'), 'utf8')).replace(/,\s*url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, '');
  for (const name of new Set([...kcss.matchAll(/url\(fonts\/([\w-]+\.woff2)\)/g)].map((m) => m[1]))) {
    const rel = await emit(`fonts/katex/${name}`, await readFile(path.join(kdir, 'fonts', name)));
    kcss = kcss.replaceAll(`url(fonts/${name})`, `url(${rel})`);
  }
  await emit('katex.css', Buffer.from(kcss + '\n' + KATEX_SITE));

  const js = async (name) => stripJsComments(await readFile(path.join(root, 'src/scripts', name), 'utf8'));
  const bundle = async (...names) => Buffer.from((await Promise.all(names.map(js))).join(';\n'));
  /* the words these scripts put on screen get into each page's Chinese font too */
  for (const [name, parts] of [['site-home.js', ['theme.js', 'theme-icon.js', 'motion.js', 'nav.js', 'glass.js', 'scene.js', 'home.js']], ['site-blog.js', ['theme.js', 'theme-icon.js', 'motion.js', 'nav.js', 'glass.js', 'ruler.js', 'archive.js', 'toc.js', 'media.js', 'comments.js', 'linkcard.js', 'article.js', 'share.js', 'bloghome.js']]]) {
    const buf = await bundle(...parts);
    scriptText[name] = buf.toString();
    await emit(name, buf);
  }
  await emit('site-admin.js', await bundle('theme.js', 'theme-icon.js', 'admin.js'));
  /* the admin editor's preview turns Markdown into HTML in the browser with the same library the build uses */
  await emit('admin-marked.js', await readFile(path.join(pkgDir('marked'), 'lib/marked.umd.js')));
  await emit('admin-katex.js', await readFile(path.join(kdir, 'katex.min.js'))); /* and the formulas */
  /* and colours code as the articles do: highlight.js (its core, and the languages scripts/highlight.mjs has names for)
     with this site's own second pass, glued into one plain script. Each part keeps its own scope; the admin page loads
     it only when the preview first shows a code block */
  const hl = pkgDir('highlight.js');
  const HL_LANGS = ['java', 'kotlin', 'groovy', 'gradle', 'scala', 'javascript', 'typescript', 'xml', 'css', 'scss', 'less', 'json', 'yaml', 'ini', 'properties', 'sql', 'bash', 'shell', 'powershell', 'python', 'go', 'rust', 'c', 'cpp', 'csharp', 'php', 'ruby', 'swift', 'dart', 'dockerfile', 'nginx', 'makefile', 'markdown', 'diff', 'http', 'graphql', 'lua', 'glsl', 'plaintext', 'objectivec'];
  let hlJs = `(function () {\n'use strict';\nvar hljs = (function () {\nvar module = { exports: {} }, exports = module.exports;\n${await readFile(path.join(hl, 'lib/core.js'), 'utf8')}\nreturn module.exports;\n})();\n`;
  for (const l of HL_LANGS) {
    const src = await readFile(path.join(hl, 'es/languages', `${l}.js`), 'utf8');
    if (!/export \{ \w+ as default \};/.test(src)) throw new Error(`highlight.js: ${l}.js is not shaped as expected`);
    hlJs += `(function () {\n${src.replace(/export \{ (\w+) as default \};/, `hljs.registerLanguage('${l}', $1);`)}\n})();\n`;
  }
  hlJs += `window.SiteHighlight = (function () {\n${(await readFile(path.join(root, 'scripts/highlight.mjs'), 'utf8')).replace(/^import hljs from 'highlight\.js';$/m, '').replace(/^export /gm, '')}\nreturn { codeBlock: codeBlock };\n})();\n})();\n`;
  await emit('admin-highlight.js', Buffer.from(hlJs));
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
  const items = posts.slice(0, 30).map((p) => `<item><title>${xml(p.title)}</title><link>${cfg.url}/blog/${encodeURI(p.slug)}/</link><guid isPermaLink="true">${cfg.url}/blog/${encodeURI(p.slug)}/</guid><pubDate>${p.date.toUTCString()}</pubDate><description>${xml(p.description)}</description><content:encoded><![CDATA[${absolute(feedMath(p.html)).replaceAll(']]>', ']]]]><![CDATA[>')}]]></content:encoded>${p.tags.map((t) => `<category>${xml(t)}</category>`).join('')}</item>`).join('\n');
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
  const urls = [['/', latest], ['/blog/', latest], ['/blog/archive/', latest], ...posts.map((p) => [`/blog/${encodeURI(p.slug)}/`, ymd(p.updated || p.date)]), ...(shown.length ? [['/gallery/', '']] : []), ...shown.map((a) => [`/gallery/${encodeURI(a.slug)}/`, ''])];
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
  notes.push(...albumNotes, ...linkNotes);
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
    if (!cfg.url) notes.push('site.config.mjs 的 url（正式域名）还空着：RSS、sitemap 和分享卡片里的地址现在是相对地址');
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
linkPosts(posts);
relate(posts);
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
