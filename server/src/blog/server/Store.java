package blog.server;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Articles, their versions and the home page's words, in PostgreSQL (tables post, post_revision, site_revision; see
 * schema.sql). The editor saves the working copy as often as it likes; a published article additionally points at the
 * version the site shows (published_revision), so writing on never changes the site until you publish again.
 */
final class Store {
  /** Saves in a row within this time make one version in the history, not one each. */
  static final String COALESCE = "10 minutes";

  private final Pg.Pool db;

  Store(Pg.Pool db) { this.db = db; }

  private static final String MS = "(extract(epoch FROM %s) * 1000)::bigint";
  /** The columns of an article's content, from the table (or alias) t. */
  private static String fields(String t) {
    return String.join(", ", t + ".slug", t + ".title", t + ".date::text AS date", t + ".tags::text AS tags", t + ".description", t + ".cover",
        t + ".comments", t + ".body", t + ".extra::text AS extra");
  }

  static Posts.Post post(Map<String, String> r) {
    return new Posts.Post(r.get("slug"), r.get("title"), r.get("date"), strings(r.get("tags")), r.get("description"), r.get("cover"),
        "t".equals(r.get("comments")), r.get("body"), strings(r.get("extra")));
  }

  static List<String> strings(String json) {
    List<String> out = new ArrayList<>();
    if (json == null) return out;
    try {
      if (Json.parse(json) instanceof List<?> l) for (Object o : l) if (o instanceof String s) out.add(s);
    } catch (Json.Bad ignored) {
      /* not a list */
    }
    return out;
  }

  private static long num(String s) { return s == null ? 0 : Long.parseLong(s); }

  private static Long numOrNull(String s) { return s == null ? null : Long.parseLong(s); }

  /* ================================================================ the list */

