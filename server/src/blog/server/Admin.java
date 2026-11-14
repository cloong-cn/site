package blog.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Everything behind the sign-in, under {admin.path}/api/ — a secret address set only on the server, so the page and
 * this API cannot even be found from outside. Only you use it: sign in with the password and the six-digit code from
 * your phone, then write and publish articles, moderate comments, edit the home page, roll back a release and get the
 * backups.
 *
 * <pre>
 * POST login {password, code}   POST logout   GET me
 * GET  posts[?trash=1]          GET posts/get?id=           POST posts/save      (the working copy, at once)
 * POST posts/publish            POST posts/unpublish        POST posts/trash     POST posts/restore   POST posts/purge
 * POST posts/schedule {id, at}  (定时发布; at 0 clears it)
 * GET  posts/revisions?id=      GET posts/revision?id=
 * POST upload (a picture)       GET files/media/… files/images/… (pictures for the preview)
 * GET  media (the picture library)   GET files/thumb/media/… (its small copies)   POST media/delete {path}
 * POST import?name=&amp;mode=   GET export[?ids=1,2]  (a zip of Markdown files and their pictures)
 * GET  site   POST site/save    GET site/revisions
 * GET  albums  GET albums/get?id=  POST albums/save  POST albums/delete
 * GET  comments/summary|list    POST comments/approve|delete|reply
 * GET  deploys  POST deploys/rollback  POST publish-all     GET backups  GET backups/download?name=
 * GET  security  POST security/clear                         GET jobs/{id}
 * </pre>
 *
 * Publishing, which rebuilds the site, runs as a background job the page follows. This service changes what the site
 * says (the database, media/, content/, builds/), never the code that builds or serves it.
 */
final class Admin implements HttpHandler {
  private static final String COOKIE = "bc_admin";
  private static final long MINUTE = 60_000L;

  private final AdminConfig cfg;
  private final String base;
  private final Pg.Pool db;
  private final Store store;
  private final Albums albums;
  private final Site site;
  private final Jobs jobs;
  private final Guard.Limiter limiter = new Guard.Limiter();
  private final Guard.Sessions sessions = new Guard.Sessions(12 * 60 * MINUTE);
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
  private volatile long lastTotpStep = -1;
  private final String salt = Guard.randomToken(16); /* for the in-memory failure counters only */

  Admin(AdminConfig cfg, Pg.Pool db, Store store, Site site, Jobs jobs) {
    this.cfg = cfg;
    this.base = cfg.path + "/api";
    this.db = db;
    this.store = store;
    this.albums = new Albums(db);
    this.site = site;
    this.jobs = jobs;
  }

  @Override
  public void handle(HttpExchange x) throws IOException {
    try {
      String path = x.getRequestURI().getPath();
      if (!path.startsWith(base + "/")) throw new Http.Fail(404, "not_found", "没有这个地址");
      String route = path.substring(base.length() + 1);
      String method = x.getRequestMethod();
      if (route.equals("login")) {
        login(x, method);
        return;
      }
      String token = Http.cookie(x, COOKIE);
      if (!sessions.valid(token)) throw new Http.Fail(401, "auth", "请先登录");
      if (!method.equals("GET") && !method.equals("HEAD")) Http.requireOrigin(x, cfg.origins);
      route(x, route, method, token);
    } catch (Http.Fail f) {
      Http.fail(x, f.status, f.code, f.getMessage());
    } catch (Pg.Unavailable e) {
      Log.warn("database unavailable: %s", e.getMessage());
      Http.fail(x, 503, "unavailable", "数据库暂时连不上");
    } catch (Pg.PgError e) {
      Log.warn("database error %s", e.getMessage());
      Http.fail(x, 500, "server", "数据库出错了");
    } catch (IOException e) {
      throw e;
    } catch (RuntimeException e) {
      Log.warn("unexpected %s: %s", e.getClass().getSimpleName(), e.getMessage());
      Http.fail(x, 500, "server", "出了点问题，请稍后再试");
    } finally {
      x.close();
    }
  }

