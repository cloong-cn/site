// A small copy of an uploaded picture, for the admin page's picture library (server: Images.thumb):
//   node scripts/thumb.mjs <picture> <output .webp>
// 360 pixels wide (never wider than the picture), turned upright, WebP. Writes to a temporary name and renames it, so
// a half-written file is never shown.
import sharp from 'sharp';
import { rename } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: thumb.mjs <in> <out.webp>'); process.exit(2); }
sharp.cache(false);
sharp.concurrency(1);
try {
  const part = `${output}.${process.pid}.part`;
  await sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate().resize({ width: 360, withoutEnlargement: true }).webp({ quality: 72 }).toFile(part);
  await rename(part, output);
} catch (e) {
  console.error(String(e && e.message ? e.message : e).slice(0, 200));
  process.exit(1);
}
