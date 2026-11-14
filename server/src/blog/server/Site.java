package blog.server;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * The site's folder on the server, /srv/blog:
 *
 * <pre>
 * repo.git   the code: git push from your computer (or GitHub) lands here and runs deploy/post-receive
 * src/       that code checked out, with its node_modules and picture cache; every build runs here
 * content/   what is published right now, as files: blog/{slug}.md and site.json (written from the database)
 * media/     pictures uploaded in the editor: media/2026/{16 hex}.jpg
 * builds/    the built versions; live points at the one being served
 * backups/   the nightly backups (deploy/backup.sh, run by root)
 * </pre>
 *
 * Publishing writes the published articles from the database into content.next/, then runs deploy/build-site.sh, the
 * same script a git push runs: it builds into builds/, and only when that worked swaps content.next/ in for content/
 * and points live at the new build. A failed build changes nothing on the site. One build at a time: both take the
 * lock file .deploy.lock. Programs always run with fixed arguments, never through a shell command line.
 */
final class Site {
  static final Pattern BUILD = Pattern.compile("\\d{8}-\\d{6}-[0-9a-z]{1,12}");

  final Path base, src, content, next, media, thumbs, builds, live, backups, tmp, lock;

  Site(Path base) {
    this.base = base;
    src = base.resolve("src");
    content = base.resolve("content");
    next = base.resolve("content.next");
    media = base.resolve("media");
    thumbs = base.resolve("thumbs"); /* small copies of the uploads for the picture library (Images.thumb): made again when missing, not backed up */
    builds = base.resolve("builds");
    live = base.resolve("live");
    backups = base.resolve("backups");
    tmp = base.resolve("tmp");
    lock = base.resolve(".deploy.lock");
  }

  /** The code has been pushed at least once (the build script and the picture cleaner are there). */
  boolean ready() {
    return Files.isRegularFile(src.resolve("scripts/build.mjs")) && Files.isRegularFile(src.resolve("deploy/build-site.sh"));
  }

  void requireReady() {
    if (!ready()) throw new Http.Fail(503, "not_ready", "服务器上还没有网站的代码：先在电脑上 git push 一次（见 README「第一次部署」）");
  }

  /* ================================================================ running programs */

  record Result(int code, byte[] out, String err) {
    String text() { return new String(out, StandardCharsets.UTF_8); }
  }

  private static ProcessBuilder builder(Path dir, List<String> command) {
    ProcessBuilder pb = new ProcessBuilder(command).directory(dir.toFile());
    Map<String, String> env = pb.environment();
    env.keySet().removeIf(k -> k.startsWith("GIT_"));
    env.put("LC_ALL", "C.UTF-8");
    return pb;
  }

