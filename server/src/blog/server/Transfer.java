package blog.server;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Articles in and out as ordinary files.
 *
 * Export: a zip with posts/{slug}.md (the same format as content/blog in the code), the pictures they use in media/,
 * and site.json. Links to pictures are relative (../media/…), so the files open with their pictures in Typora,
 * Obsidian or VS Code, and nothing in them depends on this program.
 *
 * Import: a .md file, or a zip of them with their pictures — this site's export, SiYuan's "export as Markdown",
 * Obsidian, Hexo, Hugo … Pictures next to the files are found by their relative links (or by their name), cleaned like
 * an upload and given a place in media/. Everything comes in as a draft (or, for an article that exists, as changes
 * not yet published): nothing reaches the site before you have looked at it.
 */
final class Transfer {
  private Transfer() {}

  static final long MAX_UPLOAD = 300L * 1024 * 1024;
  private static final int MAX_ENTRIES = 5000;
  private static final int MAX_TEXT = 2 * 1024 * 1024;
  private static final long MAX_TOTAL = 1024L * 1024 * 1024;
  private static final Pattern MD_IMAGE = Pattern.compile("(!\\[[^\\]\\n]*\\]\\(\\s*)(<[^>\\n]+>|[^)\\s]+)((?:\\s+\"[^\"\\n]*\")?\\s*\\))");
  private static final Pattern HTML_IMAGE = Pattern.compile("(<img\\b[^>]*?\\ssrc=\")([^\"]+)(\")", Pattern.CASE_INSENSITIVE);
  private static final Pattern PICTURE = Pattern.compile("(?i).*\\.(jpe?g|png|gif|webp|avif|heic)$");

  /* ================================================================ export */

  /** Writes the zip. ids: the articles to export, or null for all of them (and the home page). */
  static void export(OutputStream to, Store store, Site site, List<Long> ids, String folder) throws IOException {
    ZipOutputStream zip = new ZipOutputStream(to, StandardCharsets.UTF_8);
    zip.setLevel(6);
    Set<String> pictures = new LinkedHashSet<>();
    int n = 0;
    for (Map<String, Object> row : store.list(false)) {
      long id = (Long) row.get("id");
      if (ids != null && !ids.contains(id)) continue;
      Store.Current cur = store.current(id);
      boolean draft = "draft".equals(row.get("state"));
      String md = relative(Posts.toFile(cur.post(), draft, cur.aliases(), null));
      put(zip, folder + "/posts/" + cur.post().slug() + ".md", md.getBytes(StandardCharsets.UTF_8));
      pictures.addAll(pictures(cur.post().body() + "\n" + cur.post().cover()));
      n++;
    }
    if (ids == null) {
      Map<String, Object> s = store.site();
      if (s != null) {
        String json = Json.pretty(s.get("data"));
        put(zip, folder + "/site.json", json.getBytes(StandardCharsets.UTF_8));
        pictures.addAll(pictures(json));
      }
    }
    for (String rel : pictures) {
      byte[] data = Images.file(site, rel);
      if (data != null) put(zip, folder + "/" + rel, data);
    }
    put(zip, folder + "/说明.txt", ("""
        这里是从博客后台导出的 %d 篇文章。

        posts/      每篇文章一个 Markdown 文件：开头 --- 之间是标题、日期、标签等设置，下面是正文
        media/      文章里用到的图片（上传时已经去掉了拍摄地点等信息）
        images/     网站代码里自带的图片（如果文章用到了）
        site.json   主页上的文字（只有导出全部时才有）

        图片用的是相对路径（../media/…），用 Typora、Obsidian、VS Code 打开都能看到图片。
        把整个 zip 拖进后台的「导入」，就能原样导回去（已经有的文章会作为新的修改，原来的内容留在历史版本里）。
        draft: true 的是还没发布的草稿。
        """).formatted(n).getBytes(StandardCharsets.UTF_8));
    zip.finish();
    zip.flush();
  }

  private static void put(ZipOutputStream zip, String name, byte[] data) throws IOException {
    ZipEntry e = new ZipEntry(name);
    zip.putNextEntry(e);
    zip.write(data);
    zip.closeEntry();
  }

  /* /media/… and /images/… in an exported file become ../media/… (files sit in posts/) */
  private static String relative(String md) {
    return md.replaceAll("(\\]\\(\\s*<?|src=\")/(media|images)/", "$1../$2/").replaceAll("(?m)^cover: /(media|images)/", "cover: ../$1/");
  }

