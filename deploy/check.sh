#!/usr/bin/env bash
# 上线前（以及以后每次改了服务器配置后）的自检：在服务器上运行
#   sudo bash /srv/blog/src/deploy/check.sh
# 只读检查，不改任何东西。检查后台和数据库是不是只能通过 Nginx / Caddy 到达、配置文件别人能不能读、
# 秘密地址配好没有、各个地址的回应对不对、备份有没有在跑。✗ 是必须修的，! 是要你确认一下的。
set -u

CONF="${BLOG_CONF_DIR:-/etc/blog}"
BASE="${BLOG_BASE:-/srv/blog}"
ok=0; bad=0; warn=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; ok=$((ok + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; bad=$((bad + 1)); }
note() { printf '  \033[33m!\033[0m %s\n' "$*"; warn=$((warn + 1)); }
prop() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$2" 2>/dev/null | tail -n 1 | tr -d '\r'; }

echo "== 端口：后台、评论服务和数据库只能在本机访问"
if command -v ss >/dev/null; then
  public="$(ss -Hltn | awk '{print $4}' | grep -vE '^(127\.[0-9.]+|\[::1\]|::1|\[::ffff:127\.[0-9.]+\]):[0-9]+$' | sort -u)"
  for p in 8787 8788 5432; do
    if grep -qE ":$p\$" <<<"$public"; then fail "端口 $p 对外开着（应该只监听 127.0.0.1）"; else pass "端口 $p 没有对外"; fi
  done
  others="$(sed -E 's/.*:([0-9]+)$/\1/' <<<"$public" | sort -nu | grep -vxE '22|80|443|8787|8788|5432' | tr '\n' ' ')"
  [ -n "${others// /}" ] && note "这些端口也对外开着，确认都是需要的：$others" || pass "对外只有 SSH、80、443"
else
  note "没有 ss 命令，跳过端口检查"
fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then pass "防火墙 ufw 已开启"
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then pass "防火墙 firewalld 已开启"
else note "没检测到开启的防火墙（ufw / firewalld）。云服务器的话，确认安全组只放行 22、80、443"; fi

echo "== 配置文件"
A="$CONF/admin.properties"; C="$CONF/comments.properties"
for f in "$A" "$C"; do
  if [ ! -f "$f" ]; then fail "找不到 $f"; continue; fi
  mode="$(stat -c %a "$f")"; owner="$(stat -c %U "$f")"
  if [ "${mode: -1}" != "0" ]; then fail "$f 所有人都能读（现在是 $mode，应该是 640）"; else pass "$f 别人读不到（$mode，属于 $owner:$(stat -c %G "$f")）"; fi
done
path="$(prop admin.path "$A")"; origin="$(prop site.origin "$A" | cut -d, -f1)"
if [[ "$path" =~ ^/[A-Za-z0-9_-]{16,80}$ ]]; then pass "admin.path 已设置"; else fail "admin.path 没有设置或格式不对（用 random-path 生成）"; fi
if [ "$(prop admin.cookieSecure "$A")" = "false" ]; then fail "admin.cookieSecure=false：登录凭证会走明文，上线时删掉这一行"; fi
listen_a="$(prop listen.host "$A")"; listen_c="$(prop listen.host "$C")"
[ -z "$listen_a$listen_c" ] || [[ "${listen_a:-127.0.0.1}${listen_c:-127.0.0.1}" =~ ^(127\.0\.0\.1|localhost|::1)+$ ]] && pass "两个服务都只监听本机" || fail "listen.host 不是 127.0.0.1"

echo "== Web 服务器配置"
webconf=""
if command -v nginx >/dev/null; then webconf="$(nginx -T 2>/dev/null)"; fi
if [ -z "$webconf" ] && [ -f /etc/caddy/Caddyfile ]; then webconf="$(cat /etc/caddy/Caddyfile)"; fi
if [ -z "$webconf" ]; then note "读不到 Nginx / Caddy 的配置，跳过"
else
  grep -q "ADMIN_PATH" <<<"$webconf" && fail "配置里还有没替换的 ADMIN_PATH" || pass "ADMIN_PATH 都替换了"
  [ -n "$path" ] && { grep -qF "${path#/}" <<<"$webconf" && pass "配置里的后台地址和 admin.path 一致" || fail "配置里找不到 admin.path 的那一串"; }
  grep -qE 'location \^~ /api/admin|handle /api/admin' <<<"$webconf" && fail "还留着旧的 /api/admin 转发，删掉" || true
fi

echo "== 数据库"
if command -v psql >/dev/null && id postgres >/dev/null 2>&1; then
  la="$(cd / && runuser -u postgres -- psql -Atc 'SHOW listen_addresses' 2>/dev/null)"
  case "$la" in
    localhost|127.0.0.1|"127.0.0.1, ::1"|"localhost, 127.0.0.1") pass "PostgreSQL 只监听本机（$la）" ;;
    "") note "连不上 PostgreSQL（或者不在这台机器上）" ;;
    *) note "PostgreSQL 监听 $la：确认 pg_hba.conf 里按 README 加了三行，并且防火墙没放行 5432" ;;
  esac
  [ -n "$la" ] && { [ "$(cd / && runuser -u postgres -- psql -Atc "SELECT count(*) FROM pg_roles WHERE rolname IN ('blog_web','blog_admin') AND rolpassword IS NOT NULL" 2>/dev/null)" = 2 ] \
    && pass "blog_web、blog_admin 都设置了密码" || note "blog_web / blog_admin 还没设置密码（或没执行 schema.sql）"; }
