// Small helpers shared by the page templates.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function md(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function longDate(d) {
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/* a stable pick from a short list, so the same title always gets the same colours */
export function pick(list, key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return list[h % list.length];
}
/* colours for generated tiles (an article without a picture): Apple's system hues in pairs */
const HUES = [['#0a84ff', '#5e5ce6'], ['#30d158', '#0a9396'], ['#ff9f0a', '#ff375f'], ['#64d2ff', '#0a84ff'], ['#ff6482', '#ff9f0a'], ['#34c7a4', '#30b0c7']];
export const tile = (key) => { const [a, b] = pick(HUES, key); return `--t1:${a};--t2:${b}`; };

/* 26000 → "2.6 万字", 6061 → "6061 字" */
export const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万字` : `${n} 字`);

export const icon = {
  /* Apple's "›" after a text link */
  chevron: '<svg class="chev" width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true"><path d="M1.2 1.2 5.8 6l-4.6 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg class="arrow"width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  external: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4 2h6v6M10 2 2.5 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="m12.5 12.5 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

/* its icon is drawn by theme-icon.js */
export function themeToggle() {
  return '<button class="icon-btn theme-toggle" type="button" data-theme-toggle aria-label="切换主题"></button>';
}

/* The top bar of every page: one capsule of glass floating at the top — the name, the places, the theme switch. A
   second capsule slides under the link of where you are (nav.js). A word leads to the same place from every page: the
   blog and the albums are pages of their own; the work and the word about me are parts of the home page, marked as you
   scroll past them there (home.js, data-top-link). current: 'blog' | 'gallery' | '' */
export function topNav(cfg, ctx, { home = false, current = '' } = {}) {
  const PAGES = [['blog', '博客', ctx.href('/blog/')]];
  if (cfg.hasGallery) PAGES.push(['gallery', '图集', ctx.href('/gallery/')]);
  const SECTIONS = [['work', '作品', home ? '#work' : ctx.href('/#work')], ['about', '关于', home ? '#about' : ctx.href('/#about')]];
  const link = ([id, label, href], section) => `<a href="${href}"${section ? ` data-top-link="${id}"` : ''}${id === current ? ' aria-current="true"' : ''}>${label}</a>`;
  return `<header class="topbar"><nav class="nav-pill glass" aria-label="站点导航" data-nav-pill data-refract>
<a class="nav-brand" href="${home ? '#home' : ctx.href('/')}">${esc(cfg.brand)}</a>
<span class="nav-links"><span class="nav-thumb" aria-hidden="true"></span>${PAGES.map((p) => link(p, false)).join('')}${SECTIONS.map((p) => link(p, true)).join('')}</span>
${themeToggle()}
</nav></header>`;
}

export function footer(cfg, ctx, extra = '') {
  const year = new Date().getFullYear();
  return `<footer class="site-foot"><span>© ${year} ${esc(cfg.name)}</span><nav aria-label="页脚"><a href="${ctx.href('/blog/')}">博客</a><a href="${ctx.href('/rss.xml')}">RSS</a>${cfg.links
    .map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
    .join('')}${extra}</nav></footer>`;
}

/* The ruler navigation: a scale of ticks while collapsed, a glass index when open. Used for the
   sections of the home page and for the headings of an article. items: { href, title, en?, go?, minor? } */
export function rulerNav({ side, kind, label, head, items, progress = false }) {
  const n = items.length;
  /* items: { href, title, en?, go?, level?, num? } — level 1–3 marks an outline entry (title, h2, h3);
     num replaces the running number ('' for none) */
  const lv = (it) => (it.level ? ` lv${it.level}` : '');
  const ticks = items.map((it, i) => `<span class="tick${lv(it)}${i === 0 ? ' is-active' : ''}" style="--k:${i}"></span>`).join('');
  const list = items.map((it, i) => {
    const num = it.num != null ? it.num : String(i + 1).padStart(2, '0');
    return `<li><a class="dial-item${lv(it)}" href="${esc(it.href)}"${it.go != null ? ` data-go="${it.go}"` : ''} aria-current="${i === 0}" data-dist="${Math.min(4, i)}">${num ? `<span class="dial-num">${num}</span>` : ''}<span class="dial-zh">${esc(it.title)}</span>${it.en ? `<span class="dial-en">${esc(it.en)}</span>` : ''}</a></li>`;
  }).join('');
  return `<nav class="sidenav" data-kind="${kind}" data-side="${side}" data-open="false" aria-label="${esc(label)}" style="--n:${n};--index:0">
<button class="ruler" type="button" aria-expanded="false" aria-controls="nav-panel" aria-label="打开${esc(label)}"><span class="ruler-scale"></span>${ticks}<span class="ruler-pointer"></span></button>
<div class="panel" id="nav-panel">
<div class="panel-head"><p class="eyebrow">${esc(head)}</p>${progress ? '<span class="read-pct num" data-read-pct>0%</span>' : ''}</div>
${progress ? '<div class="read-bar" aria-hidden="true"><span></span></div>' : ''}
<div class="dial-window"><ol class="dial">${list}</ol><span class="panel-pointer" aria-hidden="true"></span></div>
<div class="panel-foot"><span>位置</span><div class="seg" role="group" aria-label="导航显示在哪一侧"><button type="button" data-side-btn="left" aria-pressed="${side === 'left'}">左</button><button type="button" data-side-btn="right" aria-pressed="${side === 'right'}">右</button></div></div>
</div>
</nav>`;
}

/* <picture> for a processed image; base is what the asset paths are relative to.
   eager: a picture near the top of the page, fetched first rather than when it scrolls near */
export function picture(img, base, { alt = '', sizes = '100vw', eager = false } = {}) {
  const set = (list) => list.map(([u, w]) => `${base}${u} ${w}w`).join(', ');
  const fallback = img.webp.find(([, w]) => w >= 1200) || img.webp[img.webp.length - 1];
  return `<picture><source type="image/avif" srcset="${set(img.avif)}" sizes="${sizes}"><img src="${base}${fallback[0]}" srcset="${set(img.webp)}" sizes="${sizes}" width="${img.w}" height="${img.h}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></picture>`;
}

/* the blurred stand-in for a picture while it loads: a few hundred bytes, written into the page (base.css / blog.css) */
export function placeholder(img) {
  return img.lqip ? `<span class="media-ph" aria-hidden="true" style="background-image:url(${img.lqip})"></span>` : '';
}