  /** Runs a program and waits; stdout and stderr are kept apart, both capped. */
  static Result run(Path dir, byte[] stdin, long timeoutSeconds, List<String> command) {
    try {
      Process p = builder(dir, command).start();
      ByteArrayOutputStream err = new ByteArrayOutputStream();
      Thread errReader = Thread.ofVirtual().start(() -> copy(p.getErrorStream(), err, 256 * 1024));
      Thread writer = Thread.ofVirtual().start(() -> {
        try (OutputStream o = p.getOutputStream()) {
          if (stdin != null) o.write(stdin);
        } catch (IOException ignored) {
          /* the program stopped reading */
        }
      });
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      copy(p.getInputStream(), out, 64 * 1024 * 1024);
      if (!p.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
        p.destroyForcibly();
        throw new Http.Fail(500, "timeout", "操作超时：" + command.get(0));
      }
      writer.join(1000);
      errReader.join(1000);
      return new Result(p.exitValue(), out.toByteArray(), err.toString(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new Http.Fail(500, "exec", "无法运行 " + command.get(0) + "：" + e.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new Http.Fail(500, "interrupted", "操作被中断");
    }
  }

  /** Runs a program and hands each line it prints (stdout and stderr together) to the job log as it comes. */
  static int runLive(Path dir, long timeoutSeconds, List<String> command, Consumer<String> line) {
    try {
      Process p = builder(dir, command).redirectErrorStream(true).start();
      p.getOutputStream().close();
      Thread reader = Thread.ofVirtual().start(() -> {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
          String l;
          while ((l = r.readLine()) != null) {
            String t = l.replaceAll("\u001b\\[[0-9;]*m", "").stripTrailing();
            if (!t.isEmpty()) line.accept(t.length() > 500 ? t.substring(0, 500) + "…" : t);
          }
        } catch (IOException ignored) {
          /* the program ended */
        }
      });
      if (!p.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
        p.destroyForcibly();
        throw new Http.Fail(500, "timeout", "构建超时（超过 " + timeoutSeconds / 60 + " 分钟）");
      }
      reader.join(2000);
      return p.exitValue();
    } catch (IOException e) {
      throw new Http.Fail(500, "exec", "无法运行 " + command.get(0) + "：" + e.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new Http.Fail(500, "interrupted", "操作被中断");
    }
  }

  private static void copy(InputStream in, ByteArrayOutputStream out, int max) {
    byte[] buf = new byte[8192];
    try (in) {
      int n;
      while ((n = in.read(buf)) > 0) {
        if (out.size() + n <= max) out.write(buf, 0, n);
      }
    } catch (IOException ignored) {
      /* the program ended */
    }
  }

  /* ================================================================ publishing */

  interface Exporter {
    /** Writes the content to publish into the (empty) folder. */
    void write(Path dir) throws IOException;
  }

  /**
   * Writes the content to publish, builds the site with it and puts it live. Returns the new build's name. On any
   * failure the site and content/ stay exactly as they were.
   */
  String publish(Jobs.Job job, String label, Exporter exporter) throws IOException {
    requireReady();
    deleteTree(next);
    Files.createDirectories(next.resolve("blog"));
    exporter.write(next);
    String before = liveTarget();
    job.say("构建网站");
    String oneLine = label.replaceAll("[\\r\\n]+", " ");
    int code = runLive(src, 15 * 60, List.of("flock", "-w", "900", lock.toString(), "bash", src.resolve("deploy/build-site.sh").toString(), oneLine, next.toString()), job::say);
    String after = liveTarget();
    if (code != 0 || after == null || after.equals(before)) {
      deleteTree(next);
      throw new Http.Fail(500, "build", "构建没有成功，网站还是之前的样子。详细信息见记录");
    }
    return after;
  }

  /** Points live at an earlier build: immediate, and undone by the next publish. */
  void rollback(String name) {
    if (!BUILD.matcher(name).matches()) throw new Http.Fail(400, "build", "版本名不对");
    Path target = builds.resolve(name);
    if (!Files.isRegularFile(target.resolve("index.html"))) throw new Http.Fail(404, "not_found", "没有这个版本");
    Result r = run(base, null, 120, List.of("flock", "-w", "100", lock.toString(), "sh", "-c",
        "ln -sfn \"$1\" \"$2/.live.new\" && mv -T \"$2/.live.new\" \"$2/live\"", "rollback", target.toString(), base.toString()));
    if (r.code() != 0) throw new Http.Fail(500, "rollback", "切换失败：" + r.err().strip());
  }

  /** Name of the build directory live points to. */
  String liveTarget() {
    try {
      return Files.isSymbolicLink(live) ? Files.readSymbolicLink(live).getFileName().toString() : null;
    } catch (IOException e) {
      return null;
    }
  }

  /** The builds kept on the server, newest first: name, label (what was published), code version. */
  List<Map<String, Object>> builds() throws IOException {
    List<Map<String, Object>> out = new ArrayList<>();
    if (!Files.isDirectory(builds)) return out;
    List<String> names;
    try (Stream<Path> s = Files.list(builds)) {
      names = s.filter(Files::isDirectory).map(p -> p.getFileName().toString()).filter(n -> BUILD.matcher(n).matches()).sorted(Comparator.reverseOrder()).toList();
    }
    for (String n : names) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("name", n);
      m.put("code", n.substring(16));
      Path label = builds.resolve(n + ".label");
      m.put("label", Files.isRegularFile(label) ? Text.line(Files.readString(label, StandardCharsets.UTF_8), 200) : "");
      out.add(m);
    }
    return out;
  }

  static void deleteTree(Path dir) throws IOException {
    if (!Files.exists(dir, java.nio.file.LinkOption.NOFOLLOW_LINKS)) return;
    try (Stream<Path> s = Files.walk(dir)) {
      for (Path p : s.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(p);
    }
  }

  /** Writes a file whole or not at all (a temporary file next to it, then renamed). */
  static void writeAtomic(Path file, byte[] data) throws IOException {
    Files.createDirectories(file.getParent());
    Path tmp = file.resolveSibling("." + file.getFileName() + ".tmp");
    Files.write(tmp, data);
    Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
  }
}