else
  note "这台机器上没有 psql，跳过数据库检查"
fi

echo "== 从网站访问（经过本机的 Nginx / Caddy）"
if [ -n "$origin" ] && command -v curl >/dev/null; then
  host="${origin#https://}"; host="${host#http://}"; port="${host##*:}"; [ "$port" = "$host" ] && port=443; host="${host%%:*}"
  R=(-s -m 10 -k --noproxy "*" --resolve "$host:$port:127.0.0.1")
  code() { curl "${R[@]}" -o /dev/null -w '%{http_code}' "$origin$1"; }
  home="$(curl "${R[@]}" -D - "$origin/")"
  grep -qi '^strict-transport-security' <<<"$home" && pass "HTTPS 和 HSTS" || fail "首页没有 HSTS 头（是不是还没换成完整的 HTTPS 配置）"
  grep -q 'http-equiv="Content-Security-Policy"' <<<"$home" && pass "页面带内容安全策略（CSP）" || fail "首页没有 CSP"
  [ "$(code /_admin/)" = 404 ] && pass "/_admin/ 不公开" || fail "/_admin/ 能直接打开"
  [ "$(code /_trap/)" = 404 ] && pass "/_trap/ 不公开" || fail "/_trap/ 能直接打开"
  [ "$(code /api/admin/me)" = 404 ] && pass "旧地址 /api/admin 不存在" || fail "/api/admin 还有回应"
  curl "${R[@]}" "$origin/admin/" | grep -q '管理后台' && pass "/admin/ 是假登录页" || note "/admin/ 不是假登录页（评论服务没运行，或者配置没加那一段）"
  if [ -n "$path" ]; then
    curl "${R[@]}" "$origin$path/" | grep -q 'data-admin' && pass "后台在秘密地址能打开" || fail "秘密地址打不开后台页面"
    [ "$(code "$path/api/me")" = 401 ] && pass "后台接口要先登录" || fail "后台接口 $path/api/me 的回应不是 401"
  fi
  [ "$(code /api/comments/health)" = 200 ] && pass "评论服务正常" || note "评论服务没回应"
else
  note "没有 site.origin 或 curl，跳过"
fi

echo "== 服务和备份"
if command -v systemctl >/dev/null && systemctl list-units >/dev/null 2>&1; then
  for s in blog-comments blog-admin; do systemctl is-active --quiet "$s" && pass "$s 在运行" || fail "$s 没有运行"; done
  systemctl is-enabled --quiet blog-backup.timer 2>/dev/null && pass "每天的备份已开启" || note "还没开启备份（README「备份」）"
  for s in blog-comments blog-admin; do
    u="$(systemctl show -p User --value "$s" 2>/dev/null)"
    [ -n "$u" ] && [ "$u" != root ] && pass "$s 以 $u 运行（不是 root）" || fail "$s 以 root 运行"
  done
else
  note "没有 systemd，跳过服务检查"
fi
latest="$(ls -1t "$BASE/backups/db/"blog-*.dump 2>/dev/null | head -n 1)"
if [ -n "$latest" ]; then
  age=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
  [ "$age" -le 48 ] && pass "最近的备份是 $age 小时前" || fail "最近的备份已经是 $age 小时前了"
fi

echo
echo "最后，在你自己的电脑上（不是服务器）运行下面两条，都应该连不上（超时或被拒绝）："
echo "  curl -m 5 http://服务器IP:8788/        # 后台服务"
echo "  nc -vz -w 5 服务器IP 5432                # 数据库"
echo
printf '%d 项通过，%d 项要修，%d 项要确认\n' "$ok" "$bad" "$warn"
[ "$bad" -eq 0 ]