  private void route(HttpExchange x, String route, String method, String token) throws IOException {
    if (route.startsWith("files/thumb/media/")) {
      want(method, "GET");
      Images.File t = Images.thumb(site, route.substring("files/thumb/media/".length()));
      if (t == null) throw new Http.Fail(404, "not_found", "没有这张图片");
      Http.sendFile(x, t.data(), t.type());
      return;
    }
    if (route.startsWith("files/")) {
      want(method, "GET");
      byte[] data = Images.file(site, route.substring("files/".length()));
      if (data == null) throw new Http.Fail(404, "not_found", "没有这个文件");
      Http.sendFile(x, data, Images.type(route));
      return;
    }
    if (route.startsWith("jobs/")) {
      want(method, "GET");
      Jobs.Job job = jobs.get(route.substring("jobs/".length()));
      if (job == null) throw new Http.Fail(404, "not_found", "没有这个任务（后台服务可能刚重启过）");
      Http.send(x, 200, job.view(), "no-store");
      return;
    }
    switch (route) {
      case "logout" -> {
        want(method, "POST");
        sessions.drop(token);
        x.getResponseHeaders().add("Set-Cookie", cookie("", 0));
        ok(x, Map.of("ok", true));
      }
      case "me" -> {
        want(method, "GET");
        ok(x, Map.of("name", cfg.ownerName, "site", cfg.siteUrl, "ip", Http.clientIp(x), "ready", site.ready()));
      }
      case "posts" -> { want(method, "GET"); ok(x, Map.of("posts", store.list("1".equals(Http.query(x).get("trash"))))); }
      case "posts/get" -> { want(method, "GET"); ok(x, store.get(id(Http.query(x).get("id")))); }
      case "posts/save" -> { want(method, "POST"); savePost(x); }
      case "posts/publish" -> { want(method, "POST"); publishPost(x); }
      case "posts/schedule" -> { want(method, "POST"); schedule(x); }
      case "posts/unpublish" -> { want(method, "POST"); unpublish(x); }
      case "posts/trash" -> { want(method, "POST"); trash(x); }
      case "posts/restore" -> { want(method, "POST"); store.restore(number(Http.jsonBody(x), "id")); ok(x, Map.of("ok", true)); }
      case "posts/purge" -> {
        want(method, "POST");
        if (!store.purge(number(Http.jsonBody(x), "id"))) throw new Http.Fail(404, "not_found", "回收站里没有这篇文章");
        ok(x, Map.of("ok", true));
      }
      case "posts/revisions" -> { want(method, "GET"); ok(x, Map.of("revisions", store.revisions(id(Http.query(x).get("id"))))); }
      case "posts/revision" -> { want(method, "GET"); ok(x, store.revision(id(Http.query(x).get("id")))); }
      case "upload" -> { want(method, "POST"); upload(x); }
      case "media" -> { want(method, "GET"); ok(x, Map.of("files", Images.library(site, store))); }
      case "media/delete" -> {
        want(method, "POST");
        String path = text(Http.jsonBody(x), "path");
        Images.delete(site, store, path.startsWith("/media/") ? path.substring(7) : path);
        Log.info("picture %s deleted", path);
        ok(x, Map.of("ok", true));
      }
      case "import" -> { want(method, "POST"); importFile(x); }
      case "export" -> { want(method, "GET"); export(x); }
      case "site" -> { want(method, "GET"); site(x); }
      case "site/save" -> { want(method, "POST"); saveSite(x); }
      case "site/revisions" -> { want(method, "GET"); ok(x, Map.of("revisions", store.siteRevisions())); }
      case "albums" -> { want(method, "GET"); ok(x, Map.of("albums", albums.list())); }
      case "albums/get" -> { want(method, "GET"); ok(x, albums.get(id(Http.query(x).get("id")))); }
      case "albums/save" -> { want(method, "POST"); saveAlbum(x); }
      case "albums/delete" -> { want(method, "POST"); deleteAlbum(x); }
      case "publish-all" -> { want(method, "POST"); publishAll(x); }
      case "comments/summary" -> { want(method, "GET"); commentSummary(x); }
      case "comments/list" -> { want(method, "GET"); commentList(x); }
      case "comments/approve" -> { want(method, "POST"); approve(x); }
      case "comments/delete" -> { want(method, "POST"); deleteComment(x); }
      case "comments/reply" -> { want(method, "POST"); reply(x); }
      case "deploys" -> { want(method, "GET"); ok(x, Map.of("live", String.valueOf(site.liveTarget()), "builds", site.builds())); }
      case "deploys/rollback" -> { want(method, "POST"); rollback(x); }
      case "backups" -> { want(method, "GET"); ok(x, Backups.status(site)); }
      case "backups/download" -> { want(method, "GET"); downloadBackup(x); }
      case "security" -> { want(method, "GET"); security(x); }
      case "security/clear" -> {
        want(method, "POST");
        db.with(c -> c.query("DELETE FROM trap_hit"));
        ok(x, Map.of("ok", true));
      }
      default -> throw new Http.Fail(404, "not_found", "没有这个地址");
    }
  }

