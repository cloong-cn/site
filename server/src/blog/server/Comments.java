package blog.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The public comment API, what every visitor can reach. It can read approved comments and add new ones that wait for
 * approval, nothing more: approving, answering and deleting live in the admin service (Admin.java), behind a sign-in.
 *
 * <pre>
 * GET  /api/comments?post=slug        approved comments of one article
 * POST /api/comments                  a new comment; it waits for approval
 * GET  /api/comments/health
 * POST /internal/flush                the admin service says a post's comments changed (only reachable on this machine)
 * </pre>
 */
final class Comments implements HttpHandler {
  private static final String BASE = "/api/comments";
  private static final long MINUTE = 60_000L;
  /* an article's name, as the site's build makes it from the file name */
  private static final Pattern SLUG = Pattern.compile("[\\p{L}\\p{N}][\\p{L}\\p{N}_.-]{0,119}");
  private static final Pattern EMAIL = Pattern.compile("[^\\s@<>\"']{1,64}@[^\\s@<>\"']{1,190}\\.[^\\s@<>\"'.]{2,24}");
  private static final Pattern LINK = Pattern.compile("(?i)https?://|www\\.");

  private final CommentsConfig cfg;
  private final Pg.Pool db;
  private final Notifier notifier;
  private final Guard.Limiter limiter = new Guard.Limiter();
  private final Map<String, Cached> cache = new ConcurrentHashMap<>();
  private final Map<String, Long> knownPosts = new ConcurrentHashMap<>();

  private record Cached(byte[] body, String etag, long at) {}

  Comments(CommentsConfig cfg, Pg.Pool db, Notifier notifier) {
    this.cfg = cfg;
    this.db = db;
    this.notifier = notifier;
  }

  @Override
  public void handle(HttpExchange x) throws IOException {
    try {
      String path = x.getRequestURI().getPath();
      String rest = path.length() > BASE.length() ? path.substring(BASE.length()) : "";
      String method = x.getRequestMethod();
      if (rest.equals("") || rest.equals("/")) {
        if (method.equals("GET") || method.equals("HEAD")) list(x);
        else if (method.equals("POST")) submit(x);
        else throw new Http.Fail(405, "method", "不支持的请求方式");
      } else if (rest.equals("/health") && method.equals("GET")) {
        Http.send(x, 200, Map.of("ok", true), "no-store");
      } else {
        throw new Http.Fail(404, "not_found", "没有这个地址");
      }
    } catch (Http.Fail f) {
      Http.fail(x, f.status, f.code, f.getMessage());
    } catch (Pg.Unavailable e) {
      Log.warn("database unavailable: %s", e.getMessage());
      Http.fail(x, 503, "unavailable", "评论服务暂时不可用，请稍后再试");
    } catch (Pg.PgError e) {
      Log.warn("database error %s", e.state);
      Http.fail(x, 500, "server", "出了点问题，请稍后再试");
    } catch (IOException e) {
      throw e;
    } catch (RuntimeException e) {
      Log.warn("unexpected %s: %s", e.getClass().getSimpleName(), e.getMessage());
      Http.fail(x, 500, "server", "出了点问题，请稍后再试");
    } finally {
      x.close();
    }
  }

  /* =============================================================== public */

