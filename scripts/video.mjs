// Turns any clip (an iPhone .mov, a screen recording …) into an MP4 that plays in every browser, plus a cover image,
// both into src/public/videos/. Needs ffmpeg installed on this computer.
//
//   npm run video -- ~/Desktop/IMG_1234.MOV            → src/public/videos/IMG_1234.mp4 + IMG_1234.jpg
//   npm run video -- ~/Desktop/IMG_1234.MOV demo       → src/public/videos/demo.mp4 + demo.jpg
//
// What it does: H.264 video + AAC sound (the one combination every browser plays), the long side at most 1920 px,
// iPhone HDR footage converted to normal colours (otherwise it looks washed out on most screens), the file laid
// out so playback can start before it has fully downloaded, and the phone's data (location, model) left out.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [input, nameArg] = process.argv.slice(2);

const CRF = 26;          // quality: lower is sharper and larger (23 ≈ visually lossless, 28 ≈ noticeably softer)
const MAX_SIDE = 1920;   // the long side of the picture, in pixels
const PRESET = 'medium'; // 'slow' makes the file about 10% smaller and takes about twice as long

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, missing: r.error.code === 'ENOENT', out: '' };
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

if (!input) {
  console.log('用法：npm run video -- <视频文件> [输出名字]\n例如：npm run video -- ~/Desktop/IMG_1234.MOV demo');
  process.exit(1);
}
if (!existsSync(input)) { console.error(`找不到文件：${input}`); process.exit(1); }
if (run('ffmpeg', ['-version']).missing || run('ffprobe', ['-version']).missing) {
  console.error('需要先安装 ffmpeg：\n  macOS：brew install ffmpeg\n  Windows：winget install Gyan.FFmpeg（装完重新打开终端）\n  Ubuntu / Debian：sudo apt install ffmpeg');
  process.exit(1);
}

const name = (nameArg || path.basename(input, path.extname(input))).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'video';
const dir = path.join(root, 'src/public/videos');
mkdirSync(dir, { recursive: true });
const mp4 = path.join(dir, `${name}.mp4`), jpg = path.join(dir, `${name}.jpg`);

/* what are we dealing with */
const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,color_transfer:format=duration', '-of', 'json', input]);
if (!probe.ok) { console.error('读不了这个视频文件。'); process.exit(1); }
const info = JSON.parse(probe.out.slice(probe.out.indexOf('{')));
const v = (info.streams || [])[0] || {};
const duration = Number(info.format?.duration) || 0;
const hdr = ['arib-std-b67', 'smpte2084'].includes(v.color_transfer); /* HLG (iPhone) or PQ */

/* the long side at most MAX_SIDE, even dimensions */
const scale = `scale='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_SIDE},ih))'`;
let filters = scale;
if (hdr) {
  if (run('ffmpeg', ['-hide_banner', '-filters']).out.includes(' zscale ')) {
    filters = `zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,${scale}`;
  } else {
    console.warn('提示：这是 HDR 视频，但你的 ffmpeg 不带 zscale，颜色可能会偏灰。可以在 iPhone 设置 → 相机 → 录制视频 里关掉 HDR 视频再拍。');
  }
}

console.log(`转换 ${path.basename(input)}（${v.width}×${v.height}${hdr ? '，HDR' : ''}，${duration.toFixed(1)} 秒）…`);
const enc = run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
  '-map', '0:v:0', '-map', '0:a:0?',
  '-vf', filters,
  '-c:v', 'libx264', '-preset', PRESET, '-crf', String(CRF), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
  '-map_metadata', '-1', '-map_chapters', '-1', /* drop the camera's data: where and when it was filmed, the phone model */
  '-movflags', '+faststart',
  mp4,
]);
if (!enc.ok) { console.error('转换失败：\n' + enc.out); process.exit(1); }

/* the cover: a frame half a second in (or from the middle of a very short clip) */
const at = Math.min(0.5, duration / 2).toFixed(2);
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at, '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg]);

const mb = (f) => (statSync(f).size / 1048576).toFixed(1);
console.log(`完成：
  src/public/videos/${name}.mp4  ${mb(mp4)} MB（原文件 ${mb(input)} MB）
  src/public/videos/${name}.jpg  封面${existsSync(jpg) ? '' : '（没能生成，可以自己放一张同名图片）'}

在文章里这样写（引号里是可选的说明文字）：
  ![视频说明](/videos/${name}.mp4 "说明文字")`);
if (statSync(mp4).size > 100 * 1048576) console.warn('\n提示：文件超过 100 MB，每播放一次就消耗这么多服务器流量，留意服务器每月的流量上限。');