  /* =============================================================== signing in */

  private void login(HttpExchange x, String method) throws IOException {
    want(method, "POST");
    Http.requireOrigin(x, cfg.origins);
    String ip = Http.clientIp(x);
    String ipHash = Guard.ipHash(salt, ip);
    /* at most 5 failures per address per 15 minutes, and 20 a minute from everywhere together */
    if (limiter.count("fail:" + ipHash, 15 * MINUTE) >= 5 || limiter.count("fail", MINUTE) >= 20) {
      throw new Http.Fail(429, "rate", "错误次数太多，请 15 分钟后再试");
    }
    Map<String, Object> in = Http.jsonBody(x);
    String password = text(in, "password");
    String code = text(in, "code").replace(" ", "");
    boolean passwordOk = password.length() <= 200 && Guard.verifyPassword(cfg.adminHash, password);
    long step = Totp.check(cfg.totpSecret, code, System.currentTimeMillis());
    boolean codeOk;
    synchronized (this) {
      codeOk = step >= 0 && step > lastTotpStep; /* each code works once */
      if (passwordOk && codeOk) lastTotpStep = step;
    }
    if (!passwordOk || !codeOk) {
      limiter.record("fail:" + ipHash);
      limiter.record("fail");
      Log.warn("failed admin sign-in (%s)", !passwordOk ? "password" : step < 0 ? "code" : "code reused");
      sleep(400);
      throw new Http.Fail(401, "login", "密码或验证码不对");
    }
    String token = sessions.create();
    x.getResponseHeaders().add("Set-Cookie", cookie(token, 43200));
    Log.info("admin signed in");
    ok(x, Map.of("ok", true, "name", cfg.ownerName));
  }

  private String cookie(String value, int maxAge) {
    return COOKIE + "=" + value + "; Path=" + base + "; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (cfg.cookieSecure ? "; Secure" : "");
  }

  /* =============================================================== articles */

  private void savePost(HttpExchange x) throws IOException {
    Map<String, Object> in = Http.jsonBody(x, Posts.MAX_BODY * 4 + 64 * 1024);
    Posts.Post p = Posts.fromEditor(in);
    long id = number(in, "id");
    Store.Saved s = store.save(id, (int) number(in, "version"), p, Boolean.TRUE.equals(in.get("force")), "save");
    if (id == 0) Log.info("new article %d: %s", s.id(), p.slug());
    ok(x, s.view());
  }

  private void publishPost(HttpExchange x) throws IOException {
    Map<String, Object> in = Http.jsonBody(x);
    long id = number(in, "id");
    int version = (int) number(in, "version");
    Store.Current cur = store.current(id);
    if (cur.deleted()) throw new Http.Fail(409, "trashed", "这篇文章在回收站里");
    if (cur.version() != version) throw new Http.Fail(409, "changed", "这篇文章在别的窗口或设备上保存过了，刷新后再发布");
    Jobs.Job job = startPublish(id, version, "发布：" + cur.post().title());
    Http.send(x, 202, Map.of("job", job.id), "no-store");
  }

