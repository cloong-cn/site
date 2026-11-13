package blog.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;

/** Settings of the public comment service; see comments.example.properties. */
final class CommentsConfig {
  final String listenHost;
  final int listenPort;
  final Pg.Settings db;
  final int dbPool;
  final Set<String> origins;
  final String siteUrl;
  final Path siteRoot;
  final String ipSalt;
  final int maxPending;
  final int perIp10Min;
  final int perIpDay;
  final String notifyUrl;
  final String notifyTemplate;

  private CommentsConfig(Props p) {
    listenHost = p.str("listen.host", "127.0.0.1");
    listenPort = p.integer("listen.port", 8787);
    db = p.db("blog_web");
    dbPool = Math.max(1, Math.min(10, p.integer("db.pool", 4)));
    origins = p.origins();
    siteUrl = origins.isEmpty() ? "" : origins.iterator().next();
    siteRoot = Path.of(p.str("site.root", "/srv/blog/live"));
    if (!Files.isDirectory(siteRoot)) p.problems.add("site.root 不是一个目录：" + siteRoot);
    ipSalt = p.str("security.ipSalt", "");
    if (ipSalt.length() < 16) p.problems.add("security.ipSalt 太短或没有填写（至少 16 个字符的随机字符串，用 random-salt 生成）");
    maxPending = p.integer("limits.maxPending", 500);
    perIp10Min = p.integer("limits.perIpPer10Minutes", 5);
    perIpDay = p.integer("limits.perIpPerDay", 20);
    notifyUrl = p.str("notify.url", "");
    if (!notifyUrl.isEmpty() && !notifyUrl.startsWith("https://") && !notifyUrl.startsWith("http://")) p.problems.add("notify.url 应该以 https:// 开头");
    notifyTemplate = p.str("notify.template", "{\"title\":\"{{title}}\",\"text\":\"{{text}}\",\"url\":\"{{url}}\"}");
    p.done();
  }

  static CommentsConfig load(Path file) throws IOException {
    return new CommentsConfig(Props.load(file));
  }
}
