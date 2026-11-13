import { esc, icon, topNav, footer, rulerNav, picture, placeholder } from './util.mjs';

/* /gallery/: every album, as a big picture with its name on glass */
export function galleryPage(cfg, ctx, albums) {
  const total = albums.reduce((n, a) => n + a.photos.length, 0);
  return {
    path: '/gallery/',
    title: '图集',
    description: `${cfg.name} 的图集`,
    bodyClass: 'gallery',
    body: `${topNav(cfg, ctx, { current: 'gallery' })}
<main id="main" class="page-main">
<div class="container"><header class="archive-head">
<h1 class="archive-title">图集</h1>
<p class="archive-sub">${albums.length} 个图集，<span class="num">${total}</span> 张照片</p>
</header>
<div class="albums">
${albums.map((a) => `<a class="album-card" href="${ctx.href(`/gallery/${a.slug}/`)}">
<span class="album-cover">${placeholder(a.cover.img)}${picture(a.cover.img, ctx.asset(''), { alt: '', sizes: '(min-width: 900px) 560px, calc(100vw - 48px)' })}<span class="tile-name t">${esc(a.title)}</span></span>
<span class="album-info"><span class="num">${a.photos.length} 张</span>${a.span ? `<span>${esc(a.span)}</span>` : ''}${a.draft ? '<span class="album-draft">草稿，不会发布</span>' : ''}</span>
${a.description ? `<span class="album-desc">${esc(a.description)}</span>` : ''}
</a>`).join('\n')}
</div>
<div class="archive-foot">${footer(cfg, ctx)}</div>
</div>
</main>`,
    scripts: ['site-blog.js'],
  };
}

const anchor = (g, i) => (g.key ? `d-${g.key}` : `d-other-${i}`);

/* /gallery/<name>/: the photos along a line of time. Row by row the photos keep their own shapes and fill the width */
export function albumPage(cfg, ctx, album) {
  const dates = album.groups.filter((g) => g.key);
  const showYears = new Set(dates.map((g) => g.year)).size > 1;
  let year = '';
  const days = album.groups.map((g, i) => {
    const newYear = !album.month && showYears && g.year && g.year !== year;
    if (g.year) year = g.year;
    return `<li class="tl-day" id="${anchor(g, i)}">
<div class="tl-date"><span class="tl-dot" aria-hidden="true"></span>${newYear ? `<span class="tl-year num">${g.year}</span>` : ''}<h2 class="tl-label num">${esc(g.label)}</h2><span class="tl-count num">${g.photos.length} 张</span></div>
<div class="tl-body">
${g.note ? `<p class="tl-note">${esc(g.note)}</p>` : ''}
<div class="photos${g.photos.length === 1 ? ' is-one' : ''}">
${g.photos.map((p) => `<figure class="media is-image album-photo" tabindex="0" role="button" aria-label="${esc(p.note ? `放大查看：${p.note}` : '放大查看照片')}" style="--ar:${(p.img.w / p.img.h).toFixed(4)}">${placeholder(p.img)}${picture(p.img, ctx.asset(''), { alt: p.alt, sizes: '(min-width: 900px) 420px, 60vw' })}${p.note ? `<figcaption class="media-cap">${esc(p.note)}</figcaption>` : ''}</figure>`).join('\n')}
</div>
</div>
</li>`;
  }).join('\n');
  const toc = album.groups.length >= 2
    ? [{ href: '#album-title', title: album.title, level: 1, num: '' }, ...album.groups.map((g, i) => ({ href: `#${anchor(g, i)}`, title: g.label, level: 2, num: '' }))]
    : [];
  return {
    path: `/gallery/${album.slug}/`,
    title: album.title,
    description: album.description || `${album.title}，${album.photos.length} 张照片`,
    image: album.share ? `${cfg.url}/assets/${album.share}` : undefined,
    bodyClass: 'album',
    body: `${topNav(cfg, ctx, { current: 'gallery' })}
<main id="main" class="page-main">
<div class="album-page">
<a class="back" href="${ctx.href('/gallery/')}">${icon.back} 全部图集</a>
<header class="album-head">
<h1 class="album-title" id="album-title">${esc(album.title)}</h1>
${album.description ? `<p class="album-lead">${esc(album.description)}</p>` : ''}
<p class="album-info"><span class="num">${album.photos.length} 张</span>${album.span ? `<span>${esc(album.span)}</span>` : ''}${album.draft ? '<span class="album-draft">草稿，不会发布</span>' : ''}</p>
</header>
<ol class="timeline" data-album>
${days}
</ol>
<div class="archive-foot">${footer(cfg, ctx)}</div>
</div>
</main>
${toc.length ? rulerNav({ side: cfg.navSide === 'right' ? 'right' : 'left', kind: 'toc', label: '时间轴', head: '时间轴', items: toc }) : ''}`,
    scripts: ['site-blog.js'],
  };
}
