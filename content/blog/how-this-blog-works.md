---
title: 这个博客是怎么做的：技术栈与实现细节
date: 2026-11-08
tags: [架构, 前端, Java]
description: 一篇长文，把这个网站从里到外拆开讲一遍：构建脚本、Markdown 与代码高亮、图片和中文字体的处理、WebGL 首屏、明暗切换动画、零依赖的 Java 后端、自己实现的 PostgreSQL 客户端、部署与安全。附部分实现代码。
---

[上一篇](/blog/building-this-site/)讲了为什么要自己做这个网站、大致的思路。这一篇把它从里到外拆开，
每一部分讲清楚用了什么、为什么这样做，再贴上关键的实现代码。篇幅比较长，左边的刻度就是目录，
鼠标移上去（手机上点一下）可以直接跳到想看的部分。

> [!NOTE]
> 文中的代码都摘自网站本身的源码，为了好读删掉了一部分细节，删掉的地方用 `// …` 标出来。

## 技术栈一览

先列一张总表。整个网站分成三块：生成页面的**构建脚本**、浏览器里运行的**前端脚本**、服务器上的**两个 Java 服务**。

| 部分 | 用了什么 | 第三方依赖 |
| --- | --- | --- |
| 构建 | Node.js 20+，ES 模块 | marked、highlight.js、sharp、subset-font |
| 页面模板 | JavaScript 模板字符串 | 无 |
| 样式 | 原生 CSS，CSS 变量做主题 | 无 |
| 前端交互 | 原生 JavaScript，按页面打包成一个文件 | 无 |
| 首屏 | WebGL 片元着色器 | 无 |
| 评论和后台 | Java 21，JDK 自带的 `HttpServer` | **无**（连数据库驱动都没有） |
| 数据库 | PostgreSQL 14+ | — |
| 部署 | Git 钩子 + Bash，Nginx 或 Caddy | — |

依赖少是刻意的。前端构建的四个包都只在我自己的电脑和服务器上运行，访客的浏览器不会下载任何第三方代码；
后端干脆一个依赖都没有，所以不存在“某个库爆出漏洞、被迫连夜升级”的情况。

### 目录结构

```text
site.config.mjs        域名、语言、评论和后台开关
content/
  site.json            主页上的文字
  blog/*.md            文章（本地预览用；线上的文章在数据库里）
src/
  templates/           页面模板：home.mjs、blog.mjs、layout.mjs
  styles/              base.css 全站 · home.css 主页 · blog.css 博客
  scripts/             浏览器里跑的脚本：明暗切换、着色器、刻度导航……
  fonts/               Inter 子集 + 思源黑体（只在构建时用）
  public/              原样复制到网站根目录的文件
scripts/               构建：build.mjs、highlight.mjs、media.mjs、fonts.mjs
server/                Java 服务：src/、schema.sql、systemd 配置
deploy/                Nginx / Caddy 配置、部署钩子、备份脚本
```

## 构建：从 Markdown 到静态页面

构建脚本 `scripts/build.mjs` 四百多行，做的事情按顺序是：

1. 读出 `content/blog/` 里的每个 Markdown 文件，解析开头的文章信息；
2. 用 marked 把正文转成 HTML，再做几处加工（标题加锚点、提示框、外链加箭头）；
3. 处理文章里引用的图片和视频；
4. 打包 CSS 和 JavaScript，文件名里带上内容哈希；
5. 用模板生成每一个页面，统计用到的汉字，切出共用的和每页自己的中文字体；
6. 生成 RSS、sitemap、robots.txt；
7. 正式构建时把所有文本文件预先压缩成 `.br` 和 `.gz`。

### 文章信息

文件开头两条 `---` 之间是文章信息。完整的 YAML 解析器太重了，这里只需要“键: 值”和简单的列表，
十几行就能写完：

```js title="scripts/build.mjs"
function frontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const unq = (v) => v.replace(/^(['"])(.*)\1$/, '$2');
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) { if (!Array.isArray(data[key])) data[key] = []; data[key].push(unq(item[1].trim())); continue; }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (v === '') data[key] = [];
    else if (/^\[.*\]$/.test(v)) data[key] = v.slice(1, -1).split(',').map((s) => unq(s.trim())).filter(Boolean);
    else if (v === 'true' || v === 'false') data[key] = v === 'true';
    else data[key] = unq(v);
  }
  return { data, body: src.slice(m[0].length) };
}
```

