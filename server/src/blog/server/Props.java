package blog.server;

import java.io.IOException;
import java.io.Reader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;

/** A .properties file being read: every problem found is collected, so they can all be reported at once. */
final class Props {
  private final Properties p = new Properties();
  final List<String> problems = new ArrayList<>();

  static Props load(Path file) throws IOException {
    Props props = new Props();
    try (Reader r = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
      props.p.load(r);
    }
    return props;
  }

  String str(String key, String fallback) {
    return p.getProperty(key, fallback).trim();
  }

  int integer(String key, int fallback) {
    String v = p.getProperty(key);
    if (v == null || v.isBlank()) return fallback;
    try {
      return Integer.parseInt(v.trim());
    } catch (NumberFormatException e) {
      problems.add(key + " 应该是整数：" + v);
      return fallback;
    }
  }

  /** db.* — the password may also come from the environment variable BLOG_DB_PASSWORD. */
  Pg.Settings db(String defaultUser) {
    String password = System.getenv().getOrDefault("BLOG_DB_PASSWORD", p.getProperty("db.password", ""));
    if (password.isEmpty()) problems.add("db.password 没有填写");
    return new Pg.Settings(str("db.host", "127.0.0.1"), integer("db.port", 5432), str("db.name", "blog"), str("db.user", defaultUser), password);
  }

  /** site.origin: the site's own address(es), comma separated. Only requests from these pages are accepted. */
  Set<String> origins() {
    Set<String> origins = new LinkedHashSet<>();
    for (String o : p.getProperty("site.origin", "").split(",")) {
      String t = o.trim().replaceAll("/+$", "");
      if (t.isEmpty()) continue;
      try {
        URI u = URI.create(t);
        if (!("https".equals(u.getScheme()) || "http".equals(u.getScheme())) || u.getHost() == null || (u.getPath() != null && !u.getPath().isEmpty())) {
          problems.add("site.origin 的格式应该像 https://yourname.dev（不带路径）：" + t);
        } else origins.add(t);
      } catch (IllegalArgumentException e) {
        problems.add("site.origin 不是有效的网址：" + t);
      }
    }
    if (origins.isEmpty()) problems.add("site.origin 没有填写");
    return origins;
  }

  void done() {
    if (!problems.isEmpty()) throw new IllegalArgumentException("配置有问题：\n  - " + String.join("\n  - ", problems));
  }
}
