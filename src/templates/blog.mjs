import { esc, md, ymd, longDate, icon, topNav, footer, rulerNav, picture, placeholder, tile, wan } from './util.mjs';

/* the same floating capsule as the home page (util.mjs) */
const pageTop = (cfg, ctx, current) => topNav(cfg, ctx, { current });

/* the blog's own addresses, kept in one place so the blog can later move to a domain of its own */
const BLOG = '/blog/';
const ARCHIVE = '/blog/archive/';
const tagHref = (ctx, t) => ctx.href(`${ARCHIVE}?tag=${encodeURIComponent(t)}`);

function byYear(posts) {
  const years = [];
  for (const p of posts) {
    const y = String(p.date.getFullYear());
    let g = years.find((x) => x.year === y);
    if (!g) years.push((g = { year: y, posts: [] }));
    g.posts.push(p);
  }
  return years;
}

/* ------------------------------------------------------------------ the blog's front page */

/* an article's picture, or a tile in its first tag's colours with the tag's first letter */
function cover(p, ctx, sizes, eager = false) {
  if (p.thumb) return `${placeholder(p.thumb)}${picture(p.thumb, ctx.asset(''), { sizes, eager })}`;
  const key = p.tags[0] || p.title;
  return `<span class="cover-art" style="${tile(key)}" aria-hidden="true"><span class="cover-glyph">${esc([...key][0].toUpperCase())}</span><span class="cover-word">${esc(key)}</span></span>`;
}

const meta = (p) => `<time datetime="${ymd(p.date)}">${longDate(p.date)}</time><span>阅读约 ${p.minutes} 分钟</span>`;

function feature(p, ctx) {
  return `<a class="card feature" href="${ctx.href(`${BLOG}${p.slug}/`)}">
<div class="feature-media inset">${cover(p, ctx, '(max-width: 900px) calc(100vw - 48px), 640px', true)}</div>
<div class="feature-body">
<p class="feature-meta"><span class="badge">最新</span>${meta(p)}</p>
<h2 class="feature-title">${esc(p.title)}</h2>
${p.description ? `<p class="feature-desc">${esc(p.description)}</p>` : ''}
<p class="feature-foot">${p.tags.length ? `<span class="tag-line">${p.tags.map(esc).join(' · ')}</span>` : '<span></span>'}<span class="text-link">阅读全文${icon.chevron}</span></p>
</div>
</a>`;
}

function postCard(p, ctx, big) {
  return `<li class="${big ? 'is-big' : ''}"><a class="card pcard" href="${ctx.href(`${BLOG}${p.slug}/`)}">
<div class="pcard-media inset">${cover(p, ctx, big ? '(max-width: 640px) calc(100vw - 48px), (max-width: 900px) 45vw, 560px' : '(max-width: 640px) calc(100vw - 48px), (max-width: 900px) 45vw, 380px')}</div>
<div class="pcard-body">
<p class="pcard-meta">${meta(p)}</p>
<h3 class="pcard-title">${esc(p.title)}</h3>
${p.description ? `<p class="pcard-desc">${esc(p.description)}</p>` : ''}
${p.tags.length ? `<p class="tag-line">${p.tags.map(esc).join(' · ')}</p>` : ''}
</div>
</a></li>`;
}

function topics(posts, tags, ctx) {
  return tags.map((t) => {
    const latest = posts.find((p) => p.tags.includes(t.name));
    return `<li><a class="card topic" href="${tagHref(ctx, t.name)}" style="${tile(t.name)}">
<span class="topic-head"><span class="topic-dot" aria-hidden="true"></span><span class="topic-name">${esc(t.name)}</span><span class="topic-count num">${t.count} 篇</span></span>
${latest ? `<span class="topic-latest">${esc(latest.title)}</span>` : ''}
</a></li>`;
  }).join('');
}

const secHead = (id, title, link = '') => `<header class="bh-sec-head"><h2 id="${id}">${title}</h2>${link}</header>`;