  /**
   * Publishes an article in the background: the version the editor showed (version), or, from the clock (定时发布),
   * whatever is saved when its time comes (version -1).
   */
  private Jobs.Job startPublish(long id, int version, String label) {
    site.requireReady();
    return jobs.submit(label, j -> {
      Store.Current c = store.current(id);
      if (c.deleted()) throw new Http.Fail(409, "trashed", "这篇文章在回收站里");
      if (version >= 0 && c.version() != version) throw new Http.Fail(409, "changed", "发布前文章又被改过了，再点一次发布");
      String live = site.publish(j, label, dir -> writeContent(dir, id, c.post(), Store.aliasesAfter(c)));
      store.markPublished(c);
      if (c.liveSlug() != null && !c.liveSlug().equals(c.post().slug())) {
        flush(c.liveSlug());
        flush(c.post().slug());
        j.say("网址从 /blog/" + c.liveSlug() + "/ 改成了 /blog/" + c.post().slug() + "/：评论跟着过去了，旧地址会自动跳转");
      }
      j.say("已上线");
      j.result.put("url", cfg.siteUrl + "/blog/" + c.post().slug() + "/");
      j.result.put("live", live);
    });
  }

  /** 定时发布: {id, at} sets when the article goes up by itself (milliseconds since 1970); at 0 clears it. */
  private void schedule(HttpExchange x) throws IOException {
    Map<String, Object> in = Http.jsonBody(x);
    long id = number(in, "id");
    long at = number(in, "at");
    Store.Current cur = store.current(id);
    if (cur.deleted()) throw new Http.Fail(409, "trashed", "这篇文章在回收站里");
    if (at == 0) {
      store.schedule(id, null);
      Log.info("article %d: no longer scheduled", id);
      ok(x, Map.of("ok", true));
      return;
    }
    long now = System.currentTimeMillis();
    if (at < now + 60_000) throw new Http.Fail(400, "at", "定时发布的时间要在一分钟以后");
    if (at > now + 366L * 24 * 3600 * 1000) throw new Http.Fail(400, "at", "定时发布最多定在一年以内");
    store.schedule(id, at);
    Log.info("article %d (%s) scheduled for %s", id, cur.post().slug(), java.time.Instant.ofEpochMilli(at));
    ok(x, Map.of("ok", true, "publishAt", at));
  }

  /**
   * Called every minute (Main): each article whose time has come goes up, as one publishing job, with whatever is
   * saved then. Its time is cleared first, so it goes up once; when the site's code is not on the server yet, it waits.
   */
  void runDue() {
    if (!site.ready()) return;
    for (long id : store.due()) {
      Store.Current cur = store.current(id);
      store.schedule(id, null);
      if (cur.deleted()) continue;
      startPublish(id, -1, "定时发布：" + cur.post().title());
      Log.info("scheduled article %d (%s): publishing", id, cur.post().slug());
    }
  }

  private void unpublish(HttpExchange x) throws IOException {
    long id = number(Http.jsonBody(x), "id");
    Store.Current cur = store.current(id);
    if (cur.publishedRevision() == null) throw new Http.Fail(409, "not_published", "这篇文章没有发布");
    Jobs.Job job = jobs.submit("撤下：" + cur.post().title(), j -> {
      site.publish(j, "撤下：" + cur.post().title(), dir -> writeContent(dir, id, null, null));
      store.markUnpublished(id);
      j.say("已从网站上撤下，文章还在，成了草稿");
    });
    Http.send(x, 202, Map.of("job", job.id), "no-store");
  }