  /** media/2026/….jpg and images/….jpg a text points at */
  private static List<String> pictures(String text) {
    List<String> out = new ArrayList<>();
    for (String m : Posts.mediaIn(text)) out.add("media/" + m);
    Matcher m = Pattern.compile("/(images/[\\p{L}\\p{N}_./ -]{1,200}\\.(?i:jpe?g|png|webp|gif|avif))").matcher(text);
    while (m.find()) if (!m.group(1).contains("..") && !out.contains(m.group(1))) out.add(m.group(1));
    return out;
  }

  /* ================================================================ import */

  /** What to do with a file whose address an article already has. */
  enum Mode { OVERWRITE, SKIP, COPY }

  /** Reads an uploaded .md or .zip (saved at file) and adds what is in it; the report goes into the job's result. */
  static void importFile(Jobs.Job job, Store store, Site site, Path file, String name, Mode mode, boolean withSite) throws IOException {
    List<Map<String, Object>> report = new ArrayList<>();
    job.result.put("report", report);
    byte[] head = new byte[4];
    try (InputStream in = Files.newInputStream(file)) {
      in.readNBytes(head, 0, 4);
    }
    Importer im = new Importer(job, store, site, mode, report);
    if (head[0] == 'P' && head[1] == 'K' && head[2] == 3 && head[3] == 4) {
      im.zip(file, withSite);
    } else {
      if (Files.size(file) > MAX_TEXT) throw new Http.Fail(413, "too_large", "这个文件太大了，不像是一篇文章");
      String text = decode(Files.readAllBytes(file));
      if (text == null) throw new Http.Fail(415, "not_text", "这个文件不是文本（只能导入 .md 文件或者 .zip）");
      im.article(name, text, null);
    }
    long added = report.stream().filter(r -> !"跳过".equals(r.get("result")) && !"失败".equals(r.get("result"))).count();
    job.say("完成：导入 " + added + " 篇" + (im.pictures > 0 ? "，" + im.pictures + " 张图片" : ""));
    job.result.put("added", added);
  }

  /** Text as UTF-8, or as GB18030 (files saved by Chinese Windows), or null when it is neither. */
  static String decode(byte[] raw) {
    for (Charset cs : List.of(StandardCharsets.UTF_8, Charset.forName("GB18030"))) {
      try {
        String s = cs.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();
        if (s.indexOf('\u0000') >= 0) return null;
        return s.startsWith("\uFEFF") ? s.substring(1) : s;
      } catch (CharacterCodingException e) {
        /* try the next one */
      }
    }
    return null;
  }

  private static final class Importer {
    final Jobs.Job job;
    final Store store;
    final Site site;
    final Mode mode;
    final List<Map<String, Object>> report;
    final String today = LocalDate.now().toString();
    ZipFile zip;
    final Map<String, ZipEntry> entries = new LinkedHashMap<>();
    final Map<String, List<String>> byName = new HashMap<>();
    final Map<String, String> done = new HashMap<>(); /* zip entry → its address on the site */
    long read;
    int pictures;

    Importer(Jobs.Job job, Store store, Site site, Mode mode, List<Map<String, Object>> report) {
      this.job = job;
      this.store = store;
      this.site = site;
      this.mode = mode;
      this.report = report;
    }

    void zip(Path file, boolean withSite) throws IOException {
      zip = open(file);
      try {
        Enumeration<? extends ZipEntry> en = zip.entries();
        while (en.hasMoreElements()) {
          ZipEntry e = en.nextElement();
          if (entries.size() >= MAX_ENTRIES) throw new Http.Fail(413, "too_many", "压缩包里的文件太多了（最多 " + MAX_ENTRIES + " 个）");
          String n = e.getName().replace('\\', '/');
          if (e.isDirectory() || n.startsWith("__MACOSX/") || n.contains("/.") || n.startsWith(".")) continue;
          entries.put(n, e);
          byName.computeIfAbsent(n.replaceAll("^.*/", "").toLowerCase(), k -> new ArrayList<>()).add(n);
        }
        List<String> articles = entries.keySet().stream().filter(n -> n.toLowerCase().matches(".*\\.(md|markdown)$")).sorted().toList();
        if (articles.isEmpty() && !(withSite && site(true))) throw new Http.Fail(400, "no_articles", "压缩包里没有 .md 文件");
        if (articles.size() > 1000) throw new Http.Fail(413, "too_many", "一次最多导入 1000 篇");
        job.say("压缩包里有 " + articles.size() + " 篇文章");
        for (String a : articles) {
          byte[] raw = bytes(entries.get(a), MAX_TEXT);
          String text = raw == null ? null : decode(raw);
          if (text == null) {
            row(a, null, null, "失败", List.of("读不出来（不是文本或者太大）"));
            continue;
          }
          article(a, text, a.contains("/") ? a.substring(0, a.lastIndexOf('/') + 1) : "");
        }
        if (withSite) site(false);
      } finally {
        zip.close();
      }
    }