阅读时间也是在这里算的：中文按每分钟 400 字，英文按每分钟 220 个词，两者相加。

### 加工 HTML

marked 输出的是很“素”的 HTML，构建时再加几道工序。比如 GitHub 风格的提示框：引用块第一行写
`[!TIP]`，就换成带图标的 `<aside>`；指向别的网站的链接自动加上 `target="_blank"`：

```js title="scripts/build.mjs"
function enhance(html) {
  return html
    // 正文里的换行出现在两个汉字之间时，浏览器会显示成一个空格：直接去掉
    .replace(/<(p|li|td|th)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => `<${tag}>${inner.replace(CJK_BREAK, '$1')}</${tag}>`)
    // 二级到四级标题加上 id，目录和锚点链接靠它
    .replace(/<h([234])>([\s\S]*?)<\/h\1>/g, (m, level, inner) => `<h${level} id="${slugify(inner)}">${inner}</h${level}>`)
    .replace(/<a href="(https?:\/\/[^"]+)"/g, '<a href="$1" target="_blank" rel="noopener"')
    .replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([\s\S]*?)<\/blockquote>/g, (m, type, rest) => {
      const [label, icon] = CALLOUTS[type];
      return `<aside class="callout is-${type.toLowerCase()}" role="note">…</aside>`;
    });
}
```

> [!TIP]
> 第一条规则是最近才加的。中文写作时习惯在一句话中间换行，Markdown 会把这个换行当成空格，
> 于是页面上莫名其妙多出一个空隙。英文需要这个空格，中文不需要，所以只在两个汉字之间去掉。

### 去掉文章里能运行的代码

文章只有我自己写，但后台支持导入别人的 Markdown 文件，里面可能夹带 `<script>` 或者 `onerror=`。
构建时会把这些去掉，并在构建日志里提醒：

```js title="scripts/build.mjs"
function scrub(html) {
  let out = html, before;
  do {
    before = out;
    out = out
      .replace(/<(script|style|template|object|applet|frameset|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?(script|style|template|object|applet|frameset|frame|embed|base|meta|link|form|noscript)\b[^>]*>/gi, '');
  } while (out !== before); // 反复做到没有变化为止，防止 <scr<script>ipt> 这种拼接
  return out.replace(/<[a-z][^>]*>/gi, scrubTag); // 再逐个标签去掉 on* 属性和 javascript: 链接
}
```

这只是第二道防线。第一道是每个页面都带的内容安全策略（CSP）：只允许网站自己的脚本运行，
就算有漏网的 `<script>`，浏览器也不会执行。

## 代码高亮：仿 Xcode 的配色

代码高亮在构建时完成，访客不用下载高亮库。highlight.js 负责识别关键字、字符串、注释，
但它分不出“类型名”“方法调用”“属性”，而 Xcode 会把这些分别上色。所以在它的结果上再走一遍：

```js title="scripts/highlight.mjs" {9-12}
/* identifiers in plain code text: Type, CONSTANT, call(, .property */
function semantic(text) {
  let out = '';
  const re = /(&[a-z#0-9]+;)|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) { out += m[0]; continue; }
    const id = m[2];
    const before = text.slice(0, m.index).replace(/\s+$/, '');
    const after = text.slice(re.lastIndex).replace(/^\s+/, '');
    let cls = '';
    if (after.startsWith('(') || before.endsWith('::')) cls = 'x-f'; // 调用，或者方法引用 User::getName
    else if (/^[A-Z][A-Z0-9_]+$/.test(id)) cls = 'x-c';             // 常量
    else if (/^[A-Z]/.test(id)) cls = 'x-t';                          // 类型
    else if (before.endsWith('.') && !before.endsWith('..')) cls = 'x-p'; // 属性
    out += cls ? `<span class="${cls}">${id}</span>` : id;
  }
  return out;
}
```

规则很朴素：后面跟着括号的是调用，全大写的是常量，大写开头的是类型，前面有个点的是属性。
这个判断只在字符串和注释**之外**的文本上做，靠的是一个记录当前处在哪种 `<span>` 里的小栈。

