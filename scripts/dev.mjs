// Local preview with auto-rebuild and live reload:  npm run dev   (then open http://localhost:4321)
// `npm run preview` serves the production build in dist/ as-is (no rebuild, no live reload).
// Only this computer can open it; to try it on a phone on the same Wi-Fi:  HOST=0.0.0.0 npm run dev
// /api/comments goes to the comment service in server/ when it runs locally (COMMENTS_API, default http://127.0.0.1:8787).
// The admin page is at ADMIN_PATH (default /_admin; set it to admin.path of a local admin service), its API under
// ADMIN_PATH/api/ goes to ADMIN_API (default http://127.0.0.1:8788). /admin/, /wp-login.php … show the decoy page.
// `npm run dev:admin` answers the admin API itself with sample data instead (scripts/admin-mock.mjs): the admin page
// works without Java or PostgreSQL, changes stay in memory.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { watch, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminMock } from './admin-mock.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const COMMENTS_API = new URL(process.env.COMMENTS_API || 'http://127.0.0.1:8787');
const ADMIN_API = new URL(process.env.ADMIN_API || 'http://127.0.0.1:8788');
const ADMIN_PATH = (process.env.ADMIN_PATH || '/_admin').replace(/\/+$/, '');
const TRAP = /^\/(admin|administrator|wp-admin|wp-login\.php|login|signin|user\/login|manager|manage|backend|dashboard|cms|phpmyadmin|pma|admin\.php|adminer\.php)(\/.*)?$/i;
const SERVE_ONLY = process.argv.includes('--serve');
const adminMock = process.argv.includes('--admin-demo') ? await createAdminMock({ root }) : null;
/* on the admin page while it runs on sample data: a note, so it is never taken for the real thing */
const DEMO_NOTE = '<div style="position:fixed;left:16px;bottom:16px;z-index:300;padding:8px 14px;border-radius:999px;background:#ff9f0a;color:#000;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none">本地预览 · 示例数据，改动只在内存里，重启就没了</div>';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
/* closed on leaving: a browser allows few connections to one server, and pages kept in its history would use them all up */
const RELOAD = '<script>(function(){var s=new EventSource("/__reload");s.onmessage=function(){location.reload()};addEventListener("pagehide",function(){s.close()})})()</script>';

let clients = [];
let building = null;
let again = false;

function rebuild() {
  if (building) { again = true; return building; }
  building = new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(root, 'scripts/build.mjs'), '--dev'], { cwd: root, stdio: 'inherit' });
    p.on('exit', (code) => {
      building = null;
      if (code === 0) clients.forEach((c) => c.write('data: reload\n\n'));
      if (again) { again = false; rebuild(); }
      resolve();
    });
  });
  return building;
}

if (!SERVE_ONLY) {
  await rebuild();
  let t = 0;
  const onChange = () => { clearTimeout(t); t = setTimeout(rebuild, 150); };
  for (const target of ['src', 'content', 'scripts', 'site.config.mjs']) {
    try { watch(path.join(root, target), { recursive: true }, onChange); } catch { watch(path.join(root, target), onChange); }
  }
}

/* the comment and admin services, as Nginx would pass them on */
function proxy(req, res, target, path, extra = {}, fallback = null) {
  const up = http.request({
    host: target.hostname, port: target.port || 80, method: req.method, path,
    headers: { ...req.headers, ...extra, host: target.host, 'x-real-ip': req.socket.remoteAddress.replace(/^::ffff:/, '') },
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => {
    if (res.headersSent) { res.destroy(); return; }
    if (fallback) { fallback(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'unavailable', message: `服务没有运行（${target.host}）` }));
  });
  req.pipe(up);
}
const page = async (res, file, extra = '') => {
  try {
    const html = await readFile(path.join(dist, file));
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    res.end(extra ? html.toString().replace('</body>', extra + '</body>') : html);
  } catch { res.writeHead(404); res.end(); }
};

http.createServer(async (req, res) => {
  const bare = req.url.replace(/[?#].*$/, '');
  if (bare.startsWith(ADMIN_PATH + '/api/')) {
    if (adminMock) { const u = new URL(req.url, 'http://localhost'); await adminMock(req, res, u.pathname.slice(ADMIN_PATH.length + 5), u.search.slice(1)); return; }
    proxy(req, res, ADMIN_API, req.url);
    return;
  }
  if (bare === ADMIN_PATH || bare === ADMIN_PATH + '/') { await page(res, '_admin/index.html', adminMock ? DEMO_NOTE : ''); return; }
  if (req.url.startsWith('/api/')) { proxy(req, res, COMMENTS_API, req.url); return; }
  if (TRAP.test(bare)) { proxy(req, res, COMMENTS_API, '/trap', { 'x-trap-path': req.url }, () => page(res, '_trap/index.html')); return; }
  if (req.url === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n');
    clients.push(res);
    req.on('close', () => { clients = clients.filter((c) => c !== res); });
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  let file = path.join(dist, pathname);
  let status = 200;
  if (file !== dist && !file.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    await stat(file);
  } catch {
    file = path.join(dist, '404.html');
    status = 404;
  }
  try {
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    let body;
    if (SERVE_ONLY && /\bbr\b/.test(req.headers['accept-encoding'] || '') && existsSync(file + '.br')) {
      body = await readFile(file + '.br'); /* like the production server: send the precompressed file */
      headers['Content-Encoding'] = 'br';
    } else {
      body = await readFile(file);
      if (!SERVE_ONLY && type.startsWith('text/html')) body = Buffer.from(body.toString().replace('</body>', RELOAD + '</body>'));
    }
    /* byte ranges: Safari only plays a video when the server can send it in parts */
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && status === 200 && !headers['Content-Encoding'] && (range[1] || range[2])) {
      const size = body.length;
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    headers['Accept-Ranges'] = 'bytes';
    res.writeHead(status, headers);
    res.end(body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('build output missing — run npm run build');
  }
}).listen(PORT, HOST, () => console.log(`\n  ${SERVE_ONLY ? 'serving dist/' : 'dev server'} → http://localhost:${PORT}${HOST === '127.0.0.1' ? '' : `  (also on this computer's network address, port ${PORT})`}${adminMock ? `\n  admin, on sample data → http://localhost:${PORT}${ADMIN_PATH}/` : ''}\n`));