  private void trash(HttpExchange x) throws IOException {
    long id = number(Http.jsonBody(x), "id");
    Store.Current cur = store.current(id);
    if (cur.deleted()) throw new Http.Fail(409, "trashed", "已经在回收站里了");
    if (cur.publishedRevision() == null) {
      store.trash(id);
      ok(x, Map.of("ok", true));
      return;
    }
    Jobs.Job job = jobs.submit("删除：" + cur.post().title(), j -> {
      site.publish(j, "删除：" + cur.post().title(), dir -> writeContent(dir, id, null, null));
      store.trash(id);
      j.say("已从网站上去掉，文章在回收站里（30 天内可以恢复）");
    });
    Http.send(x, 202, Map.of("job", job.id), "no-store");
  }

  private void publishAll(HttpExchange x) throws IOException {
    site.requireReady();
    Jobs.Job job = jobs.submit("重新发布全部", j -> {
      j.result.put("live", site.publish(j, "重新发布全部", dir -> writeContent(dir, 0, null, null)));
      j.say("已上线");
    });
    Http.send(x, 202, Map.of("job", job.id), "no-store");
  }

  /**
   * What the site will show, as files: every published article (as published), with one of them replaced by a new
   * version (or left out, when replacement is null), and the home page.
   */
  private void writeContent(Path dir, long id, Posts.Post replacement, List<String> aliases) throws IOException {
    int n = 0;
    for (Store.Live l : store.published()) {
      if (l.id() == id) continue;
      write(dir, l.post(), l.aliases());
      n++;
    }
    if (replacement != null) {
      write(dir, replacement, aliases);
      n++;
    }
    Map<String, Object> s = store.site();
    if (s != null) Files.writeString(dir.resolve("site.json"), Json.pretty(s.get("data")), StandardCharsets.UTF_8);
    List<Map<String, Object>> live = albums.published();
    Files.writeString(dir.resolve("albums.json"), Json.pretty(live), StandardCharsets.UTF_8);
    Log.info("content written: %d articles, %d albums%s", n, live.size(), s == null ? "" : " and the home page");
  }

  private static void write(Path dir, Posts.Post p, List<String> aliases) throws IOException {
    Files.writeString(dir.resolve("blog").resolve(Posts.checkSlug(p.slug()) + ".md"), Posts.toFile(p, false, aliases, null), StandardCharsets.UTF_8);
  }

  /* =============================================================== pictures, import, export */

  private void upload(HttpExchange x) throws IOException {
    /* an album can bring hundreds at a time; the page sends them one after another */
    if (!limiter.allow("upload", 600, 10 * MINUTE)) throw new Http.Fail(429, "rate", "上传太频繁了，稍后再试");
    byte[] data = Http.rawBody(x, Images.MAX);
    Map<String, Object> r = Images.accept(site, data);
    Log.info("picture uploaded: %s", r.get("path"));
    ok(x, r);
  }

  private void importFile(HttpExchange x) throws IOException {
    Map<String, String> q = Http.query(x);
    String name = Text.line(q.getOrDefault("name", "import.md"), 200);
    Transfer.Mode mode = switch (q.getOrDefault("mode", "overwrite")) {
      case "skip" -> Transfer.Mode.SKIP;
      case "copy" -> Transfer.Mode.COPY;
      default -> Transfer.Mode.OVERWRITE;
    };
    boolean withSite = "1".equals(q.get("site"));
    Files.createDirectories(site.tmp);
    Path file = site.tmp.resolve("import-" + Guard.randomToken(9).replaceAll("[^A-Za-z0-9]", "x"));
    long size = Http.saveBody(x, Transfer.MAX_UPLOAD, file);
    if (size == 0) {
      Files.deleteIfExists(file);
      throw new Http.Fail(400, "empty", "文件是空的");
    }
    Jobs.Job job = jobs.submit("导入：" + name, j -> {
      try {
        Transfer.importFile(j, store, site, file, name, mode, withSite);
      } finally {
        Files.deleteIfExists(file);
      }
    });
    Http.send(x, 202, Map.of("job", job.id), "no-store");
  }