另一个细节是行号。highlight.js 输出的 HTML 里，一个多行注释的 `<span>` 会跨越好几行；
想给每行单独包一层，就得在换行处把还没闭合的标签先关上、下一行再重新打开：

```js title="scripts/highlight.mjs"
function lines(html) {
  const out = [];
  const stack = [];
  let cur = '';
  for (const tok of html.match(/<span class="[^"]*">|<\/span>|\n|[^<\n]+/g) || []) {
    if (tok === '\n') {
      out.push(cur + '</span>'.repeat(stack.length)); // 这一行结束：关上所有还开着的标签
      cur = stack.join('');                           // 下一行开头：原样再打开
    } else {
      if (tok.startsWith('<span')) stack.push(tok);
      else if (tok === '</span>') stack.pop();
      cur += tok;
    }
  }
  out.push(cur);
  return out;
}
```

颜色本身写在 CSS 变量里，亮色和暗色各一套，跟着网站的主题切换：

```css title="src/styles/base.css"
html[data-theme="light"] {
  --x-kw: #9b2393;    /* 关键字 */
  --x-str: #c41a16;   /* 字符串 */
  --x-type: #3900a0;  /* 类型 */
  --x-fn: #6c36a9;    /* 方法调用 */
  --x-com: #5d6c79;   /* 注释 */
}
```

## 图片：每位访客只下载合适的那一张

文章里引用的每张图片，构建时都会经过 sharp 处理：

- 缩成 480、800、1200、1600 四种宽度（比原图宽的跳过）；
- 每种宽度各出一份 AVIF 和 WebP；
- 截图（PNG）压得轻一些保住文字清晰，照片压得狠一些；
- `.rotate()` 按 EXIF 把手机竖拍的照片转正，同时去掉拍摄地点等信息。

```js title="scripts/media.mjs"
const shot = /\.png$/i.test(src);
const q = { avif: shot ? 62 : 50, webp: shot ? 88 : 78 };
for (const w of widths) {
  for (const fmt of ['avif', 'webp']) {
    const cached = path.join(cacheDir, `${id}-${w}-${fmt}${q[fmt]}.${fmt}`);
    let data;
    if (existsSync(cached)) data = await readFile(cached);  // 处理过的直接用缓存
    else {
      const pipe = sharp(buf).rotate().resize({ width: w, withoutEnlargement: true });
      data = await (fmt === 'avif' ? pipe.avif({ quality: q.avif, effort: 4 }) : pipe.webp({ quality: q.webp, effort: 5 })).toBuffer();
      await writeFile(cached, data);
    }
    // …
  }
}
```

输出的是一个 `<picture>`：浏览器先看自己支不支持 AVIF，再按屏幕宽度和像素密度从 `srcset` 里挑一张。
图片写好了宽高，加载过程中页面不会跳动；离屏幕还远的图片不加载。比如下面这张分享卡片的原图是 JPG，
你现在看到的多半是 AVIF：

![分享到微信或 X 时显示的预览图](/og.jpg "这张图也是脚本画的：npm run og 按名字和职位生成")

## 中文字体：共用一份，每页再补一点

Windows 上的中文默认会落到微软雅黑，小字号时笔画发虚。想换成思源黑体，难处在于一套中文字体好几 MB。
做法是在构建时统计每一页用到的汉字，只从字体里切出这些字，并且分成两份：

- **共用文件**：出现在 30% 以上页面的字。下载一次之后就在缓存里，换页几乎不用再下；
- **每页自己的文件**：只有这一页（或很少几页）才用到的字。

```js title="scripts/fonts.mjs"
async plan(pages) {
  const count = { all: new Map(), heavy: new Map() };
  for (const p of pages) {
    const c = charsOf(p.html, p.extra);
    for (const kind of ['all', 'heavy']) for (const ch of c[kind]) count[kind].set(ch, (count[kind].get(ch) || 0) + 1);
  }
  const least = Math.max(2, Math.ceil(pages.length * SHARE));
  const pick = (m) => new Set([...m].filter(([, n]) => n >= least).map(([ch]) => ch));
  shared = { all: pick(count.all), heavy: pick(count.heavy) };
}
```

几个要点：

- 源字体是思源黑体的**可变字重**版本，裁剪时用 `variationAxes: { wght: 400 }` 把字重固定下来，
  得到的静态字体比保留可变轴的小将近一半；
