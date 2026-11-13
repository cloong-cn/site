// Cleans a picture uploaded in the admin page, before it is kept:
//   node scripts/clean-image.mjs <uploaded file> <output path without extension>
// The picture is decoded and saved again: turned upright (phones store the rotation separately) and with everything
// but the pixels dropped — location, camera, date, thumbnails. A file that is not really a picture, or one that would
// unpack to more than 80 megapixels, is refused. Prints {"format","width","height"} or {"error"}, with "taken" (the day
// only, for an album's timeline) when the picture said when it was taken.
import sharp from 'sharp';
import { readExif } from './media.mjs';

const [input, outBase] = process.argv.slice(2);
const fail = (message) => {
  console.log(JSON.stringify({ error: message }));
  process.exit(1);
};
if (!input || !outBase) fail('usage: clean-image.mjs <in> <out-base>');

const LIMIT = 80_000_000;
sharp.cache(false);
sharp.concurrency(1);

try {
  const probe = await sharp(input, { limitInputPixels: LIMIT, failOn: 'error' }).metadata();
  if (!probe.width || !probe.height) fail('图片打不开');
  if (probe.width * probe.height > LIMIT) fail('图片太大了（最多 8000 万像素）');
  const animated = (probe.pages || 1) > 1 && (probe.format === 'gif' || probe.format === 'webp');
  const format = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }[probe.format] || 'jpg'; /* AVIF is kept as JPG */

  let img = sharp(input, { limitInputPixels: LIMIT, failOn: 'error', animated });
  if (!animated) img = img.rotate(); /* apply the phone's rotation, then forget it */
  if (format === 'jpg') img = img.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true });
  else if (format === 'png') img = img.png({ compressionLevel: 9 });
  else if (format === 'webp') img = img.webp({ quality: 90 });
  else img = img.gif();
  /* sharp writes no metadata unless asked to: no EXIF, no GPS, no XMP */
  const info = await img.toFile(`${outBase}.${format}`);
  const { taken } = readExif(probe.exif);
  console.log(JSON.stringify({ format, width: info.width, height: animated ? probe.height : info.height, ...(taken ? { taken: taken.slice(0, 10).replace(/:/g, '-') } : {}) }));
} catch (e) {
  fail(String(e && e.message ? e.message : e).slice(0, 200));
}
