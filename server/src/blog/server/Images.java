package blog.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Year;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pictures uploaded in the editor (or found in an imported file), kept in /srv/blog/media/{year}/. Only real JPEG,
 * PNG, WebP, GIF or AVIF files are taken (decided by their first bytes, not their name or the browser's word), at most
 * 25 MB and 80 megapixels. Each one is decoded and saved again by scripts/clean-image.mjs (sharp): turned upright, and
 * everything but the pixels dropped (location, camera, thumbnails). The name comes from the cleaned picture's content,
 * so the same picture uploaded twice is kept once.
 */
final class Images {
  private Images() {}

  static final int MAX = 25 * 1024 * 1024;
  private static final Pattern RESULT = Pattern.compile("\\{\"format\":\"(jpg|png|webp|gif)\",\"width\":(\\d+),\"height\":(\\d+)(?:,\"taken\":\"(\\d{4}-\\d{2}-\\d{2})\")?\\}");
  static final Pattern MEDIA = Pattern.compile("\\d{4}/[0-9a-f]{16}\\.(?:jpg|png|webp|gif)");
  private static final Pattern IMAGES = Pattern.compile("[\\p{L}\\p{N}_./ -]{1,200}\\.(?i:jpe?g|png|webp|gif|avif)");

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
    return null;
  }

  /** Cleans the picture and keeps it in media/{year}/; returns its address on the site, width and height. */
  static Map<String, Object> accept(Site site, byte[] data) throws IOException {
    String kind = sniff(data);
    if ("heic".equals(kind)) throw new Http.Fail(415, "heic", "iPhone 的 HEIC 照片浏览器大多显示不了，请先导出成 JPG 再上传（在“照片”里分享 → 选项 → 最兼容）");
    if (kind == null) throw new Http.Fail(415, "not_image", "只能上传 JPG、PNG、WebP、GIF 或 AVIF 图片");
    if (data.length > MAX) throw new Http.Fail(413, "too_large", "图片太大了（最多 25 MB）");
    site.requireReady();
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
    return "image/jpeg";
  }
}