  private void list(HttpExchange x) throws IOException {
    String post = post(Http.query(x).get("post"));
    Cached c = cache.get(post);
    if (c == null || System.currentTimeMillis() - c.at() > 30_000) {
      Pg.Rows r = db.with(conn -> conn.query(
          "SELECT id, parent_id, author_name, website, content, is_owner, (extract(epoch FROM created_at) * 1000)::bigint AS at"
              + " FROM comment WHERE post = $1 AND status = 'approved' ORDER BY created_at, id LIMIT 2000",
          post));
      List<Map<String, Object>> items = new ArrayList<>();
      for (Map<String, String> row : r.maps()) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", Long.parseLong(row.get("id")));
        m.put("parent", row.get("parent_id") == null ? null : Long.parseLong(row.get("parent_id")));
        m.put("name", row.get("author_name"));
        m.put("url", row.get("website"));
        m.put("content", row.get("content"));
        m.put("owner", "t".equals(row.get("is_owner")));
        m.put("at", Long.parseLong(row.get("at")));
        items.add(m);
      }
      byte[] body = Json.write(Map.of("post", post, "count", items.size(), "comments", items)).getBytes(StandardCharsets.UTF_8);
      String etag = "\"" + HexFormat.of().formatHex(Guard.sha256(body), 0, 10) + "\"";
      c = new Cached(body, etag, System.currentTimeMillis());
      cache.put(post, c);
    }
    x.getResponseHeaders().set("ETag", c.etag());
    if (c.etag().equals(x.getRequestHeaders().getFirst("If-None-Match"))) Http.send(x, 304, new byte[0], "no-cache");
    else Http.send(x, 200, c.body(), "no-cache");
  }

  private void submit(HttpExchange x) throws IOException {
    Http.requireOrigin(x, cfg.origins);
    Map<String, Object> in = Http.jsonBody(x);
    String ipHash = Guard.ipHash(cfg.ipSalt, Http.clientIp(x));

    /* bots: a filled-in hidden field, or a form sent within three seconds of showing it. They get the usual answer,
       and nothing is stored */
    if (!text(in, "website2").isEmpty() || number(in, "t") < 3000) {
      Log.info("dropped a bot submission");
      Http.send(x, 202, Map.of("status", "pending"), "no-store");
      return;
    }
    if (!limiter.allow("post10:" + ipHash, cfg.perIp10Min, 10 * MINUTE) || !limiter.allow("postday:" + ipHash, cfg.perIpDay, 24 * 60 * MINUTE)) {
      throw new Http.Fail(429, "rate", "评论太频繁了，请稍后再试");
    }

    String post = post(text(in, "post"));
    String name = Text.line(text(in, "name"), 40);
    if (name.isEmpty()) throw new Http.Fail(400, "name", "请填写昵称");
    String email = Text.line(text(in, "email"), 120);
    if (!email.isEmpty() && !EMAIL.matcher(email).matches()) throw new Http.Fail(400, "email", "邮箱格式不对");
    String website = website(text(in, "url"));
    String content = Text.block(text(in, "content"), 2000);
    if (content.isEmpty()) throw new Http.Fail(400, "content", "请填写评论内容");
    Matcher links = LINK.matcher(content);
    int linkCount = 0;
    while (links.find()) linkCount++;
    if (linkCount > 3) throw new Http.Fail(400, "links", "评论里的链接太多了");
    long parentId = number(in, "parent");
    String agent = Text.clip(x.getRequestHeaders().getFirst("User-Agent"), 300);

    long id = db.with(conn -> {
      Long parent = null;
      if (parentId > 0) {
        Pg.Rows p = conn.query("SELECT post, status, parent_id FROM comment WHERE id = $1", parentId);
        if (p.size() == 0 || !post.equals(p.get(0, "post")) || !"approved".equals(p.get(0, "status"))) {
          throw new Http.Fail(400, "parent", "要回复的评论不存在");
        }
        String top = p.get(0, "parent_id"); /* replies stay one level deep: a reply to a reply joins the same thread */
        parent = top != null ? Long.parseLong(top) : parentId;
      }
      if (conn.query("SELECT 1 FROM comment WHERE ip_hash = $1 AND content = $2 AND created_at > now() - interval '1 day' LIMIT 1", ipHash, content).size() > 0) {
        throw new Http.Fail(409, "duplicate", "这条评论已经提交过了");
      }
      if (Long.parseLong(conn.query("SELECT count(*) AS n FROM comment WHERE status = 'pending'").get(0, "n")) >= cfg.maxPending) {
        throw new Http.Fail(503, "busy", "待审核的评论太多了，请过一阵再来");
      }
      Pg.Rows r = conn.query(
          "INSERT INTO comment (post, parent_id, author_name, email, website, content, ip_hash, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
          post, parent, name, email.isEmpty() ? null : email, website, content, ipHash, agent);
      return Long.parseLong(r.get(0, "id"));
    });
    Log.info("new comment %d on %s, waiting for approval", id, post);
    notifier.newComment(post, name, content);
    Http.send(x, 202, Map.of("status", "pending", "id", id), "no-store");
  }

  /** The admin service approved, answered or deleted something: forget the cached list of that post. */
  void flush(String post) {
    if (post != null) cache.remove(post);
  }

  /* =============================================================== input */

  /** An article that exists on the site: its name passes the pattern and the built page is there. */
  private String post(String slug) {
    if (slug == null || !SLUG.matcher(slug).matches() || slug.contains("..")) throw new Http.Fail(400, "post", "文章不存在");
    Long seen = knownPosts.get(slug);
    if (seen != null && System.currentTimeMillis() - seen < 60_000) return slug;
    Path blog = cfg.siteRoot.resolve("blog").normalize();
    Path page;
    try {
      page = blog.resolve(slug).resolve("index.html").normalize();
    } catch (java.nio.file.InvalidPathException e) {
      throw new Http.Fail(404, "post", "文章不存在");
    }
    if (!page.startsWith(blog) || !Files.isRegularFile(page)) throw new Http.Fail(404, "post", "文章不存在");
    if (knownPosts.size() > 5000) knownPosts.clear();
    knownPosts.put(slug, System.currentTimeMillis());
    return slug;
  }

  private static String text(Map<String, Object> in, String key) {
    Object v = in.get(key);
    return v instanceof String s ? s : "";
  }

  private static long number(Map<String, Object> in, String key) {
    Object v = in.get(key);
    if (v instanceof Long l) return l;
    if (v instanceof Double d && Double.isFinite(d)) return d.longValue();
    return 0;
  }

  /** A visitor's site: an http(s) address with a host, or nothing. */
  private static String website(String raw) {
    String s = Text.line(raw, 200);
    if (s.isEmpty()) return null;
    Matcher scheme = Pattern.compile("(?i)^(https?)://").matcher(s);
    s = scheme.find() ? scheme.group(1).toLowerCase() + "://" + s.substring(scheme.end()) : "https://" + s;
    try {
      URI u = URI.create(s);
      if (!("https".equals(u.getScheme()) || "http".equals(u.getScheme())) || u.getHost() == null || u.getUserInfo() != null) throw new IllegalArgumentException();
      String out = u.toString();
      if (out.length() > 200) throw new Http.Fail(400, "url", "网址太长了");
      return out;
    } catch (IllegalArgumentException e) {
      throw new Http.Fail(400, "url", "网址格式不对");
    }
  }
}
