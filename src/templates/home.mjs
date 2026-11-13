import { esc, ymd, icon, topNav, footer, picture, placeholder } from './util.mjs';

/* the home page is one page that scrolls: the planet; a row of small cards about right now; the writing, the work
   and a word about me. The top bar (util.mjs, topNav) links the last three */

/* a stable pick from a short list, so the same title always gets the same colours */
function pick(list, key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return list[h % list.length];
}
/* colours for generated tiles (an article without a picture): Apple's system hues in pairs */
const HUES = [['#0a84ff', '#5e5ce6'], ['#30d158', '#0a9396'], ['#ff9f0a', '#ff375f'], ['#64d2ff', '#0a84ff'], ['#ff6482', '#ff9f0a'], ['#34c7a4', '#30b0c7']];
const tile = (key) => { const [a, b] = pick(HUES, key); return `--t1:${a};--t2:${b}`; };

/* 26000 → "2.6 万字", 6061 → "6061 字" */
const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万字` : `${n} 字`);

/* ------------------------------------------------------------------ hero */

// The visitor's city, local time, weather and next sunrise or sunset, on a pill of clear glass over the planet.
// Filled in by home.js; empty parts stay hidden.
function hud() {
  return `<div class="hud container"><p class="hud-pill glass-clear" aria-label="访客所在地" data-refract><span data-hud-city>当地</span><span class="num" data-hud-time></span><span class="num" data-hud-temp></span><span class="num" data-hud-sun></span></p></div>`;
}

function hero(cfg, ctx) {
  return `<section class="sec sec-hero" id="home" aria-labelledby="hero-title" data-tz-src="${ctx.asset(ctx.files['tz.json'])}">
<div class="hero-scene" aria-hidden="true"><canvas class="hero-canvas"></canvas></div>
<div class="container hero-body">
<p class="hero-role reveal" style="--i:0">${esc(cfg.role)}</p>
<h1 class="hero-name reveal" id="hero-title" style="--i:1">${esc(cfg.name)}</h1>
<p class="hero-intro reveal" style="--i:2">${esc(cfg.hero.intro)}</p>
<div class="hero-actions reveal" style="--i:3"><a class="btn btn-primary" href="${ctx.href('/blog/')}">阅读博客</a><a class="text-link" href="#work">查看作品${icon.chevron}</a></div>
</div>
${hud()}
</section>`;
}

function sectionHead(id, title, lead) {
  return `<header class="sec-head">
<h2 class="sec-title" id="${id}-title">${title}</h2>
${lead ? `<p class="sec-lead">${esc(lead)}</p>` : ''}
</header>`;
}

/* ------------------------------------------------------------------ now: small cards, like widgets */

function now(cfg, ctx, posts) {
  const latest = posts[0];
  const total = posts.reduce((n, p) => n + (p.words || 0), 0);
  const recent = posts.slice(0, 8).reverse();
  const most = Math.max(1, ...recent.map((p) => p.words || 0));
  return `<section class="sec sec-now" id="now" aria-labelledby="now-title">
