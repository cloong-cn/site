-- 网站的数据库：文章、历史版本、主页内容、图集、评论、假后台的访问记录。用 PostgreSQL 的管理员账号执行一次：
--
--   sudo -u postgres psql -f schema.sql
--   sudo -u postgres psql -c '\password blog_web'      （评论服务用的密码，输入时不显示）
--   sudo -u postgres psql -c '\password blog_admin'    （后台用的密码，和上面那个不要一样）
--
-- 会创建：
--   数据库 blog，里面一个 schema 也叫 blog
--   角色 blog_owner   不能登录，只用来拥有表
--   角色 blog_web     评论服务（所有访客都能访问的那个）用。只能读公开需要的几列评论、添加新评论、
--                     记一条假后台的访问；不能审核、删除、修改任何东西，读不到文章草稿，连访客的邮箱都读不到
--   角色 blog_admin   后台用（登录后才能访问）。能写文章、审核评论、看假后台的记录
-- 两个角色都不能建表删表。再按 README 在 pg_hba.conf 里加三行，它们就只能连 blog 这一个库。
--
-- 密码可以用  openssl rand -base64 30  生成，分别填进两个配置文件的 db.password。

\set ON_ERROR_STOP on

CREATE ROLE blog_owner NOLOGIN;
CREATE ROLE blog_web LOGIN CONNECTION LIMIT 10;
CREATE ROLE blog_admin LOGIN CONNECTION LIMIT 4;

CREATE DATABASE blog OWNER blog_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE blog FROM PUBLIC;
GRANT CONNECT ON DATABASE blog TO blog_web, blog_admin;

\connect blog

REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA blog AUTHORIZATION blog_owner;

SET ROLE blog_owner;

-- ---------------------------------------------------------------- 文章

-- 每篇文章一行：后台编辑器里正在写的样子（自动保存的就是这一份）
CREATE TABLE blog.post (
  id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug               text        NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 120 AND slug !~ '[/\\[:space:]]' AND slug NOT LIKE '%..%'),  -- 网址：/blog/{slug}/
  title              text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  date               date        NOT NULL,
  tags               jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tags) = 'array'),
  description        text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  cover              text        NOT NULL DEFAULT '' CHECK (char_length(cover) <= 300),
  comments           boolean     NOT NULL DEFAULT true,
  body               text        NOT NULL DEFAULT '' CHECK (char_length(body) <= 500000),
  extra              jsonb       NOT NULL DEFAULT '[]',          -- 导入时文件开头里这个后台不认识的设置，原样保留
  aliases            jsonb       NOT NULL DEFAULT '[]',          -- 以前用过的网址：旧链接会自动跳到现在的网址
  words              integer     NOT NULL DEFAULT 0,
  version            integer     NOT NULL DEFAULT 1,             -- 每保存一次加 1；两个窗口同时改同一篇时靠它发现
  published_revision bigint,                                     -- 网站上现在显示的是哪个版本；空 = 没有发布
  first_published_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz                                 -- 在回收站里（30 天后自动彻底删除）
);
CREATE UNIQUE INDEX post_slug ON blog.post (slug) WHERE deleted_at IS NULL;

