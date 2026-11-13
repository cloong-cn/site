package blog.server;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * The nightly backups in /srv/blog/backups, made by deploy/backup.sh (it runs as root from a systemd timer; this
 * service can only read them): db/blog-{time}.dump (pg_dump of the whole database: articles, versions, home page,
 * comments) and media/ (every uploaded picture). The admin page lists them and downloads the newest as one zip, which
 * is the copy to keep somewhere else than the server.
 */
final class Backups {
  private Backups() {}

  static final Pattern DUMP = Pattern.compile("blog-\\d{8}-\\d{6}\\.dump");

  static Map<String, Object> status(Site site) throws IOException {
    Map<String, Object> m = new LinkedHashMap<>();
    List<Map<String, Object>> dumps = new ArrayList<>();
    Path db = site.backups.resolve("db");
    if (Files.isDirectory(db)) {
      try (Stream<Path> s = Files.list(db)) {
        for (Path f : s.filter(p -> DUMP.matcher(p.getFileName().toString()).matches()).sorted(Comparator.reverseOrder()).toList()) {
          dumps.add(Map.of("name", f.getFileName().toString(), "size", Files.size(f), "at", Files.getLastModifiedTime(f).toMillis()));
        }
      }
    }
    m.put("enabled", Files.isDirectory(db));
    m.put("dumps", dumps);
    long[] media = count(site.media);
    m.put("mediaFiles", media[0]);
    m.put("mediaBytes", media[1]);
    m.put("offsite", modified(site.backups.resolve("offsite.ok")));
    m.put("downloaded", modified(site.base.resolve(".backup-downloaded")));
    return m;
  }

  private static Long modified(Path f) throws IOException {
    return Files.isRegularFile(f) ? Files.getLastModifiedTime(f).toMillis() : null;
  }

  private static long[] count(Path dir) throws IOException {
    long[] n = {0, 0};
    if (!Files.isDirectory(dir)) return n;
    try (Stream<Path> s = Files.walk(dir, 2)) {
      for (Path f : s.filter(Files::isRegularFile).toList()) {
        if (!Images.MEDIA.matcher(dir.relativize(f).toString().replace('\\', '/')).matches()) continue;
        n[0]++;
        n[1] += Files.size(f);
      }
    }
    return n;
  }

  /** The newest backup of the database and every uploaded picture, as one zip; remembers that it was downloaded. */
  static void download(OutputStream to, Site site, String name) throws IOException {
    Path dump = site.backups.resolve("db").resolve(name);
    String stamp = name.substring(5, 20);
    try (ZipOutputStream zip = new ZipOutputStream(to, StandardCharsets.UTF_8)) {
      zip.setLevel(1); /* the dump and the pictures are compressed already */
      String folder = "blog-backup-" + stamp;
      zip.putNextEntry(new ZipEntry(folder + "/" + name));
      Files.copy(dump, zip);
      zip.closeEntry();
      if (Files.isDirectory(site.media)) {
        try (Stream<Path> s = Files.walk(site.media, 2)) {
          for (Path f : s.filter(Files::isRegularFile).sorted().toList()) {
            String rel = site.media.relativize(f).toString().replace('\\', '/');
            if (!Images.MEDIA.matcher(rel).matches()) continue;
            zip.putNextEntry(new ZipEntry(folder + "/media/" + rel));
            Files.copy(f, zip);
            zip.closeEntry();
          }
        }
      }
      zip.putNextEntry(new ZipEntry(folder + "/恢复方法.txt"));
      zip.write(("""
          博客的完整备份（%s）

          %s   整个数据库：文章、历史版本、主页内容、评论（pg_dump 的格式）
          media/   文章里上传的图片

          恢复到服务器（新服务器先按 README「第一次部署」装好，并执行过 schema.sql）：

            sudo -u postgres pg_restore --clean --if-exists -d blog %s
            sudo cp -a media/. /srv/blog/media/ && sudo chown -R blog:blog /srv/blog/media
            然后在后台「发布」里点「重新发布全部」

          只想看文章内容：后台的「文章」→「导出」得到的是普通 Markdown 文件，不需要数据库。
          """).formatted(stamp, name, name).getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
    }
    Path mark = site.base.resolve(".backup-downloaded");
    Files.writeString(mark, String.valueOf(System.currentTimeMillis()));
  }
}