export function blogHomePage(cfg, ctx, posts, tags) {
  const lead = cfg.blog?.lead || '';
  const words = posts.reduce((n, p) => n + (p.words || 0), 0);
  const [first, ...rest] = posts;
  const recent = rest.slice(0, 5);
  const years = byYear(posts);
  const archiveHref = ctx.href(ARCHIVE);
  const allLink = `<a class="text-link" href="${archiveHref}">全部 ${posts.length} 篇${icon.chevron}</a>`;
  return {
    path: BLOG,
    title: '博客',
    description: lead || `${cfg.name} 的博客`,
    bodyClass: 'blog blog-home',
    data: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: `${cfg.name} 的博客`,
      description: lead || undefined,
      url: `${cfg.url}${BLOG}`,
      inLanguage: cfg.lang,
      author: { '@type': 'Person', name: cfg.name, url: `${cfg.url}/` },
    },
    body: `${pageTop(cfg, ctx, 'blog')}
<main id="main" class="page-main" data-blog-home data-archive-href="${esc(archiveHref)}">
<div class="container">
<header class="bh-head">
<p class="bh-eyebrow">${esc(cfg.brand || cfg.name)} 的博客</p>
<h1 class="bh-title">${esc(lead || '博客')}</h1>
<ul class="bh-stats" aria-label="博客概况">
<li><b class="num">${posts.length}</b> 篇文章</li>
${words ? `<li>约 <b class="num">${wan(words).replace(/\s*字$/, '')}</b> 字</li>` : ''}
${tags.length ? `<li><b class="num">${tags.length}</b> 个主题</li>` : ''}
${first ? `<li>最近更新 <b class="num">${ymd(first.date)}</b></li>` : ''}
</ul>
<div class="bh-actions">
<form class="bh-search glass" action="${archiveHref}" method="get" role="search" data-refract>${icon.search}<label class="sr-only" for="bh-q">搜索文章</label><input id="bh-q" name="q" type="search" placeholder="搜索标题、摘要或标签" autocomplete="off" enterkeyhint="search"></form>
<a class="btn btn-ghost" href="${ctx.href('/rss.xml')}">RSS 订阅</a>
</div>
</header>

${first ? `<section class="bh-feature" aria-label="最新文章">${feature(first, ctx)}</section>` : '<p class="empty">第一篇文章即将发布。</p>'}

${recent.length ? `<section class="bh-sec" aria-labelledby="bh-recent">
${secHead('bh-recent', '最近更新', allLink)}
<ol class="post-grid">${recent.map((p, i) => postCard(p, ctx, i < 2)).join('')}</ol>
</section>` : ''}

${tags.length ? `<section class="bh-sec" aria-labelledby="bh-topics">
${secHead('bh-topics', '主题')}
<ul class="topic-grid">${topics(posts, tags, ctx)}</ul>
</section>` : ''}

${posts.length ? `<section class="bh-sec" aria-labelledby="bh-archive">
${secHead('bh-archive', '归档')}
<a class="card bh-archive" href="${archiveHref}">
<span class="bh-archive-text"><span class="bh-archive-title">全部文章</span><span class="bh-archive-sub">按时间排列，可以搜索，也可以按主题筛选</span></span>
<span class="bh-years">${years.map((y) => `<span class="bh-year"><b class="num">${y.year}</b><small>${y.posts.length} 篇</small></span>`).join('')}</span>
<span class="bh-archive-go" aria-hidden="true">${icon.arrow}</span>
</a>
</section>` : ''}

<div class="archive-foot">${footer(cfg, ctx)}</div>
</div>
</main>`,
    scripts: ['site-blog.js'],
  };
}

/* ------------------------------------------------------------------ the archive: every article, searchable */

export function archivePage(cfg, ctx, posts, tags) {
  const years = byYear(posts);
  const groups = years.map((g) => `<section class="year" id="y${g.year}" data-year>
<div class="year-head"><h2 class="num">${g.year}</h2><span data-year-count>${g.posts.length} 篇</span></div>
<ol>${g.posts.map((p) => {
    const search = [p.title, p.description, p.tags.join(' ')].join(' ').toLowerCase();
    return `<li class="post-row" data-post data-tags="${esc(p.tags.join('|'))}" data-search="${esc(search)}" data-date="${ymd(p.date)}"><a href="${ctx.href(`${BLOG}${p.slug}/`)}"><span class="date">${md(p.date)}</span><span class="title">${esc(p.title)}</span><span class="tags">${esc(p.tags.join('、'))}</span></a></li>`;
  }).join('')}</ol>
</section>`).join('\n');

  return {
    path: ARCHIVE,
    title: '全部文章',
    description: `${cfg.name} 的全部文章`,
    bodyClass: 'blog',
    body: `${pageTop(cfg, ctx, 'blog')}
<main id="main" class="page-main" data-archive>
<div class="container"><header class="archive-head">
<a class="back" href="${ctx.href(BLOG)}">${icon.back} 博客</a>
<h1 class="archive-title">全部文章</h1>
<p class="archive-sub">共 <span class="num" data-count>${posts.length}</span> 篇，按时间倒序</p>
</header></div>
<div class="filters"><div class="container filters-row">
<div class="search-wrap" data-search-wrap>
<label class="search glass" data-refract>${icon.search}<span class="sr-only">搜索文章</span><input type="search" placeholder="搜索标题、摘要或标签" autocomplete="off" enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="search-pop" aria-autocomplete="list"></label>
<div class="search-pop glass" id="search-pop" role="listbox" aria-label="搜索结果" data-search-pop hidden></div>
</div>
<div class="seg glass" role="group" aria-label="按标签筛选" data-seg><span class="seg-thumb" aria-hidden="true"></span>
<button class="chip" type="button" data-tag="" aria-pressed="true">全部 <span class="count">${posts.length}</span></button>
${tags.map((t) => `<button class="chip" type="button" data-tag="${esc(t.name)}" aria-pressed="false">${esc(t.name)} <span class="count">${t.count}</span></button>`).join('\n')}
</div>
</div></div>
<div class="container">
${groups}
<p class="empty" data-empty hidden>没有找到相关文章，换个关键词试试。</p>
<div class="archive-foot">${footer(cfg, ctx)}</div>
</div>
</main>`,
    scripts: ['site-blog.js'],
  };
}

/* the article's outline for the ruler, three levels deep: the title, every h2 (numbered 01, 02 …)
   and every h3 under it; h4 and below stay out */