-- 历史版本：每次发布一份；写作中的保存每 10 分钟最多一份
CREATE TABLE blog.post_revision (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id     bigint      NOT NULL REFERENCES blog.post (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('save', 'publish', 'import', 'restore')),
  slug        text        NOT NULL,
  title       text        NOT NULL,
  date        date        NOT NULL,
  tags        jsonb       NOT NULL,
  description text        NOT NULL,
  cover       text        NOT NULL,
  comments    boolean     NOT NULL,
  body        text        NOT NULL,
  extra       jsonb       NOT NULL,
  words       integer     NOT NULL,
  saved_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_revision_by_post ON blog.post_revision (post_id, id DESC);

ALTER TABLE blog.post ADD CONSTRAINT post_published_revision
  FOREIGN KEY (published_revision) REFERENCES blog.post_revision (id) ON DELETE SET NULL;

-- 主页上的文字（名字、介绍、链接、作品……）：每次保存一行，最新的一行就是现在的
CREATE TABLE blog.site_revision (
  id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data     jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  saved_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- 图集

-- 每个图集一行：名字、说明、每张照片的地址和备注都在 data 里，后台整份保存。不是草稿的才会发布
-- （已经建好的数据库用 upgrade-albums.sql 加上这张表）
CREATE TABLE blog.album (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug !~ '[/\\[:space:]]' AND slug NOT LIKE '%..%'),  -- 网址：/gallery/{slug}/
  data       jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object' AND jsonb_typeof(data->'photos') = 'array'),
  draft      boolean     NOT NULL DEFAULT true,
  version    integer     NOT NULL DEFAULT 1,                       -- 每保存一次加 1；两个窗口同时改同一个图集时靠它发现
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- 评论

CREATE TABLE blog.comment (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post        text        NOT NULL CHECK (char_length(post) BETWEEN 1 AND 120),     -- 文章网址里的名字，比如 markdown-guide
  parent_id   bigint      REFERENCES blog.comment (id) ON DELETE CASCADE,           -- 回复的是哪条评论（只有一层）
  author_name text        NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 40),
  email       text        CHECK (char_length(email) <= 120),                       -- 选填，不公开
  website     text        CHECK (char_length(website) <= 200 AND website ~ '^https?://'),
  content     text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  is_owner    boolean     NOT NULL DEFAULT false,                                   -- 你自己在后台的回复
  ip_hash     text        CHECK (char_length(ip_hash) <= 64),                       -- 访客 IP 加盐后的摘要，不存原始 IP
  user_agent  text        CHECK (char_length(user_agent) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE INDEX comment_by_post ON blog.comment (post, created_at) WHERE status = 'approved';
CREATE INDEX comment_pending ON blog.comment (created_at) WHERE status = 'pending';
CREATE INDEX comment_by_ip   ON blog.comment (ip_hash, created_at);
CREATE INDEX comment_parent  ON blog.comment (parent_id);

-- ---------------------------------------------------------------- 假后台

-- 有人打开 /admin/、/wp-login.php 这类地址（visit），或者在那里点了登录（login）。不记密码。
-- 只是记录，不会因此封谁。超过 90 天的记录后台会自动清掉
CREATE TABLE blog.trap_hit (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  ip         text        NOT NULL CHECK (char_length(ip) <= 45),
  kind       text        NOT NULL CHECK (kind IN ('visit', 'login')),
  method     text        NOT NULL CHECK (char_length(method) <= 10),
  path       text        NOT NULL CHECK (char_length(path) <= 300),
  user_agent text        CHECK (char_length(user_agent) <= 300),
  username   text        CHECK (char_length(username) <= 100)                       -- 对方填的用户名（密码从来不存）
);
CREATE INDEX trap_hit_by_time ON blog.trap_hit (at);

RESET ROLE;

GRANT USAGE ON SCHEMA blog TO blog_web, blog_admin;

-- 评论服务：读评论（不含邮箱和浏览器信息）、加新评论、记假后台的访问。别的都不行
GRANT SELECT (id, post, parent_id, author_name, website, content, status, is_owner, ip_hash, created_at) ON blog.comment TO blog_web;
GRANT INSERT (post, parent_id, author_name, email, website, content, ip_hash, user_agent) ON blog.comment TO blog_web;
GRANT INSERT (ip, kind, method, path, user_agent, username) ON blog.trap_hit TO blog_web;

-- 后台：文章、主页和图集随便改；评论能读、审核、回复、删除，文章改网址时评论跟着走；假后台的记录能看、能清
GRANT SELECT, INSERT, UPDATE, DELETE ON blog.post, blog.post_revision, blog.site_revision, blog.album TO blog_admin;
GRANT SELECT, DELETE ON blog.comment TO blog_admin;
GRANT INSERT (post, parent_id, author_name, content, status, is_owner, approved_at) ON blog.comment TO blog_admin;
GRANT UPDATE (status, approved_at, post) ON blog.comment TO blog_admin;
GRANT SELECT, DELETE ON blog.trap_hit TO blog_admin;

-- 每条语句最多 5 秒（后台 15 秒），事务不许挂着不提交：服务出了问题也拖不垮数据库
ALTER ROLE blog_web IN DATABASE blog SET search_path = blog;
ALTER ROLE blog_admin IN DATABASE blog SET search_path = blog;
ALTER ROLE blog_web SET statement_timeout = '5s';
ALTER ROLE blog_admin SET statement_timeout = '15s';
ALTER ROLE blog_web SET lock_timeout = '3s';
ALTER ROLE blog_admin SET lock_timeout = '3s';
ALTER ROLE blog_web SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE blog_admin SET idle_in_transaction_session_timeout = '30s';

\echo ''
\echo '建好了。接着给两个角色设置密码（输入时不显示）：'
\echo '  sudo -u postgres psql -c ''\\password blog_web'''
\echo '  sudo -u postgres psql -c ''\\password blog_admin'''
