package blog.server;

import com.sun.net.httpserver.HttpServer;
import java.io.BufferedReader;
import java.io.Console;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * The blog's server side: two services from one program, run separately with their own settings and permissions.
 *
 * <pre>
 * java -jar blog-server.jar comments --config /etc/blog/comments.properties   the public comment API and decoy pages (port 8787)
 * java -jar blog-server.jar admin    --config /etc/blog/admin.properties      the admin service (port 8788)
 * java -jar blog-server.jar comments check --config …    test the settings and the database (same for admin)
 * java -jar blog-server.jar hash-password                make admin.passwordHash
 * java -jar blog-server.jar totp-setup                   make admin.totpSecret (two-step sign-in)
 * java -jar blog-server.jar random-path                  make admin.path (the admin page's secret address)
 * java -jar blog-server.jar random-salt                  make security.ipSalt
 * </pre>
 */
public final class Main {
  private Main() {}

  public static void main(String[] args) throws Exception {
    /* messages are in Chinese: print them as UTF-8 whatever the console's locale */
    System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
    System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));
    /* limits of the built-in HTTP server: a request (or response) that takes longer than 30 s is dropped. Nginx in
       front already buffers slow clients; this is the second line */
    String command = args.length > 0 && !args[0].startsWith("--") ? args[0] : "";
    System.setProperty("sun.net.httpserver.maxReqTime", "30");
    /* the admin service sends downloads (exports, backups) that can take a while; it is behind the sign-in */
    System.setProperty("sun.net.httpserver.maxRspTime", command.equals("admin") ? "1800" : "30");
    System.setProperty("sun.net.httpserver.maxReqHeaders", "64");
    System.setProperty("sun.net.httpserver.idleInterval", "30");
    /* file names and the arguments given to git are passed to the system in its own encoding: Chinese titles and
       article names need UTF-8. systemd starts services with no language set, hence LANG=C.UTF-8 in the unit files */
    String jnu = System.getProperty("sun.jnu.encoding", "");
    if ((command.equals("admin") || command.equals("comments")) && !jnu.equalsIgnoreCase("UTF-8")) {
      System.err.println("系统语言环境不是 UTF-8（现在是 " + jnu + "），中文的文章名和标题会出错。");
      System.err.println("在 systemd 服务文件里加一行  Environment=LANG=C.UTF-8 ，或者运行前先  export LANG=C.UTF-8");
      System.exit(1);
    }
    boolean check = args.length > 1 && args[1].equals("check");
    switch (command) {
      case "comments" -> {
        CommentsConfig cfg = CommentsConfig.load(configPath(args, "comments.properties"));
        if (check) checkDb(cfg.db, "SELECT count(*) AS n FROM comment WHERE status = 'approved'", "条公开的评论");
        else serveComments(cfg);
      }
      case "admin" -> {
        AdminConfig cfg = AdminConfig.load(configPath(args, "admin.properties"));
        if (check) checkAdmin(cfg);
        else serveAdmin(cfg);
      }
      case "hash-password" -> hashPassword();
      case "totp-setup" -> totpSetup();
      case "random-salt" -> System.out.println(Guard.randomToken(24));
      case "random-path" -> randomPath();
      default -> {
        System.err.println("用法：java -jar blog-server.jar comments|admin [check] --config 文件");
        System.err.println("      java -jar blog-server.jar hash-password | totp-setup | random-path | random-salt");
        System.exit(2);
      }
    }
  }

  private static Path configPath(String[] args, String fallback) {
    for (int i = 0; i < args.length - 1; i++) if (args[i].equals("--config")) return Path.of(args[i + 1]);
    return Path.of(fallback);
  }

  /* ordinary threads, not virtual ones: on Java 21 the built-in server reads requests while holding a lock, which pins
     a virtual thread to its carrier, so two clients that send slowly could freeze every request. A slow client now
     only ties up one of these threads, for at most maxReqTime */
  private static ThreadPoolExecutor workers(int n) {
    ThreadPoolExecutor w = new ThreadPoolExecutor(n, n, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1000), r -> {
      Thread t = new Thread(r, "http");
      t.setDaemon(true);
      return t;
    });
    w.allowCoreThreadTimeOut(true);
    return w;
  }

  private static HttpServer listen(String host, int port) throws Exception {
    /* only Nginx / Caddy on this machine may reach the services: everything from outside goes through them (their
       limits, their HTTPS), never around them */
    if (!InetAddress.getByName(host).isLoopbackAddress()) {
      System.err.println("listen.host 是 " + host + "：服务只能监听本机地址（127.0.0.1），由 Nginx / Caddy 转发。改回 listen.host=127.0.0.1");
      System.exit(1);
    }
    return HttpServer.create(new InetSocketAddress(host, port), 128);
  }

  private static Pg.Pool pool(Pg.Settings db, int size) {
    Pg.Pool pool = new Pg.Pool(db, size);
    try {
      pool.with(c -> c.query("SELECT 1"));
      Log.info("database ok: %s@%s:%d/%s", db.user(), db.host(), db.port(), db.database());
    } catch (RuntimeException e) {
      Log.warn("database not reachable yet (%s); will keep trying on each request", e.getMessage());
    }
    return pool;
  }

  private static void serveComments(CommentsConfig cfg) throws Exception {
    Pg.Pool pool = pool(cfg.db, cfg.dbPool);
    HttpServer server = listen(cfg.listenHost, cfg.listenPort);
    Notifier notifier = new Notifier(cfg);
    Comments comments = new Comments(cfg, pool, notifier);
    server.createContext("/api/comments", comments);
    /* the decoy admin pages: Nginx / Caddy send /admin/, /wp-login.php … here (see deploy/nginx.conf) */
    server.createContext("/trap", new Trap(cfg, pool, notifier));
    /* not under /api/comments, so Nginx and Caddy never pass it on: only the admin service on this machine calls it */
    server.createContext("/internal/flush", x -> {
      try (x) {
        if (x.getRemoteAddress().getAddress().isLoopbackAddress() && "POST".equals(x.getRequestMethod())) {
          comments.flush(new String(Http.rawBody(x, 200), StandardCharsets.UTF_8).strip());
        }
        x.sendResponseHeaders(204, -1);
      } catch (Http.Fail f) {
        x.sendResponseHeaders(400, -1);
      }
    });
    ThreadPoolExecutor w = workers(64);
    server.setExecutor(w);
    server.start();
    Log.info("comments: listening on %s:%d for %s", cfg.listenHost, cfg.listenPort, String.join(", ", cfg.origins));
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      server.stop(2);
      w.shutdownNow();
      pool.close();
      Log.info("stopped");
    }));
  }

  private static void serveAdmin(AdminConfig cfg) throws Exception {
    Pg.Pool pool = pool(cfg.db, cfg.dbPool);
    Site site = new Site(cfg.base);
    Store store = new Store(pool);
    Jobs jobs = new Jobs();
    HttpServer server = listen(cfg.listenHost, cfg.listenPort);
    server.createContext(cfg.path + "/api/", new Admin(cfg, pool, store, site, jobs));
    ThreadPoolExecutor w = workers(16);
    server.setExecutor(w);
    server.start();
    Log.info("admin: listening on %s:%d for %s, site files in %s", cfg.listenHost, cfg.listenPort, String.join(", ", cfg.origins), cfg.base);
    if (!site.ready()) Log.warn("no site code in %s yet: git push once (README, first deployment)", site.src);
    /* once a day: the trash after 30 days, decoy records after 90, pictures nothing uses */
    ScheduledExecutorService daily = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "daily");
      t.setDaemon(true);
      return t;
    });
    daily.scheduleWithFixedDelay(() -> {
      try {
        String swept = store.sweep();
        int pictures = Images.sweep(site, store);
        Log.info("housekeeping: removed %s, %d unused pictures", swept, pictures);
      } catch (RuntimeException e) {
        Log.warn("housekeeping failed: %s", e.getMessage());
      }
    }, 2, 24 * 60, TimeUnit.MINUTES);
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      server.stop(2);
      w.shutdownNow();
      daily.shutdownNow();
      jobs.close();
      pool.close();
      Log.info("stopped");
    }));
  }

  private static void checkDb(Pg.Settings db, String sql, String what) {
    System.out.println("配置文件没有问题。");
    Pg.Pool pool = new Pg.Pool(db, 1);
    try {
      String n = pool.with(c -> c.query(sql).get(0, "n"));
      System.out.println("数据库连接正常（" + db.user() + "），现在有 " + n + " " + what + "。");
    } catch (RuntimeException e) {
      System.out.println("连不上数据库：" + e.getMessage());
      System.exit(1);
    } finally {
      pool.close();
    }
  }

  private static void checkAdmin(AdminConfig cfg) {
    checkDb(cfg.db, "SELECT count(*) AS n FROM post WHERE deleted_at IS NULL", "篇文章");
    Site site = new Site(cfg.base);
    System.out.println(site.ready() ? "网站代码已经在 " + site.src + "。" : "服务器上还没有网站代码：先在电脑上 git push 一次。");
    Site.Result node = Site.run(cfg.base, null, 10, java.util.List.of("node", "--version"));
    System.out.println(node.code() == 0 ? "Node.js " + node.text().strip() + "。" : "找不到 node，发布和上传图片都需要它。");
    System.out.println("后台地址：" + cfg.siteUrl + cfg.path + "/");
  }

  private static char[][] askTwice(String first, String second) throws Exception {
    Console console = System.console();
    if (console != null) return new char[][] {console.readPassword(first), console.readPassword(second)};
    BufferedReader r = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String l1 = r.readLine(), l2 = r.readLine();
    return new char[][] {l1 == null ? new char[0] : l1.toCharArray(), l2 == null ? new char[0] : l2.toCharArray()};
  }

  private static void hashPassword() throws Exception {
    char[][] pw = askTwice("管理密码（至少 12 位）：", "再输入一次：");
    char[] a = pw[0], b = pw[1];
    if (a == null || b == null || !Arrays.equals(a, b)) {
      System.err.println("两次输入不一样。");
      System.exit(1);
    }
    if (a.length < 12) {
      System.err.println("密码太短了，至少 12 位。");
      System.exit(1);
    }
    System.out.println("admin.passwordHash=" + Guard.hashPassword(a));
    Arrays.fill(a, ' ');
    Arrays.fill(b, ' ');
  }

  /** A secret address for the admin page: a word, then 20 random letters and digits (about 119 bits). */
  private static void randomPath() {
    String[] words = {"harbor", "lantern", "meadow", "orbit", "pebble", "quartz", "river", "saffron", "timber", "velvet", "willow", "amber",
        "cobalt", "delta", "ember", "falcon", "glacier", "horizon", "indigo", "juniper", "kestrel", "lagoon", "maple", "nebula", "onyx", "prairie"};
    String abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    StringBuilder b = new StringBuilder("/").append(words[Guard.RANDOM.nextInt(words.length)]).append('-');
    for (int i = 0; i < 20; i++) b.append(abc.charAt(Guard.RANDOM.nextInt(abc.length())));
    System.out.println("admin.path=" + b);
    System.out.println();
    System.out.println("把这一行放进 admin.properties，再把 deploy/nginx.conf（或 Caddyfile）里的 ADMIN_PATH 换成 " + b.substring(1) + "。");
    System.out.println("以后后台就在 https://你的域名" + b + "/ ，收藏起来；/admin/ 会变成假的登录页。");
  }

  /** Makes a secret, shows it for the phone, and only prints the setting after a code from the phone matches. */
  private static void totpSetup() throws Exception {
    String secret = Totp.newSecret();
    System.out.println("在手机的验证器 App 里添加一个账户，选“输入设置密钥”（或“手动输入”），填：");
    System.out.println();
    System.out.println("    账户名：Blog");
    System.out.println("    密钥：  " + secret.replaceAll("(.{4})", "$1 ").strip());
    System.out.println("    类型：  基于时间");
    System.out.println();
    System.out.println("（也可以把这个地址做成二维码再扫：" + Totp.uri(secret, "admin") + "）");
    System.out.println();
    BufferedReader r = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    for (int i = 0; i < 3; i++) {
      System.out.print("添加好以后，输入 App 上现在显示的 6 位数：");
      System.out.flush();
      String line = r.readLine();
      if (line == null) break;
      if (Totp.check(secret, line.replace(" ", "").strip(), System.currentTimeMillis()) >= 0) {
        System.out.println();
        System.out.println("对上了。把下面这一行放进后台的配置文件（admin.properties）：");
        System.out.println("admin.totpSecret=" + secret);
        return;
      }
      System.out.println("不对。确认手机时间是自动设置的，再试一次。");
    }
    System.err.println("没有设置成功，重新运行 totp-setup 再来。");
    System.exit(1);
  }
}