  private void export(HttpExchange x) throws IOException {
    String ids = Http.query(x).get("ids");
    List<Long> list = null;
    if (ids != null && !ids.isBlank()) {
      list = new ArrayList<>();
      for (String s : ids.split(",")) list.add(id(s.strip()));
    }
    String day = LocalDate.now().toString().replace("-", "");
    String folder = "blog-export-" + day;
    List<Long> chosen = list;
    String filename = chosen != null && chosen.size() == 1 ? "blog-" + store.current(chosen.get(0)).post().slug() + "-" + day + ".zip" : folder + ".zip";
    Http.download(x, "application/zip", filename, out -> Transfer.export(out, store, site, chosen, folder));
  }

  private void downloadBackup(HttpExchange x) throws IOException {
    String name = Http.query(x).getOrDefault("name", "");
    if (!Backups.DUMP.matcher(name).matches() || !Files.isRegularFile(site.backups.resolve("db").resolve(name))) {
      throw new Http.Fail(404, "not_found", "没有这个备份");
    }
    Log.info("backup %s downloaded", name);
    Http.download(x, "application/zip", "blog-backup-" + name.substring(5, 20) + ".zip", out -> Backups.download(out, site, name));
  }

  /* =============================================================== home page */

  private void site(HttpExchange x) throws IOException {
    Map<String, Object> s = store.site();
    if (s != null) {
      ok(x, Map.of("data", s.get("data"), "base", s.get("id")));
      return;
    }
    /* never saved here yet: start from the one in the code */
    Path f = site.src.resolve("content/site.json");
    if (!Files.isRegularFile(f)) throw new Http.Fail(404, "not_found", "服务器上还没有网站的代码（content/site.json）：先 git push 一次");
    try {
      ok(x, Map.of("data", Json.parse(Files.readString(f, StandardCharsets.UTF_8)), "base", 0L));
    } catch (Json.Bad e) {
      throw new Http.Fail(500, "site", "代码里的 content/site.json 格式有错");
    }
  }

  private void saveSite(HttpExchange x) throws IOException {
    Map<String, Object> in = Http.jsonBody(x, 256 * 1024);
    Map<String, Object> data = SiteData.check(in.get("data"));
    long id = store.saveSite(data, number(in, "base"));
    site.requireReady();
    Jobs.Job job = jobs.submit("更新主页", j -> {
      j.result.put("live", site.publish(j, "更新主页", dir -> writeContent(dir, 0, null, null)));
      j.say("已上线");
    });
    Http.send(x, 202, Map.of("job", job.id, "base", id), "no-store");
  }

  /* =============================================================== albums */

  /** Saves an album. A draft that never was on the site stays here; otherwise the site is rebuilt, as for the home page. */
  private void saveAlbum(HttpExchange x) throws IOException {
    Map<String, Object> in = Http.jsonBodyLarge(x, Albums.MAX_BODY);
    String slug = Albums.slug(in.get("slug"));
    Map<String, Object> data = Albums.check(in.get("data"));
    for (String rel : Albums.paths(data)) {
      if (!Files.isRegularFile(site.media.resolve(rel))) throw new Http.Fail(400, "album", "有一张照片在服务器上找不到了：/media/" + rel);
    }
    boolean draft = !Boolean.FALSE.equals(in.get("draft"));
    Albums.Saved s = albums.save(number(in, "id"), number(in, "version"), slug, draft, data);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("id", s.id());
    out.put("version", s.version());
    if (draft && !s.wasLive()) {
      ok(x, out);
      return;
    }
    out.put("job", rebuild("更新图集：" + data.get("title")).id);
    Http.send(x, 202, out, "no-store");
  }

  private void deleteAlbum(HttpExchange x) throws IOException {
    long id = number(Http.jsonBody(x), "id");
    if (!albums.delete(id)) {
      ok(x, Map.of("ok", true));
      return;
    }
    Http.send(x, 202, Map.of("job", rebuild("删除图集").id), "no-store");
  }

  private Jobs.Job rebuild(String label) {
    site.requireReady();
    return jobs.submit(label, j -> {
      j.result.put("live", site.publish(j, label, dir -> writeContent(dir, 0, null, null)));
      j.say("已上线");
    });
  }

