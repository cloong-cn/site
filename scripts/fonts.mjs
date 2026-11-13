// Chinese text in Source Han Sans (Noto Sans SC) on Windows and Android, instead of Microsoft YaHei / the system font.
// A full CJK font is several MB, so only the characters the site uses are cut out of it, at build time, in two parts:
//   - a shared file with the characters that appear on many pages. It is downloaded once and then cached, so moving
//     from page to page costs next to nothing;
//   - each page's own small file with the characters only it has (or few others have).
// Both come in a regular weight and a semibold one (the semibold holding only characters from headings and bold text).
// Apple devices keep using PingFang and download nothing (html.apple in base.css takes this family out of the font stack).
// Cuts are cached in .cache/fonts, so a rebuild only works on what changed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const FAMILY = 'Noto Sans SC Web';
const CJK = /[⺀-鿿豈-﫿︰-﹏＀-￯]/gu;
const RANGE = 'U+2E80-9FFF,U+F900-FAFF,U+FE30-FE4F,U+FF00-FFEF';
/* text set in a heavy weight: headings, bold, and the template's *-title / *-name elements */
const HEAVY = /<(h[1-6]|strong|b|th)\b[^>]*>([\s\S]*?)<\/\1>|<[a-z0-9]+\b[^>]*\bclass="[^"]*(?:title|name)\b[^"]*"[^>]*>([^<]*)/gi;
/* a character goes into the shared file when it appears on this share of the pages (and on at least two) */
const SHARE = 0.3;

function decode(s) {
  return s.replace(/&#(x[0-9a-f]+|\d+);/gi, (m, n) => { try { return String.fromCodePoint(/^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n)); } catch { return ''; } })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[n]));
}
const cjk = (s) => new Set(decode(s).match(CJK) || []);
const codepoints = (set) => [...set].sort().map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(',');
const minus = (a, b) => new Set([...a].filter((c) => !b.has(c)));
const both = (a, b) => new Set([...a].filter((c) => b.has(c)));

/* the characters on one finished page; extra is any text its scripts put on screen */
function charsOf(html, extra) {
  const visible = html
    .replace(/<(script|style|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const placeholders = [...visible.matchAll(/\b(?:placeholder|aria-label|title|alt)="([^"]*)"/g)].map((m) => m[1]).join('');
  const all = cjk(visible.replace(/<[^>]+>/g, ' ') + placeholders + (extra || ''));
  const heavy = new Set();
  for (const m of visible.matchAll(HEAVY)) for (const c of cjk((m[2] ?? m[3] ?? '').replace(/<[^>]+>/g, ''))) heavy.add(c);
  return { all, heavy };
}

export async function createFonts({ root, out, log }) {
  const source = path.join(root, 'src/fonts/source/NotoSansSC-VF.woff2');
  let subsetFont = null;
  try { subsetFont = (await import('subset-font')).default; } catch { /* not installed */ }
  if (!subsetFont || !existsSync(source)) {
    log('  ! 中文字体：没找到 subset-font 或 src/fonts/source/NotoSansSC-VF.woff2，中文用系统字体');
    return { plan: async () => {}, faces: async () => '' };
  }
  const cache = path.join(root, '.cache/fonts');
  let font = null;

  async function cut(chars, weight) {
    const text = [...chars].sort().join('');
    const key = createHash('sha256').update(`${weight}:${text}`).digest('hex').slice(0, 12);
    const cached = path.join(cache, `${key}.woff2`);
    let buf;
    if (existsSync(cached)) buf = await readFile(cached);
    else {
      font ??= await readFile(source);
      buf = await subsetFont(font, text, { targetFormat: 'woff2', variationAxes: { wght: weight } });
      await mkdir(cache, { recursive: true });
      await writeFile(cached, buf);
    }
    const rel = `fonts/sc-${weight}.${key}.woff2`;
    const file = path.join(out, 'assets', rel);
    if (!existsSync(file)) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, buf); }
    return rel;
  }

  let shared = { all: new Set(), heavy: new Set() };
  const face = (weight, url, range) => `@font-face{font-family:"${FAMILY}";font-weight:${weight};font-display:swap;src:url(${url}) format("woff2");unicode-range:${range}}`;

  return {
    /* looks at all the pages first: which characters are worth sharing. pages: [{ html, extra }] */
    async plan(pages) {
      const count = { all: new Map(), heavy: new Map() };
      for (const p of pages) {
        const c = charsOf(p.html, p.extra);
        for (const kind of ['all', 'heavy']) for (const ch of c[kind]) count[kind].set(ch, (count[kind].get(ch) || 0) + 1);
      }
      const least = Math.max(2, Math.ceil(pages.length * SHARE));
      const pick = (m) => new Set([...m].filter(([, n]) => n >= least).map(([ch]) => ch));
      shared = { all: pick(count.all), heavy: pick(count.heavy) };
    },
    /* the @font-face rules for one page */
    async faces(html, extra, asset) {
      const { all, heavy } = charsOf(html, extra);
      if (!all.size) return '';
      let css = '';
      /* for a character covered by two faces the browser takes the one declared last: the page's own file only
         lists its own characters, and everything else in the range falls to the shared file */
      if (shared.all.size) css += face(400, asset(await cut(shared.all, 400)), RANGE);
      const own = minus(all, shared.all);
      if (own.size) css += face(400, asset(await cut(own, 400)), shared.all.size ? codepoints(own) : RANGE);
      /* the semibold faces cover exactly the characters this page sets in bold: any other character asked for in bold
         falls back to the regular face, made bolder by the browser */
      const inShared = both(heavy, shared.heavy), inOwn = minus(heavy, shared.heavy);
      if (inShared.size) css += face(600, asset(await cut(shared.heavy, 600)), codepoints(inShared));
      if (inOwn.size) css += face(600, asset(await cut(inOwn, 600)), codepoints(inOwn));
      return `<style>${css}</style>`;
    },
  };
}
