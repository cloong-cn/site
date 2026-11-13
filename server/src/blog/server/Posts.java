package blog.server;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * An article and the Markdown file it becomes: a block of settings between --- lines, then the text. The site's build
 * reads that format (scripts/build.mjs, frontmatter()); exports and imports use it too. Reading is forgiving, so
 * files from other tools (Hexo, Hugo, Jekyll, Obsidian, SiYuan …) come in with their title, date and tags.
 */
final class Posts {
  private Posts() {}

  /* the same names the comment service accepts, so every article can have comments */
  static final Pattern SLUG = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}_.-]{0,119}");
  static final Pattern IMAGE = Pattern.compile("/(?:images|media)/[\\p{L}\\p{N}_./ -]{1,200}\\.(?i:jpe?g|png|webp|gif|avif)");
  static final int MAX_BODY = 500_000;
  private static final Pattern YAML = Pattern.compile("\\A\\uFEFF?---[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n---[ \\t]*(?:\\r?\\n|\\z)");
  private static final Pattern TOML = Pattern.compile("\\A\\uFEFF?\\+\\+\\+[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\\+\\+\\+[ \\t]*(?:\\r?\\n|\\z)");
  private static final Pattern KEY = Pattern.compile("^([A-Za-z_][\\w-]*)\\s*[:=]\\s*(.*)$");

  /** One article's content (what the editor edits, what a version stores). */
  record Post(String slug, String title, String date, List<String> tags, String description, String cover, boolean comments,
              String body, List<String> extra) {
    Map<String, Object> view() {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("slug", slug);
      m.put("title", title);
      m.put("date", date);
      m.put("tags", tags);
      m.put("description", description);
      m.put("cover", cover);
      m.put("comments", comments);
      m.put("body", body);
      m.put("extra", extra);
      return m;
    }

    int words() { return Posts.words(body); }
  }

  static boolean slugOk(String slug) {
    return slug != null && SLUG.matcher(slug).matches() && !slug.contains("..");
  }

  static String checkSlug(String slug) {
    if (!slugOk(slug)) throw new Http.Fail(400, "slug", "文章网址只能用文字、数字和 - _ .，最长 120 个字");
    return slug;
  }

  /** A picture of the site: /images/… (in the code) or /media/… (uploaded), no way out of those folders. */
  static boolean image(String path) {
    return IMAGE.matcher(path).matches() && !path.contains("..") && !path.contains("//") && !path.contains("/./");
  }

  /** Characters a reader counts: Chinese characters one by one, other words as one each. */
  static int words(String body) {
    String t = body.replaceAll("```[\\s\\S]*?```", " ").replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", " ").replaceAll("\\]\\([^)]*\\)", "]");
    int n = 0;
    boolean inWord = false;
    for (int i = 0; i < t.length(); ) {
      int c = t.codePointAt(i);
      i += Character.charCount(c);
      if (Character.UnicodeScript.of(c) == Character.UnicodeScript.HAN) {
        n++;
        inWord = false;
      } else if (Character.isLetterOrDigit(c)) {
        if (!inWord) n++;
        inWord = true;
      } else inWord = false;
    }
    return n;
  }

  /* ================================================================ from the editor */

  /** Checks what the editor sent: every field, so mistakes come back at once with a message. */
  static Post fromEditor(Map<String, Object> in) {
    String slug = checkSlug(str(in.get("slug")).strip());
    String title = Text.line(str(in.get("title")), 120);
    if (title.isEmpty()) throw new Http.Fail(400, "title", "请填写标题");
    String date = str(in.get("date")).strip();
    try {
      LocalDate.parse(date);
    } catch (DateTimeParseException e) {
      throw new Http.Fail(400, "date", "日期格式应该是 2026-11-01");
    }
    List<String> tags = new ArrayList<>();
    if (in.get("tags") instanceof List<?> list) {
      for (Object t : list) {
        String tag = Text.line(str(t), 30);
        if (tag.isEmpty()) continue;
        if (tag.matches(".*[,\\[\\]\"'#].*")) throw new Http.Fail(400, "tags", "标签里不能有逗号、方括号、引号或 #：" + tag);
        if (!tags.contains(tag)) tags.add(tag);
      }
    }
    if (tags.size() > 10) throw new Http.Fail(400, "tags", "标签最多 10 个");
    String description = Text.line(str(in.get("description")), 300);
    String cover = Text.line(str(in.get("cover")), 210);
    if (!cover.isEmpty() && !image(cover)) throw new Http.Fail(400, "cover", "分享图要填 /media/ 或 /images/ 开头的图片地址");
    boolean comments = !Boolean.FALSE.equals(in.get("comments"));
    String body = str(in.get("body"));
    if (body.length() > MAX_BODY) throw new Http.Fail(400, "too_long", "正文太长了（最多 50 万字）");
    body = body.replace("\r\n", "\n").replace('\r', '\n').replace("\u0000", "");
    if (YAML.matcher(body).find()) throw new Http.Fail(400, "body", "正文不能以 --- 开头（那是文章设置的写法）");
    List<String> extra = new ArrayList<>();
    if (in.get("extra") instanceof List<?> l) for (Object o : l) if (o instanceof String s && extraOk(s)) extra.add(s);
    return new Post(slug, title, date, List.copyOf(tags), description, cover, comments, body, List.copyOf(extra));
  }

  /* an unknown setting kept from an imported file: one line "key: value" that cannot be mistaken for ours */
  private static boolean extraOk(String line) {
    Matcher m = KEY.matcher(line);
    return line.length() < 500 && !line.contains("\n") && !line.contains("\r") && m.matches() && line.contains(":")
        && !List.of("title", "date", "tags", "description", "cover", "draft", "comments", "aliases").contains(m.group(1));
  }

  /* ================================================================ to a file */

  /**
   * The Markdown file of an article. draft adds "draft: true" (exports of unpublished articles); aliases are earlier
   * addresses, which the build turns into redirects. Pictures are written as /media/… unless mediaPrefix replaces it.
   */
  static String toFile(Post p, boolean draft, List<String> aliases, String mediaPrefix) {
    StringBuilder out = new StringBuilder("---\n");
    out.append("title: ").append(quote(p.title())).append('\n');
    out.append("date: ").append(p.date()).append('\n');
    if (!p.tags().isEmpty()) out.append("tags: [").append(String.join(", ", p.tags())).append("]\n");
    if (!p.description().isEmpty()) out.append("description: ").append(quote(p.description())).append('\n');
    if (!p.cover().isEmpty()) out.append("cover: ").append(mediaPrefix == null ? p.cover() : p.cover().replaceFirst("^/media/", mediaPrefix)).append('\n');
    if (draft) out.append("draft: true\n");
    if (!p.comments()) out.append("comments: false\n");
    List<String> al = new ArrayList<>();
    for (String a : aliases) if (slugOk(a) && !a.equals(p.slug())) al.add(a);
    if (!al.isEmpty()) out.append("aliases: [").append(String.join(", ", al)).append("]\n");
    for (String line : p.extra()) if (extraOk(line)) out.append(line).append('\n');
    String body = p.body().strip();
    if (mediaPrefix != null) body = body.replace("](/media/", "](" + mediaPrefix).replace("src=\"/media/", "src=\"" + mediaPrefix);
    out.append("---\n\n").append(body).append('\n');
    return out.toString();
  }

  /** Values are written in double quotes, which the build strips; one line only, so nothing can break out. */
  private static String quote(String v) {
    return "\"" + v + "\"";
  }

  /* ================================================================ from a file (import) */

  /** What reading a file found: the article (slug may be empty), whether it says it is a draft, and remarks. */
  record Parsed(Post post, boolean draft, List<String> notes) {}

  /**
   * Reads a Markdown file from anywhere. name is its file name (the fallback for the address and the title);
   * today is used when it has no date.
   */
  static Parsed fromFile(String name, String src, String today) {
    List<String> notes = new ArrayList<>();
    String text = src.replace("\r\n", "\n").replace('\r', '\n').replace("\u0000", "");
    Map<String, Object> data = new LinkedHashMap<>();
    List<String> extra = new ArrayList<>();
    Matcher y = YAML.matcher(text), t = TOML.matcher(text);
    if (y.find()) {
      readYaml(y.group(1), data, extra);
      text = text.substring(y.end());
    } else if (t.find()) {
      readToml(t.group(1), data);
      text = text.substring(t.end());
    } else if (text.startsWith("\uFEFF")) text = text.substring(1);
    text = cleanSiyuan(text);

    String stem = name.replaceAll("^.*/", "").replaceAll("\\.(md|markdown|txt)$", "");
    String title = Text.line(first(data, "title"), 120);
    /* a file that starts with "# Title" (Obsidian, SiYuan, Typora): that is the title */
    Matcher h1 = Pattern.compile("\\A\\s*# +(.+?)\\s*#*\\s*(?:\\n|\\z)").matcher(text);
    if (h1.find() && (title.isEmpty() || Text.line(h1.group(1), 120).equals(title))) {
      if (title.isEmpty()) title = Text.line(h1.group(1).replaceAll("[*_`]", ""), 120);
      text = text.substring(h1.end());
    }
    if (title.isEmpty()) title = Text.line(stem, 120);
    if (title.isEmpty()) title = "未命名";

    String date = toDate(first(data, "date", "created", "publishDate", "pubDate", "published", "lastmod", "updated"));
    if (date == null) {
      date = today;
      notes.add("没有日期，用了今天");
    }
    List<String> tags = new ArrayList<>();
    for (String key : List.of("tags", "tag", "keywords", "categories", "category")) {
      for (String v : list(data.get(key))) {
        String tag = Text.line(v.replaceAll("^#|#$", "").replaceAll("[,\\[\\]\"'#]", " ").strip(), 30);
        if (!tag.isEmpty() && !tags.contains(tag) && tags.size() < 10) tags.add(tag);
      }
    }
    String description = Text.line(first(data, "description", "summary", "excerpt", "abstract", "subtitle"), 300);
    String cover = Text.line(first(data, "cover", "image", "banner", "thumbnail", "featured_image", "featuredImage", "og_image"), 210);
    boolean draft = "true".equals(first(data, "draft")) || "false".equals(first(data, "published")) || "draft".equalsIgnoreCase(first(data, "status"));
    boolean comments = !"false".equals(first(data, "comments", "comment"));
    String slug = first(data, "slug");
    if (slug.isEmpty()) {
      String link = first(data, "permalink", "url").replaceAll("/+$", "");
      if (!link.isEmpty()) slug = link.replaceAll("^.*/", "").replaceAll("\\.html?$", "");
    }
    if (!slugOk(slug)) slug = slugOk(stem) ? stem : slugify(stem.isEmpty() ? title : stem);
    if (text.length() > MAX_BODY) throw new Http.Fail(400, "too_long", name + "：正文太长了（最多 50 万字）");
    String body = text.strip();
    if (YAML.matcher(body).find()) body = "\u200b" + body; /* never mistaken for settings */
    return new Parsed(new Post(slug, title, date, List.copyOf(tags), description, cover, comments, body, List.copyOf(extra)), draft, notes);
  }

  /** An address made from a title: letters and digits of any language, the rest becomes "-". */
  static String slugify(String s) {
    String t = s.strip().toLowerCase().replaceAll("[^\\p{L}\\p{N}]+", "-").replaceAll("^-+|-+$", "");
    if (t.length() > 80) t = t.substring(0, 80).replaceAll("-+$", "");
    return t.isEmpty() ? "post" : t;
  }

  /** What SiYuan (and other block editors) leave in Markdown that means nothing on a web page. */
  static String cleanSiyuan(String text) {
    return text
        .replace("\u200b", "")
        .replaceAll("(?m)^\\s*\\{: [^}\\n]*\\}\\s*$\\n?", "")                                    /* block attributes */
        .replaceAll("(?m)\\s*\\{: [^}\\n]*\\}$", "")
        .replaceAll("(?m)^\\s*(?:\\{\\{\\{(?:row|col)|\\}\\}\\})\\s*$\\n?", "")                    /* super blocks */
        .replaceAll("(?m)^\\s*\\{\\{[^}\\n]*\\}\\}\\s*$\\n?", "")                                  /* embedded queries */
        .replaceAll("\\(\\(\\d{14}-[0-9a-z]{7}(?:\\s+[\"']([^\"'\\n]*)[\"'])?\\)\\)", "$1")        /* block references */
        .replaceAll("\\[([^\\]\\n]*)\\]\\(siyuan://[^)\\s]*\\)", "$1");                            /* links into the notebook */
  }

  private static String toDate(String v) {
    Matcher m = Pattern.compile("^(\\d{4})[-/.年]?(\\d{1,2})[-/.月]?(\\d{1,2})").matcher(v.strip());
    if (!m.find()) return null;
    try {
      return LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))).toString();
    } catch (RuntimeException e) {
      return null;
    }
  }

  private static String first(Map<String, Object> data, String... keys) {
    for (String k : keys) {
      Object v = data.get(k);
      if (v instanceof String s && !s.isBlank()) return s.strip();
      if (v instanceof List<?> l && !l.isEmpty() && l.get(0) instanceof String s && !s.isBlank() && !k.equals("tags")) return s.strip();
    }
    return "";
  }

  private static List<String> list(Object v) {
    List<String> out = new ArrayList<>();
    if (v instanceof List<?> l) {
      for (Object o : l) if (o instanceof String s) out.add(s);
    } else if (v instanceof String s && !s.isBlank()) {
      for (String part : s.split("[,，、]")) if (!part.isBlank()) out.add(part.strip());
    }
    return out;
  }

  private static final List<String> KNOWN = List.of("title", "date", "created", "publishDate", "pubDate", "published", "lastmod", "updated",
      "tags", "tag", "keywords", "categories", "category", "description", "summary", "excerpt", "abstract", "subtitle", "cover", "image",
      "banner", "thumbnail", "featured_image", "featuredImage", "og_image", "draft", "status", "comments", "comment", "slug", "permalink", "url", "aliases");

  /* a small part of YAML: key: value, key: [a, b], lists of "- item", and >/| blocks of indented lines */
  private static void readYaml(String block, Map<String, Object> data, List<String> extra) {
    String key = null;
    StringBuilder folded = null;
    for (String line : block.split("\n")) {
      if (folded != null) {
        if (line.isBlank() || Character.isWhitespace(line.charAt(0))) {
          folded.append(folded.length() > 0 ? " " : "").append(line.strip());
          data.put(key, folded.toString());
          continue;
        }
        folded = null;
      }
      if (line.isBlank() || line.strip().startsWith("#")) continue;
      Matcher item = Pattern.compile("^\\s*-\\s+(.*)$").matcher(line);
      if (item.matches() && key != null) {
        Object cur = data.get(key);
        List<String> l = cur instanceof List<?> c ? new ArrayList<>(c.stream().map(String::valueOf).toList()) : new ArrayList<>();
        l.add(unquote(item.group(1).strip()));
        data.put(key, l);
        continue;
      }
      Matcher kv = Pattern.compile("^([A-Za-z_][\\w-]*)\\s*:\\s*(.*)$").matcher(line);
      if (!kv.matches()) continue;
      key = kv.group(1);
      String v = kv.group(2).strip().replaceAll("\\s+#.*$", "");
      if (!KNOWN.contains(key)) {
        if (!v.isEmpty() && !v.equals("|") && !v.equals(">")) extra.add(line.strip());
        continue;
      }
      if (v.equals("|") || v.equals(">") || v.equals("|-") || v.equals(">-")) {
        folded = new StringBuilder();
        data.put(key, "");
      } else if (v.startsWith("[") && v.endsWith("]")) {
        List<String> l = new ArrayList<>();
        for (String s : v.substring(1, v.length() - 1).split(",")) if (!unquote(s.strip()).isEmpty()) l.add(unquote(s.strip()));
        data.put(key, l);
      } else data.put(key, v.isEmpty() ? new ArrayList<String>() : unquote(v));
    }
  }

  /* Hugo's TOML: key = "value", key = ["a", "b"], key = true */
  private static void readToml(String block, Map<String, Object> data) {
    for (String line : block.split("\n")) {
      Matcher kv = Pattern.compile("^([A-Za-z_][\\w-]*)\\s*=\\s*(.*)$").matcher(line.strip());
      if (!kv.matches()) continue;
      String v = kv.group(2).strip();
      if (v.startsWith("[") && v.endsWith("]")) {
        List<String> l = new ArrayList<>();
        for (String s : v.substring(1, v.length() - 1).split(",")) if (!unquote(s.strip()).isEmpty()) l.add(unquote(s.strip()));
        data.put(kv.group(1), l);
      } else data.put(kv.group(1), unquote(v));
    }
  }

  private static String unquote(String v) {
    Matcher q = Pattern.compile("^(['\"])(.*)\\1$").matcher(v);
    return q.matches() ? q.group(2).replace("''", q.group(1).equals("'") ? "'" : "''") : v;
  }

  private static String str(Object o) {
    return o instanceof String s ? s : o == null ? "" : String.valueOf(o);
  }

  /** Uploaded pictures a text uses: /media/2026/abcdef0123456789.jpg → 2026/abcdef0123456789.jpg */
  static List<String> mediaIn(String text) {
    List<String> out = new ArrayList<>();
    Matcher m = Pattern.compile("/media/(" + Images.MEDIA.pattern() + ")").matcher(text);
    while (m.find()) if (!out.contains(m.group(1))) out.add(m.group(1));
    return out;
  }
}