  /* =============================================================== releases */

  private void rollback(HttpExchange x) throws IOException {
    String name = text(Http.jsonBody(x), "build");
    if (!Site.BUILD.matcher(name).matches()) throw new Http.Fail(400, "build", "版本名不对");
    Jobs.Job job = jobs.submit("切换到版本 " + name, j -> {
      site.rollback(name);
      j.say("网站已切换到 " + name);
      j.result.put("live", name);
      Log.info("rolled back to %s", name);
    });
    Http.send(x, 202, Map.of("job", job.id), "no-store");
  }

  /* =============================================================== the decoy pages */

  private void security(HttpExchange x) throws IOException {
    Map<String, Object> out = db.with(c -> {
      Map<String, Object> m = new LinkedHashMap<>();
      List<Map<String, Object>> hits = new ArrayList<>();
      for (Map<String, String> r : c.query("SELECT id, ip, kind, method, path, user_agent, username, (extract(epoch FROM at) * 1000)::bigint AS at"
          + " FROM trap_hit ORDER BY id DESC LIMIT 200").maps()) {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("id", Long.parseLong(r.get("id")));
        h.put("ip", r.get("ip"));
        h.put("kind", r.get("kind"));
        h.put("path", r.get("path"));
        h.put("agent", r.get("user_agent"));
        h.put("user", r.get("username"));
        h.put("at", Long.parseLong(r.get("at")));
        hits.add(h);
      }
      m.put("hits", hits);
      Pg.Rows s = c.query("SELECT count(*) FILTER (WHERE at > now() - interval '24 hours') AS day,"
          + " count(*) FILTER (WHERE kind = 'login' AND at > now() - interval '24 hours') AS logins, count(*) AS total FROM trap_hit");
      m.put("day", Long.parseLong(s.get(0, "day")));
      m.put("logins", Long.parseLong(s.get(0, "logins")));
      m.put("total", Long.parseLong(s.get(0, "total")));
      return m;
    });
    out.put("you", Http.clientIp(x));
    ok(x, out);
  }

  /* =============================================================== comments */

  private void commentSummary(HttpExchange x) throws IOException {
    String n = db.with(conn -> conn.query("SELECT count(*) AS n FROM comment WHERE status = 'pending'").get(0, "n"));
    ok(x, Map.of("pending", Long.parseLong(n)));
  }