function outline(post) {
  const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  let h2 = 0;
  const heads = [...post.html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map((m) => {
    const level = Number(m[1]);
    if (level === 2) h2++;
    return { href: `#${m[2]}`, title: text(m[3]), level, num: level === 2 ? String(h2).padStart(2, '0') : '' };
  });
  return heads.length >= 2 ? [{ href: '#article-title', title: post.title, level: 1, num: '' }, ...heads] : [];
}

export function postPage(cfg, ctx, post, older, newer) {
  const toc = outline(post);
  return {
    path: `/blog/${post.slug}/`,
    title: post.title,
    description: post.description,
    ogType: 'article',
    image: post.share ? `${cfg.url}/assets/${post.share}` : undefined,
    head: `<meta property="article:published_time" content="${ymd(post.date)}">\n${post.updated ? `<meta property="article:modified_time" content="${ymd(post.updated)}">\n` : ''}${post.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join('\n')}`,
    /* structured data: search engines show the date and author with the result */
    data: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: ymd(post.date),
      ...(post.updated ? { dateModified: ymd(post.updated) } : {}),
      inLanguage: cfg.lang,
      url: `${cfg.url}/blog/${encodeURI(post.slug)}/`,
      mainEntityOfPage: `${cfg.url}/blog/${encodeURI(post.slug)}/`,
      image: post.share ? `${cfg.url}/assets/${post.share}` : `${cfg.url}/og.jpg`,
      author: { '@type': 'Person', name: cfg.name, url: `${cfg.url}/` },
      keywords: post.tags.join(', '),
    },
    bodyClass: 'post',
    styles: post.math ? ['katex.css'] : [], /* only a page with a formula loads KaTeX's stylesheet and fonts */
    body: `${pageTop(cfg, ctx, 'blog')}
<main id="main" class="page-main">
<article class="article" data-share-title="${esc(post.title)}" data-share-desc="${esc(post.description)}" data-share-date="${esc(longDate(post.date))}" data-share-site="${esc(`${cfg.brand || cfg.name} 的博客`)}">
<a class="back" href="${ctx.href(BLOG)}">${icon.back} 博客</a>
<div class="article-bar"><p class="article-meta"><time datetime="${ymd(post.date)}">${longDate(post.date)}</time>${post.updated ? `<span>更新于 <time datetime="${ymd(post.updated)}">${longDate(post.updated)}</time></span>` : ''}<span>约 ${wan(post.words || 0)}</span><span>阅读约 ${post.minutes} 分钟</span></p>${shareButton()}</div>
<h1 class="article-title" id="article-title">${esc(post.title)}</h1>
${post.description ? `<p class="article-lead">${esc(post.description)}</p>` : ''}
${post.tags.length ? `<div class="article-tags">${post.tags.map((t) => `<a href="${tagHref(ctx, t)}">${esc(t)}</a>`).join('')}</div>` : ''}
<p class="age-note" data-age="${ymd(post.updated || post.date)}"${post.updated ? ' data-updated' : ''} hidden></p>
${series(ctx, post)}
<div class="prose">
${post.html}
</div>
${seriesNext(ctx, post)}
${backlinks(ctx, post)}
${related(ctx, post)}
${refData(post)}
${older || newer ? `<nav class="post-nav" aria-label="其他文章">
${older ? `<a class="prev" href="${ctx.href(`/blog/${older.slug}/`)}"><span class="label">上一篇</span><span class="t">${esc(older.title)}</span></a>` : ''}
${newer ? `<a class="next" href="${ctx.href(`/blog/${newer.slug}/`)}"><span class="label">下一篇</span><span class="t">${esc(newer.title)}</span></a>` : ''}
</nav>` : ''}
${comments(cfg, ctx, post)}
<div class="article-foot">${footer(cfg, ctx)}</div>
</article>
</main>
${toc.length ? rulerNav({ side: cfg.navSide === 'right' ? 'right' : 'left', kind: 'toc', label: '文章目录', head: '目录', progress: true, items: toc }) : ''}`,
    scripts: ['site-blog.js'],
  };
}

/* the article's share button: its menu (copy the link, a picture to share, X, Weibo) is built by share.js */
function shareButton() {
  return `<button class="share-btn" type="button" data-share aria-haspopup="menu" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10V2.2M5 4.8 8 1.8l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.2 7H4a1.5 1.5 0 0 0-1.5 1.5v4.8A1.5 1.5 0 0 0 4 14.8h8a1.5 1.5 0 0 0 1.5-1.5V8.5A1.5 1.5 0 0 0 12 7h-1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>分享</button>`;
}

/* `series: 名称` in several articles: every part, oldest first, this one marked; folded to the nearest few when long */
function series(ctx, post) {
  const list = post.seriesPosts;
  if (!list) return '';
  const at = list.indexOf(post);
  const near = (i) => list.length <= 6 || Math.abs(i - at) <= 2 || i === 0 || i === list.length - 1;
  return `<nav class="series" aria-label="系列：${esc(post.series)}">
<p class="series-head"><span class="series-label">系列</span><span class="series-name">${esc(post.series)}</span><span class="series-pos num">第 ${at + 1} 篇，共 ${list.length} 篇</span></p>
<ol class="series-list">${list.map((p, i) => `<li${near(i) ? '' : ' class="is-far"'}>${p === post ? `<span class="series-item is-current" aria-current="page"><span class="series-n num">${i + 1}</span>${esc(p.title)}</span>` : `<a class="series-item" href="${ctx.href(`${BLOG}${p.slug}/`)}"><span class="series-n num">${i + 1}</span>${esc(p.title)}</a>`}</li>`).join('')}</ol>
${list.some((p, i) => !near(i)) ? `<button class="series-more" type="button" data-series-more>显示全部 ${list.length} 篇</button>` : ''}
</nav>`;
}