    /* names are checked as the directory is read: not UTF-8 means the zip was made on Chinese Windows */
    private static ZipFile open(Path file) throws IOException {
      try {
        return new ZipFile(file.toFile(), StandardCharsets.UTF_8);
      } catch (ZipException | IllegalArgumentException e) {
        try {
          return new ZipFile(file.toFile(), Charset.forName("GB18030"));
        } catch (ZipException e2) {
          throw new Http.Fail(400, "bad_zip", "压缩包打不开（不是 zip，或者已经损坏）");
        }
      }
    }

    /* the home page's words from site.json, when asked for; check only tells whether there is one */
    boolean site(boolean check) throws IOException {
      String found = entries.keySet().stream().filter(n -> n.equals("site.json") || n.endsWith("/site.json")).sorted((a, b) -> a.length() - b.length()).findFirst().orElse(null);
      if (check || found == null) return found != null;
      byte[] raw = bytes(entries.get(found), 256 * 1024);
      try {
        Object data = Json.parse(raw == null ? "" : decode(raw));
        Map<String, Object> s = store.site();
        store.saveSite(SiteData.check(data), s == null ? 0 : (Long) s.get("id"));
        job.say("主页内容已导入（还没有发布：在「主页」里点保存并发布）");
        job.result.put("site", true);
      } catch (Json.Bad | Http.Fail e) {
        job.say("site.json 没有导入：" + e.getMessage());
      }
      return true;
    }

    /** One Markdown file: read, bring in its pictures, save. dir: its folder inside the zip (null for a single file). */
    void article(String name, String text, String dir) {
      List<String> notes = new ArrayList<>();
      Posts.Parsed parsed;
      try {
        parsed = Posts.fromFile(name, text, today);
      } catch (Http.Fail f) {
        row(name, null, null, "失败", List.of(f.getMessage()));
        return;
      }
      notes.addAll(parsed.notes());
      Posts.Post p = parsed.post();
      String body = rewrite(MD_IMAGE, p.body(), dir, notes);
      body = rewrite(HTML_IMAGE, body, dir, notes);
      String cover = p.cover().isEmpty() ? "" : picture(p.cover(), dir, notes);
      if (cover == null || !Posts.image(cover)) {
        if (!p.cover().isEmpty()) notes.add("分享图 " + p.cover() + " 没有用上");
        cover = "";
      }
      Posts.Post post = new Posts.Post(p.slug(), p.title(), p.date(), p.tags(), p.description(), cover, p.comments(), body, p.extra());
      try {
        Map<String, Object> existing = store.findBySlug(post.slug());
        String result;
        long id;
        if (existing == null) {
          id = store.save(0, 0, post, false, "import").id();
          result = "新建";
        } else if (mode == Mode.SKIP) {
          row(name, post.title(), post.slug(), "跳过", List.of("已经有一篇 /blog/" + post.slug() + "/"));
          return;
        } else if (mode == Mode.OVERWRITE) {
          id = (Long) existing.get("id");
          store.save(id, ((Long) existing.get("version")).intValue(), post, true, "import");
          result = "覆盖";
          notes.add("原来的内容在这篇文章的历史版本里");
        } else {
          String slug = free(post.slug());
          post = new Posts.Post(slug, post.title(), post.date(), post.tags(), post.description(), post.cover(), post.comments(), post.body(), post.extra());
          id = store.save(0, 0, post, false, "import").id();
          result = "另存";
          notes.add("网址改成了 " + slug);
        }
        Map<String, Object> r = row(name, post.title(), post.slug(), result, notes);
        r.put("id", id);
        job.say(result + "：" + post.title() + (notes.isEmpty() ? "" : "（" + String.join("；", notes) + "）"));
      } catch (Http.Fail f) {
        row(name, post.title(), post.slug(), "失败", List.of(f.getMessage()));
      }
    }

    private String free(String slug) {
      for (int i = 2; i < 1000; i++) {
        String s = (slug.length() > 110 ? slug.substring(0, 110) : slug) + "-" + i;
        if (store.findBySlug(s) == null) return s;
      }
      throw new Http.Fail(409, "slug_taken", "找不到空着的网址");
    }

    private Map<String, Object> row(String file, String title, String slug, String result, List<String> notes) {
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("file", file);
      r.put("title", title);
      r.put("slug", slug);
      r.put("result", result);
      r.put("notes", List.copyOf(notes));
      report.add(r);
      if ("失败".equals(result)) job.say("没有导入 " + file + "：" + String.join("；", notes));
      return r;
    }

