// 站点的技术设置。主页上的文字（名字、简介、链接、作品、服务、关于）在 content/site.json 里，
// 上线前把方括号里的占位内容都换成你自己的。部署到服务器以后，这些文字在后台的「主页」里改（存在数据库里），
// 构建时由后台写进 CONTENT_DIR/site.json；这里的 content/site.json 只是第一次的起点和本地预览用的。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const local = new URL('./content/site.json', import.meta.url);
const fromServer = process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR, 'site.json') : null;
const content = JSON.parse(readFileSync(fromServer && existsSync(fromServer) ? fromServer : local, 'utf8'));

export default {
  // 正式域名（RSS、sitemap、分享卡片会用到），不要以 / 结尾，比如 'https://example.com'。
  // 还没有域名时先空着：页面照常生成，只是这些地方会是相对地址，构建时会提醒你
  url: '',

  // 主页「此刻」第一张卡片：你这边的时间和日出日落，并写出和访客差几个小时。只用时区算，不需要更精确的位置。
  // timeZone 用 IANA 名称（比如 'Asia/Shanghai'），city 是卡片上显示的名字。不想公开，把 timeZone 改成 '' 这张卡片就不显示
  here: { timeZone: 'Asia/Taipei', city: '台北' },
  lang: 'zh-CN',

  // 侧边导航默认在屏幕哪一侧：'left' | 'right'。访客也可以在导航面板底部自己切换，会记在他的浏览器里
  navSide: 'left',

  // 文章下面的评论区，评论存在你自己服务器的 PostgreSQL 里（服务在 server/，部署方法见 README「评论和后台」）。
  // 评论服务没运行时评论区自动隐藏，不会显示成坏掉的样子。不想要评论就把 enabled 改成 false；
  // 单篇文章不要评论，在它开头的 --- 里写 comments: false
  comments: {
    enabled: true,
    api: '/api/comments', // 一般不用改：Nginx / Caddy 把这个路径转给评论服务
  },

  // 后台（写文章、管评论、改主页、备份）。它的地址是只写在服务器上的一串秘密路径（admin.properties 的 admin.path），
  // 不在这里，也不进 Git 仓库；/admin/ 这类常见地址会显示一个永远登录不了的假登录页（见 README「评论和后台」）。
  // 改成 false：不生成后台页面和假登录页
  admin: {
    enabled: true,
  },

  ...content,
};
