// Draws src/public/og.jpg, the picture shown when the site is shared (1200×630), from the name and role in
// content/site.json: the home page's night scene — a planet's lit edge rising to the right, a small sun, stars.
//   npm run og        (run it again after changing the name)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let sharp;
try { sharp = (await import('sharp')).default; } catch { console.error('需要 sharp（npm install 时会自动装上）'); process.exit(1); }

/* the same stars every time: a tiny seeded random */
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const stars = Array.from({ length: 90 }, () => {
  const x = rnd() * 1200, y = rnd() * 420, r = rnd() < 0.85 ? 0.8 : 1.4;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#fff" opacity="${(0.25 + rnd() * 0.55).toFixed(2)}"/>`;
}).join('');

/* the planet: a circle far below the frame whose top edge climbs from the lower left to the right */
const P = { cx: 1030, cy: 1700, r: 1400 };
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <radialGradient id="sky" cx="0.72" cy="0.62" r="0.9"><stop offset="0" stop-color="#0b1426"/><stop offset="0.55" stop-color="#03060c"/><stop offset="1" stop-color="#000"/></radialGradient>
  <radialGradient id="planet" cx="${P.cx}" cy="${P.cy - P.r}" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a2638"/><stop offset="0.45" stop-color="#080c14"/><stop offset="1" stop-color="#020306"/></radialGradient>
  <radialGradient id="halo" cx="820" cy="300" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9cc4ff" stop-opacity=".38"/><stop offset="1" stop-color="#9cc4ff" stop-opacity="0"/></radialGradient>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
  <filter id="sunglow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="1200" height="630" fill="url(#sky)"/>
${stars}
<rect width="1200" height="630" fill="url(#halo)"/>
<circle cx="820" cy="246" r="34" fill="#dbe9ff" opacity=".55" filter="url(#sunglow)"/>
<circle cx="820" cy="246" r="15" fill="#fff"/>
<circle cx="${P.cx}" cy="${P.cy}" r="${P.r}" fill="url(#planet)"/>
<circle cx="${P.cx}" cy="${P.cy}" r="${P.r}" fill="none" stroke="#a9ccff" stroke-width="7" opacity=".5" filter="url(#soft)"/>
<circle cx="${P.cx}" cy="${P.cy}" r="${P.r}" fill="none" stroke="#e6f0ff" stroke-width="1.6" opacity=".9"/>
<text x="88" y="250" font-family="Inter Display, Inter, Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="22" font-weight="500" letter-spacing="5" fill="#86868b">${esc(String(site.role || '').toUpperCase())}</text>
<text x="84" y="350" font-family="Inter Display, Inter, Segoe UI Semibold, Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="116" font-weight="600" letter-spacing="-3" fill="#f5f5f7">${esc(site.name)}</text>
</svg>`;

const out = path.join(root, 'src/public/og.jpg');
await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
console.log(`→ ${path.relative(root, out)}（${site.name}）`);
