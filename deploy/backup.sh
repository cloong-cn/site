#!/usr/bin/env bash
# 每天的备份：整个数据库（文章、历史版本、主页内容、评论、假后台记录）+ 上传的图片。
# 由 blog-backup.timer 每天凌晨以 root 运行。安装（只需一次，见 README「备份」）：
#   sudo install -m 755 deploy/backup.sh /usr/local/sbin/blog-backup
#   sudo cp deploy/blog-backup.service deploy/blog-backup.timer /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now blog-backup.timer
# 想立刻备份一次：sudo systemctl start blog-backup   看结果：journalctl -u blog-backup
#
# 结果在 /srv/blog/backups：
#   db/blog-<时间>.dump   pg_dump 的格式，恢复：sudo -u postgres pg_restore --clean --if-exists -d blog <文件>
#   media/                图片（上传后不会再变，所以只复制新增的）
# 保留最近 14 份，另外每个月留第一份、留 12 个月。后台「发布」页能下载最新的一份（数据库 + 图片打成一个 zip）。
#
# 服务器以外再存一份（可选）：装好 rclone 并配置一个远程（阿里云 OSS、腾讯云 COS、Cloudflare R2、Backblaze B2 ……，
# 建议再套一层 rclone 的 crypt 加密），然后在 /etc/blog/backup.conf 里写  RCLONE_REMOTE=名字:路径
#
# 这个脚本以 root 运行，所以用的是 /usr/local/sbin 里安装好的那一份，不是仓库里的：推送代码改不了它。
set -euo pipefail

[ -f /etc/blog/backup.conf ] && . /etc/blog/backup.conf

BASE="${BLOG_BASE:-/srv/blog}"
DEST="${BACKUP_DIR:-$BASE/backups}"
DB="${BACKUP_DB:-blog}"
PG_USER="${BACKUP_PG_USER:-postgres}"     # 有权限读整个库的系统用户（本机用 peer 登录）
GROUP="${BACKUP_GROUP:-blog}"             # 后台服务的用户组：能读备份（好让你在后台下载），不能改、不能删
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

umask 027
cd /
install -d -m 750 -g "$GROUP" "$DEST" "$DEST/db" "$DEST/media"

stamp="$(date +%Y%m%d-%H%M%S)"
tmp="$DEST/db/.blog-$stamp.dump"
trap 'rm -f "$tmp"' EXIT
# pg_dump 以数据库管理员身份运行，写到标准输出，由 root 存成文件
runuser -u "$PG_USER" -- pg_dump --format=custom --compress=6 --dbname="$DB" > "$tmp"
chgrp "$GROUP" "$tmp"
chmod 640 "$tmp"
mv "$tmp" "$DEST/db/blog-$stamp.dump"
trap - EXIT
echo "数据库：db/blog-$stamp.dump（$(du -h "$DEST/db/blog-$stamp.dump" | cut -f1)）"

# 图片：只复制新的（文件名来自内容，同名就是同一张）
if [ -d "$BASE/media" ]; then
  new=0
  while IFS= read -r -d '' f; do
    rel="${f#"$BASE/media/"}"
    if [ ! -e "$DEST/media/$rel" ]; then
      install -D -m 640 -g "$GROUP" "$f" "$DEST/media/$rel"
      new=$((new + 1))
    fi
  done < <(find "$BASE/media" -mindepth 2 -maxdepth 2 -type f -path "$BASE/media/[0-9][0-9][0-9][0-9]/*" -print0)
  find "$DEST/media" -mindepth 1 -type d -exec chmod 750 {} + -exec chgrp "$GROUP" {} +
  echo "图片：新增 $new 张，一共 $(find "$DEST/media" -type f | wc -l) 张"
fi

# 只留最近 KEEP_DAILY 份，加上最近 KEEP_MONTHLY 个月里每个月的第一份
cd "$DEST/db"
mapfile -t all < <(ls -1 blog-*.dump 2>/dev/null | sort -r)
keep="$(printf '%s\n' "${all[@]}" | head -n "$KEEP_DAILY"; printf '%s\n' "${all[@]}" | sort | awk '{ m = substr($0, 6, 6); if (!(m in seen)) { seen[m] = 1; print } }' | sort -r | head -n "$KEEP_MONTHLY")"
for f in "${all[@]}"; do
  grep -qxF "$f" <<<"$keep" || { rm -f -- "$f"; echo "删除旧备份 $f"; }
done

# 服务器以外的一份
if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null; then
    rclone copy --quiet "$DEST/db/blog-$stamp.dump" "$RCLONE_REMOTE/db/"
    rclone copy --quiet --ignore-existing "$DEST/media" "$RCLONE_REMOTE/media/"
    touch "$DEST/offsite.ok"
    chgrp "$GROUP" "$DEST/offsite.ok"
    echo "已上传到 $RCLONE_REMOTE"
  else
    echo "设置了 RCLONE_REMOTE，但没有安装 rclone" >&2
    exit 1
  fi
fi
