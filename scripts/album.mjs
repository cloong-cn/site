// Brings photos into an album, cleaned:   npm run album -- <folder of photos> <album name>
//
// Each photo is decoded and saved again into content/gallery/<album name>/: turned upright, at most 2560 pixels on its
// long side, and with everything but the pixels dropped (location, camera, serial number, thumbnails). So what is in the
// project, and in git, can be shared; the originals stay where they were. The day each was taken is written into
// album.json (only the day), so the timeline still works. A new album starts as a draft: it shows in the local preview
// and nowhere else until "draft" in album.json is set to false.
//
// Run it again with more photos and they are added; what is already written in album.json stays as it is.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readExif } from './media.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [from, slug] = process.argv.slice(2);
const stop = (msg) => { console.error(msg); process.exit(1); };
if (!from || !slug) stop('用法：npm run album -- <照片所在的文件夹> <图集名字>\n比如：npm run album -- "D:/照片/台北" taipei-2026');
if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(slug)) stop('图集名字只能用文字、数字、- 和 _（它会出现在网址里）');
if (!existsSync(from)) stop(`找不到文件夹 ${from}`);

const dir = path.join(process.env.GALLERY_DIR ? path.resolve(process.env.GALLERY_DIR) : path.join(root, 'content/gallery'), slug);
await mkdir(dir, { recursive: true });
const jsonFile = path.join(dir, 'album.json');
const album = existsSync(jsonFile) ? JSON.parse((await readFile(jsonFile, 'utf8')).replace(/^\uFEFF/, '')) : { title: slug, description: '', draft: true, timeline: 'day', days: {}, photos: {} };
album.photos = album.photos || {};

const LONG = 2560;
const names = (await readdir(from)).filter((f) => /\.(jpe?g|png|webp|avif|tiff?|heic|heif)$/i.test(f)).sort();
if (!names.length) stop(`${from} 里没有照片`);
let added = 0, same = 0, located = 0;
const skipped = [];
for (const name of names) {
  const source = path.join(from, name);
  try {
    if (/\.(heic|heif)$/i.test(name)) throw new Error('HEIC');
    const meta = await sharp(source).metadata();
    const exif = readExif(meta.exif);
    if (exif.gps) located++;
    const png = meta.format === 'png';
    const pipe = sharp(source).rotate().resize({ width: LONG, height: LONG, fit: 'inside', withoutEnlargement: true });
    /* sharp writes no metadata unless asked to */
    const data = await (png ? pipe.png({ compressionLevel: 9 }) : pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true })).toBuffer();
    /* named after the picture, so a name from a phone or a folder says nothing, and the same photo comes in only once */
    const file = `${createHash('sha256').update(data).digest('hex').slice(0, 12)}.${png ? 'png' : 'jpg'}`;
    if (existsSync(path.join(dir, file))) { same++; continue; }
    await writeFile(path.join(dir, file), data);
    const day = exif.taken ? exif.taken.slice(0, 10).replace(/:/g, '-') : (/(?:^|\D)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:\D|$)/.exec(name) || []).slice(1, 4).join('-');
    album.photos[file] = { note: '', date: day || '', from: name };
    added++;
    console.log(`  ${name} → ${file}${day ? `（${day}）` : '（没有日期）'}`);
  } catch (e) {
    skipped.push(`${name}${e.message === 'HEIC' ? '（HEIC 格式，请先转成 JPG）' : `（${e.message}）`}`);
  }
}
await writeFile(jsonFile, JSON.stringify(album, null, 2) + '\n');
console.log(`\n图集 ${slug}：新增 ${added} 张${same ? `，${same} 张已经有了` : ''}${skipped.length ? `，${skipped.length} 张没导入` : ''}。${located ? `其中 ${located} 张带拍摄地点，导入的副本里已经去掉。` : ''}`);
for (const s of skipped) console.log(`  没导入：${s}`);
console.log(`接下来：在 ${path.relative(root, jsonFile)} 里写标题和备注${album.draft ? '，写好后把 "draft" 改成 false 才会发布' : ''}。`);
