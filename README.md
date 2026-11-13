# 个人主页

主页 + 博客。不依赖任何前端框架：`npm run build` 之后得到的是一堆纯静态文件，放到任何服务器或 CDN 上都能直接跑。

## 快速开始

需要 Node.js 20.9 或更新版本。

```bash
npm install
npm run dev        # 打开 http://localhost:4321 ，改任何文件都会自动重新构建并刷新（草稿也能看到）
```

不要直接双击打开 `dist/index.html`：页面里的资源用的是网站根目录的路径（`/assets/...`），
用 `file://` 打开会找不到样式和脚本。本地看效果用 `npm run dev`，看正式版用 `npm run preview`。

## 换成你自己的内容

- **`content/site.json`**：主页上的文字——名字、简介、社交链接、作品、自托管服务、关于我。上线后也可以在后台的「主页」里改。
- **`site.config.mjs`**：技术设置。`url` 一定要改成正式域名，RSS、sitemap 和分享卡片都会用到它；`navSide` 是侧边导航默认显示在哪一侧；
  `comments`、`admin` 是评论区和后台的开关。
- 两个文件里所有方括号 `[ ]` 里的都是占位，上线前替换掉（`npm run build` 会列出还剩哪些）。
- **`src/public/`** 里的文件会原样复制到网站根目录：`favicon.svg`（标签页图标）、`apple-touch-icon.png`（iOS 主屏图标）、
  `og.jpg`（分享到微信 / X 等平台时的预览图，1200×630）。

## 写文章

上线后在后台里写（见「评论和后台」）：文章存在服务器的 PostgreSQL 里，点「发布」生成静态页面。
这一节讲的 Markdown 写法在后台里一样适用；后台也能导入、导出这种格式的 `.md` 文件。

本地预览（`npm run dev`）读的是 `content/blog/` 里的 `.md` 文件，文件名就是网址：`spring-tips.md` → `/blog/spring-tips/`。
仓库里的这几篇是示例，开源给别人看用的；服务器上的网站只显示数据库里的文章，不会出现它们。

```markdown
---
title: 文章标题
date: 2026-11-01
tags: [Java, Spring]
description: 一两句话的摘要，用在文章列表、RSS 和分享卡片上；不写就自动取正文第一段
draft: true          # 可选。草稿只在 npm run dev 里能看到，不会被发布
cover: /media/2026/…jpg  # 可选。分享这篇文章时的预览图；不写就用文章里的第一张图片，没有图片就用 og.jpg
---

正文……
```

目录里的三篇示例文章演示了支持的写法，看完删掉即可；示例用的图片和视频是 `src/public/images/demo-*.jpg`
和 `src/public/videos/demo.*`，一起删掉。

文章里有两个以上的二级（`##`）或三级（`###`）标题时，屏幕边上会出现一列刻度导航，充当文章目录。
目录有三级：文章标题、二级标题（编号 01、02……）、三级标题（缩进在所属二级标题下面，带一条细竖线）；
四级及以下的标题不进目录。所以正文里的标题从 `##` 开始写，`#` 是文章标题本身。
刻度也分三种长度，三角形跟着阅读位置移动。展开后目录是一个能单独滚动的列表：鼠标在上面滚动、手指在上面拖动，
滚的是目录，文章不动；点哪一条就跳到哪里。

### 文章之间的链接（双链）

和思源、Obsidian 一样用双方括号：

```markdown
[[spring-tips]]                  链接文字自动用那篇的标题
[[spring-tips|这篇]]             竖线后面是自己写的链接文字
[[spring-tips#连接池]]           跳到那篇的某一节（写小节的标题）
[[#连接池]]                      跳到本文的某一节
```

方括号里写文章网址（文件名）最稳，写标题也能找到；文章换过网址也行，只要旧网址写在它的 `aliases` 里。
找不到的文章或小节会显示成灰色虚线，`npm run build` 也会列出来。后台编辑器的预览里同样能看到这些链接。

被链接的文章底部会自动多出「提到这篇的文章」，列出谁链接了它，以及链接所在的那句话；
普通 Markdown 链接 `[文字](/blog/spring-tips/)` 也算在内。电脑上鼠标停在这种链接上，会浮出那篇文章的摘要卡片
（手机上点一下就直接打开）。这些都在构建时算好写进页面，访客那边不多发任何请求。

### 脚注、提示框标题和折叠

- 脚注：正文写 `[^1]`，另起一行写 `[^1]: 内容`（下一行缩进两格算同一条）。按第一次出现的顺序编号，列在文章末尾的「注释」里；
  鼠标停在编号上能直接看到内容。只用没写、或写了没用的脚注，构建时会提醒。
- 提示框：`> [!TIP] 自己的标题` 换掉默认的「提示」两个字；`[!TIP]-` 折叠起来、点标题展开，`[!TIP]+` 默认展开。
  Obsidian 的 `[!info]`、`[!question]`、`[!danger]` 等名字也认，归到最接近的颜色。
- 想把一段长内容收起来，直接写 HTML 的 `<details><summary>标题</summary> … </details>`，里面空一行照样写 Markdown。

### 数学公式

用 LaTeX 写：行内 `$E = mc^2$`，单独一行 `$$ … $$` 或 ` ```math ` 代码块。构建时由 [KaTeX](https://katex.org) 排好版，
读者那边不跑脚本；只有带公式的文章才加载 KaTeX 的样式表和用到的那几款字体（几十 KB）。
`$5 和 $10` 这种钱数不会被当成公式，单独的美元符号写 `\$`。写错的公式显示成红色，构建后也会提醒。
RSS 里的公式是 MathML，阅读器自己会画。

### 系列、更新日期、相关文章

- `series: 系列名`：同名的文章连成一组，按日期排。文章开头列出整个系列（长了只显示附近几篇），结尾是「下一篇」。
- `updated: 2026-11-13`：更新日期，显示在发布日期旁边，也写进 sitemap 和给搜索引擎的数据。
  一年前写的（或最后更新的）文章会在开头提醒内容可能过时，这个在访客打开时才判断，不用为它重新发布。
- 文章底部的「相关文章」按共同标签自动挑三篇，同一个系列的不算在内。
- 这两项在后台编辑器里是「系列」和「更新日期」两个输入框。

### 分享

- 文章标题上方的「分享」：系统分享（手机上）、复制链接、生成分享图、分享到 X、分享到微博。
- 在正文里选中一段文字，会浮出一条工具栏：
  「复制链接」得到的链接打开时会标出这段文字并滚动过去（地址后面的 `#hl=…`）；
  「分享图片」把这段话做成一张图；「引用」把它放进评论框（评论里以 `>` 开头的行显示成引用）。
- 分享图在访客的浏览器里用页面自己的字体画出来，可以保存、复制或交给系统分享，不经过服务器。
  标题旁的小链接图标（电脑上鼠标移到小节标题上）复制这一节的链接。

### 图片

图片放进 `src/public/images/`，文章里这样写：

```markdown
![图片说明](/images/spring-boot.jpg "图注：写在引号里，可以不写")
```

单独占一行的图片会放在圆角框里，引号里的图注浮在图片左下角的毛玻璃上；点一下全屏查看（背后的页面变成毛玻璃，
图片从原来的位置放大出来，手机上左右滑切换、往下滑关闭）。构建时会自动处理（作品卡片的截图也一样）：