<div class="container sec-inner">
${sectionHead('now', '此刻', '你那边的此刻，和我这边的近况。')}
<div class="bento">
<article class="card w w-time" data-w-time>
<p class="w-label"><span>当地时间</span><span data-w-city></span></p>
<p class="w-big num" data-w-clock>--:--</p>
<svg class="w-arc" viewBox="0 0 300 96" aria-hidden="true"><path class="w-arc-track" d="M14 88A136 76 0 0 1 286 88" pathLength="100"/><path class="w-arc-done" d="M14 88A136 76 0 0 1 286 88" pathLength="100"/><line class="w-arc-ground" x1="0" y1="88" x2="300" y2="88"/><circle class="w-arc-sun" r="6" cx="-20" cy="-20"/></svg>
<p class="w-foot"><span data-w-rise>日出</span><span data-w-set>日落</span></p>
</article>
<article class="card w w-weather" data-w-weather>
<p class="w-label"><span>天气</span></p>
<p class="w-big num" data-w-temp>—</p>
<p class="w-text" data-w-sky>查询中</p>
<p class="w-foot"><span data-w-humid></span></p>
</article>
${latest ? `<a class="card w w-post" href="${ctx.href(`/blog/${latest.slug}/`)}">
<p class="w-label"><span>最新文章</span></p>
<p class="w-title">${esc(latest.title)}</p>
<p class="w-sub">${esc(latest.description)}</p>
<p class="w-foot"><span class="num">${ymd(latest.date)}</span><span>阅读约 ${latest.minutes} 分钟</span></p>
</a>` : ''}
<article class="card w w-stats">
<p class="w-label"><span>写作</span></p>
<p class="w-big num">${posts.length}<small> 篇</small></p>
<p class="w-text">一共约 ${wan(total)}</p>
<div class="w-foot"><span>最近 ${recent.length} 篇的篇幅</span><ol class="w-bars" aria-label="最近几篇文章的篇幅">${recent.map((p) => `<li style="--h:${Math.max(8, Math.round(((p.words || 0) / most) * 100))}%" title="${esc(p.title)}：${p.words} 字"></li>`).join('')}</ol></div>
</article>
</div>
</div>
</section>`;
}

/* ------------------------------------------------------------------ blog: a grouped list, like a settings page */

function thumb(p, ctx) {
  if (p.thumb) return `<span class="row-thumb">${picture(p.thumb, ctx.asset(''), { sizes: '56px' })}</span>`;
  const glyph = [...(p.tags[0] || p.title)][0].toUpperCase();
  return `<span class="row-thumb is-glyph" style="${tile(p.tags[0] || p.title)}" aria-hidden="true">${esc(glyph)}</span>`;
}

function blog(cfg, ctx, posts) {
  const rows = posts.slice(0, 5).map((p) => `<li><a class="row" href="${ctx.href(`/blog/${p.slug}/`)}">${thumb(p, ctx)}<span class="row-text"><span class="row-title">${esc(p.title)}</span><span class="row-sub">${esc(p.description)}</span></span><span class="row-date num">${ymd(p.date)}</span></a></li>`).join('');
  return `<section class="sec sec-blog" id="blog" aria-labelledby="blog-title">
<div class="container sec-inner">
${sectionHead('blog', '博客', cfg.blog.lead)}
${rows ? `<ol class="card group">${rows}</ol>` : '<p class="post-empty">第一篇文章即将发布。</p>'}
<a class="text-link more-link" href="${ctx.href('/blog/')}">全部 ${posts.length} 篇文章${icon.chevron}</a>
</div>
</section>`;
}

/* ------------------------------------------------------------------ work: a bento of tiles */

/* "Node.js · HTML · CSS" in site.json becomes a short list, laid out with space rather than dots */
const stackOf = (s) => String(s || '').split(/\s*[·•,，、/|]\s*/).filter(Boolean);

function project(p, ctx, shape) {
  const links = [p.source && `<a href="${esc(p.source)}" target="_blank" rel="noopener">源码 ${icon.external}</a>`, p.demo && `<a href="${esc(p.demo)}" target="_blank" rel="noopener">演示 ${icon.external}</a>`].filter(Boolean).join('');
  const src = p.image && (p.image.startsWith('/') ? ctx.href(p.image) : p.image);
  const img = p.media ? picture(p.media, ctx.asset(''), { alt: `${p.name}的截图`, sizes: shape === 'wide' ? '(max-width: 900px) calc(100vw - 48px), 560px' : '(max-width: 900px) calc(100vw - 48px), 420px' })
    : src ? `<img src="${esc(src)}" alt="${esc(p.name)}的截图" loading="lazy" decoding="async">` : '';
  const ph = p.media ? placeholder(p.media) : '';
  const live = p.live === 'planet' ? '<canvas class="live-canvas" data-live="planet" aria-hidden="true"></canvas>' : '';
  const stack = stackOf(p.stack);
  const foot = `<div class="project-foot">${stack.length ? `<ul class="project-stack" aria-label="技术栈">${stack.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<span></span>'}${links ? `<span class="project-links">${links}</span>` : ''}</div>`;
  /* the featured tile: the picture (or the live scene) fills it, the words sit on clear glass over it */
  if (shape === 'feature') {
    return `<article class="card tile is-feature${live ? ' is-live' : ''}">
<div class="tile-media inset">${live || ph + img}</div>
<div class="tile-over glass"><h3 class="project-name">${esc(p.name)}</h3><p class="project-desc">${esc(p.desc)}</p>${foot}</div>
</article>`;
  }
  return `<article class="card tile is-${shape}${img || live ? '' : ' is-text'}">
${img || live ? `<div class="tile-media inset">${live || ph + img}<span class="tile-name" data-refract>${esc(p.name)}</span></div>` : ''}
<div class="tile-body">${img || live ? '' : `<h3 class="project-name">${esc(p.name)}</h3>`}<p class="project-desc">${esc(p.desc)}</p>${foot}</div>
</article>`;
}