  private void commentList(HttpExchange x) throws IOException {
    Map<String, String> q = Http.query(x);
    String status = switch (q.getOrDefault("status", "pending")) {
      case "approved" -> "approved";
      case "all" -> "all";
      default -> "pending";
    };
    long before = parseLong(q.get("before"));
    Pg.Rows r = db.with(conn -> conn.query(
        "SELECT c.id, c.post, c.parent_id, c.author_name, c.email, c.website, c.content, c.status, c.is_owner, c.ip_hash, c.user_agent,"
            + " (extract(epoch FROM c.created_at) * 1000)::bigint AS at, p.author_name AS parent_name"
            + " FROM comment c LEFT JOIN comment p ON p.id = c.parent_id"
            + " WHERE ($1 = 'all' OR c.status = $1) AND ($2::bigint = 0 OR c.id < $2::bigint)"
            + " ORDER BY c.id DESC LIMIT 50",
        status, before));
    List<Map<String, Object>> items = new ArrayList<>();
    for (Map<String, String> row : r.maps()) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", Long.parseLong(row.get("id")));
      m.put("post", row.get("post"));
      m.put("parent", row.get("parent_id") == null ? null : Long.parseLong(row.get("parent_id")));
      m.put("parentName", row.get("parent_name"));
      m.put("name", row.get("author_name"));
      m.put("email", row.get("email"));
      m.put("url", row.get("website"));
      m.put("content", row.get("content"));
      m.put("status", row.get("status"));
      m.put("owner", "t".equals(row.get("is_owner")));
      m.put("ip", row.get("ip_hash"));
      m.put("agent", row.get("user_agent"));
      m.put("at", Long.parseLong(row.get("at")));
      items.add(m);
    }
    ok(x, Map.of("comments", items));
  }

  private void approve(HttpExchange x) throws IOException {
    long id = number(Http.jsonBody(x), "id");
    String p = db.with(conn -> {
      Pg.Rows r = conn.query("UPDATE comment SET status = 'approved', approved_at = now() WHERE id = $1 AND status = 'pending' RETURNING post", id);
      return r.size() == 0 ? null : r.get(0, "post");
    });
    if (p == null) throw new Http.Fail(404, "not_found", "这条评论不存在或已经通过");
    flush(p);
    Log.info("comment %d approved", id);
    ok(x, Map.of("ok", true));
  }

  private void deleteComment(HttpExchange x) throws IOException {
    long id = number(Http.jsonBody(x), "id");
    String p = db.with(conn -> {
      Pg.Rows r = conn.query("DELETE FROM comment WHERE id = $1 RETURNING post", id);
      return r.size() == 0 ? null : r.get(0, "post");
    });
    if (p == null) throw new Http.Fail(404, "not_found", "这条评论不存在");
    flush(p);
    Log.info("comment %d deleted", id);
    ok(x, Map.of("ok", true));
  }

  private void reply(HttpExchange x) throws IOException {
    Map<String, Object> in = Http.jsonBody(x);
    long id = number(in, "id");
    String content = Text.block(text(in, "content"), 2000);
    if (content.isEmpty()) throw new Http.Fail(400, "content", "请填写回复内容");
    String[] post = new String[1];
    long newId = db.tx(conn -> {
      Pg.Rows p = conn.query("SELECT post, parent_id, status FROM comment WHERE id = $1", id);
      if (p.size() == 0) throw new Http.Fail(404, "not_found", "这条评论不存在");
      if ("pending".equals(p.get(0, "status"))) { /* answering a comment approves it */
        conn.query("UPDATE comment SET status = 'approved', approved_at = now() WHERE id = $1", id);
      }
      String top = p.get(0, "parent_id");
      post[0] = p.get(0, "post");
      Pg.Rows r = conn.query(
          "INSERT INTO comment (post, parent_id, author_name, content, status, is_owner, approved_at) VALUES ($1, $2, $3, $4, 'approved', true, now()) RETURNING id",
          post[0], top != null ? Long.parseLong(top) : id, cfg.ownerName, content);
      return Long.parseLong(r.get(0, "id"));
    });
    flush(post[0]);
    Log.info("author replied to comment %d", id);
    ok(x, Map.of("ok", true, "id", newId));
  }

  /** Tells the comment service to drop its cached list for the article, so the change shows at once. */
  private void flush(String post) {
    try {
      HttpRequest req = HttpRequest.newBuilder(URI.create(cfg.commentsUrl + "/internal/flush"))
          .timeout(Duration.ofSeconds(2)).POST(HttpRequest.BodyPublishers.ofString(post)).build();
      http.sendAsync(req, HttpResponse.BodyHandlers.discarding());
    } catch (IllegalArgumentException ignored) {
      /* comments.url is wrong: the list refreshes within 30 seconds anyway */
    }
  }

  /* =============================================================== helpers */

  private static void ok(HttpExchange x, Object payload) throws IOException {
    Http.send(x, 200, payload, "no-store");
  }

  private static void want(String method, String expected) {
    if (!method.equals(expected) && !(expected.equals("GET") && method.equals("HEAD"))) throw new Http.Fail(405, "method", "不支持的请求方式");
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

  private static long id(String s) {
    long n = parseLong(s);
    if (n <= 0) throw new Http.Fail(400, "id", "编号不对");
    return n;
  }

  private static long parseLong(String s) {
    try {
      return s == null ? 0 : Math.max(0, Long.parseLong(s));
    } catch (NumberFormatException e) {
      return 0;
    }
  }

  private static void sleep(long ms) {
    try {
      Thread.sleep(ms);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