- 同一个字被两个 `@font-face` 覆盖时，浏览器用后声明的那个。所以共用文件声明整个汉字范围，
  每页自己的文件放在后面，只列出自己的字；
- 半粗字重只包含标题和加粗文字里的字，它的 `unicode-range` 精确列出每一个字。
  别的字如果被要求加粗，浏览器会回落到常规字重再自己加粗，不会退回微软雅黑；
- 苹果设备上 `html.apple` 会把这个字体从字体栈里拿掉，继续用苹方，一个字节都不下载。

实测下来，第一次打开主页要下载约 75 KB，之后再打开别的页面，多数只要再下载几 KB 到 30 KB，特别长的文章会多一些。
连续看 6 个页面一共约 200 KB；原来每页各裁一份时约 340 KB。

## 首屏：一个着色器画出整个场景

首页那颗星球、地平线的光、日月和星星，没有一张图片，全部是一个 WebGL 片元着色器逐像素算出来的。
好处是任何屏幕上都清晰，而且页面不需要下载图片。

核心思路是**有向距离**：算出每个像素到星球边缘（一个巨大的圆）的距离 `d`，在星球里面是负数，外面是正数。
地平线那条极细的亮边，就是 `d` 接近 0 的地方：

```glsl nolines
vec2 rel = p - uPlanet.xy;
float dist = length(rel);
float d = dist - uPlanet.z;                 // 到地平线的有向距离，星球内部 < 0
float body = 1. - smoothstep(-aa, aa, d);   // 星球本身，边缘抗锯齿
float line = exp(-d*d / (.36 + aa*aa*.3));  // 那条极细的亮边
float near = exp(-along / (uPlanet.z*.16)); // 离日月正下方越近越亮
```

星星是“格子 + 哈希”：把画面切成小格，每格用哈希值决定有没有星星、亮度多少、偏暖还是偏冷。
三种格子大小叠在一起，就有了大小不一、疏密自然的星空：

```glsl
float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
vec3 stars(vec2 p,float cs,float prob,float seed,float r,float b0,float b1,float halo){
  vec2 cell=floor(p/cs);
  if(hash(cell+seed)>prob)return vec3(0.);
  vec2 sp=(cell+.15+.7*vec2(hash(cell+seed+1.7),hash(cell+seed+5.3)))*cs;
  vec2 v=p-sp;float d2=dot(v,v);
  float b=mix(b0,b1,pow(hash(cell+seed+9.1),3.));
  float t=hash(cell+seed+13.7);
  vec3 tint=t<.22?vec3(1.,.86,.74):(t>.8?vec3(.78,.86,1.):vec3(.94,.96,1.));
  return tint*b*(exp(-d2/(r*r))+halo*exp(-d2/(r*r*14.)));
}
```

最后一行是个小技巧：在颜色上加一点点随机噪声（抖动），大面积的渐变就不会出现一圈圈的色带。

```glsl nolines
col += (hash(gl_FragCoord.xy) - .5) / 255.;
```

日月的高度由访客当地的时间决定：白天是太阳，晚上是月亮。每隔一阵还会有一颗流星划过，
只在夜里、只在首屏停留时出现。不支持 WebGL 的浏览器，会用普通的 2D 画布画一个简化版。

## 明暗切换：像素波纹

右上角的按钮切换明暗时，新主题从按钮的位置像素块一样扩散开。实现用的是浏览器的 View Transitions：
浏览器先给旧画面拍一张快照，换成新主题后再拍一张，然后由我决定新画面怎么“露出来”。

露出的形状是一个 `clip-path`：屏幕切成 20 像素的方块，每个方块有一个固定的随机阈值，
波纹的半径超过“距离 + 阈值”时它就翻过来。因为阈值固定，每个方块只会翻一次，不会闪烁：

