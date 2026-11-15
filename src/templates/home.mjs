import { esc, ymd, icon, topNav, footer, picture, placeholder, tile, wan } from './util.mjs';

/* the home page is one page that scrolls: the planet; one row of small cards about right now, and close under it
   the writing; the work and a word about me. The top bar (util.mjs, topNav) links the last three */

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

/* extra: more to say under the lead (the blog's numbers) */
function sectionHead(id, title, lead, extra = '') {
  return `<header class="sec-head">
<h2 class="sec-title" id="${id}-title">${title}</h2>
${lead ? `<p class="sec-lead">${esc(lead)}</p>` : ''}
${extra}
</header>`;
}

/* ------------------------------------------------------------------ now: small cards, like widgets */

/* One row of two cards: the time where I am, and the weather where the visitor is. The row shares out its width
   among the cards it has (--span, of six columns): without a time zone for me, the weather has it all.
   How much I have written sits with the blog, just below. The self-hosted services (site.json, lab) are not shown */
function now(cfg, ctx) {
  const here = cfg.here?.timeZone ? cfg.here : null;
  /* the sun's height over the day, drawn by home.js: time across (midnight to midnight), height up, the horizon at y=32 */
  const cards = [
    here && ((span) => `<article class="card w w-time" style="--span:${span}" data-w-time data-tz="${esc(here.timeZone)}">
<p class="w-label"><span>${esc(here.city || here.timeZone.split('/').pop().replace(/_/g, ' '))}</span><span data-w-diff></span></p>
<div class="w-when"><p class="w-big num" data-w-clock>--:--</p><p class="w-date num" data-w-date></p></div>
<svg class="w-arc" viewBox="0 0 300 64" aria-hidden="true"><path class="w-arc-track"/><path class="w-arc-done"/><line class="w-arc-ground" x1="0" y1="32" x2="300" y2="32"/><circle class="w-arc-sun" r="5" cx="-20" cy="-20"/></svg>
<p class="w-foot"><span data-w-rise></span><span data-w-set></span></p>
</article>`),
    /* the visitor's weather, its sky painted to match (home.js sets data-sky) */
    (span) => `<article class="card w w-weather" style="--span:${span}" data-w-weather data-sky="none">
<div class="w-sky" aria-hidden="true"><canvas class="w-sky-fx"></canvas></div>
<p class="w-label"><span>你那边的天气</span><span data-w-city></span></p>
<p class="w-big num" data-w-temp>--°</p>
<p class="w-text"><span data-w-sky>查询中</span> <span class="num" data-w-range></span></p>
<p class="w-foot"><span data-w-feel></span><span data-w-wind></span></p>
<button class="w-hit" type="button" data-w-week-open aria-haspopup="dialog" aria-label="查看你那边近 7 天的天气" hidden></button>
</article>`,
  ].filter(Boolean);
  return `<section class="sec sec-now" id="now" aria-labelledby="now-title">
<div class="container sec-inner">
${sectionHead('now', '此刻', '我这边的时间，和你那边的天气。')}
<div class="bento">
${cards.map((card) => card(6 / cards.length)).join('\n')}
</div>
${weekDialog()}
</div>
</section>`;
}

/* the next seven days where the visitor is, opened from the weather card; home.js fills the list */
function weekDialog() {
  return `<dialog class="w-week w-weather" data-w-week data-sky="none" aria-labelledby="w-week-title">
<div class="w-sky" aria-hidden="true"><canvas class="w-sky-fx"></canvas></div>
<div class="w-week-in">
<header class="w-week-head">
<div><p class="w-week-title" id="w-week-title"><span data-w-city></span> · 近 7 天</p><p class="w-week-now"><span class="num" data-w-week-temp></span><span data-w-week-sky></span></p></div>
<button class="w-week-close" type="button" data-w-week-close aria-label="关闭"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
</header>
<ol class="w-days" data-w-days></ol>
<p class="w-week-src">按你浏览器的时区推断城市 · 天气数据 Open-Meteo</p>
</div>
</dialog>`;
}

/* ------------------------------------------------------------------ blog: a grouped list, like a settings page */

function thumb(p, ctx) {
  if (p.thumb) return `<span class="row-thumb">${picture(p.thumb, ctx.asset(''), { sizes: '56px' })}</span>`;
  const glyph = [...(p.tags[0] || p.title)][0].toUpperCase();
  return `<span class="row-thumb is-glyph" style="${tile(p.tags[0] || p.title)}" aria-hidden="true">${esc(glyph)}</span>`;
}

/* how much there is to read, under the section's name: the count, the words, and how long the last few articles were */
function written(posts) {
  if (!posts.length) return '';
  const total = posts.reduce((n, p) => n + (p.words || 0), 0);
  const recent = posts.slice(0, 8).reverse();
  const most = Math.max(1, ...recent.map((p) => p.words || 0));
  return `<div class="written">
<p class="written-sum"><b class="num">${posts.length}</b> 篇<span>一共约 ${wan(total)}</span></p>
<div class="written-recent"><ol class="bars" aria-label="最近几篇文章的篇幅">${recent.map((p) => `<li style="--h:${Math.max(8, Math.round(((p.words || 0) / most) * 100))}%" title="${esc(p.title)}：${p.words} 字"></li>`).join('')}</ol><span>最近 ${recent.length} 篇的篇幅</span></div>
</div>`;
}

function blog(cfg, ctx, posts) {
  const rows = posts.slice(0, 5).map((p) => `<li><a class="row" href="${ctx.href(`/blog/${p.slug}/`)}">${thumb(p, ctx)}<span class="row-text"><span class="row-title">${esc(p.title)}</span><span class="row-sub">${esc(p.description)}</span></span><span class="row-date num">${ymd(p.date)}</span></a></li>`).join('');
  return `<section class="sec sec-blog" id="blog" aria-labelledby="blog-title">
<div class="container sec-inner">
${sectionHead('blog', '博客', cfg.blog.lead, written(posts))}
${rows ? `<ol class="card group">${rows}</ol>` : '<p class="post-empty">第一篇文章即将发布。</p>'}
<a class="text-link more-link" href="${ctx.href('/blog/')}">全部 ${posts.length} 篇文章${icon.chevron}</a>
</div>
</section>`;
}

/* ------------------------------------------------------------------ work: a bento of tiles */

/* "Node.js · HTML · CSS" in site.json becomes a short list, laid out with space rather than dots */
const stackOf = (s) => String(s || '').split(/\s*[·•,，、/|]\s*/).filter(Boolean);

function project(p, ctx, shape) {
  /* the article about it first (postHref: resolved from p.post by the build), then the outside links */
  const links = [p.postHref && `<a href="${esc(ctx.href(p.postHref))}">介绍文章 ${icon.chevron}</a>`, p.source &&`<a href="${esc(p.source)}" target="_blank" rel="noopener">源码 ${icon.external}</a>`, p.demo && `<a href="${esc(p.demo)}" target="_blank" rel="noopener">演示 ${icon.external}</a>`].filter(Boolean).join('');
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

const facts = (cfg) => cfg.about.facts || [];

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
${now(cfg, ctx)}
${blog(cfg, ctx, posts)}
${work(cfg, ctx)}
${about(cfg, ctx)}
</main>`,
    scripts: ['site-home.js'],
  };
}
