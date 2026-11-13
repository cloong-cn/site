package blog.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** Settings of the admin service; see admin.example.properties. */
final class AdminConfig {
  /* a secret address: letters, digits, - and _, long enough that nobody guesses it */
  static final Pattern PATH = Pattern.compile("/[A-Za-z0-9_-]{16,80}");
  /* addresses the site itself uses: the secret one must not start like them */
  private static final List<String> TAKEN = List.of("/blog", "/assets", "/media", "/images", "/videos", "/api", "/admin", "/internal", "/trap", "/_", "/rss", "/sitemap", "/robots");

  final String listenHost;
  final int listenPort;
  final Pg.Settings db;
  final int dbPool;
  final Set<String> origins;
  final String siteUrl;
  final String ownerName;
  final String adminHash;
  final String totpSecret;
  final boolean cookieSecure;
  /** the secret address of the admin page, e.g. /harbor-k3Vq9xTf2LmZ8wRb (page at path + "/", API under path + "/api/") */
  final String path;
  /** /srv/blog: src (the code), content (what is published), media (pictures), builds, live, backups */
  final Path base;
  final String commentsUrl;

  private AdminConfig(Props p) {
    listenHost = p.str("listen.host", "127.0.0.1");
    listenPort = p.integer("listen.port", 8788);
    db = p.db("blog_admin");
    dbPool = Math.max(1, Math.min(4, p.integer("db.pool", 3)));
    origins = p.origins();
    siteUrl = origins.isEmpty() ? "" : origins.iterator().next();
    ownerName = p.str("owner.name", "作者");
    if (ownerName.isEmpty() || ownerName.length() > 40) p.problems.add("owner.name 要填，最多 40 个字");
    adminHash = p.str("admin.passwordHash", "");
    if (!adminHash.startsWith("pbkdf2-sha256$")) p.problems.add("admin.passwordHash 没有填写（用 hash-password 生成）");
    totpSecret = p.str("admin.totpSecret", "").replace(" ", "").toUpperCase();
    if (Totp.decode(totpSecret) == null || totpSecret.length() < 26) p.problems.add("admin.totpSecret 没有填写或格式不对（用 totp-setup 生成）");
    cookieSecure = !"false".equalsIgnoreCase(p.str("admin.cookieSecure", "true"));
    path = p.str("admin.path", "").replaceAll("/+$", "");
    if (!PATH.matcher(path).matches()) {
      p.problems.add("admin.path 要以 / 开头，后面 16 到 80 个字母、数字、- 或 _（用 random-path 生成）：" + path);
    } else if (TAKEN.stream().anyMatch(t -> path.toLowerCase().startsWith(t))) {
      p.problems.add("admin.path 不能以 " + String.join("、", TAKEN) + " 开头（网站自己要用）");
    }
    base = Path.of(p.str("blog.base", "/srv/blog"));
    if (!Files.isDirectory(base)) p.problems.add("找不到网站目录：" + base);
    commentsUrl = p.str("comments.url", "http://127.0.0.1:8787");
    p.done();
  }

  static AdminConfig load(Path file) throws IOException {
    return new AdminConfig(Props.load(file));
  }
}
