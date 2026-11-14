package blog.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Year;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Semaphore;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pictures uploaded in the editor (or found in an imported file), kept in /srv/blog/media/{year}/. Only real JPEG,
 * PNG, WebP, GIF or AVIF files are taken (decided by their first bytes, not their name or the browser's word), at most
 * 25 MB and 80 megapixels. Each one is decoded and saved again by scripts/clean-image.mjs (sharp): turned upright, and
 * everything but the pixels dropped (location, camera, thumbnails). The name comes from the cleaned picture's content,
 * so the same picture uploaded twice is kept once. SVG pictures (diagrams) are taken too: they are not decoded but
 * read and written again with only what draws (Svg.java), and articles show them as they are, never as photos.
 */
final class Images {
  private Images() {}

  static final int MAX = 25 * 1024 * 1024;
  private static final Pattern RESULT = Pattern.compile("\\{\"format\":\"(jpg|png|webp|gif)\",\"width\":(\\d+),\"height\":(\\d+)(?:,\"taken\":\"(\\d{4}-\\d{2}-\\d{2})\")?\\}");
  static final Pattern MEDIA = Pattern.compile("\\d{4}/[0-9a-f]{16}\\.(?:jpg|png|webp|gif|svg)");
  /** An uploaded photo: what an album may hold (an SVG may not). */
  static final Pattern PHOTO = Pattern.compile("\\d{4}/[0-9a-f]{16}\\.(?:jpg|png|webp|gif)");
  private static final Pattern IMAGES = Pattern.compile("[\\p{L}\\p{N}_./ -]{1,200}\\.(?i:jpe?g|png|webp|gif|avif|svg)");

  /** The kind of picture, from its first bytes; null when it is not one we take. */
  static String sniff(byte[] b) {
    if (b.length < 16) return null;
    if ((b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xD8 && (b[2] & 0xff) == 0xFF) return "jpeg";
    if ((b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "png";
    if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8' && (b[4] == '7' || b[4] == '9') && b[5] == 'a') return "gif";
    if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "webp";
    if (b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') {
      String brand = new String(b, 8, 4, java.nio.charset.StandardCharsets.US_ASCII);
      if (brand.equals("avif") || brand.equals("avis")) return "avif";
      if (brand.startsWith("hei") || brand.startsWith("mif") || brand.equals("msf1")) return "heic";
    }
    if (Svg.looksLike(b)) return "svg";
    return null;
  }

  /** Cleans the picture and keeps it in media/{year}/; returns its address on the site, width and height. */
  static Map<String, Object> accept(Site site, byte[] data) throws IOException {
    String kind = sniff(data);
    if ("heic".equals(kind)) throw new Http.Fail(415, "heic", "iPhone 的 HEIC 照片浏览器大多显示不了，请先导出成 JPG 再上传（在“照片”里分享 → 选项 → 最兼容）");
    if (kind == null) throw new Http.Fail(415, "not_image", "只能上传 JPG、PNG、WebP、GIF、AVIF 或 SVG 图片");
    if (data.length > MAX) throw new Http.Fail(413, "too_large", "图片太大了（最多 25 MB）");
    site.requireReady();
    if ("svg".equals(kind)) return acceptSvg(site, data);
    Path script = site.src.resolve("scripts/clean-image.mjs");

    Path tmp = site.media.resolve(".tmp");
    Files.createDirectories(tmp);
    String name = Guard.randomToken(12).replaceAll("[^A-Za-z0-9]", "x");
    Path in = tmp.resolve(name + ".in");
    Path outBase = tmp.resolve(name);
    try {
      Files.write(in, data);
      Site.Result r = Site.run(site.src, null, 120, List.of("node", script.toString(), in.toString(), outBase.toString()));
      Matcher m = RESULT.matcher(r.text().strip());
      if (r.code() != 0 || !m.matches()) {
        String why = r.text().contains("\"error\"") ? r.text().replaceAll(".*\"error\":\"([^\"]*)\".*", "$1").strip() : r.err().strip();
        Log.warn("picture refused: %s", why.length() > 300 ? why.substring(0, 300) : why);
        throw new Http.Fail(415, "bad_image", why.startsWith("图片") ? why : "这张图片打不开或者太大了（最多 8000 万像素）");
      }
      String ext = m.group(1);
      Path cleaned = Path.of(outBase + "." + ext);
      String id = HexFormat.of().formatHex(Guard.sha256(Files.readAllBytes(cleaned)), 0, 8);
      String rel = Year.now().getValue() + "/" + id + "." + ext;
      Path to = site.media.resolve(rel);
      Files.createDirectories(to.getParent());
      if (Files.exists(to)) Files.delete(cleaned); /* the same picture is already here */
      else Files.move(cleaned, to, StandardCopyOption.ATOMIC_MOVE);
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("path", "/media/" + rel);
      out.put("width", Integer.parseInt(m.group(2)));
      out.put("height", Integer.parseInt(m.group(3)));
      if (m.group(4) != null) out.put("taken", m.group(4)); /* the day it was taken, read before that was dropped: for the albums' timelines */
      return out;
    } finally {
      Files.deleteIfExists(in);
      for (String e : List.of("jpg", "png", "webp", "gif")) Files.deleteIfExists(Path.of(outBase + "." + e));
    }
  }

  /* an SVG: cleaned (Svg.java), and named after the cleaned file like the others */
  private static Map<String, Object> acceptSvg(Site site, byte[] data) throws IOException {
    Svg.Clean c = Svg.clean(data);
    String id = HexFormat.of().formatHex(Guard.sha256(c.data()), 0, 8);
    String rel = Year.now().getValue() + "/" + id + ".svg";
    Path to = site.media.resolve(rel);
    Files.createDirectories(to.getParent());
    if (!Files.exists(to)) { /* else the same picture is already here */
      Path tmp = site.media.resolve(".tmp");
      Files.createDirectories(tmp);
      Path part = tmp.resolve(Guard.randomToken(12).replaceAll("[^A-Za-z0-9]", "x") + ".svg");
      Files.write(part, c.data());
      Files.move(part, to, StandardCopyOption.ATOMIC_MOVE);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("path", "/media/" + rel);
    out.put("width", c.width());
    out.put("height", c.height());
    return out;
  }

  /**
   * A picture the editor's preview asks for: media/… (uploaded) or images/… (in the site's code). Null when there is
   * no such file, or the name tries to leave its folder.
   */
  static byte[] file(Site site, String rel) throws IOException {
    Path f = null;
    if (rel.startsWith("media/") && MEDIA.matcher(rel.substring(6)).matches()) f = site.media.resolve(rel.substring(6));
    else if (rel.startsWith("images/") && IMAGES.matcher(rel.substring(7)).matches() && !rel.contains("..") && !rel.contains("//")) {
      Path dir = site.src.resolve("src/public/images");
      Path c = dir.resolve(rel.substring(7)).normalize();
      if (c.startsWith(dir)) f = c;
    }
    if (f == null || !Files.isRegularFile(f) || Files.isSymbolicLink(f)) return null;
    return Files.readAllBytes(f);
  }

  /* ================================================================ the picture library */

  /**
   * Every upload, newest first: its address, size and date, where it is shown now (Store.mediaUsers), and whether only
   * older versions still have it. One that nothing has at all is cleared out a week after it came (sweep).
   */
  static List<Map<String, Object>> library(Site site, Store store) throws IOException {
    List<Map<String, Object>> out = new ArrayList<>();
    if (!Files.isDirectory(site.media)) return out;
    Map<String, List<String>> users = store.mediaUsers();
    Set<String> anywhere = new HashSet<>();
    for (String t : store.allTexts()) anywhere.addAll(Posts.mediaIn(t));
    List<Path> files;
    try (var s = Files.walk(site.media, 2)) {
      files = s.filter(Files::isRegularFile).toList();
    }
    for (Path f : files) {
      String rel = site.media.relativize(f).toString().replace('\\', '/');
      if (!MEDIA.matcher(rel).matches()) continue;
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("path", "/media/" + rel);
      m.put("size", Files.size(f));
      m.put("at", Files.getLastModifiedTime(f).toMillis());
      List<String> u = users.getOrDefault(rel, List.of());
      m.put("usedBy", u);
      m.put("history", u.isEmpty() && anywhere.contains(rel));
      out.add(m);
    }
    out.sort((a, b) -> Long.compare((Long) b.get("at"), (Long) a.get("at")));
    return out;
  }

  record File(byte[] data, String type) {}

  /* at most two thumbnails made at a time: each one is a node process */
  private static final Semaphore THUMBS = new Semaphore(2);

  private static Path thumbOf(Site site, String rel) { return site.thumbs.resolve(rel.replaceAll("\\.\\w+$", ".webp")); }

  /**
   * A small copy of an upload for the library: 360 pixels wide, WebP, made once by scripts/thumb.mjs and kept in
   * thumbs/. SVG and GIF are sent as they are; when the copy cannot be made, the picture itself. Null: no such upload.
   */
  static File thumb(Site site, String rel) throws IOException {
    if (!MEDIA.matcher(rel).matches()) return null;
    Path src = site.media.resolve(rel);
    if (!Files.isRegularFile(src) || Files.isSymbolicLink(src)) return null;
    if (rel.endsWith(".svg") || rel.endsWith(".gif")) return new File(Files.readAllBytes(src), type(rel));
    Path out = thumbOf(site, rel);
    if (!Files.isRegularFile(out) && site.ready()) {
      boolean got = false;
      try {
        got = THUMBS.tryAcquire(30, java.util.concurrent.TimeUnit.SECONDS);
        if (got && !Files.isRegularFile(out)) {
          Files.createDirectories(out.getParent());
          Site.Result r = Site.run(site.src, null, 60, List.of("node", site.src.resolve("scripts/thumb.mjs").toString(), src.toString(), out.toString()));
          if (r.code() != 0) Log.warn("thumbnail of %s not made: %s", rel, r.err().strip());
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      } finally {
        if (got) THUMBS.release();
      }
    }
    return Files.isRegularFile(out) ? new File(Files.readAllBytes(out), "image/webp") : new File(Files.readAllBytes(src), type(rel));
  }

  /** Deletes an upload that nothing has any more: no article, version, album or home page (else 409). */
  static void delete(Site site, Store store, String rel) throws IOException {
    if (!MEDIA.matcher(rel).matches()) throw new Http.Fail(400, "path", "图片地址不对");
    for (String t : store.allTexts()) {
      if (Posts.mediaIn(t).contains(rel)) throw new Http.Fail(409, "in_use", "这张图片还有地方在用（文章、历史版本、图集或主页），不能删除");
    }
    if (!Files.deleteIfExists(site.media.resolve(rel))) throw new Http.Fail(404, "not_found", "没有这张图片");
    Files.deleteIfExists(thumbOf(site, rel));
  }

  /** Uploads no article, version or home page uses, after a week (a picture added and then removed again). */
  static int sweep(Site site, Store store) {
    if (!Files.isDirectory(site.media)) return 0;
    Set<String> used = new HashSet<>();
    for (String t : store.allTexts()) used.addAll(Posts.mediaIn(t));
    long cutoff = System.currentTimeMillis() - 7L * 24 * 3600 * 1000;
    int[] removed = {0};
    try (var files = Files.walk(site.media, 2)) {
      files.filter(Files::isRegularFile).forEach(f -> {
        String rel = site.media.relativize(f).toString().replace('\\', '/');
        try {
          boolean stale = Files.getLastModifiedTime(f).toMillis() < cutoff;
          if (stale && (rel.startsWith(".tmp/") || (MEDIA.matcher(rel).matches() && !used.contains(rel)))) {
            Files.delete(f);
            Files.deleteIfExists(thumbOf(site, rel)); /* its small copy too */
            removed[0]++;
          }
        } catch (IOException ignored) {
          /* try again next time */
        }
      });
    } catch (IOException ignored) {
      /* nothing to sweep */
    }
    return removed[0];
  }

  static String type(String path) {
    String p = path.toLowerCase();
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".webp")) return "image/webp";
    if (p.endsWith(".gif")) return "image/gif";
    if (p.endsWith(".avif")) return "image/avif";
    if (p.endsWith(".svg")) return "image/svg+xml";
    return "image/jpeg";
  }
}