```js title="src/scripts/theme.js"
function clipPath(g, o, R, W, H, full) {
  if (full) return 'path("M0 0H' + Math.ceil(W) + 'V' + Math.ceil(H) + 'H0Z")';
  var out = '';
  for (var j = 0; j < g.rows; j++) {
    var cy = j * CS + CS / 2, run = -1;
    for (var i = 0; i <= g.cols; i++) {
      var on = false;
      if (i < g.cols) {
        var cx = i * CS + CS / 2, dx = cx - o.x, dy = cy - o.y;
        on = Math.sqrt(dx * dx + dy * dy) < R - BAND + g.noise[j * g.cols + i] * BAND;
      }
      // 同一行里连着翻过来的方块合并成一个长方形，路径短很多
      if (on && run < 0) run = i;
      else if (!on && run >= 0) {
        out += 'M' + run * CS + ' ' + j * CS + 'h' + (i - run) * CS + 'v' + CS + 'h' + (run - i) * CS + 'z';
        run = -1;
      }
    }
  }
  return 'path("' + (out || 'M0 0z') + '")';
}
```

> [!WARNING]
> 这里踩过一个坑：两帧之间如果让浏览器自动插值，两个恰好都有 N 个长方形的路径会被“变形”过去，
> 屏幕上出现奇怪的长条。解决办法是每一帧都用 `easing: 'step-end'`，不插值，一帧一帧地换。

主题默认跟着访客当地的时间走：白天浅色，晚上深色。手动切换后记住 6 小时，之后恢复自动。
为了不在加载时闪一下错误的颜色，判断主题的那几行脚本直接写在 `<head>` 里，在页面画出来之前执行。

## 液态玻璃：边缘的折射

顶部的胶囊、首屏的信息条、视频控制条都是一层“液态玻璃”：背景模糊、提亮，再盖一层半透明的色调，
左上和右下各一道边缘光。真正让它像玻璃的，是边缘那一圈的折射：靠近边缘的地方，背后的内容会被弯过来。

做法是按元素自己的尺寸和圆角画一张**位移贴图**，红色通道控制左右偏移，绿色通道控制上下偏移，128 表示不动。
每个像素先算出到圆角矩形边缘的距离，只有边缘一圈才偏移，越靠边越多，中间保持平整，文字不受影响：

```js title="src/scripts/glass.js"
var qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
var dist = Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r; // 到边缘的距离，内部为负
var depth = -dist, m = depth >= 0 && depth < band ? Math.pow(1 - depth / band, 2) : 0;
// … 算出最近那条边的法线 nx、ny
d[i] = Math.round(128 - nx * m * 127);     // 红：左右
d[i + 1] = Math.round(128 - ny * m * 127); // 绿：上下
```

这张图交给 SVG 的 `feDisplacementMap`，再用 `backdrop-filter: url(#…)` 作用到元素背后的内容上。

> [!NOTE]
> 目前只有 Chrome、Edge 这类 Chromium 浏览器支持把 SVG 滤镜用在元素背后。Safari 和 Firefox 保持普通的磨砂玻璃，
> 系统开了“减少透明度”时，玻璃直接变成实色。

玻璃只在有颜色的背景上才好看，放在白纸上几乎看不出来。所以网站有两种材质：浮在画面上的用玻璃，
放在页面底色上的内容卡片用另一套：顶部一道内发光、1 像素描边、由近到远的多重投影。

## 很长的文章：看不见的部分先不排版

这篇文章有二十多个代码块。一屏之外的代码块和图片用 `content-visibility: auto` 跳过排版和绘制，滚到附近才处理。

跳过的前提是知道它有多高，否则滚动条会乱跳，目录也会跳错位置。代码块的行数在构建时就知道，高度可以直接算出来；
图片的高度同样由比例算出：

```css title="src/styles/blog.css"
.prose .codeblock {
  content-visibility: auto;
  contain-intrinsic-size: auto calc(80px + var(--rows, 8) * 22.4px);
}
```

把页面里的代码块复制到 312 个（约 1.9 万个节点）测了一下，排版和绘制从 150 ms 左右降到 5 ms 左右。

图片加载时先显示一张 16 像素宽的小图，模糊后铺满整个框，每张只占一百多字节，直接写在页面里；
原图下载好后再淡入。文章开头的第一张图不等滚动，优先下载。

代码块的标题栏在滚动时固定在顶部。遇到特别长的行，标题栏上会多一个“换行”按钮，选择会被记住；
这个按钮只在最长的一行放不下时才出现，判断用的是构建时记下的列数，不需要先把代码块排版一遍。

## 后端：零依赖的 Java 服务