function work(cfg, ctx) {
  /* the first project is the big one; after it the tiles go half, half, full width, and again */
  const SHAPES = ['half', 'half', 'wide'];
  const tiles = cfg.work.projects.map((p, i) => project(p, ctx, i === 0 ? 'feature' : SHAPES[(i - 1) % 3])).join('');
  return `<section class="sec sec-work" id="work" aria-labelledby="work-title">
<div class="container sec-inner">
${sectionHead('work', '作品', cfg.work.lead)}
<div class="work-bento">${tiles}</div>
</div>
</section>`;
}

/* ------------------------------------------------------------------ about */

/* the self-hosted services used to have a section of their own; now they are one line among the facts */
function facts(cfg) {
  const rows = cfg.hero.now ? [['正在做', cfg.hero.now], ...cfg.about.facts] : [...cfg.about.facts];
  const services = (cfg.lab?.services || []).filter((s) => s.status !== 'maintenance').map((s) => s.name).filter(Boolean);
  if (services.length) rows.push(['自托管', services.join('、')]);
  return rows;
}

function about(cfg, ctx) {
  return `<section class="sec sec-about" id="about" aria-labelledby="about-title">
<div class="container sec-inner">
${sectionHead('about', '关于', '')}
<div class="about-grid">
<p class="statement">${esc(cfg.about.statement)}</p>
<div>
<dl class="facts">${facts(cfg).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
<div class="social">${cfg.links.map((l) => `<a class="text-link" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ${icon.external}</a>`).join('')}<a class="text-link" href="${ctx.href('/rss.xml')}">RSS 订阅</a></div>
</div>
</div>
${footer(cfg, ctx, '<a href="https://open-meteo.com/" target="_blank" rel="noopener">天气数据 Open-Meteo</a>')}
</div>
</section>`;
}

export function homePage(cfg, ctx, posts) {
  return {
    path: '/',
    data: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: cfg.title || cfg.name,
      url: `${cfg.url}/`,
      inLanguage: cfg.lang,
      author: { '@type': 'Person', name: cfg.name, url: `${cfg.url}/`, sameAs: (cfg.links || []).map((l) => l.href).filter((h) => /^https?:/.test(h)) },
    },
    bodyClass: 'home',
    body: `${topNav(cfg, ctx, { home: true })}
<main id="main" class="home-main">
${hero(cfg, ctx)}
${now(cfg, ctx, posts)}
${blog(cfg, ctx, posts)}
${work(cfg, ctx)}
${about(cfg, ctx)}
</main>`,
    scripts: ['site-home.js'],
  };
}
