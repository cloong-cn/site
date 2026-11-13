package blog.server;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Albums, in the table album (see schema.sql): each one a row, with what it says as one JSON document. The page saves an
 * album whole. A draft stays here; one that is not a draft goes on the site with the next build, through albums.json
 * in the folder the build reads (scripts/gallery.mjs). The photos themselves are uploads, cleaned and kept in media/ like
 * any other picture.
 */
final class Albums {
  static final int MAX_BODY = 4 * 1024 * 1024;
  private static final int MAX_PHOTOS = 2000;
  private static final int MAX_DAYS = 1000;
  /* the same names scripts/gallery.mjs takes */
  private static final Pattern SLUG = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}_-]{0,79}");
  private static final Pattern PHOTO = Pattern.compile("/media/(" + Images.PHOTO.pattern() + ")");
  private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
  private static final Pattern MONTH = Pattern.compile("\\d{4}-\\d{2}");
  private static final String MS = "(extract(epoch FROM %s) * 1000)::bigint";

  private final Pg.Pool db;

  Albums(Pg.Pool db) { this.db = db; }

  /* ================================================================ what may be saved */

  static String slug(Object o) {
    String s = o instanceof String t ? t.strip() : "";
    if (!SLUG.matcher(s).matches()) throw bad("图集网址只能用文字、数字、- 和 _，最长 80 个字");
    return s;
  }

  /** The album as it will be kept: only known settings, sensible lengths, photos that are uploads, dates that exist. */
  static Map<String, Object> check(Object input) {
    Map<String, Object> in = obj(input, "", Set.of("title", "description", "timeline", "cover", "days", "photos"));
    Map<String, Object> out = new LinkedHashMap<>();
    String title = Text.line(str(in, "title"), 80);
    if (title.isEmpty()) throw bad("图集要有个名字");
    out.put("title", title);
    out.put("description", Text.block(str(in, "description"), 600));
    String timeline = str(in, "timeline");
    if (!timeline.isEmpty() && !timeline.equals("day") && !timeline.equals("month")) throw bad("时间轴只能按天或按月");
    out.put("timeline", timeline.equals("month") ? "month" : "day");

    List<Object> photos = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    List<Object> given = list(in.get("photos"), "photos", MAX_PHOTOS);
    for (Object o : given) {
      Map<String, Object> p = obj(o, "photos", Set.of("path", "note", "alt", "date", "hidden"));
      String path = str(p, "path");
      if (!PHOTO.matcher(path).matches()) throw bad("这张照片的地址不对：" + Text.line(path, 300));
      if (!seen.add(path)) continue; /* the same picture twice counts once */
      String date = str(p, "date");
      if (!date.isEmpty()) checkDay(date);
      Map<String, Object> q = new LinkedHashMap<>();
      q.put("path", path);
      q.put("note", Text.line(str(p, "note"), 500));
      q.put("alt", Text.line(str(p, "alt"), 300));
      q.put("date", date);
      q.put("hidden", Boolean.TRUE.equals(p.get("hidden")));
      photos.add(q);
    }
    String cover = str(in, "cover");
    if (!cover.isEmpty() && !seen.contains(cover)) cover = ""; /* its photo was taken out */
    out.put("cover", cover);

    Map<String, Object> days = new LinkedHashMap<>();
    Map<String, Object> givenDays = obj(in.get("days"), "days", null);
    if (givenDays.size() > MAX_DAYS) throw bad("写给日期的话太多了");
    for (Map.Entry<String, Object> e : givenDays.entrySet()) {
      String key = e.getKey();
      if (MONTH.matcher(key).matches()) checkDay(key + "-01");
      else checkDay(key);
      String text = e.getValue() instanceof String t ? Text.line(t, 300) : "";
      if (!text.isEmpty()) days.put(key, text);
    }
    out.put("days", days);
    out.put("photos", photos);
    return out;
  }

  private static void checkDay(String s) {
    if (!DAY.matcher(s).matches()) throw bad("日期要写成 2026-03-14：" + Text.line(s, 40));
    try {
      LocalDate.parse(s);
    } catch (DateTimeException e) {
      throw bad("没有这一天：" + s);
    }
  }

  /** The path of every photo in a checked album, for finding out whether they are all there. */
  @SuppressWarnings("unchecked")
  static List<String> paths(Map<String, Object> data) {
    List<String> out = new ArrayList<>();
    for (Object o : (List<Object>) data.get("photos")) out.add(((String) ((Map<String, Object>) o).get("path")).substring("/media/".length()));
    return out;
  }

  /* ================================================================ the table */

  /** Every album, the latest changed first, without its photos. */
  List<Map<String, Object>> list() {
    Pg.Rows r = db.with(c -> c.query("SELECT id, slug, draft, version, data->>'title' AS title, jsonb_array_length(data->'photos') AS photos,"
        + " coalesce(nullif(data->>'cover', ''), data->'photos'->0->>'path') AS cover, " + MS.formatted("updated_at") + " AS updated"
        + " FROM album ORDER BY updated_at DESC, id DESC"));
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, String> row : r.maps()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", Long.parseLong(row.get("id")));
      m.put("slug", row.get("slug"));
      m.put("draft", "t".equals(row.get("draft")));
      m.put("version", Long.parseLong(row.get("version")));
      m.put("title", row.get("title"));
      m.put("photos", Long.parseLong(row.get("photos")));
      m.put("cover", row.get("cover"));
      m.put("updated", Long.parseLong(row.get("updated")));
      out.add(m);
    }
    return out;
  }

  Map<String, Object> get(long id) {
    Pg.Rows r = db.with(c -> c.query("SELECT id, slug, draft, version, data::text AS data FROM album WHERE id = $1", id));
    if (r.size() == 0) throw new Http.Fail(404, "not_found", "没有这个图集");
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("slug", r.get(0, "slug"));
    m.put("draft", "t".equals(r.get(0, "draft")));
    m.put("version", Long.parseLong(r.get(0, "version")));
    m.put("data", Json.parseLarge(r.get(0, "data")));
    return m;
  }

  /** wasLive: the site showed it before this save, so the site has to change even if it is a draft now. */
  record Saved(long id, long version, boolean wasLive) {}

  Saved save(long id, long version, String slug, boolean draft, Map<String, Object> data) {
    String json = Json.write(data);
    return db.tx(c -> {
      if (c.query("SELECT id FROM album WHERE slug = $1 AND id <> $2", slug, id).size() > 0) throw new Http.Fail(409, "slug", "已经有一个图集用了这个网址");
      if (id == 0) {
        Pg.Rows r = c.query("INSERT INTO album (slug, data, draft) VALUES ($1, $2::jsonb, $3) RETURNING id", slug, json, draft);
        return new Saved(Long.parseLong(r.get(0, "id")), 1, false);
      }
      Pg.Rows cur = c.query("SELECT version, draft FROM album WHERE id = $1 FOR UPDATE", id);
      if (cur.size() == 0) throw new Http.Fail(404, "not_found", "这个图集已经被删除了");
      if (Long.parseLong(cur.get(0, "version")) != version) throw new Http.Fail(409, "changed", "这个图集在别的窗口或设备上保存过了，刷新后再改");
      c.query("UPDATE album SET slug = $1, data = $2::jsonb, draft = $3, version = version + 1, updated_at = now() WHERE id = $4", slug, json, draft, id);
      return new Saved(id, version + 1, "f".equals(cur.get(0, "draft")));
    });
  }

  /** Deletes the album (its photos stay in media/ until the weekly sweep finds nothing uses them); true if the site showed it. */
  boolean delete(long id) {
    return db.with(c -> {
      Pg.Rows r = c.query("DELETE FROM album WHERE id = $1 RETURNING draft", id);
      if (r.size() == 0) throw new Http.Fail(404, "not_found", "这个图集已经被删除了");
      return "f".equals(r.get(0, "draft"));
    });
  }

  /** What goes on the site: every album that is not a draft, as scripts/gallery.mjs reads them from albums.json. */
  @SuppressWarnings("unchecked")
  List<Map<String, Object>> published() {
    Pg.Rows r = db.with(c -> c.query("SELECT slug, data::text AS data FROM album WHERE NOT draft ORDER BY id"));
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, String> row : r.maps()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("slug", row.get("slug"));
      m.putAll((Map<String, Object>) Json.parseLarge(row.get("data")));
      out.add(m);
    }
    return out;
  }

  /* ================================================================ helpers */

  private static Http.Fail bad(String message) {
    return new Http.Fail(400, "album", message);
  }

  /** allowed null: any key (they are checked by the caller). */
  @SuppressWarnings("unchecked")
  private static Map<String, Object> obj(Object o, String where, Set<String> allowed) {
    if (o == null) return Map.of();
    if (!(o instanceof Map)) throw bad("格式不对：" + where);
    Map<String, Object> m = (Map<String, Object>) o;
    if (allowed != null) for (String k : m.keySet()) if (!allowed.contains(k)) throw bad("不认识的设置：" + (where.isEmpty() ? k : where + "." + k));
    return m;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object o, String where, int max) {
    if (o == null) return List.of();
    if (!(o instanceof List)) throw bad("格式不对：" + where);
    List<Object> l = (List<Object>) o;
    if (l.size() > max) throw bad("一个图集最多 " + max + " 张照片");
    return l;
  }

  private static String str(Map<String, Object> m, String key) {
    Object v = m.get(key);
    if (v != null && !(v instanceof String)) throw bad("格式不对：" + key);
    return v == null ? "" : (String) v;
  }
}