需要“动”的只有两件事：评论，和写文章的后台。它们是同一个 Java 程序的两种运行方式，
用 JDK 自带的 `com.sun.net.httpserver.HttpServer`，不依赖任何第三方库。

两个服务都只肯监听本机地址，外面的请求一律经过 Nginx：

```java title="server/src/blog/server/Main.java"
if (!InetAddress.getByName(host).isLoopbackAddress()) {
  System.err.println("listen.host 是 " + host + "：服务只能监听本机地址（127.0.0.1），由 Nginx / Caddy 转发。");
  System.exit(1);
}
return HttpServer.create(new InetSocketAddress(host, port), 128);
```

### 自己实现的 PostgreSQL 客户端

不用 JDBC 驱动，意味着要自己和数据库“说话”。PostgreSQL 的通信协议其实很规整：每条消息是一个字节的类型、
四个字节的长度，然后是内容。一次带参数的查询，就是连着发出 Parse、Bind、Describe、Execute、Sync 五条消息：

```java title="server/src/blog/server/Pg.java"
Rows query(String sql, Object... params) {
  ByteArrayOutputStream all = new ByteArrayOutputStream();
  /* Parse：SQL 文本，参数用 $1、$2 占位，类型交给服务器推断 */
  ByteArrayOutputStream p = new ByteArrayOutputStream();
  DataOutputStream pd = new DataOutputStream(p);
  cstr(pd, "");
  cstr(pd, sql);
  pd.writeShort(0);
  frame(all, 'P', p.toByteArray());
  /* Bind：参数的值单独发送，和 SQL 文本完全分开 */
  ByteArrayOutputStream bnd = new ByteArrayOutputStream();
  DataOutputStream bd = new DataOutputStream(bnd);
  cstr(bd, "");
  cstr(bd, "");
  bd.writeShort(0);
  bd.writeShort(params.length);
  for (Object v : params) {
    if (v == null) {
      bd.writeInt(-1); // SQL NULL
    } else {
      byte[] bytes = (v instanceof Boolean bo ? (bo ? "t" : "f") : v.toString()).getBytes(StandardCharsets.UTF_8);
      bd.writeInt(bytes.length);
      bd.write(bytes);
    }
  }
  bd.writeShort(0);
  frame(all, 'B', bnd.toByteArray());
  frame(all, 'D', new byte[] {'P', 0});
  frame(all, 'E', new byte[] {0, 0, 0, 0, 0});
  frame(all, 'S', new byte[0]);
  out.write(all.toByteArray()); // 五条消息一次发出去，只有一个来回
  out.flush();
  // … 读回 RowDescription、DataRow、CommandComplete，直到 ReadyForQuery
}
```

因为值和 SQL 文本是分开发送的，访客在评论框里输入什么都改变不了查询本身，SQL 注入从协议层面就不存在。

登录用的是 SCRAM-SHA-256：客户端和服务器互相证明自己知道密码，密码本身从不在网络上传输，
最后还会验证服务器的签名，防止连到冒充的数据库。整个客户端（连接池、事务、SCRAM）四百多行。

### 评论：先审核再显示

评论接口只做两件事：读已经通过的评论、提交一条新评论。提交时有几道关卡：

```java title="server/src/blog/server/Comments.java"
/* 机器人：填了隐藏的诱饵输入框，或者页面打开不到三秒就提交。照常回答“已提交”，但什么都不存 */
if (!text(in, "website2").isEmpty() || number(in, "t") < 3000) {
  Log.info("dropped a bot submission");
  Http.send(x, 202, Map.of("status", "pending"), "no-store");
  return;
}
if (!limiter.allow("post10:" + ipHash, cfg.perIp10Min, 10 * MINUTE) || !limiter.allow("postday:" + ipHash, cfg.perIpDay, 24 * 60 * MINUTE)) {
  throw new Http.Fail(429, "rate", "评论太频繁了，请稍后再试");
}
// … 昵称、邮箱、网址、内容逐项检查；链接超过 3 个的不收；同样的内容一天内不能重复提交
```

给机器人“假装成功”是故意的：如果直接报错，它就知道换个方式再试。

访客的 IP 从来不存原样，只存一个加了盐的摘要，够用来限流和识别刷屏就行：