/* at the end of a part, the way on to the next one */
function seriesNext(ctx, post) {
  const list = post.seriesPosts;
  const next = list && list[list.indexOf(post) + 1];
  if (!next) return '';
  return `<a class="series-next" href="${ctx.href(`${BLOG}${next.slug}/`)}"><span class="series-next-label">「${esc(post.series)}」下一篇</span><span class="series-next-t">${esc(next.title)}</span>${icon.arrow}</a>`;
}

/* articles on the same subjects (build.mjs, relate) */
function related(ctx, post) {
  const list = post.related || [];
  if (!list.length) return '';
  return `<section class="related" aria-labelledby="related-title">
<h2 class="bl-title" id="related-title">相关文章</h2>
<ul class="rel-list">${list.map((p) => `<li><a class="rel-item" href="${ctx.href(`${BLOG}${p.slug}/`)}">
<span class="rel-t">${esc(p.title)}</span>
${p.description ? `<span class="rel-d">${esc(p.description)}</span>` : ''}
<span class="rel-m"><time class="num" datetime="${ymd(p.date)}">${ymd(p.date)}</time>${p.tags.length ? `<span>${esc(p.tags.join(' · '))}</span>` : ''}</span>
</a></li>`).join('')}</ul>
</section>`;
}

/* the other articles that link to this one (build.mjs, linkPosts), each with the words around its link */
function backlinks(ctx, post) {
  const list = post.backlinks || [];
  if (!list.length) return '';
  return `<section class="backlinks" aria-labelledby="backlinks-title">
<h2 class="bl-title" id="backlinks-title">提到这篇的文章<span class="bl-count num">${list.length}</span></h2>
<ul class="bl-list">${list.map(({ post: p, context }) => `<li><a class="bl-item" href="${ctx.href(`${BLOG}${p.slug}/`)}">
<span class="bl-head"><span class="bl-t">${esc(p.title)}</span><time class="num" datetime="${ymd(p.date)}">${ymd(p.date)}</time></span>
${context ? `<span class="bl-ctx">${context}</span>` : ''}
</a></li>`).join('')}</ul>
</section>`;
}

/* what the card shown over a link to another article says (linkcard.js): only the articles this page links to */
function refData(post) {
  const refs = new Map();
  for (const p of post.links || []) {
    refs.set(p.slug, { t: p.title, d: ymd(p.date), m: p.minutes, s: p.description, g: p.tags });
  }
  if (!refs.size) return '';
  return `<script type="application/json" id="ref-data">${JSON.stringify(Object.fromEntries(refs)).replace(/</g, '\\u003c')}</script>`;
}

/* the slugs the comment service accepts (Comments.SLUG on the Java side) */
export const COMMENT_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,119}$/u;
export const commentsOn = (cfg, post) => Boolean(cfg.comments?.enabled) && post.comments !== false && COMMENT_SLUG.test(post.slug) && !post.slug.includes('..');

/* sample comments, shown instead of the real ones when building with COMMENTS_DEMO=1 (a preview with no comment service) */
const DEMO = [
  { id: 1, parent: null, name: '林间', url: 'https://example.com', content: '写得很清楚，正好在找 Java 21 虚拟线程的实际用法。\n想问一下：数据库连接池满的时候，有什么好的排查办法吗？', owner: false, ago: 3 * 86400e3 },
  { id: 2, parent: 1, name: '', url: null, content: '谢谢！先看 pg_stat_activity 里每个连接在跑什么，再看有没有忘了归还连接的地方，后面我单独写一篇。', owner: true, ago: 2 * 86400e3 },
  { id: 3, parent: null, name: 'Mia', url: null, content: '代码块的配色好舒服 👍', owner: false, ago: 5 * 3600e3 },
];

/* the comment section: an empty frame; site-blog.js fills it from the comment service once the reader gets near it,
   and leaves it hidden when the service cannot be reached */
