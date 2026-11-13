package blog.server;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The decoy admin pages: /admin/, /wp-login.php, /login and the other addresses scanners try (Nginx or Caddy send
 * them here; the real admin page has a secret address of its own). Each shows a sign-in form in the site's style that
 * never signs anyone in: whatever is typed, after a moment it says "系统错误，请稍后再试".
 *
 * Every visit and every attempt is written down (time, address, browser, the user name typed — the password never),
 * and an attempt is reported through notify.url (at most once per address in 6 hours). Nobody is locked out because
 * of it: one address is often shared by many people (mobile networks, offices, a CDN in front), and what keeps the
 * real admin page safe is its secret address, the password and the code from your phone. Lines "trap login from …"
 * in the journal can feed fail2ban if you want to block scanners at the firewall.
 *
 * It runs in the public service, with its database role, which can add these records and nothing else.
 */
final class Trap implements HttpHandler {
  private static final long HOUR = 3_600_000L;
  private static final Pattern USER = Pattern.compile("(?:^|&)(?:log|user(?:name)?|account|email|login|name|uname)=([^&]*)");
  static final String STATUS = "<!--trap-status-->";

  private final CommentsConfig cfg;
  private final Pg.Pool db;
  private final Notifier notifier;
  private final Guard.Limiter limiter = new Guard.Limiter();
  private final Semaphore waiting = new Semaphore(8); /* attempts being made to wait at once; more are answered at once */
  private volatile Cached page;

  private record Cached(byte[] html, long modified) {}

  Trap(CommentsConfig cfg, Pg.Pool db, Notifier notifier) {
    this.cfg = cfg;
    this.db = db;
    this.notifier = notifier;
  }

  @Override
  public void handle(HttpExchange x) throws IOException {
    try (x) {
      String method = x.getRequestMethod();
      String ip = Http.clientIp(x);
      String original = x.getRequestHeaders().getFirst("X-Trap-Path");
      String path = Text.line(original != null ? original : x.getRequestURI().getRawPath(), 300);
      String ua = x.getRequestHeaders().getFirst("User-Agent");
      String agent = ua == null ? null : Text.line(ua, 300);
      if (method.equals("GET") || method.equals("HEAD")) {
        record(ip, "visit", method, path, agent, null);
        send(x, 200, html(false));
      } else if (method.equals("POST")) {
        String user = null;
        try {
          String form = new String(Http.rawBody(x, 8 * 1024), StandardCharsets.UTF_8);
          Matcher m = USER.matcher(form);
          if (m.find()) user = Text.line(URLDecoder.decode(m.group(1), StandardCharsets.UTF_8), 100);
        } catch (Http.Fail | IllegalArgumentException ignored) {
          /* too long or not a form: still an attempt */
        }
        /* the password field is never read */
        record(ip, "login", method, path, agent, user);
        Log.warn("trap login from %s path=%s", ip, path.replaceAll("\\s", "_"));
        if (limiter.allow("notify:" + ip, 1, 6 * HOUR)) {
          notifier.send("有人在假后台尝试登录", "地址 " + ip + " 在 " + path + " 尝试登录" + (user == null || user.isEmpty() ? "" : "，用户名 " + user)
              + "。这是扫描器的常见行为，真正的后台不受影响。", cfg.siteUrl + "/");
        }
        if (waiting.tryAcquire()) {
          try {
            Thread.sleep(1200 + ThreadLocalRandom.current().nextInt(1600)); /* like a real system thinking it over */
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            waiting.release();
          }
        }
        send(x, 200, html(true));
      } else {
        x.getResponseHeaders().set("Allow", "GET, POST");
        x.sendResponseHeaders(405, -1);
      }
    } catch (RuntimeException e) {
      Log.warn("trap: %s", e.getClass().getSimpleName());
    }
  }

  /* at most 30 records an hour from one address, 2000 from everywhere: a scanner cannot fill the database */
  private void record(String ip, String kind, String method, String path, String agent, String user) {
    if (!limiter.allow("rec:" + ip, 30, HOUR) || !limiter.allow("rec", 2000, HOUR)) return;
    try {
      db.with(c -> c.query("INSERT INTO trap_hit (ip, kind, method, path, user_agent, username) VALUES ($1, $2, $3, $4, $5, $6)",
          ip, kind, method, path, agent, user));
    } catch (Pg.Unavailable | Pg.PgError e) {
      Log.warn("trap: could not record (%s)", e.getMessage());
    }
  }

  /** The decoy page from the site's build (_trap/index.html), with the error when an attempt was made. */
  private byte[] html(boolean failed) {
    Path f = cfg.siteRoot.resolve("_trap/index.html");
    Cached c = page;
    try {
      long mod = Files.getLastModifiedTime(f).toMillis();
      if (c == null || c.modified() != mod) {
        c = new Cached(Files.readAllBytes(f), mod);
        page = c;
      }
    } catch (IOException e) {
      c = new Cached(("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>后台登录</title><form method=\"post\">"
          + STATUS + "<input name=\"username\" placeholder=\"用户名\"><input name=\"password\" type=\"password\" placeholder=\"密码\"><button>登录</button></form></html>").getBytes(StandardCharsets.UTF_8), 0);
    }
    String html = new String(c.html(), StandardCharsets.UTF_8);
    return html.replace(STATUS, failed ? "<p class=\"cm-status is-error trap-status\" role=\"alert\">系统错误，请稍后再试。</p>" : "").getBytes(StandardCharsets.UTF_8);
  }

  private static void send(HttpExchange x, int status, byte[] body) throws IOException {
    Headers h = x.getResponseHeaders();
    h.set("Content-Type", "text/html; charset=utf-8");
    h.set("Cache-Control", "no-store");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    boolean head = "HEAD".equals(x.getRequestMethod());
    x.sendResponseHeaders(status, head ? -1 : body.length);
    if (!head) {
      try (OutputStream o = x.getResponseBody()) {
        o.write(body);
      }
    }
  }
}