```java title="server/src/blog/server/Guard.java"
static String ipHash(String salt, String ip) {
  byte[] d = hmac(salt.getBytes(StandardCharsets.UTF_8), String.valueOf(ip).getBytes(StandardCharsets.UTF_8));
  return HexFormat.of().formatHex(d, 0, 12);
}
```

### 数据库权限：按角色拆开

两个服务用两个不同的数据库账号，各自只拿到需要的那几列权限。评论服务是所有访客都能访问的那个，
所以它的权限最小：

```sql title="server/schema.sql"
-- 评论服务：读评论（不含邮箱和浏览器信息）、加新评论、记假后台的访问。别的都不行
GRANT SELECT (id, post, parent_id, author_name, website, content, status, is_owner, ip_hash, created_at) ON blog.comment TO blog_web;
GRANT INSERT (post, parent_id, author_name, email, website, content, ip_hash, user_agent) ON blog.comment TO blog_web;
GRANT INSERT (ip, kind, method, path, user_agent, username) ON blog.trap_hit TO blog_web;

-- 每条语句最多 5 秒，事务不许挂着不提交：服务出了问题也拖不垮数据库
ALTER ROLE blog_web SET statement_timeout = '5s';
ALTER ROLE blog_web SET idle_in_transaction_session_timeout = '10s';
```

就算评论服务被攻破，攻击者也读不到文章草稿和访客邮箱，删不了、改不了任何一条评论。

## 后台的登录与安全

后台在一串随机生成的秘密地址下面，登录要两样东西：管理密码，和手机验证器上的 6 位数。

密码在配置文件里只存摘要，用 PBKDF2-HMAC-SHA256 迭代 31 万次。比较的时候用常量时间，
不会因为“前几位对了所以慢一点”泄露信息：

```java title="server/src/blog/server/Guard.java"
static boolean verifyPassword(String stored, String password) {
  String[] p = stored.split("\\$");                 // pbkdf2-sha256$轮数$盐$摘要
  if (p.length != 4 || !p[0].equals("pbkdf2-sha256")) return false;
  int rounds = Integer.parseInt(p[1]);
  byte[] salt = Base64.getDecoder().decode(p[2]);
  byte[] want = Base64.getDecoder().decode(p[3]);
  byte[] got = pbkdf2(password.getBytes(StandardCharsets.UTF_8), salt, rounds);
  return MessageDigest.isEqual(want, got);          // 常量时间比较
}
```

手机验证码是标准的 TOTP（RFC 6238），算法短得出乎意料：用共享密钥对“当前是第几个 30 秒”做 HMAC，
再从结果里截出 6 位数字：

```java title="server/src/blog/server/Totp.java"
static String code(byte[] key, long step) {
  Mac mac = Mac.getInstance("HmacSHA1");
  mac.init(new SecretKeySpec(key, "HmacSHA1"));
  byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
  int o = h[h.length - 1] & 0xf;   // 最后一个字节的低 4 位决定从哪里截
  int n = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String.format("%06d", n % 1_000_000);
}
```

校验时前后各放宽一个周期，容忍手机时间差 30 秒；每个验证码只能用一次。

### 假后台

`/admin/`、`/wp-login.php` 这类地址每天都有扫描器来试。它们会看到一个和网站风格一致的登录页，
填什么都会在一两秒后提示“系统错误，请稍后再试”，谁也进不去。来访会被记下来（时间、地址、填的用户名），
**密码从来不读**。停顿的那一两秒是故意的，看起来像真的系统在处理：

```java title="server/src/blog/server/Trap.java"
/* the password field is never read */
record(ip, "login", method, path, agent, user);
Log.warn("trap login from %s path=%s", ip, path.replaceAll("\\s", "_"));
if (waiting.tryAcquire()) {   // 同时最多让 8 个请求等待，多了直接回答，拖不垮自己
  try {
    Thread.sleep(1200 + ThreadLocalRandom.current().nextInt(1600));
  } catch (InterruptedException e) {
    Thread.currentThread().interrupt();
  } finally {
    waiting.release();
  }
}
```

### systemd 沙箱

两个服务都以专用的系统账号运行，再套一层 systemd 的沙箱。评论服务的配置是这样的：

```ini title="server/blog-comments.service"
User=blog-comments
MemoryMax=300M
NoNewPrivileges=yes
CapabilityBoundingSet=
# 整个文件系统只读；看不到 /home，也就看不到 SSH 密钥
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallFilter=@system-service
```