function comments(cfg, ctx, post) {
  if (!commentsOn(cfg, post) || (ctx.preview && !ctx.demo)) return '';
  const demo = ctx.demo ? `<script type="application/json" id="cm-demo">${JSON.stringify(DEMO.map((c) => ({ ...c, name: c.owner ? cfg.name : c.name, at: Date.now() - c.ago }))).replace(/</g, '\\u003c')}</script>` : '';
  return `<section class="comments" id="comments" data-comments data-post="${esc(post.slug)}" data-api="${esc(cfg.comments.api || '/api/comments')}"${ctx.dev ? ' data-dev' : ''}${demo ? ' data-demo' : ''} aria-labelledby="comments-title" hidden>
<header class="cm-head"><h2 class="cm-title" id="comments-title">评论<span class="cm-count num" data-count></span></h2></header>
<p class="cm-notice" data-notice hidden></p>
<ol class="cm-list" data-list></ol>
<p class="cm-empty" data-empty hidden>还没有评论，来写第一条吧。</p>
<form class="cm-form" data-form novalidate>
<div class="cm-replying" data-replying hidden><span>回复 <b data-replying-name></b></span><button type="button" class="cm-link" data-cancel>取消</button></div>
<div class="cm-compose glass" data-refract>
<label class="cm-box"><span class="sr-only">评论内容</span><textarea name="content" rows="1" maxlength="4000" placeholder="写下你的想法…" required></textarea></label>
<button class="cm-send" type="submit" aria-label="发表评论"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
</div>
<div class="cm-more"><div class="cm-more-in">
<div class="cm-row">
<label class="cm-field"><input name="name" maxlength="40" autocomplete="nickname" placeholder=" " required><span class="cm-label">昵称</span></label>
<label class="cm-field"><input name="email" type="email" maxlength="120" autocomplete="email" inputmode="email" placeholder=" "><span class="cm-label">邮箱（选填，不会公开）</span></label>
<label class="cm-field"><input name="url" maxlength="200" autocomplete="url" inputmode="url" autocapitalize="off" spellcheck="false" placeholder=" "><span class="cm-label">网站（选填）</span></label>
</div>
<div class="cm-actions"><p class="cm-note">评论审核后显示。⌘ / Ctrl + Enter 发送</p><span class="cm-len num" data-len></span></div>
</div></div>
<div class="cm-trap" aria-hidden="true"><label>留空<input name="website2" tabindex="-1" autocomplete="off"></label></div>
<p class="cm-status" data-status role="status" aria-live="polite"></p>
</form>
${demo}</section>`;
}

/* /admin/: the back office (writing, comments, home page, releases). An empty frame filled by site-admin.js; not linked
   anywhere, kept out of search engines, and only its own scripts may run on it (see layout.mjs, csp) */
