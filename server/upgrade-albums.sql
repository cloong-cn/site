-- 给已经建好的数据库加上图集这张表。新建的数据库不用执行（schema.sql 里已经有了）；执行多次也没关系。
-- 要在重启新版后台之前执行，否则发布时会因为找不到这张表而失败：
--
--   sudo -u postgres psql -f upgrade-albums.sql

\set ON_ERROR_STOP on
\connect blog

SET ROLE blog_owner;

CREATE TABLE IF NOT EXISTS blog.album (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug       text        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 80 AND slug !~ '[/\\[:space:]]' AND slug NOT LIKE '%..%'),
  data       jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object' AND jsonb_typeof(data->'photos') = 'array'),
  draft      boolean     NOT NULL DEFAULT true,
  version    integer     NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

RESET ROLE;

GRANT SELECT, INSERT, UPDATE, DELETE ON blog.album TO blog_admin;