## 部署：git push 就上线

服务器上有一个 Git 裸仓库。推送代码时，`post-receive` 钩子依次做这些事，输出直接显示在本地的终端里：

```bash title="deploy/post-receive"
say "检出 ${new:0:7}"
git --work-tree="$SRC" read-tree --reset -u "$new"
git --work-tree="$SRC" clean -fdq -e node_modules -e .cache -e .deploy-commit

# package.json 变了才重新装依赖
deps_hash="$({ cat package.json; cat package-lock.json 2>/dev/null || true; } | sha256sum | cut -c1-16)"
if [ ! -d node_modules ] || [ "$(cat node_modules/.deploy-hash 2>/dev/null)" != "$deps_hash" ]; then
  say "安装依赖"
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  echo "$deps_hash" > node_modules/.deploy-hash
fi

say "构建"
if ! bash "$SRC/deploy/build-site.sh" "代码 ${new:0:7}：$(git log -1 --format=%s "$new")"; then
  echo "修好后再推送一次就行。" >&2
  exit 1
fi

# server/ 变了才重新编译 Java 服务并重启
if [ "$old" = "0000000000000000000000000000000000000000" ] || ! git diff --quiet "$old" "$new" -- server; then
  ./server/build.sh
  install -m 644 server/build/blog-server.jar "$JAR_DIR/blog-server.jar.new"
  mv -f "$JAR_DIR/blog-server.jar.new" "$JAR_DIR/blog-server.jar"
  for svc in blog-comments blog-admin; do
    sudo -n systemctl restart "$svc"
  done
fi
```

真正上线的那一步在 `build-site.sh` 里：每次构建到一个带时间戳的新目录，成功了才用 `rename` 把 `live`
这个链接一步指过去。`rename` 是原子操作，访客不会碰到“换到一半”的网站；构建失败则什么都不变。

```bash title="deploy/build-site.sh"
if ! CONTENT_DIR="$content" MEDIA_DIR="$BASE/media" OUT_DIR="$BUILDS/$stamp" node scripts/build.mjs; then
  rm -rf "${BUILDS:?}/$stamp"
  echo "构建失败，网站还是之前的样子。" >&2
  exit 1
fi
ln -sfn "$BUILDS/$stamp" "$BASE/.live.new"
mv -T "$BASE/.live.new" "$BASE/live"
```

最近 5 个版本都留在服务器上，后台的「发布」页里点一下就能切回去。

### Nginx

Nginx 负责 HTTPS、压缩和限流。构建时已经生成了压缩好的 `.gz`，Nginx 直接发送，不用每次请求都现压：

```nginx title="deploy/nginx.conf"
limit_req_zone  $binary_remote_addr zone=comments:10m    rate=60r/m;
limit_req_zone  $binary_remote_addr zone=admin_login:10m rate=6r/m;

gzip_static on;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options DENY always;
```

## 性能

做完这一切，首页首次访问（空缓存）的情况：

| 内容 | 大小（压缩后） |
| --- | --- |
| HTML | 5 KB |
| CSS（全站一个文件） | 13 KB |
| JavaScript（含着色器） | 10 KB |
| 时区表（估算访客所在城市） | 5 KB |
| 英文字体 Inter，三个字重（苹果设备不下载） | 55 KB |
| 中文字体，共用文件和这一页的文件（苹果设备不下载） | 约 75 KB |

苹果设备上只有前四行，加起来约 33 KB。字体都不会挡住页面显示：文字先用系统字体画出来，字体到了再换上。

`/assets/` 下的文件名带内容哈希，可以让浏览器缓存一年；HTML 不缓存，发了新版访客立刻能看到。

## 写在最后

回头看，这个网站没有用到什么高深的技术，大部分是把基础的东西认真做一遍：
HTTP 缓存、图片格式、字体子集、数据库权限、原子替换。真正花时间的是细节，比如一个中文换行变成的空格、
一帧动画里冒出来的长条、一个机器人应该看到什么样的回答。

这篇本身也是一次测试：长文章的目录、代码块的折叠和高亮、表格、提示框、图片，都在上面用到了。
如果哪里显示得不对，欢迎在下面留言告诉我。