export function adminPage(cfg, ctx) {
  const ico = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const tool = (cmd, label, svg, key) => `<button type="button" class="ed-tool" data-cmd="${cmd}" title="${label}${key ? `（${key}）` : ''}" aria-label="${label}">${svg}</button>`;
  const field = (name, label, attrs = '') => `<label class="cm-field"><input name="${name}" placeholder=" " autocomplete="off" ${attrs}><span class="cm-label">${label}</span></label>`;
  return {
    path: '/_admin/',
    title: '后台',
    bodyClass: 'admin-page',
    head: '<meta name="robots" content="noindex, nofollow">\n<meta name="referrer" content="no-referrer">',
    csp: !ctx.dev,
    /* pictures copied in SiYuan point at its local server; the editor fetches them from there when SiYuan is running */
    connect: 'http://127.0.0.1:6806 http://localhost:6806',
    styles: ['admin.css'],
    body: `${pageTop(cfg, ctx, '')}
<main id="main" class="page-main admin" data-admin data-css="${ctx.asset(ctx.files['site.css'])}">

<section class="admin-login" data-view="login" hidden>
<p class="eyebrow">Admin</p>
<h1 class="admin-title">后台</h1>
<p class="admin-sub">登录后可以写文章、管理评论和修改主页。</p>
<form class="login-form" data-login novalidate>
<label class="cm-field"><input type="password" name="password" autocomplete="current-password" placeholder=" " required><span class="cm-label">管理密码</span></label>
<label class="cm-field"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" placeholder=" " required><span class="cm-label">验证码（手机验证器上的 6 位数）</span></label>
<button class="btn btn-primary" type="submit">登录</button>
<p class="cm-status" data-login-status role="status" aria-live="polite"></p>
</form>
</section>

<section class="admin-app" data-view="app" hidden>
<div class="admin-bar">
<nav class="seg admin-tabs" aria-label="后台">
<a href="#/posts" data-tab="posts">文章</a>
<a href="#/albums" data-tab="albums">图集</a>
<a href="#/comments" data-tab="comments">评论 <span class="num tab-badge" data-pending></span></a>
<a href="#/site" data-tab="site">主页</a>
<a href="#/deploys" data-tab="deploys">发布 <span class="tab-dot" data-backup-dot hidden></span></a>
<a href="#/security" data-tab="security">安全</a>
</nav>
<button class="cm-link admin-logout" type="button" data-logout>退出登录</button>
</div>
<p class="admin-banner" data-banner hidden></p>

<div class="pane" data-pane="posts" hidden>
<div class="pane-head"><h1 class="pane-title">文章</h1>
<div class="pane-actions"><button class="btn btn-ghost pane-action" type="button" data-import-open>导入</button><a class="btn btn-ghost pane-action" data-export-all download>导出全部</a><a class="btn btn-primary pane-action" href="#/new">新文章</a></div></div>

<form class="import-box" data-import hidden novalidate>
<label class="drop" data-import-drop>
<input type="file" accept=".md,.markdown,.txt,.zip,text/markdown,application/zip" multiple data-import-file>
<span class="drop-title">把 .md 文件或 .zip 拖到这里，或者点这里选择</span>
<span class="drop-sub">支持这个后台导出的 zip、思源笔记「导出 → Markdown」的 zip，以及 Obsidian、Typora、Hexo、Hugo 的 Markdown 文件。图片放在 zip 里会一起导入。导入的文章都是草稿，检查后再发布。</span>
</label>
<div class="import-opts">
<label class="cm-field is-select"><select name="mode"><option value="overwrite">覆盖（原来的内容留在历史版本里）</option><option value="copy">另存一篇新的</option><option value="skip">跳过</option></select><span class="cm-label">已经有同样网址的文章时</span></label>
<label class="ed-check"><input type="checkbox" name="site"> 也导入主页内容（zip 里的 site.json）</label>
<button class="cm-link" type="button" data-import-close>收起</button>
</div>
<ol class="import-report" data-import-report></ol>
</form>

<div class="list-tools">
<div class="seg admin-filter" role="group" aria-label="筛选" data-post-filter>
<button type="button" data-filter="all" aria-pressed="true">全部</button>
<button type="button" data-filter="draft" aria-pressed="false">草稿</button>
<button type="button" data-filter="published" aria-pressed="false">已发布</button>
<button type="button" data-filter="trash" aria-pressed="false">回收站</button>
</div>
<label class="search admin-search">${icon.search}<span class="sr-only">搜索文章</span><input type="search" placeholder="搜索标题、标签或网址" data-post-search autocomplete="off"></label>
</div>
<ol class="post-list" data-post-list></ol>
<p class="admin-empty" data-post-empty hidden>还没有文章。</p>
</div>

<div class="pane pane-wide" data-pane="editor" hidden>
<form class="editor" data-editor novalidate>
<div class="ed-top">
<a class="back" href="#/posts">${icon.back} 全部文章</a>
<span class="cm-badge" data-ed-state></span>
<span class="ed-saved" data-ed-saved role="status" aria-live="polite"></span>
<div class="ed-actions">
<details class="ed-more" data-ed-more>
<summary class="btn btn-ghost ed-btn" aria-label="更多操作">更多</summary>
<div class="ed-menu" role="menu">
<button type="button" role="menuitem" data-ed-history>历史版本</button>
<button type="button" role="menuitem" data-ed-export>导出这篇（Markdown）</button>
<button type="button" role="menuitem" data-ed-unpublish>从网站撤下（变回草稿）</button>
<button type="button" role="menuitem" class="is-danger" data-ed-trash>删除（移到回收站）</button>
</div>
</details>
<button class="btn btn-ghost ed-btn" type="button" data-ed-save>保存</button>
<button class="btn btn-primary ed-btn" type="button" data-ed-publish>发布</button>
</div>
</div>
<input class="ed-title" name="title" placeholder="标题" maxlength="120" autocomplete="off">
<div class="ed-meta">
<label class="cm-field ed-slug"><input name="slug" maxlength="120" placeholder=" " autocapitalize="off" spellcheck="false"><span class="cm-label">网址：/blog/<b data-slug-preview>…</b>/</span></label>
<label class="cm-field ed-date"><input name="date" type="date" placeholder=" "><span class="cm-label">日期</span></label>
${field('tags', '标签（用逗号隔开）').replace('cm-field', 'cm-field ed-tags')}
${field('description', '摘要（不写就用正文第一段）', 'maxlength="300"').replace('cm-field', 'cm-field ed-desc')}
${field('cover', '分享图（不写就用文章第一张图）', 'spellcheck="false"').replace('cm-field', 'cm-field ed-cover')}
${field('series', '系列（同名的文章连成一组，可不写）', 'maxlength="60"').replace('cm-field', 'cm-field ed-series')}
<label class="cm-field ed-date ed-updated"><input name="updated" type="date" placeholder=" "><span class="cm-label">更新日期（大改过再填）</span></label>
<label class="ed-check"><input type="checkbox" name="comments"> 允许评论</label>
</div>
<p class="ed-note" data-ed-slug-note hidden></p>
<div class="ed-missing" data-ed-missing hidden>
<div class="ed-missing-text" data-ed-missing-text></div>
<div class="ed-missing-actions">
<button class="btn btn-ghost ad-btn" type="button" data-ed-siyuan hidden>从思源获取</button>
<label class="btn btn-ghost ad-btn">选择图片<input type="file" accept="image/*" multiple hidden data-ed-missing-file></label>
</div>
</div>
<div class="ed-split" data-ed-split>
<div class="ed-source">
<div class="ed-toolbar" role="toolbar" aria-label="格式">
${tool('h2', '二级标题', ico('M5 6v12M13 6v12M5 12h8M17 11.5a2 2 0 1 1 3 1.7L16.5 18H21'))}
${tool('h3', '三级标题', ico('M5 6v12M13 6v12M5 12h8M17 10.5a2 2 0 1 1 2 2.5 2 2 0 1 1-2 2.5'))}
${tool('bold', '加粗', ico('M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z'), 'Ctrl+B')}
${tool('italic', '斜体', ico('M14 5h-4M14 19h-4M14 5l-4 14'), 'Ctrl+I')}
${tool('mark', '高亮', ico('M5 19h14M8 15l7.5-7.5a2.1 2.1 0 0 0-3-3L5 12l-1 4z'))}
${tool('link', '链接', ico('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'), 'Ctrl+K')}
${tool('quote', '引用', ico('M6 7v10M10 9h8M10 13h8M10 17h5'))}
${tool('list', '列表', ico('M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01'))}
${tool('olist', '编号列表', ico('M10 7h10M10 12h10M10 17h10M4 6h1.5v4M4 10h3M4 14.5a1.5 1.5 0 1 1 2.6 1L4 18h3'))}
${tool('task', '待办清单', ico('M4 5h5v5H4zM5.5 7.5l1 1 2-2M12 7.5h8M4 14h5v5H4zM12 16.5h8'))}
${tool('code', '代码块', ico('M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12'))}
${tool('table', '表格', ico('M4 5h16v14H4zM4 10h16M4 15h16M10 5v14'))}
${tool('callout', '提示框', ico('M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM9.5 19h5M10.5 21.5h3'))}
${tool('image', '插入图片', ico('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5zM4 16l4.5-4.5a2 2 0 0 1 2.8 0L17 17M14 14l1.5-1.5a2 2 0 0 1 2.8 0L20 14.3M15.5 8.5h.01'))}
<span class="ed-tool-gap"></span>
<div class="seg ed-mode" role="group" aria-label="显示"><button type="button" data-mode="write" aria-pressed="true">编辑</button><button type="button" data-mode="preview" aria-pressed="false">预览</button></div>
</div>
<textarea class="ed-body" name="body" spellcheck="false" placeholder="用 Markdown 写正文。图片可以直接粘贴或拖进来；从思源、网页、Word 复制过来的内容会自动转成 Markdown。"></textarea>
</div>
<div class="ed-preview">
<iframe class="ed-frame" title="预览" sandbox="allow-same-origin" data-ed-frame></iframe>
<div class="ed-history" data-ed-history-pane hidden>
<div class="eh-head"><h2 class="eh-title">历史版本</h2><button class="cm-link" type="button" data-eh-close>关闭</button></div>
<ol class="eh-list" data-eh-list></ol>
<div class="eh-view" data-eh-view hidden>
<div class="eh-bar"><span class="eh-which" data-eh-which></span><button class="btn btn-primary ad-btn" type="button" data-eh-restore>恢复这个版本</button></div>
<iframe class="ed-frame eh-frame" title="历史版本预览" sandbox="allow-same-origin" data-eh-frame></iframe>
</div>
</div>
</div>
</div>
<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden data-ed-file>
<div class="ed-foot">
<span class="ed-count" data-ed-count></span>
<details class="ed-keys"><summary class="cm-link">快捷键</summary>
<dl class="keys">
<dt>Ctrl/⌘ + S</dt><dd>保存（也会自动保存）</dd>
<dt>Ctrl/⌘ + B / I / K</dt><dd>加粗 / 斜体 / 链接</dd>
<dt>Ctrl/⌘ + E</dt><dd>行内代码</dd>
<dt>Tab / Shift + Tab</dt><dd>缩进 / 取消缩进（列表、代码）</dd>
<dt>回车</dt><dd>列表、引用自动接着写；空的一项再按回车结束</dd>
<dt>Ctrl/⌘ + Shift + V</dt><dd>粘贴纯文本（不转换格式）</dd>
<dt>选中文字后粘贴网址</dt><dd>变成链接</dd>
</dl></details>
<span class="ed-foot-note">预览是近似效果（没有代码配色），发布后以网站为准</span>
</div>
</form>
</div>

<div class="pane" data-pane="comments" hidden>
<div class="pane-head"><h1 class="pane-title">评论</h1></div>
<div class="seg admin-filter" role="group" aria-label="按状态筛选" data-comment-filter>
<button type="button" data-filter="pending" aria-pressed="true">待审核</button>
<button type="button" data-filter="approved" aria-pressed="false">已通过</button>
<button type="button" data-filter="all" aria-pressed="false">全部</button>
</div>
<ol class="admin-list" data-comment-list></ol>
<p class="admin-empty" data-comment-empty hidden>这里没有评论。</p>
<div class="admin-more"><button class="btn btn-ghost" type="button" data-more hidden>加载更多</button></div>
</div>

<div class="pane" data-pane="albums" hidden>
<div class="pane-head"><h1 class="pane-title">图集</h1><a class="btn btn-primary pane-action" href="#/album/new">新图集</a></div>
<p class="pane-sub">整理照片用：按日期排成时间轴，每张可以写备注。文章里能引用一个图集，只显示其中几张。</p>
<div class="al-list" data-album-list></div>
<p class="admin-empty" data-album-empty hidden>还没有图集。</p>
</div>

<div class="pane" data-pane="album" hidden>
<div class="ed-top">
<a class="back" href="#/albums">${icon.back} 全部图集</a>
<span class="cm-badge" data-al-state></span>
<span class="ed-saved" data-al-status></span>
<div class="ed-actions">
<a class="cm-link" data-al-view target="_blank" rel="noopener" hidden>在网站上看</a>
<button class="btn btn-ghost ed-btn" type="button" data-al-delete hidden>删除</button>
<button class="btn btn-ghost ed-btn" type="button" data-al-toggle>发布</button>
<button class="btn btn-primary ed-btn" type="button" data-al-save>保存</button>
</div>
</div>
<form class="al-form" data-al-form novalidate>
${field('title', '图集名字', 'maxlength="80" required')}
${field('slug', '网址（/gallery/ 后面那段）', 'maxlength="80" spellcheck="false" required')}
<label class="cm-field is-area al-wide"><textarea name="description" rows="2" maxlength="600" placeholder=" "></textarea><span class="cm-label">写在图集开头的一段话（可以空着）</span></label>
<label class="cm-field is-select"><select name="timeline"><option value="day">显示到哪一天</option><option value="month">只显示到月份（不透露哪天在哪里）</option></select><span class="cm-label">时间轴</span></label>
<p class="al-ref" data-al-ref hidden><span>文章里引用：</span><code data-al-code></code><button class="cm-link" type="button" data-al-copy>复制</button></p>
</form>
<label class="drop al-drop" data-al-drop>
<input type="file" accept="image/*" multiple data-al-file>
<span class="drop-title">把照片拖到这里，或者点这里选择（可以一次选很多张）</span>
<span class="drop-sub">上传时会去掉定位、相机型号等信息，只把拍摄日期（到天）记下来排时间轴。iPhone 的 HEIC 照片请先导出成 JPG。发布前看一眼画面：门牌、车牌、屏幕内容程序去不掉。</span>
</label>
<div class="al-photos" data-al-photos></div>
<p class="admin-empty" data-al-empty hidden>还没有照片。</p>
</div>

<div class="pane" data-pane="site" hidden>
<div class="pane-head"><h1 class="pane-title">主页</h1><button class="btn btn-primary pane-action" type="button" data-site-save>保存并发布</button></div>
<p class="pane-sub">首页上的名字、介绍、链接、作品、服务和“关于”。保存后自动重新发布。</p>
<form class="site-form" data-site-form novalidate></form>
</div>

<div class="pane" data-pane="deploys" hidden>
<div class="pane-head"><h1 class="pane-title">发布</h1><button class="btn btn-ghost pane-action" type="button" data-publish-all>重新发布全部</button></div>
<p class="pane-sub" data-live></p>
<h2 class="pane-h2">备份</h2>
<div class="backup-box" data-backup></div>
<h2 class="pane-h2">最近的版本</h2>
<p class="pane-sub">服务器上保留最近 5 次构建。切换只是临时回到旧版本，下次发布又会是最新内容。</p>
<ol class="deploy-list" data-builds></ol>
</div>

<div class="pane" data-pane="security" hidden>
<div class="pane-head"><h1 class="pane-title">安全</h1><button class="btn btn-ghost pane-action" type="button" data-sec-clear>清空记录</button></div>
<p class="pane-sub">/admin/、/wp-login.php 这类地址是假的登录页：谁也登录不进去，来过的都记在这里（不记密码）。这些大多是自动扫描器，只是记录，不用处理；真正的后台靠秘密地址、密码和手机验证码。</p>
<div class="sec-stats" data-sec-stats></div>
<h2 class="pane-h2">最近的访问</h2>
<ol class="sec-list" data-sec-hits></ol>
</div>
</section>

<p class="admin-offline" data-view="offline" hidden></p>
</main>
<div class="job-toast" data-toast hidden role="status" aria-live="polite"><div class="job-row"><span class="job-dot" data-toast-dot></span><span class="job-text" data-toast-text></span><button class="cm-link" type="button" data-toast-log>记录</button><button class="cm-link" type="button" data-toast-close aria-label="关闭">✕</button></div><pre class="job-log" data-toast-pre hidden></pre></div>`,
    scripts: ['admin-marked.js', 'admin-katex.js', 'site-admin.js'],
  };
}