- 缩成 480 / 800 / 1200 / 1600 四种宽度，转成 AVIF 和 WebP，访客只下载适合自己屏幕的那一张；
- 写好宽高，加载时页面不跳动；快滚到图片附近才开始下载；竖拍的照片不会比屏幕还高；
- 手机竖着拍、靠 EXIF 标记方向的照片会转正。

原图用 JPG、PNG、WebP 都行，大一点没关系，会自动缩小。手机照片里记录的拍摄地点（GPS）、手机型号这些信息不会被发布：
文章里用到的图片只发布压缩后的版本（压缩时就去掉了这些信息），原图不会传到服务器上；`src/public/` 里其他带拍摄地点的照片，
发布的那一份也会自动去掉位置。`npm run video` 转出来的视频同样不带拍摄地点和手机信息。iPhone 的 HEIC 浏览器大多显示不了，要导出成 JPG
（iPhone 设置 → 相机 → 格式 → 兼容性最佳，之后拍的就都是 JPG）。
每张新图片第一次构建要几秒，结果缓存在 `.cache/` 里，之后不再重复。压缩靠 `sharp` 这个包，`npm install` 时自动装上；
万一装不上，图片会原样使用，网站照常能构建。

### 图集

几张图片挨着写、中间不夹文字，就会叠成一摞卡片，后面的卡片从底下露出一点：

```markdown
![第一张](/images/a.jpg "图注")
![第二张](/images/b.jpg)
![第三张](/images/c.jpg)
```

拖动或者左右滑动最上面那张翻页，也可以点右下角的箭头或按键盘左右键；点一下全屏查看整组。
卡片的形状跟第一张图片走；形状不一样的图片放在卡片中间，衬着它自己模糊后的颜色。

### 视频

```bash
npm run video -- ~/Desktop/IMG_1234.MOV demo     # 需要先装 ffmpeg：brew install ffmpeg / winget install Gyan.FFmpeg
```

这条命令会生成 `src/public/videos/demo.mp4` 和封面 `demo.jpg`：转成所有浏览器都能放的 H.264 MP4（iPhone 拍的 .mov 多半是
HEVC 编码，Windows 和安卓的浏览器放不了），长边缩到 1920 像素，iPhone 的 HDR 视频转成普通色彩（不转的话在大多数屏幕上发灰），
并且边下载边能播放。然后在文章里写：

```markdown
![视频说明](/videos/demo.mp4 "图注")
```

有同名封面时，访客按播放之前视频一个字节都不下载。播放器是自己做的：封面中间一个毛玻璃播放按钮，
播放后底部一条毛玻璃控制条（播放 / 暂停、进度、时长、静音、全屏），鼠标不动时自动淡出，各个浏览器看起来都一样。

**视频放自己服务器上要看两件事：**

- **每月流量**：服务器商写的 10 Gbps 之类是网口速度，套餐里通常还有每月流量上限。视频每播放一次就消耗一次它的大小：
  一个 50 MB 的视频被看 1000 次就是 50 GB。所以视频一定要先用 `npm run video` 压缩（一般能小好几倍）。
- **到访客的线路**：服务器在海外的话，国内访客实际能跑多快取决于线路，可能远低于网口速度。
  可以在自己电脑上测一下：`curl -o /dev/null -w "%{speed_download}\n" https://你的域名/videos/某个视频.mp4`（单位是字节/秒）。

超过 100 MB 的视频构建时会提醒。

### 图集

用来整理照片：有时间轴，每张可以写备注，一个图集就是一组。照片存在自己的服务器或项目里，不用图床。有两种维护方式，发布出来一模一样：

**在后台（上线后推荐）**：后台「图集 → 新图集」，把照片拖进去，写备注，再点「发布」。上传时会去掉定位、相机型号等全部附加信息，只把拍摄日期（到天）记下来排时间轴；数据存在数据库的 `album` 表，照片存在 `/srv/blog/media`，都在每日备份里。草稿只存在后台，点「发布」才上网站；已发布的图集改完点「保存并更新网站」。图集的网址改了，引用它的文章也要跟着改。

已经建好的数据库要先加上这张表，在重启新版后台之前执行一次（新建的数据库不用）：

```bash
sudo -u postgres psql -f server/upgrade-albums.sql
```

**放在项目里（本地维护）**：照片放 `content/gallery/<名字>/`，随代码 `git push`。

```bash
npm run album -- "D:/照片/台北" taipei-2026
```

这条命令把照片导入成干净的副本：转正、长边缩到 2560 像素，去掉定位、相机型号等全部附加信息，按内容重新命名，拍摄日期（只有日期）
记进 `album.json`。原图留在原来的文件夹。再运行一次可以继续添加，已经写好的备注不会变。

然后改 `content/gallery/taipei-2026/album.json`：

| 写什么 | 作用 |
| --- | --- |
| `title`、`description` | 图集的名字和开头的一段话 |
| `draft` | 新图集默认是 `true`，只在本地预览显示；改成 `false` 才发布 |
| `cover` | 封面的文件名，不写就用第一张 |
| `timeline` | 写 `month` 时时间轴只显示到月份，不透露具体哪天在哪里 |
| `days` | `{ "2026-03-14": "写给这一天的话" }` |
| `photos` | `{ "文件名.jpg": { "note": "备注", "date": "2026-03-14", "alt": "给读屏软件的描述", "hidden": true } }`；`from` 是原来的文件名，只用来对照 |

发布之后在 `/gallery/` 能看到，顶栏也会多一个“图集”。文章里单独写一行就能引用，后面的数字是显示几张（默认 4 张），其余的进图集才加载：

```markdown
::gallery[taipei-2026]{show=6}
```

**隐私**：网页上发布的永远是重新编码过的压缩副本，不带任何附加信息，图片地址也不含原文件名。原图不在 `src/public` 下，不会被复制到网站里。
要是把带定位的照片直接放进这个文件夹而不是用命令导入，构建会提醒：网页上不受影响，但原图不要提交到公开的仓库。
画面里的门牌、车牌、屏幕内容程序去不掉，发布前要自己看一眼。

后台编辑器的预览里，`::gallery[…]` 只显示成一张提示卡片，真正的预览要发布后才看得到。两边有同名的图集时，显示后台的那个。

大图模式下，手机上可以双指放大、旋转，也可以双击放大；放大或旋转时切换按钮和图注会隐藏，底部出现“还原”。

### 提示框和其他写法

引用的第一行写 `[!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]` 或 `[!CAUTION]`，会变成带颜色的提示框
（说明 / 提示 / 重要 / 注意 / 警告），和 GitHub 的写法一样：

```markdown
> [!TIP]
> npm run dev 运行时，保存文件页面会自动刷新。
```

另外还支持待办清单（`- [ ]`、`- [x]`）、键盘按键（`<kbd>⌘</kbd>`）、删除线（`~~文字~~`）。
链接是蓝色的，指向别的网站时后面带一个小箭头并在新标签页打开。示例文章《Markdown 写作指南》里每一种都有。

### 代码块

