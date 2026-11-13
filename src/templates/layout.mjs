import { createHash } from 'node:crypto';
import { esc } from './util.mjs';

// Runs before first paint: picks the theme (manual choice if still valid, else the visitor's local time)
// and the side of the navigation, so the page never flashes the wrong colours.
const boot = (side) => `(function(){var d=document.documentElement,t=null;d.classList.add('js');d.setAttribute('data-nav-side','${side}');try{var o=JSON.parse(localStorage.getItem('theme-override')||'null');if(o&&o.exp>Date.now())t=o.t;var s=localStorage.getItem('nav-side');if(s==='left'||s==='right')d.setAttribute('data-nav-side',s)}catch(e){}if(t!=='light'&&t!=='dark'){var n=new Date(),h=n.getHours()+n.getMinutes()/60;t=Math.sin(Math.PI*(h-6)/12)>0.1?'light':'dark'}d.setAttribute('data-theme',t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='light'?'#ffffff':'#000000')})();`;

// Apple devices are marked so they draw the text in their own system font (see html.apple in base.css)
// and skip the Inter download; everyone else gets Inter, preloaded.
const fontPreload = (hrefs) => `(function(){if(/Mac|iPhone|iPad|iPod/.test(navigator.platform||'')||/Macintosh|iPhone|iPad/.test(navigator.userAgent)){document.documentElement.classList.add('apple');return}${JSON.stringify(hrefs)}.forEach(function(h){var l=document.createElement('link');l.rel='preload';l.as='font';l.type='font/woff2';l.crossOrigin='anonymous';l.href=h;document.head.appendChild(l)})})();`;

export function layout(cfg, ctx, page) {
  const url = cfg.url + (page.canonical || page.path);
  const title = page.title ? `${page.title} · ${cfg.name}` : cfg.title;
  const desc = page.description || cfg.description;
  const og = page.image || cfg.url + '/og.jpg'; /* an article's own picture when it has one */
  const side = cfg.navSide === 'right' ? 'right' : 'left';
  const inline = boot(side) + fontPreload([ctx.asset(ctx.files['fonts/inter-400.woff2']), ctx.asset(ctx.files['fonts/inter-display-600.woff2'])]);
  /* Content Security Policy: no page runs any script but the site's own files and the one above (allowed by its hash).
     So even a <script> or onerror="…" that got into an article (an imported file, say) does nothing. The admin page
     and the decoy (page.csp) are stricter still; page.connect adds addresses their script may fetch from. Article
     pictures, videos and embeds may come from other https sites; the home page fetches the weather from Open-Meteo. */
  const hash = `'sha256-${createHash('sha256').update(inline).digest('base64')}'`;
  const policy = page.csp
    ? `default-src 'self'; script-src 'self' ${hash}; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${page.connect ? ' ' + page.connect : ''}; object-src 'none'; base-uri 'none'; form-action 'self'`
    : ctx.dev ? '' : `default-src 'self'; script-src 'self' ${hash}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self'; connect-src 'self' https://api.open-meteo.com; frame-src https:; object-src 'none'; base-uri 'none'; form-action 'self'`;
  const csp = policy ? `<meta http-equiv="Content-Security-Policy" content="${policy}">\n` : '';
  return `<!doctype html>
<html lang="${esc(cfg.lang)}" data-theme="dark" data-nav-side="${side}">
<head>
<meta charset="utf-8">
${csp}<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark light">
<script>${inline}</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="${page.ogType || 'website'}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${esc(String(cfg.lang || 'zh-CN').replace('-', '_'))}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${ctx.href('/favicon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${ctx.href('/apple-touch-icon.png')}">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${ctx.href('/rss.xml')}">
${page.csp ? '' : '<style>@media(prefers-reduced-motion:no-preference){@view-transition{navigation:auto;types:nav}}</style>\n'}<link rel="stylesheet" href="${ctx.asset(ctx.files['site.css'])}">
${(page.styles || []).map((s) => `<link rel="stylesheet" href="${ctx.asset(ctx.files[s])}">\n`).join('')}
${page.head || ''}
${page.data ? `<script type="application/ld+json">${JSON.stringify(page.data).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="${page.bodyClass || ''}">
<a class="skip-link" href="#main">跳到正文</a>
${page.body}
<canvas class="vt-overlay" aria-hidden="true"></canvas>
${(page.scripts || []).map((s) => `<script src="${ctx.asset(ctx.files[s])}" defer></script>`).join('\n')}
</body>
</html>
`;
}