/* the decoy admin page: shown at /admin/, /wp-login.php and the like (the comment service fills in the error) */
export function trapPage(cfg, ctx) {
  return {
    path: '/_trap/',
    canonical: '/',
    title: '管理后台',
    bodyClass: 'admin-page trap-page',
    head: '<meta name="robots" content="noindex, nofollow">',
    csp: true,
    styles: ['admin.css'],
    body: `${pageTop(cfg, ctx, '')}
<main id="main" class="page-main admin">
<section class="admin-login">
<p class="eyebrow">Admin</p>
<h1 class="admin-title">管理后台</h1>
<p class="admin-sub">请使用管理员账号登录。</p>
<form class="login-form" method="post" autocomplete="on">
<!--trap-status-->
<label class="cm-field"><input name="username" autocomplete="username" placeholder=" " required maxlength="80"><span class="cm-label">用户名</span></label>
<label class="cm-field"><input type="password" name="password" autocomplete="current-password" placeholder=" " required maxlength="200"><span class="cm-label">密码</span></label>
<button class="btn btn-primary" type="submit">登录</button>
<p class="admin-sub trap-help">忘记密码请联系系统管理员。</p>
</form>
</section>
</main>`,
    scripts: [],
  };
}

/* an article's earlier address: forwards to where it is now */
export function redirectPage(cfg, ctx, to, title) {
  return {
    path: '',
    canonical: to,
    title,
    bodyClass: 'notfound-page',
    head: `<meta http-equiv="refresh" content="0; url=${esc(ctx.href(to))}">\n<meta name="robots" content="noindex">`,
    body: `${pageTop(cfg, ctx, 'blog')}
<main id="main" class="notfound">
<p>这篇文章换了地址：</p>
<a class="btn btn-primary" href="${ctx.href(to)}">${esc(title)} ${icon.arrow}</a>
</main>`,
    scripts: ['site-blog.js'],
  };
}

export function notFoundPage(cfg, ctx) {
  return {
    path: '/404.html',
    title: '页面不存在',
    bodyClass: 'notfound-page',
    body: `${pageTop(cfg, ctx, '')}
<main id="main" class="notfound">
<p class="code num">404</p>
<p>这个页面不存在，可能已经被移走了。</p>
<a class="btn btn-primary" href="${ctx.href('/')}">回到首页 ${icon.arrow}</a>
</main>`,
    scripts: ['site-blog.js'],
  };
}