    private String rewrite(Pattern p, String text, String dir, List<String> notes) {
      Matcher m = p.matcher(text);
      StringBuilder out = new StringBuilder();
      while (m.find()) {
        String url = m.group(2);
        if (url.startsWith("<") && url.endsWith(">")) url = url.substring(1, url.length() - 1);
        String to = picture(url, dir, notes);
        m.appendReplacement(out, Matcher.quoteReplacement(m.group(1) + (to == null ? m.group(2) : to) + m.group(3)));
      }
      m.appendTail(out);
      return out.toString();
    }

    /** Where a picture of the file ends up on the site; null when it stays as written (and a note says why). */
    private String picture(String url, String dir, List<String> notes) {
      String u = url.strip();
      if (u.matches("(?i)^https?://.*")) {
        if (!notes.contains("有外部图片（链接到别的网站），建议下载后重新上传")) notes.add("有外部图片（链接到别的网站），建议下载后重新上传");
        return null;
      }
      if (u.startsWith("data:")) return dataUri(u, notes);
      if (u.startsWith("/media/") && Images.MEDIA.matcher(u.substring(7)).matches() && Files.isRegularFile(site.media.resolve(u.substring(7)))) return u;
      if (u.startsWith("/images/") && Posts.image(u)) return u;
      String path = u;
      try {
        path = URLDecoder.decode(u.replace("+", "%2B"), StandardCharsets.UTF_8);
      } catch (IllegalArgumentException ignored) {
        /* keep as written */
      }
      path = path.replaceAll("[?#].*$", "");
      if (!PICTURE.matcher(path).matches()) return null;
      String entry = find(path, dir);
      if (entry == null) {
        notes.add("找不到图片 " + u);
        return null;
      }
      if (done.containsKey(entry)) return done.get(entry);
      byte[] data = bytes(entries.get(entry), Images.MAX);
      if (data == null) {
        notes.add("图片太大或读不出来：" + entry);
        return null;
      }
      /* a picture this site exported, already here unchanged: keep its address */
      Matcher own = Pattern.compile("(?:^|/)media/(\\d{4}/[0-9a-f]{16}\\.(?:jpg|png|webp|gif))$").matcher(entry);
      try {
        if (own.find()) {
          Path f = site.media.resolve(own.group(1));
          if (Files.isRegularFile(f) && java.util.Arrays.equals(Files.readAllBytes(f), data)) {
            done.put(entry, "/media/" + own.group(1));
            return done.get(entry);
          }
        }
        String to = (String) Images.accept(site, data).get("path");
        pictures++;
        done.put(entry, to);
        return to;
      } catch (Http.Fail f) {
        notes.add(entry.replaceAll("^.*/", "") + "：" + f.getMessage());
        return null;
      } catch (IOException e) {
        notes.add("图片没有保存成功：" + entry);
        return null;
      }
    }

    private String dataUri(String u, List<String> notes) {
      Matcher m = Pattern.compile("^data:image/[a-z+.-]+;base64,([A-Za-z0-9+/=\\s]+)$").matcher(u);
      if (!m.matches() || m.group(1).length() > Images.MAX * 4 / 3 + 16) return null;
      try {
        String to = (String) Images.accept(site, Base64.getMimeDecoder().decode(m.group(1))).get("path");
        pictures++;
        return to;
      } catch (Http.Fail | IllegalArgumentException | IOException e) {
        notes.add("有一张嵌在文件里的图片没能保存");
        return null;
      }
    }

    /* a relative link resolved against the file's folder, else the only picture of that name */
    private String find(String path, String dir) {
      if (zip == null) return null;
      String p = path.replaceAll("^\\./", "");
      if (dir != null && !p.startsWith("/")) {
        List<String> parts = new ArrayList<>();
        for (String s : (dir + p).split("/")) {
          if (s.isEmpty() || s.equals(".")) continue;
          if (s.equals("..")) {
            if (!parts.isEmpty()) parts.remove(parts.size() - 1);
          } else parts.add(s);
        }
        String joined = String.join("/", parts);
        if (entries.containsKey(joined)) return joined;
      }
      for (String key : entries.keySet()) if (key.endsWith("/" + p.replaceAll("^/+", "")) || key.equals(p.replaceAll("^/+", ""))) return key;
      List<String> same = byName.get(p.replaceAll("^.*/", "").toLowerCase());
      return same != null && same.size() == 1 ? same.get(0) : null;
    }

    /* an entry's content, read with a cap (a zip can claim any size) */
    private byte[] bytes(ZipEntry e, int max) {
      try (InputStream in = zip.getInputStream(e)) {
        byte[] b = in.readNBytes(max + 1);
        read += b.length;
        if (read > MAX_TOTAL) throw new Http.Fail(413, "too_large", "压缩包解开后太大了");
        return b.length > max ? null : b;
      } catch (IOException ex) {
        return null;
      }
    }
  }
}