代码块按 Xcode 默认主题的配色做语法高亮（亮色、暗色各一套，跟着网站切换），高亮在构建时完成，
访客不用多下载任何脚本。除了关键字、字符串、注释这些，Java、Kotlin、TypeScript 等语言还会像 IDE 一样
区分类型名、方法调用、属性、常量和注解。三个反引号后面写语言名，还可以加文件名和要高亮的行：

````markdown
```java title="UserController.java" {8-9}
……
```
````

代码块自动带行号（复制时不会带上行号；横向滚动时行号固定在左边）。超过 30 行的代码块先折叠，只显示前 18 行，
底部有「展开全部代码」按钮；不想要的话，在语言名后面加 `nolines`（不要行号）或 `nofold`（不折叠）。
右上角有复制按钮。常用的语言都支持：Java、Kotlin、Groovy / Gradle、JavaScript / TypeScript、JSON、YAML、XML / HTML、
SQL、Shell、Python、Go、Dockerfile、Nginx、Properties、Diff 等；写 `text` 或不写语言就是纯文本。
示例文章《代码块与行内代码》里有各种语言的效果。

### 其他

主页的博客区只显示最新的 5 篇。`/blog/` 是博客自己的首页：顶上一行介绍（就是 `content/site.json` 里的 `blog.lead`，
后台「主页」里也能改）和几个数字，最新一篇放大显示，接着是最近 5 篇、按标签分的「主题」和归档入口。
全部文章在 `/blog/archive/`，按年份分组，可以搜索和按标签筛选；以前的 `/blog/?tag=…` 链接会自动转过去。
所以文章的文件名（网址）不要叫 `archive`。
文章到几百篇这一套也够用；真到那个量级再加分页。

## 构建与上线

`npm run build` 结束时会列出上线前还要处理的地方：`site.config.mjs` 里没替换的占位内容、还是示例图的 `og.jpg`、
还没删的示例图片，以及文章里指向不存在页面的链接。只是提醒，不影响构建。

```bash
npm run build      # 生成 dist/
npm run preview    # 用生产文件在本地预览，和线上的压缩方式一致
```

上线后的样子：网站、评论和后台都在你自己的服务器上。**文章在后台写、存在数据库里；代码在电脑上改、git push 上去。**

```
              ┌────────── 你在后台写 ──────────┐
              ▼                                │ 秘密地址（只有你知道）
     PostgreSQL（文章、历史版本、评论）      后台服务（Java，本机 8788）
              │ 点「发布」                     │
              ▼                                │
   导出已发布的文章 → Node 构建静态页面 → /srv/blog/live ◀── Nginx / Caddy（80、443）◀── 访客
              ▲                                            │ /api/comments、/admin/ 等
   你的电脑 ──git push 代码──┘                              ▼
                                               评论服务（Java，本机 8787）── PostgreSQL
```

- 点「发布」：后台把数据库里已发布的文章写成 Markdown 文件，交给 `deploy/build-site.sh`（就是 Node 跑 `scripts/build.mjs`）
  生成整站的静态文件，放进 `/srv/blog/builds/<时间>`，成功后把 `/srv/blog/live` 一步切过去。构建失败什么都不变。
- `git push` 代码：服务器检出新代码，用同一个脚本重新构建，文章用的是上一次发布的那一份（`/srv/blog/content`），不会被冲掉。
- 访客看到的始终是构建好的静态页面：速度和纯静态网站一样，数据库或 Java 服务停了，文章照样能看。
  只有评论会经过评论服务，它的数据库账号只能读公开的评论、加新评论。

### 服务器要准备什么

Ubuntu 22.04 / 24.04 或 Debian 12 都行，2 核 4G 绰绰有余。实测（2 核）的内存占用：

| 什么时候 | 占多少 |
| --- | --- |
| 平时：评论服务 + 后台服务 | 各 70–200 MB，合计不到 400 MB（评论服务上限 300 MB，后台上限 1 GB） |
| 发布（构建网站），图片已处理过 | 约 110 MB，1 秒左右 |
| 发布，有新图片要压缩（包括 4800 万像素的手机原图） | 约 350 MB，一张大图几秒 |
| 上传一张 4800 万像素的照片 | 约 400 MB，几秒 |
| `server/` 代码有更新时编译服务 | 约 170 MB |
| `package.json` 有更新时 `npm ci` | 几百 MB，只在依赖变了时 |

这些高峰都很短，而且同一时间只跑一个。可用内存有 1.5 GB 以上就很宽裕；服务器上没有 swap 的话，建议加 1–2 GB 当保险。

