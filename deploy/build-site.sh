#!/usr/bin/env bash
# 构建网站并上线。git push（deploy/post-receive）和后台发布都用它：
#
#   deploy/build-site.sh "这次发布的说明" [新内容目录]
#
# 用 $BASE/src 里的代码，$BASE/content 里的已发布内容（文章、主页，由后台从数据库写出来）和 $BASE/media 里上传的
# 图片，构建到 $BASE/builds/<时间>-<代码版本>。成功了才一步把 $BASE/live 切过去（网站一直在线）；给了新内容目录时，
# 也是成功了才用它换掉 $BASE/content。构建失败什么都不变。最近 5 个版本留着，后台「发布」里可以切回去。
#
# 调用的人先拿到 $BASE/.deploy.lock（flock），同一时间只有一个构建。
set -euo pipefail

BASE="${BLOG_BASE:-/srv/blog}"
SRC="$BASE/src"
BUILDS="$BASE/builds"
KEEP="${BLOG_KEEP_BUILDS:-5}"
label="${1:-发布}"
next="${2:-}"

content="$BASE/content"
[ -n "$next" ] && content="$next"
mkdir -p "$BUILDS" "$BASE/media" "$content/blog"

code="$(cat "$SRC/.deploy-commit" 2>/dev/null || true)"
code="${code:0:7}"
[ -n "$code" ] || code="local"
stamp="$(date +%Y%m%d-%H%M%S)-$code"
while [ -e "$BUILDS/$stamp" ]; do sleep 1; stamp="$(date +%Y%m%d-%H%M%S)-$code"; done

cd "$SRC"
if ! CONTENT_DIR="$content" MEDIA_DIR="$BASE/media" OUT_DIR="$BUILDS/$stamp" node scripts/build.mjs; then
  rm -rf "${BUILDS:?}/$stamp"
  echo "构建失败，网站还是之前的样子。" >&2
  exit 1
fi
printf '%s\n' "$label" | head -c 300 > "$BUILDS/$stamp.label"

if [ -n "$next" ]; then
  rm -rf "$BASE/content.old"
  if [ -d "$BASE/content" ]; then mv "$BASE/content" "$BASE/content.old"; fi
  mv "$next" "$BASE/content"
  rm -rf "$BASE/content.old"
fi

# 先建好新的链接，再用 rename 一步替换：访客不会遇到"换到一半"的状态
ln -sfn "$BUILDS/$stamp" "$BASE/.live.new"
mv -T "$BASE/.live.new" "$BASE/live"
echo "已上线：builds/$stamp"

# 旧版本只留最近几个
ls -1d "$BUILDS"/*/ 2>/dev/null | sort | head -n -"$KEEP" | while read -r d; do rm -rf "$d" "${d%/}.label"; done
