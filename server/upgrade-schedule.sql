-- 给已经建好的数据库加上「定时发布」用的一列。新建的数据库不用执行（schema.sql 里已经有了）；执行多次也没关系。
-- 要在重启新版后台之前执行，否则打开文章列表时会因为找不到这一列而出错：
--
--   sudo -u postgres psql -f upgrade-schedule.sql

\set ON_ERROR_STOP on
\connect blog

SET ROLE blog_owner;

ALTER TABLE blog.post ADD COLUMN IF NOT EXISTS publish_at timestamptz;

RESET ROLE;