  /** All articles (not those in the trash), or only the trash. Newest date first. */
  List<Map<String, Object>> list(boolean trash) {
    Pg.Rows r = db.with(c -> c.query(
        "SELECT p.id, p.slug, p.title, p.date::text AS date, p.tags::text AS tags, p.words, p.version, p.published_revision,"
            + " " + MS.formatted("p.updated_at") + " AS updated, " + MS.formatted("p.deleted_at") + " AS deleted,"
            + " (pr.id IS NOT NULL AND (pr.slug, pr.title, pr.date, pr.tags, pr.description, pr.cover, pr.comments, pr.body)"
            + "   IS DISTINCT FROM (p.slug, p.title, p.date, p.tags, p.description, p.cover, p.comments, p.body)) AS changed"
            + " FROM post p LEFT JOIN post_revision pr ON pr.id = p.published_revision"
            + " WHERE (p.deleted_at IS NOT NULL) = $1 ORDER BY p.date DESC, p.id DESC", trash));
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, String> row : r.maps()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", num(row.get("id")));
      m.put("slug", row.get("slug"));
      m.put("title", row.get("title"));
      m.put("date", row.get("date"));
      m.put("tags", strings(row.get("tags")));
      m.put("words", num(row.get("words")));
      m.put("state", state(row.get("published_revision"), row.get("changed")));
      m.put("updated", num(row.get("updated")));
      if (row.get("deleted") != null) m.put("deleted", num(row.get("deleted")));
      out.add(m);
    }
    return out;
  }

  /** draft: never published (or taken down); published: the site shows what is saved; changed: saved changes not on the site yet */
  private static String state(String publishedRevision, String changed) {
    return publishedRevision == null ? "draft" : "t".equals(changed) ? "changed" : "published";
  }

  /* ================================================================ one article */

  Map<String, Object> get(long id) {
    return db.with(c -> {
      Pg.Rows r = c.query("SELECT p.id, p.version, p.published_revision, p.aliases::text AS aliases, " + fields("p")
          + ", " + MS.formatted("p.updated_at") + " AS updated, " + MS.formatted("p.deleted_at") + " AS deleted, " + MS.formatted("p.first_published_at") + " AS first_published,"
          + " pr.slug AS live_slug, (pr.id IS NOT NULL AND (pr.slug, pr.title, pr.date, pr.tags, pr.description, pr.cover, pr.comments, pr.body)"
          + "   IS DISTINCT FROM (p.slug, p.title, p.date, p.tags, p.description, p.cover, p.comments, p.body)) AS changed"
          + " FROM post p LEFT JOIN post_revision pr ON pr.id = p.published_revision WHERE p.id = $1", id);
      if (r.size() == 0) throw new Http.Fail(404, "not_found", "没有这篇文章");
      Map<String, String> row = r.maps().get(0);
      Map<String, Object> m = new LinkedHashMap<>(post(row).view());
      m.put("id", id);
      m.put("version", num(row.get("version")));
      m.put("state", state(row.get("published_revision"), row.get("changed")));
      m.put("liveSlug", row.get("live_slug"));
      m.put("aliases", strings(row.get("aliases")));
      m.put("updated", num(row.get("updated")));
      m.put("firstPublished", numOrNull(row.get("first_published")));
      if (row.get("deleted") != null) m.put("deleted", num(row.get("deleted")));
      return m;
    });
  }

  /** The article (not in the trash) at this address: {id, version}, or null. */
  Map<String, Object> findBySlug(String slug) {
    Pg.Rows r = db.with(c -> c.query("SELECT id, version FROM post WHERE slug = $1 AND deleted_at IS NULL", slug));
    return r.size() == 0 ? null : Map.of("id", num(r.get(0, "id")), "version", num(r.get(0, "version")));
  }

  /** The working copy as it is now, with its version. */
  record Current(long id, int version, Posts.Post post, Long publishedRevision, String liveSlug, List<String> aliases, boolean deleted) {}

  Current current(Pg.Conn c, long id, boolean lock) {
    Pg.Rows r = c.query("SELECT p.id, p.version, p.published_revision, p.aliases::text AS aliases, p.deleted_at IS NOT NULL AS deleted, pr.slug AS live_slug, "
        + fields("p") + " FROM post p LEFT JOIN post_revision pr ON pr.id = p.published_revision WHERE p.id = $1" + (lock ? " FOR UPDATE OF p" : ""), id);
    if (r.size() == 0) throw new Http.Fail(404, "not_found", "没有这篇文章（可能已经彻底删除了）");
    Map<String, String> row = r.maps().get(0);
    return new Current(id, Integer.parseInt(row.get("version")), post(row), numOrNull(row.get("published_revision")), row.get("live_slug"),
        strings(row.get("aliases")), "t".equals(row.get("deleted")));
  }

  Current current(long id) {
    return db.with(c -> current(c, id, false));
  }

  record Saved(long id, int version, long updated) {
    Map<String, Object> view() { return Map.of("id", id, "version", version, "updated", updated); }
  }

  /**
   * Saves the working copy. id 0 makes a new article. version is the one the editor opened (or last saved): when the
   * article was saved elsewhere since, this refuses (409 changed) unless force.
   */
  Saved save(long id, int version, Posts.Post p, boolean force, String kind) {
    try {
      return db.tx(c -> {
        if (taken(c, p.slug(), id)) throw new Http.Fail(409, "slug_taken", "已经有一篇文章用了这个网址（/blog/" + p.slug() + "/），换一个");
        long postId = id;
        int newVersion;
        if (id == 0) {
          Pg.Rows r = c.query("INSERT INTO post (slug, title, date, tags, description, cover, comments, body, extra, words)"
              + " VALUES ($1, $2, $3::date, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10) RETURNING id, version",
              p.slug(), p.title(), p.date(), Json.write(p.tags()), p.description(), p.cover(), p.comments(), p.body(), Json.write(p.extra()), p.words());
          postId = Long.parseLong(r.get(0, "id"));
          newVersion = Integer.parseInt(r.get(0, "version"));
        } else {
          Current cur = current(c, id, true);
          if (cur.deleted()) throw new Http.Fail(409, "trashed", "这篇文章在回收站里，先恢复再改");
          if (cur.version() != version && !force) throw new Http.Fail(409, "changed", "这篇文章在别的窗口或设备上保存过了");
          if (cur.post().equals(p)) return new Saved(id, cur.version(), now(c));
          Pg.Rows r = c.query("UPDATE post SET slug = $2, title = $3, date = $4::date, tags = $5::jsonb, description = $6, cover = $7, comments = $8, body = $9,"
              + " extra = $10::jsonb, words = $11, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version",
              id, p.slug(), p.title(), p.date(), Json.write(p.tags()), p.description(), p.cover(), p.comments(), p.body(), Json.write(p.extra()), p.words());
          newVersion = Integer.parseInt(r.get(0, "version"));
        }
        revision(c, postId, p, kind);
        return new Saved(postId, newVersion, now(c));
      });
    } catch (Pg.PgError e) {
      if ("23505".equals(e.state)) throw new Http.Fail(409, "slug_taken", "已经有一篇文章用了这个网址（/blog/" + p.slug() + "/），换一个");
      throw e;
    }
  }

  private static long now(Pg.Conn c) {
    return Long.parseLong(c.query("SELECT " + MS.formatted("now()") + " AS t").get(0, "t"));
  }

  /* another article has this address, as it is written or as it is on the site */
  private static boolean taken(Pg.Conn c, String slug, long except) {
    return c.query("SELECT 1 FROM post p LEFT JOIN post_revision r ON r.id = p.published_revision"
        + " WHERE p.id <> $2 AND p.deleted_at IS NULL AND (p.slug = $1 OR r.slug = $1) LIMIT 1", slug, except).size() > 0;
  }

  /** A version in the history: saves close together share one (the newest one is updated), anything else adds one. */
  private static long revision(Pg.Conn c, long postId, Posts.Post p, String kind) {
    if (kind.equals("save")) {
      Pg.Rows last = c.query("SELECT id FROM post_revision WHERE post_id = $1 AND kind = 'save' AND saved_at > now() - interval '" + COALESCE + "'"
          + " AND id = (SELECT max(id) FROM post_revision WHERE post_id = $1)", postId);
      if (last.size() > 0) {
        long rev = Long.parseLong(last.get(0, "id"));
        c.query("UPDATE post_revision SET slug = $2, title = $3, date = $4::date, tags = $5::jsonb, description = $6, cover = $7, comments = $8, body = $9,"
            + " extra = $10::jsonb, words = $11, saved_at = now() WHERE id = $1",
            rev, p.slug(), p.title(), p.date(), Json.write(p.tags()), p.description(), p.cover(), p.comments(), p.body(), Json.write(p.extra()), p.words());
        return rev;
      }
    }
    Pg.Rows r = c.query("INSERT INTO post_revision (post_id, kind, slug, title, date, tags, description, cover, comments, body, extra, words)"
        + " VALUES ($1, $2, $3, $4, $5::date, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12) RETURNING id",
        postId, kind, p.slug(), p.title(), p.date(), Json.write(p.tags()), p.description(), p.cover(), p.comments(), p.body(), Json.write(p.extra()), p.words());
    return Long.parseLong(r.get(0, "id"));
  }

  /* ================================================================ publishing */

  /** One article as the site will show it: its content and the earlier addresses that redirect to it. */
  record Live(long id, Posts.Post post, List<String> aliases) {}

  /** What the site shows now: every published article, as published (not the working copies). */
  List<Live> published() {
    Pg.Rows r = db.with(c -> c.query("SELECT p.id, p.aliases::text AS aliases, "
        + fields("r") + " FROM post p JOIN post_revision r ON r.id = p.published_revision WHERE p.deleted_at IS NULL ORDER BY p.id"));
    List<Live> out = new ArrayList<>();
    for (Map<String, String> row : r.maps()) out.add(new Live(num(row.get("id")), post(row), strings(row.get("aliases"))));
    return out;
  }

  /** Earlier addresses after publishing at a new one: the old address joins them, the new one leaves. */
  static List<String> aliasesAfter(Current cur) {
    List<String> al = new ArrayList<>(cur.aliases());
    if (cur.liveSlug() != null && !cur.liveSlug().equals(cur.post().slug()) && !al.contains(cur.liveSlug())) al.add(cur.liveSlug());
    al.remove(cur.post().slug());
    while (al.size() > 20) al.remove(0);
    return al;
  }

  /**
   * After a successful build: the working copy (exactly the one that was built, by version) is now the published
   * version. When the address changed, the comments go along.
   */
  void markPublished(Current built) {
    db.tx(c -> {
      current(c, built.id(), true); /* waits for, then holds, the article's row */
      long rev = revision(c, built.id(), built.post(), "publish");
      c.query("UPDATE post SET published_revision = $2, aliases = $3::jsonb, first_published_at = coalesce(first_published_at, now()) WHERE id = $1",
          built.id(), rev, Json.write(aliasesAfter(built)));
      if (built.liveSlug() != null && !built.liveSlug().equals(built.post().slug())) {
        c.query("UPDATE comment SET post = $2 WHERE post = $1", built.liveSlug(), built.post().slug());
      }
      return null;
    });
  }

  /** Takes an article off the site (it stays as a draft). */
  void markUnpublished(long id) {
    db.with(c -> c.query("UPDATE post SET published_revision = NULL WHERE id = $1", id));
  }

  /** Into the trash: off the site too. */
  void trash(long id) {
    db.with(c -> c.query("UPDATE post SET deleted_at = now(), published_revision = NULL WHERE id = $1 AND deleted_at IS NULL", id));
  }

  /** Back from the trash, as a draft. */
  void restore(long id) {
    db.tx(c -> {
      Current cur = current(c, id, true);
      if (!cur.deleted()) return null;
      if (taken(c, cur.post().slug(), id)) throw new Http.Fail(409, "slug_taken", "现在有另一篇文章用着 /blog/" + cur.post().slug() + "/，先把那篇改个网址");
      c.query("UPDATE post SET deleted_at = NULL, version = version + 1, updated_at = now() WHERE id = $1", id);
      return null;
    });
  }

  /** Gone for good, with its whole history: only from the trash. */
  boolean purge(long id) {
    return db.with(c -> c.query("DELETE FROM post WHERE id = $1 AND deleted_at IS NOT NULL", id).tag.endsWith(" 1"));
  }

  /* ================================================================ history */

  List<Map<String, Object>> revisions(long postId) {
    Pg.Rows r = db.with(c -> c.query("SELECT r.id, r.kind, r.title, r.slug, r.words, " + MS.formatted("r.saved_at") + " AS at, (p.published_revision = r.id) AS live"
        + " FROM post_revision r JOIN post p ON p.id = r.post_id WHERE r.post_id = $1 ORDER BY r.id DESC LIMIT 300", postId));
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, String> row : r.maps()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", num(row.get("id")));
      m.put("kind", row.get("kind"));
      m.put("title", row.get("title"));
      m.put("slug", row.get("slug"));
      m.put("words", num(row.get("words")));
      m.put("at", num(row.get("at")));
      m.put("live", "t".equals(row.get("live")));
      out.add(m);
    }
    return out;
  }

  Map<String, Object> revision(long revId) {
    return db.with(c -> {
      Pg.Rows r = c.query("SELECT r.id, r.post_id, r.kind, " + MS.formatted("r.saved_at") + " AS at, " + fields("r") + " FROM post_revision r WHERE r.id = $1", revId);
      if (r.size() == 0) throw new Http.Fail(404, "not_found", "没有这个版本");
      Map<String, String> row = r.maps().get(0);
      Map<String, Object> m = new LinkedHashMap<>(post(row).view());
      m.put("id", revId);
      m.put("post", num(row.get("post_id")));
      m.put("kind", row.get("kind"));
      m.put("at", num(row.get("at")));
      return m;
    });
  }

  /* ================================================================ the home page */

  /** The newest saved home page: {id, data}, or null when it was never saved here. */
  Map<String, Object> site() {
    return db.with(c -> {
      Pg.Rows r = c.query("SELECT id, data::text AS data FROM site_revision ORDER BY id DESC LIMIT 1");
      if (r.size() == 0) return null;
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", num(r.get(0, "id")));
      try {
        m.put("data", Json.parse(r.get(0, "data")));
      } catch (Json.Bad e) {
        throw new IllegalStateException(e);
      }
      return m;
    });
  }

  /** Saves the home page; base is the version the form opened (0 when it was never saved here). */
  long saveSite(Map<String, Object> data, long base) {
    return db.tx(c -> {
      Pg.Rows last = c.query("SELECT coalesce(max(id), 0) AS id FROM site_revision");
      if (Long.parseLong(last.get(0, "id")) != base) throw new Http.Fail(409, "changed", "主页内容在别的窗口里改过了，刷新后再改");
      return Long.parseLong(c.query("INSERT INTO site_revision (data) VALUES ($1::jsonb) RETURNING id", Json.write(data)).get(0, "id"));
    });
  }

  List<Map<String, Object>> siteRevisions() {
    Pg.Rows r = db.with(c -> c.query("SELECT id, " + MS.formatted("saved_at") + " AS at FROM site_revision ORDER BY id DESC LIMIT 50"));
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, String> row : r.maps()) out.add(Map.of("id", num(row.get("id")), "at", num(row.get("at"))));
    return out;
  }

  /* ================================================================ housekeeping */

  /** Every text that may show a picture (articles, versions, trash, home page, albums), for clearing out unused uploads. */
  List<String> allTexts() {
    return db.with(c -> {
      List<String> out = new ArrayList<>();
      for (String[] row : c.query("SELECT body || ' ' || cover FROM post UNION ALL SELECT body || ' ' || cover FROM post_revision UNION ALL SELECT data::text FROM site_revision UNION ALL SELECT data::text FROM album").data) out.add(row[0]);
      return out;
    });
  }

  /** Trash older than 30 days goes for good; records of the decoy pages after 90 days. Returns what was removed. */
  String sweep() {
    return db.with(c -> {
      String posts = c.query("DELETE FROM post WHERE deleted_at < now() - interval '30 days'").tag;
      String hits = c.query("DELETE FROM trap_hit WHERE at < now() - interval '90 days'").tag;
      return posts.replace("DELETE ", "") + " 篇回收站里的文章，" + hits.replace("DELETE ", "") + " 条假后台记录";
    });
  }
}