- **Web 服务器**：Nginx 或 Caddy 二选一，配置在 `deploy/`（下面细说）。
- **Node.js 20.9 或更新**：服务器上构建网站用。用 [NodeSource](https://github.com/nodesource/distributions) 或官方安装包装到系统里，
  **不要用 nvm**：推送和后台发布时读不到 nvm 装的 node。装好后 `node -v` 确认。
- **git**：`sudo apt install git`
- **JDK 21**：评论和后台服务用，`sudo apt install openjdk-21-jdk-headless`，装好后 `javac -version` 确认。
- **PostgreSQL**：14 或更新。下面会建一个独立的库。

**端口**：云服务商的安全组和服务器自己的防火墙里，只放行 TCP 22、80、443（用 Caddy 再加 UDP 443，浏览器就能用 HTTP/3）。

- 80 用来申请证书和把 http 跳到 https；443 是网站本身；22 是 SSH 和 git push，建议只允许密钥登录。
- **8787（评论）、8788（后台）和 5432（PostgreSQL）都不要对外开放**。两个服务只肯监听 127.0.0.1（配置成别的地址会拒绝启动），
  外面只能经过 Nginx / Caddy 访问；PostgreSQL 默认也只听本机。部署完用 `deploy/check.sh` 自检（见第 8 步）。
- 本地预览用的 4321 不要在服务器上开。

**HTTPS 是必须的**：`.dev` 域名被浏览器强制只走 HTTPS，证书没配好之前浏览器根本打不开；后台的登录凭证也只走 HTTPS。
Caddy 会自动申请和续期证书；Nginx 用 certbot，步骤写在 `nginx.conf` 开头。
**域名解析**：在域名商那里把 `@` 和 `www` 的 A 记录指向服务器 IP（有 IPv6 的话再加 AAAA 记录）。
服务器在中国大陆的话，域名需要先做 ICP 备案。

### 第一次部署

按顺序做一次。命令里的 `服务器IP`、`你的用户名` 换成你自己的。

**1. 账号和目录**（服务器上，用你平时登录的账号）

```bash
# 发布专用的 blog 账号：只能执行 git 操作，不能登录 shell；后台服务也用它运行
sudo useradd --system --home-dir /srv/blog --shell /usr/bin/git-shell blog
# 评论服务专用的账号：什么都登录不了
sudo useradd --system --no-create-home --shell /usr/sbin/nologin blog-comments

sudo mkdir -p /srv/blog/acme /opt/blog /etc/blog
sudo chown -R blog:blog /srv/blog /opt/blog
sudo -u blog git init --bare /srv/blog/repo.git

# 允许你用自己的 SSH 公钥以 blog 的身份推送（文件归 root 所有，blog 账号自己改不了）
sudo mkdir -p /srv/blog/.ssh
sudo cp ~/.ssh/authorized_keys /srv/blog/.ssh/authorized_keys
sudo chown -R root:root /srv/blog/.ssh && sudo chmod 755 /srv/blog/.ssh && sudo chmod 644 /srv/blog/.ssh/authorized_keys
```

**2. 部署脚本和第一次推送**

```bash
# 自己电脑上
scp deploy/post-receive 你的用户名@服务器IP:/tmp/post-receive
# 服务器上
sudo install -o blog -g blog -m 755 /tmp/post-receive /srv/blog/repo.git/hooks/post-receive
# 自己电脑上
git remote add server blog@服务器IP:/srv/blog/repo.git
git push server main
```

推送时你会在终端里看到服务器上的每一步：检出代码 → 装依赖（只有 `package.json` 变了才装）→ 构建 → 上线 → 编译评论和后台服务（只有 `server/` 变了才编译）。
这时网站已经能打开了，只是还没有文章。

**3. 数据库**

```bash
cd /srv/blog/src/server
sudo -u postgres psql -f schema.sql
openssl rand -base64 30                              # 生成两个不同的密码，各复制一个
sudo -u postgres psql -c '\password blog_web'        # 评论服务用（输入时不显示）
sudo -u postgres psql -c '\password blog_admin'      # 后台用
```

`schema.sql` 建了一个单独的数据库 `blog`（文章、历史版本、主页内容、图集、评论、假后台的访问记录）和两个能登录的角色，权限分开给：

- `blog_web`（评论服务，所有访客都能访问的那个）：只能读公开需要的几列评论、添加新评论、记一条假后台的访问。
  读不到文章和草稿，不能审核、删除或修改评论，连访客的邮箱都读不到。
- `blog_admin`（后台，登录后才能用）：能写文章、审核和删除评论，但建不了表、删不了表。

再让它们只能连这一个数据库：打开 `pg_hba.conf`（位置用 `sudo -u postgres psql -Atc 'SHOW hba_file'` 查），
在**所有 `host` 开头的行前面**加这三行，然后 `sudo systemctl reload postgresql`：

```
host    blog    blog_web                127.0.0.1/32    scram-sha-256
host    blog    blog_admin              127.0.0.1/32    scram-sha-256
host    all     blog_web,blog_admin     all             reject
```

这样即使服务出了问题，也碰不到你服务器上的其他数据库。

**4. 配置文件**

```bash
cd /srv/blog/src/server
sudo cp comments.example.properties /etc/blog/comments.properties
sudo cp admin.example.properties /etc/blog/admin.properties
sudo chown root:blog-comments /etc/blog/comments.properties
sudo chown root:blog /etc/blog/admin.properties
sudo chmod 640 /etc/blog/*.properties     # 里面有密码，只有 root 和各自的服务能读
```

每一项都有中文说明，用 `sudo nano` 打开填：

- `comments.properties`：`db.password`（第 3 步评论服务的密码）、`site.origin`（你的网址，比如 `https://yourname.dev`）、
  `security.ipSalt`（运行 `java -jar /opt/blog/blog-server.jar random-salt` 生成，之后不要再改）。
- `admin.properties`：
  - `db.password`：第 3 步后台的密码
  - `site.origin`：同上
  - `owner.name`：你在评论区回复时显示的名字
  - `admin.passwordHash`：运行 `java -jar /opt/blog/blog-server.jar hash-password`，输入两次管理密码（至少 12 位），把输出的整行贴进去。
    配置文件里只存密码的摘要，不存密码本身
  - `admin.totpSecret`：两步验证。运行 `java -jar /opt/blog/blog-server.jar totp-setup`，在手机的验证器 App（Google Authenticator、
    Microsoft Authenticator、1Password、iPhone 的“密码”App 都行）里选“输入设置密钥”，填它显示的密钥；
    再把 App 上的 6 位数输回去，对上了它才会给出要贴进配置的那一行
  - `admin.path`：后台的秘密地址。运行 `java -jar /opt/blog/blog-server.jar random-path`，得到像 `/harbor-k3Vq9xTf2LmZ8wRbNp4c`
    这样“一个单词 + 20 位随机字符”的一串。以后后台就在 `https://你的域名/harbor-k3Vq9xTf2LmZ8wRbNp4c/`，收藏到浏览器里。
    这串只写在服务器上（这个文件和下一步的 Nginx / Caddy 配置），不进 Git 仓库，也别发给别人

检查一遍：

```bash
sudo -u blog-comments env LANG=C.UTF-8 java -jar /opt/blog/blog-server.jar comments check --config /etc/blog/comments.properties
sudo -u blog env LANG=C.UTF-8 java -jar /opt/blog/blog-server.jar admin check --config /etc/blog/admin.properties
```

**5. 启动两个服务**

```bash
sudo cp /srv/blog/src/server/blog-comments.service /srv/blog/src/server/blog-admin.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now blog-comments blog-admin
systemctl status blog-comments blog-admin       # 都应该是 active (running)
```

以后 `server/` 的代码有更新，推送时会自动重新编译；要让它也能自动重启这两个服务，加一条只允许重启它们的权限：

```bash
echo "blog ALL=(root) NOPASSWD: /usr/bin/systemctl restart blog-comments, /usr/bin/systemctl restart blog-admin" | sudo tee /etc/sudoers.d/blog
sudo chmod 440 /etc/sudoers.d/blog
```

**6. Nginx 或 Caddy**：见下一节，记得把配置里的 `ADMIN_PATH` 换成你的秘密地址。

**7. 备份**：见下面「备份」，三条命令。

**8. 自检**：

```bash
sudo bash /srv/blog/src/deploy/check.sh
```

它只读不改：检查后台、评论服务和数据库的端口是不是只在本机、配置文件别人能不能读、秘密地址配好没有、
`/_admin/` 这些不该公开的地址是不是 404、假登录页和真后台各自的回应、服务是不是以非 root 账号运行、备份有没有在跑。
✗ 是必须修的。最后它会给你两条命令，在你自己的电脑上运行，确认从外面连不上 8788 和 5432。

全部通过后，打开 `https://你的域名/你的秘密地址/` 登录。文章列表是空的：点「新文章」开始写；
想先看看效果，可以点「导入」，把仓库里 `content/blog/` 的三篇示例拖进去。

### Nginx 和 Caddy

配置在 `deploy/` 里，`nginx.conf` 和 `Caddyfile` 二选一。把里面的 `yourname.dev` 换成你的域名，
`ADMIN_PATH` 换成 `admin.path` 去掉开头 `/` 的那一串（文件开头有一条 `sed` 命令一次换完）。
换好的这份只放在服务器上；仓库里的那份一直保持 `ADMIN_PATH`，开源也不会泄露你的地址。
（两份都在 nginx 1.28 和 Caddy 2.11 上实际跑过：压缩、缓存头、404、跳转、HTTP/2、接口转发、假后台都检查过，Nginx 的限流也试过。）

- 网站文件从 `/srv/blog/live` 读；`/api/comments` 转给评论服务；后台页面和接口只在秘密地址下，接口转给后台服务；
  `/_admin/`、`/_trap/`（构建出来的后台页面和假登录页的原始位置）一律 404。
- `/admin/`、`/wp-login.php`、`/login`、`/phpmyadmin` 这些扫描器常试的地址，给一个永远登录不了的假登录页（见下面「假后台」）。
- 请求由 Nginx / Caddy 先完整收下再转过去，故意慢慢发数据拖住连接的手段对后面的服务无效。
  评论请求最多 32 KB，后台最多 2 MB；上传图片最多 25 MB，导入的 zip 最多 300 MB。
- Nginx 还按访客 IP 限流：评论接口每分钟 60 次，后台每分钟 180 次，后台登录每分钟 6 次，假后台每分钟 20 次，超出的直接挡在 Nginx 这一层。
  Caddy 没有内置限流，靠两个服务自己的限制（见下面「安全措施」）。
- `/assets/` 下的文件名里带内容哈希，可以让浏览器缓存一年；HTML 不缓存，发新版后访客立刻看到；出错的响应（比如 404）一律不缓存。
- 安全设置：浏览器以后只用 HTTPS 访问（HSTS）、不许别的网站用 iframe 嵌入、关掉用不到的摄像头 / 麦克风 / 定位权限；后台不让搜索引擎收录。
- 构建时已经生成了 `.br` 和 `.gz` 压缩版本，服务器直接发送压缩好的文件，不用每次请求都现压。
- 所有字体、图片、脚本都在你自己的域名下，没有 Google Fonts 或外部 CDN，国内访问不受影响。

以后要是在前面加了 CDN（比如 Cloudflare），Nginx 看到的访客地址会变成 CDN 的地址：要按 CDN 的说明配置 `set_real_ip_from`，
否则限流会把所有访客当成同一个人。

### 日常

- **写文章**：在后台写，自动保存；点「发布」才上线（几秒钟）。已发布的文章接着改，网站上不变，直到点「更新上线」。
- **改代码**：电脑上改完 `git push server main`。构建失败网站保持原样，失败原因会显示在终端里。
- **同时推到 GitHub**：

  ```bash
  git remote set-url --add --push origin git@github.com:你的用户名/仓库名.git
  git remote set-url --add --push origin blog@服务器IP:/srv/blog/repo.git
  git push        # 两边都推
  ```

  文章不在仓库里，开源不会带出你的草稿；`admin.path` 和配置文件也只在服务器上。
- **回退**：后台「发布」里列着服务器上保留的最近 5 个版本，点「切换到这个版本」立刻生效；下次发布又会是最新内容。
  单篇文章改坏了，用编辑器「更多 → 历史版本」恢复。
- **日志**：`journalctl -u blog-admin -f`、`journalctl -u blog-comments -f`。
- **手机丢了 / 换手机**：SSH 登录服务器，重新运行 `totp-setup`，把新的那一行换进 `admin.properties`，`sudo systemctl restart blog-admin`。
  忘了管理密码也一样，重新运行 `hash-password`。秘密地址泄露了就重新运行 `random-path`，改配置、改 Nginx，重启。
- `deploy/post-receive` 本身改了的话，要按第 2 步再装一次（脚本不会自己更新自己）；`deploy/backup.sh` 改了也要按「备份」再装一次。
- 服务器配置动过以后，再跑一次 `sudo bash /srv/blog/src/deploy/check.sh`。

### 备份

要备份的是两样：**数据库**（文章、历史版本、主页内容、图集、评论）和**上传的图片**（`/srv/blog/media`）。代码在 Git 里，不用管。
分三层：

1. **防手滑**：每次发布、每次保存（写作中 10 分钟一个）都是一个历史版本，编辑器里随时恢复；删掉的文章在回收站留 30 天。
2. **服务器上每天自动备份**：凌晨 4 点左右 `pg_dump` 整个数据库，图片目录同步一份，放在 `/srv/blog/backups`。
   保留最近 14 份，另外每个月留第一份、留 12 个月。
3. **服务器以外再存一份**（防硬盘坏、服务器被入侵、云厂商出问题）：后台「发布」页一键下载最新备份（数据库 + 图片一个 zip），
   超过 30 天没下载，后台顶部会提醒。也可以让服务器每天自动传到对象存储（见下面）。

装好每天的备份（备份脚本以 root 运行，所以装一份到系统目录，推送代码改不了它）：

```bash
sudo install -m 755 /srv/blog/src/deploy/backup.sh /usr/local/sbin/blog-backup
sudo cp /srv/blog/src/deploy/blog-backup.service /srv/blog/src/deploy/blog-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now blog-backup.timer
sudo systemctl start blog-backup && journalctl -u blog-backup -n 20     # 现在就备份一次，看看结果
```

**自动传到服务器以外**（可选）：装好 [rclone](https://rclone.org/install/)，`sudo rclone config` 配置一个远程（阿里云 OSS、腾讯云 COS、
Cloudflare R2、Backblaze B2 都行），**再套一层 rclone 的 `crypt` 加密远程**，这样存储商也看不到内容。然后：

```bash
echo 'RCLONE_REMOTE=你的加密远程名:blog' | sudo tee /etc/blog/backup.conf
```

之后每天备份完会自动上传，后台显示上次上传的时间。

**恢复**（新服务器先按「第一次部署」做到第 3 步）：

```bash
sudo -u postgres pg_restore --clean --if-exists -d blog blog-<时间>.dump
sudo cp -a media/. /srv/blog/media/ && sudo chown -R blog:blog /srv/blog/media
```

然后在后台「发布」里点「重新发布全部」。后台下载的备份 zip 里有一份同样的 `恢复方法.txt`。

**恢复演练**：备份没恢复过就不算备份。建议每个季度做一次，把最新的备份恢复到一个临时库里看看文章数对不对，五分钟的事：

```bash
sudo -u postgres createdb blog_drill
sudo -u postgres pg_restore -d blog_drill --no-owner "$(ls -1t /srv/blog/backups/db/blog-*.dump | head -n 1)"
sudo -u postgres psql -d blog_drill -c 'SELECT count(*) AS 文章 FROM blog.post' -c 'SELECT count(*) AS 评论 FROM blog.comment'
sudo -u postgres dropdb blog_drill
```

另外两样东西很少变，各自存一份就行：`/etc/blog/` 里的两个配置文件（里面有密码摘要、验证码密钥和秘密地址，存进密码管理器），
以及 Nginx / Caddy 的配置。

## 评论和后台

### 评论

每篇文章下面有评论区，**先审核再显示**：访客提交后只有他自己能看到（标着“审核中”），你在后台通过后才公开。
访客只需要填昵称和内容，邮箱和网站选填，邮箱不会公开。有新评论时可以推送到企业微信 / 钉钉 / 飞书机器人或 Bark（`comments.properties` 里的 `notify.url`，可选）。
评论服务停了或者数据库连不上，评论区会自动隐藏（或显示“暂时加载不了”），网站其他部分不受影响。

不想要评论：`site.config.mjs` 里 `comments.enabled` 改成 `false`；单篇文章不要评论，在编辑器里去掉「允许评论」。

### 后台

在你的秘密地址（`admin.path`），登录要管理密码 + 手机验证器上的 6 位数。

**写文章**

- 左边写 Markdown，右边实时预览，样式和网站一样，深浅色跟着切换；滚动编辑区，预览跟到同一个位置。预览没有代码配色，发布后以网站为准。
- **自动保存**：停下来两三秒就存到服务器；网络断了先存在浏览器里，恢复后自动补上，关掉页面再打开会提示恢复。
- **保存和发布分开**：保存只存草稿，网站不变；「发布」才上线。已发布的文章接着改，状态显示“有修改未发布”，点「更新上线」才更新网站。
- **历史版本**：每次发布一个版本，写作中 10 分钟一个。「更多 → 历史版本」里能预览任何一版，一键恢复（恢复本身也会留一个版本）。
- **两个窗口同时改同一篇**（比如电脑和手机），后保存的那边会提示，选覆盖还是加载对方的版本，不会悄悄互相覆盖。
- **改网址**：已发布的文章改了网址，发布后旧地址自动跳到新地址，评论也跟着过去。
- **删除**：先进回收站，30 天后才彻底删除；删完马上点「撤销」，已发布的文章会原样回到网站上。
- 快捷键：⌘/Ctrl + S 保存，B / I / K / E 加粗、斜体、链接、行内代码；Tab / Shift+Tab 缩进；列表、编号、待办、引用回车自动接着写，
  空的一项再按回车就结束。点编辑器下面的「快捷键」能看到全部。工具栏还有表格、提示框、高亮。
- 图片：直接粘贴截图、拖进编辑框或点工具栏的图片按钮，会自动上传、转正方向、去掉拍摄地点和手机信息；同一张图传两次只存一份。

**从思源笔记、网页、Word 复制**

- 从思源复制过来的内容：去掉思源特有的块属性（`{: id=…}`）、块引用、`siyuan://` 链接，`==高亮==` 照样能用（网站也支持）。
- 思源里的图片在你电脑上（`assets/…`）。思源正在运行时，编辑器会尝试直接从它那里取（`http://127.0.0.1:6806`，浏览器可能会问一次
  “是否允许访问本地网络上的设备”，选允许）；取不到的话，编辑器上方会列出缺的图片，把思源工作空间 `data/assets` 里的那几张拖进来，
  按文件名自动换上。
- 从网页、Word、飞书、Notion 复制的带格式内容，自动转成 Markdown（标题、加粗、列表、表格、代码、图片）；嵌在里面的图片自动上传；
  `javascript:` 链接、脚本这些直接丢掉。不想转换就用 ⌘/Ctrl + Shift + V 粘贴纯文本。
- 选中几个字再粘贴一个网址，就变成链接。

**导入和导出**

- 「文章 → 导入」：拖进 `.md` 文件或 zip。支持这个后台导出的 zip、思源「导出 → Markdown」的 zip，以及 Obsidian、Typora、Hexo、Hugo
  的 Markdown（文件开头的标题、日期、标签、摘要、封面都能认出来；GBK 编码的文件也行）。zip 里的图片按相对路径（或者文件名）找到，
  一起上传。已经有同样网址的文章时可以选覆盖（原来的留在历史版本里）、另存或跳过。**导入的都是草稿**，看过再发布。
- 「导出全部」或编辑器里的「更多 → 导出这篇」：得到一个 zip，`posts/` 里是 Markdown 文件，`media/` 里是图片，链接是相对路径，
  用 Typora、Obsidian、VS Code 打开就能看到图。它本身也是一份不依赖这个程序的备份。

**其他几页**

- **评论**：通过、以作者身份回复（回复会同时通过这条评论）、删除（连同下面的回复）。
- **主页**：名字、介绍、链接、作品、自托管服务、“关于”，保存后自动重新发布。
- **发布**：当前是哪个版本、最近 5 次构建（可以切回去）、「重新发布全部」，以及备份的情况和下载。
- **安全**：假后台的访问记录。

### 假后台

`/admin/`、`/wp-login.php`、`/login`、`/administrator`、`/phpmyadmin` 这类地址，每天都会有自动扫描器来试。
它们会看到一个和网站风格一致的登录页：填什么都会在一两秒后提示“系统错误，请稍后再试”，谁也登录不进去。

来访都会记下来（时间、地址、浏览器、填的用户名），**密码从来不存**，后台「安全」页能看到；有人在那里点了登录，可以推送一条通知
（`comments.properties` 的 `notify.url`，每个地址 6 小时最多一条）。只记录、不封禁：同一个出口地址后面常常有很多人
（手机网络、公司网络、CDN），封了容易误伤你自己；挡住别人的是秘密地址、密码和验证码。
想在防火墙上直接拦掉扫描器的话，日志里 `trap login from <地址>` 这一行可以交给 fail2ban。

### 安全措施

评论、假后台和后台是这个网站仅有的接收外部输入的地方，下面这些都做了，并且实际攻击测试过：

| 风险 | 怎么防的 |
| --- | --- |
| 找到后台 | 后台只在一串只有你知道的地址下（约 119 位随机），页面和接口都在那里；常见的后台地址都是假登录页；后台不让搜索引擎收录 |
| 有人登进后台 | 管理密码（PBKDF2 31 万轮，配置里只存摘要）+ 手机验证码，两样都对才能登录，验证码只能用一次；同一 IP 15 分钟内错 5 次就锁，所有来源加起来每分钟最多 20 次；Nginx 再限一层 |
| 冒充你的身份操作（CSRF） | 登录凭证是 HttpOnly + Secure + SameSite=Strict 的 Cookie，只发给后台的接口地址，页面脚本读不到，别的网站也带不上；所有修改操作都检查请求来自你的网站 |
| 绕过 Nginx 直连 | 两个服务只肯监听 127.0.0.1（配错会拒绝启动）；数据库的两个角色按 pg_hba.conf 只能从本机连这一个库；`deploy/check.sh` 自检 |
| 后台被攻破之后 | 后台只能改文章、图片和主页内容，改不了构建和运行网站的代码，拿不到服务器的执行权限；它以只能做 git 操作的 blog 账号运行，systemd 沙箱让它除了 /srv/blog 哪里都写不了、看不到你的家目录和 SSH 密钥 |
| 评论服务被攻破之后 | 它以一个什么都登录不了的专用账号运行，沙箱里一个文件都写不了；数据库账号只能读公开的评论、加新评论、记假后台的访问，读不到文章、审核删除都做不到 |
| SQL 注入 | 所有查询都用参数绑定，内容从来不会拼进 SQL |
| XSS | 评论在页面上一律作为纯文本显示。文章里的 `<script>`、`onerror=` 之类、`javascript:` 链接（比如导入了别人写的文件）在构建时去掉，构建日志会提醒；而且**全站每个页面都有内容安全策略（CSP）**，只允许网站自己的脚本运行，就算漏了也执行不了。后台的 CSP 更严，预览在禁止脚本的沙箱框架里显示，从网页粘贴的内容只被读取、转成 Markdown，不会执行 |
| 恶意图片 | 只收真正的 JPG / PNG / WebP / GIF / AVIF（看文件内容，不看扩展名），最多 25 MB、8000 万像素（防“解压炸弹”）；每张都重新解码保存一遍，去掉拍摄地点、手机型号等全部附带信息 |
| SSRF | 服务器从不按网址去下载任何东西：外部图片原样留着链接（编辑器会提示你），思源的图片是你的浏览器去取 |
| 恶意 zip（导入） | 压缩包里的文件名从来不用来写文件，`../` 之类的条目直接跳过；最多 5000 个文件、单个文件和解压总量都有上限（防压缩炸弹）；上传的临时文件处理完就删 |
| 路径穿越 | 文章网址、图片地址都按白名单检查，`..` 之类的一概不收；读写前再确认路径在允许的目录里 |
| 刷评论、垃圾广告 | 隐藏的诱饵输入框和填写时间检查过滤机器人；每个访客 10 分钟最多 5 条、一天 20 条；同样内容一天内不能重复提交；链接超过 3 个的不收；待审核超过 500 条暂停接收 |
| 拖垮服务器 | 请求大小、JSON 嵌套和长度都有上限；慢速连接由 Nginx 吸收；两个服务各有内存上限；数据库查询有时间上限；发布一次只跑一个；假后台每个地址每小时最多记 30 条 |
| 访客隐私 | 评论访客的 IP 只存加盐摘要（用来限流和识别刷屏），不存原始 IP；邮箱不公开 |
| 数据丢失 | 历史版本、回收站、每天自动备份、服务器以外的副本（见「备份」） |

评论和后台服务（`server/`）是 Java 21 写的，**不依赖任何第三方库**（连数据库驱动都是自己实现的），所以不存在“某个依赖爆出漏洞”的问题。
前端构建只用了 marked、highlight.js、sharp 和 subset-font 四个包（都只在构建时运行，访客的浏览器不会下载），偶尔在电脑上 `npm audit` 看一眼就行。

### 在自己电脑上试

`npm run dev` 会把 `/api/comments` 转给本机 8787 端口上的评论服务，后台页面在 `/_admin/`，它的接口 `/_admin/api/` 转给本机 8788
（地址可以用环境变量 `COMMENTS_API`、`ADMIN_API`、`ADMIN_PATH` 改）；没有运行这两个服务时，评论区会提示没连上、后台会提示连不上，不影响别的。

两个服务在本机跑起来需要 PostgreSQL 和 JDK 21：按上面第 3 步建库（Mac 上用 Homebrew 装的 PostgreSQL，管理员就是你自己，
把 `sudo -u postgres psql` 换成 `psql -d postgres`），然后

```bash
cd server && ./build.sh
cp comments.example.properties comments.properties    # 已在 .gitignore 里，不会被提交
# 改 comments.properties：site.origin=http://localhost:4321，site.root=../dist，再填 db.password 和 security.ipSalt
LANG=C.UTF-8 java -jar build/blog-server.jar comments --config comments.properties
```

后台要的东西多一些（一份 `/srv/blog` 那样的目录、构建脚本），直接在服务器上用最省事。

## 加载速度

首页的星球、地平线的光和日月都是浏览器当场用代码画的（WebGL），没有一张图片要下载。
首次访问主页（空缓存）一共 11 个请求，约 165 KB；iPhone、iPad 和 Mac 不用下载字体，只要 4 个请求，约 33 KB：

| 内容 | 传输大小 |
| --- | --- |
| HTML（文本文件都按 br 压缩后计） | 5.5 KB |
| CSS（全站一个文件） | 13 KB |
| JS（主页一个文件，含主视觉的着色器） | 10 KB |
| 时区表（用来估算访客所在城市） | 5.1 KB |
| 英文字体（Inter 三个字重，只含拉丁字符；苹果设备不下载） | 55 KB |
| 中文字体（共用文件加这一页的文件，两个字重；苹果设备不下载） | 约 75 KB |

字体用 `font-display: swap`，不会挡住页面显示。下面这组数字是加入中文字体和主页改版之前测的，当时首次访问约 88 KB：

在 Chrome 里限速模拟首次访问：

| 场景 | 首次内容绘制（FCP） | 最大内容绘制（LCP） | 布局偏移（CLS） |
| --- | --- | --- | --- |
| 桌面，10 Mbps，40 ms 延迟 | 0.3 s | 0.3 s | 0 |
| 手机，慢速 4G（1.6 Mbps，150 ms 延迟）+ CPU 降速 4 倍 | 0.9 s | 0.9–2.2 s | 0 |
| 同上，iPhone（不下载字体） | 0.6 s | 0.6–1.9 s | 0 |

（测试环境没有显卡，这组数字是关掉着色器测的；着色器在真实设备的显卡上每帧只要几毫秒，画布最多约 800 万像素。
LCP 有时晚一些，是因为首屏文字有一段淡入动画，浏览器在动画结束时才记下“最大内容”；页面其实在 FCP 时就已经显示出来了。
Google 的“良好”标准是 LCP 2.5 s 以内、CLS 0.1 以内。）

**字体**：iPhone、iPad 和 Mac 上直接用系统字体，也就是 iPhone 自己用的 SF Pro（英文数字）和苹方（中文），什么都不用下载。
其他设备上英文和数字用 Inter：苹果的字体只授权在苹果设备上使用，不能放到网站上给别的设备下载，Inter 是最接近 SF Pro 的免费字体；
中文用思源黑体（Noto Sans SC，SIL Open Font License），构建时统计每一页的汉字（包括脚本会显示的文字），只切出用到的字，分两份：
出现在 30% 以上页面的字放进**共用文件**，下载一次之后就在缓存里；其余的字放进**每页自己的文件**。
常规字重包含全部的字，半粗字重只包含标题和加粗里的字。第一次打开主页约 75 KB，之后的页面多数只要再下载几 KB 到 30 KB（特别长的文章会多一些），苹果设备上为 0。
发布新文章后共用文件可能跟着变，访客下次访问时重新下载一次。比例在 `scripts/fonts.mjs` 的 `SHARE`。
完整字体在 `src/fonts/source/`（7.8 MB，只在构建时用，不会发布），裁好的结果缓存在 `.cache/fonts/`。
评论里访客写的、页面上原本没有的字，会用系统字体显示。

**长文章和大量图片**：

- 一屏之外的代码块和图片用 `content-visibility: auto` 跳过排版和绘制。高度由构建时记下的行数和图片比例算出，所以滚动条不跳、目录跳转准确。
  把代码块复制到 312 个（约 1.9 万个节点）测试，排版和绘制从约 150 ms 降到约 5 ms。
- 每张图片在页面里带一张 16 像素宽的小图（约 130 字节），模糊后铺满图片框，原图下载好后淡入。文章开头的第一张图优先下载。
- 液态玻璃的位移贴图只在控件接近屏幕时才生成。

**代码块**：标题栏在滚动时固定在顶栏下面；最长的一行放不下时，标题栏上出现“换行”按钮，选择记在访客的浏览器里。

分享预览图 `src/public/og.jpg` 由 `npm run og` 按 `content/site.json` 里的名字和职位生成，改了名字以后再运行一次。

## 首页遥测条

首页左下角一行小字，数据都是访客自己的：`TAIPEI · 14:30 · 28°C · 日落 17:11`。

- **位置**：不弹定位请求，也不查 IP，而是按浏览器的时区估算城市（`Asia/Shanghai` → 上海），下一次日出 / 日落在浏览器里直接算。时区表由 `tools/tz_coords.py` 从系统的时区数据库生成。
- **温度**：页面加载完后，由访客的浏览器向 [Open-Meteo](https://open-meteo.com/) 查询这个估算城市的当前气温，结果缓存 20 分钟。Open-Meteo 免费、不需要 key，但要求注明数据来源，所以页脚有一个链接。查不到时这一项不显示。

后台「主页」里的自托管服务不再单独占一屏，正常运行的那几个会作为「关于」里的一行列出来。

## 可以调的参数

- **主页**：一整页正常滚动（不再整屏翻页）。顶栏在首屏之上只是文字，滚过星球后变成玻璃；看到作品和关于时，顶栏里会标出来。
  从上到下：星球（底部一枚玻璃胶囊：城市、时间、气温、下一次日出日落）→「此刻」一排小卡片（当地时间和太阳轨迹、天气、
  最新文章、写作统计）→ 博客（分组列表，有图的文章显示缩略图，没有的按标签生成一块彩色图标）→ 作品 → 关于。
- **作品**：第一个作品显示成大图，之后按“半宽、半宽、整宽”排。截图放 `src/public/images/work/`，16:10 最合适；
  在 `site.json`（或后台「主页」）里给作品写 `"live": "planet"`，那一格显示活的星球（跟着明暗切换，鼠标移过地平线会亮）。
- **材质**：`src/styles/base.css` 的「materials」一节。`.card` 是放在页面底色上的卡片（顶部内发光 + 1px 描边 + 多重投影），
  `.glass` / `.glass-clear` 是液态玻璃（常规的用于顶栏和菜单，清透的用于图片、视频上的图注和控制条），颜色都在
  `--card-*`、`--glass-*` 变量里，深浅色各一套。系统开了“减少透明度”或浏览器不支持背景模糊时，玻璃自动变成实色。
- **顶栏**：每一页都是顶部正中一枚悬浮的玻璃胶囊（名字、博客 / 图集 / 作品 / 关于、明暗切换）。同一个词在哪一页都去同一个地方：博客和图集是独立页面，作品和关于是主页上的内容。当前所在的那一项下面有一枚小胶囊滑过去
  （`src/scripts/nav.js`）。在 Chrome / Edge 里，顶栏、首屏的信息胶囊和搜索框的边缘会像玻璃一样折射背后的内容
  （`src/scripts/glass.js`，按元素自己的尺寸画一张位移贴图，通过 SVG 滤镜作用在背景上）；Safari、Firefox 和开了“减少透明度 /
  减少动态效果”的系统保持普通的磨砂玻璃。
- **文章目录**：展开后顶部显示已读百分比和一条进度线；二级标题的编号放在小方块里，正在读的那一节方块变成蓝色、整行高亮。
- **全部文章页**：标签是一个分段控件，滑块跟着选中的标签走；搜索框是玻璃胶囊，边输入边在下面的玻璃面板里列出匹配的文章，
  方向键选择、回车打开、Esc 关闭，同时下面的列表也跟着筛选。
- **圆角**：`--r-xl` / `--r-lg` / `--r-md` / `--r-sm` / `--r-xs`。套在圆角盒子里的东西按同心圆角走：内圆角 = 外圆角 − 两者间距。
- **明暗切换动画**：`src/scripts/theme.js` 里的 `CS`（像素块大小）、`BAND`（边缘起伏的宽度）、`DUR`（时长，毫秒）。
- **主题**：默认跟随访客当地时间（白天浅色，晚上深色）。访客手动切换后记住 6 小时，之后恢复自动。
- **侧边导航**：`site.config.mjs` 里的 `navSide` 决定默认在左还是右；访客可以在导航面板底部自己切换，记在他自己的浏览器里。
- **代码折叠**：`scripts/highlight.mjs` 里的 `FOLD_OVER`（超过多少行折叠，默认 30）和 `FOLD_TO`（折叠后显示几行，默认 18）。
- **代码配色**：`src/styles/base.css` 里以 `--x-` 开头的颜色，亮色、暗色各一组。

## 目录结构

```
site.config.mjs        技术设置（域名、语言、评论和后台开关）
content/blog/          示例文章（Markdown），本地预览用；服务器上的文章在数据库里
src/templates/         页面模板（纯 JS 模板字符串）
src/styles/            base.css 全站 · home.css 主页 · blog.css 博客（含评论区）· admin.css 后台
src/scripts/           theme.js 明暗切换 · scene.js 主视觉着色器 · ruler.js 刻度导航 · home.js 主页顶栏 / 星球 / 遥测条 · toc.js 文章目录
                       archive.js 搜索与标签筛选 · media.js 图片全屏 / 图集 / 视频播放器 / 代码复制
                       comments.js 评论区 · admin.js 后台
src/fonts/             Inter 字体子集（SIL Open Font License，见 OFL-Inter.txt）
src/public/            原样复制到网站根目录的文件
src/data/tz.json       时区 → 城市坐标表（遥测条用）
scripts/               build.mjs 构建 · highlight.mjs 代码高亮 · media.mjs 图片和视频处理 · video.mjs 视频转换 · dev.mjs 本地预览
.cache/                压缩好的图片缓存（不用提交，删掉会在下次构建时重新生成）
tools/tz_coords.py     生成时区 → 城市坐标表（src/data/tz.json）
deploy/                nginx.conf / Caddyfile · post-receive（git push 部署代码）· build-site.sh（构建并上线，推送和后台发布共用）
                       backup.sh + blog-backup.service/.timer（每天备份）· check.sh（上线前自检）
server/                评论和后台服务（Java 21，无第三方依赖）：src/ 源码 · schema.sql 建库 · build.sh 编译
                       *.example.properties 配置模板 · *.service systemd 服务
content/site.json      主页上的文字：本地预览和服务器上第一次的起点（之后在后台「主页」里改，存在数据库里）
```

## 主视觉

`src/scripts/scene.js` 里的一个片元着色器画出整个场景：一颗巨大的星球，地平线从左下斜着升到右边；
地平线是一道极细的亮边，日月下方最亮、向两侧衰减；太阳或月亮升起越过地平线的那一刻，亮边会膨胀成一团光。
黑夜是近黑的底色、冷蓝的光和大小不一的星星，偶尔划过一颗流星（每 15–45 秒最多一颗，只在首页停留时出现）；
白天是淡蓝的天空、蓝灰的星球和地平线上的一道白色光晕。鼠标移过时，地平线会跟着闪一下。
切换明暗时，新画面里的日月先藏在地平线下，像素波纹结束后再升起。

- 构图（星球大小、地平线位置、日月在哪）在 `src/scripts/home.js` 的 `layout()` 里，横屏和竖屏各一套。
- 颜色和光的强弱在 `scene.js` 的着色器里，夜里和白天各一段，都有注释。
- 不支持 WebGL 的浏览器会用普通 2D 画布画一个简化版。

## 搜索引擎、分享和订阅

- 每篇文章分享到微信、X、Telegram 时，预览图是文章里的第一张图片（构建时裁成 1200×630），没有图片就用 `og.jpg`。
- 页面里带有结构化数据（文章标题、发布日期、作者），搜索结果里能显示日期；`sitemap.xml` 带每篇文章的日期。
- RSS（`/rss.xml`）里是文章全文，用 RSS 阅读器订阅可以直接读完，图片和代码都在。
- 打印文章或者“存储为 PDF”时，不管当时是深色还是浅色，都会用白底黑字；折叠的代码全部展开，图集里的图片依次排开。

## 浏览器支持

- 明暗切换的像素动画用的是 View Transitions API；不支持的浏览器会直接切换，没有动画。
- 关掉 JavaScript 时页面变成普通的长页面，内容都能正常阅读。
- 系统开启了“减少动态效果”时，动画会自动关闭。
