package blog.server;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Request and response helpers around the JDK's built-in HTTP server. */
final class Http {
  private Http() {}

  static final int MAX_BODY = 16 * 1024;
  private static final Pattern IP = Pattern.compile("[0-9a-fA-F:.]{2,45}");

  /** A refusal with an HTTP status, a short code for scripts and a message for people. */
  static final class Fail extends RuntimeException {
    private static final long serialVersionUID = 1L;
    final int status;
    final String code;

    Fail(int status, String code, String message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  /** The JSON object in the request body: at most 16 KB of valid UTF-8, sent as application/json. */
  static Map<String, Object> jsonBody(HttpExchange x) throws IOException {
    return jsonBody(x, MAX_BODY);
  }

  static Map<String, Object> jsonBody(HttpExchange x, int max) throws IOException {
    return jsonBody(x, max, false);
  }

  /** Only behind the sign-in: longer lists than anything a visitor may send (an album's photos). */
  static Map<String, Object> jsonBodyLarge(HttpExchange x, int max) throws IOException {
    return jsonBody(x, max, true);
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> jsonBody(HttpExchange x, int max, boolean large) throws IOException {
    String type = x.getRequestHeaders().getFirst("Content-Type");
    if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("application/json")) {
      throw new Fail(415, "content_type", "请求格式不对");
    }
    byte[] raw = rawBody(x, max);
    String text;
    try {
      text = StandardCharsets.UTF_8.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
          .decode(ByteBuffer.wrap(raw)).toString();
    } catch (CharacterCodingException e) {
      throw new Fail(400, "encoding", "内容不是有效的 UTF-8 文本");
    }
    Object v;
    try {
      v = large ? Json.parseLarge(text) : Json.parse(text);
    } catch (Json.Bad e) {
      throw new Fail(400, "json", "请求内容格式不对");
    }
    if (!(v instanceof Map)) throw new Fail(400, "json", "请求内容格式不对");
    return (Map<String, Object>) v;
  }

  /** The request body as bytes, refused past max (read at most max + 1 bytes, whatever Content-Length says). */
  static byte[] rawBody(HttpExchange x, int max) throws IOException {
    String length = x.getRequestHeaders().getFirst("Content-Length");
    if (length != null) {
      try {
        if (Long.parseLong(length.trim()) > max) throw new Fail(413, "too_large", "内容太长了");
      } catch (NumberFormatException e) {
        throw new Fail(400, "length", "请求格式不对");
      }
    }
    byte[] raw;
    try (InputStream in = x.getRequestBody()) {
      raw = in.readNBytes(max + 1);
    }
    if (raw.length > max) throw new Fail(413, "too_large", "内容太长了");
    return raw;
  }

  /** The request body written to a file, refused past max (the file is removed then). */
  static long saveBody(HttpExchange x, long max, java.nio.file.Path file) throws IOException {
    String length = x.getRequestHeaders().getFirst("Content-Length");
    if (length != null) {
      try {
        if (Long.parseLong(length.trim()) > max) throw new Fail(413, "too_large", "文件太大了（最多 " + max / 1024 / 1024 + " MB）");
      } catch (NumberFormatException e) {
        throw new Fail(400, "length", "请求格式不对");
      }
    }
    long total = 0;
    try (InputStream in = x.getRequestBody(); OutputStream out = java.nio.file.Files.newOutputStream(file)) {
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) {
        total += n;
        if (total > max) throw new Fail(413, "too_large", "文件太大了（最多 " + max / 1024 / 1024 + " MB）");
        out.write(buf, 0, n);
      }
    } catch (IOException | Fail e) {
      java.nio.file.Files.deleteIfExists(file);
      throw e;
    }
    return total;
  }

  interface Writer {
    void write(OutputStream out) throws IOException;
  }

  /** A download (zip): sent as it is written, so a big one never sits in memory. */
  static void download(HttpExchange x, String type, String filename, Writer writer) throws IOException {
    Headers h = x.getResponseHeaders();
    h.set("Content-Type", type);
    String ascii = filename.replaceAll("[^A-Za-z0-9._-]", "_");
    h.set("Content-Disposition", "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''"
        + java.net.URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20"));
    h.set("Cache-Control", "no-store");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Content-Security-Policy", "default-src 'none'; sandbox");
    x.sendResponseHeaders(200, 0); /* chunked */
    try (OutputStream o = x.getResponseBody()) {
      writer.write(o);
    }
  }

  /** A file (a picture for the editor's preview): its own type, never sniffed, never run as a page. */
  static void sendFile(HttpExchange x, byte[] body, String type) throws IOException {
    Headers h = x.getResponseHeaders();
    h.set("Content-Type", type);
    h.set("Cache-Control", "private, max-age=300");
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Content-Security-Policy", "default-src 'none'; sandbox");
    h.set("Referrer-Policy", "no-referrer");
    boolean head = "HEAD".equals(x.getRequestMethod());
    x.sendResponseHeaders(200, head ? -1 : body.length);
    if (!head) {
      try (OutputStream o = x.getResponseBody()) {
        o.write(body);
      }
    }
  }

  static void send(HttpExchange x, int status, Object payload, String cacheControl) throws IOException {
    send(x, status, Json.write(payload).getBytes(StandardCharsets.UTF_8), cacheControl);
  }

  static void send(HttpExchange x, int status, byte[] body, String cacheControl) throws IOException {
    Headers h = x.getResponseHeaders();
    h.set("Content-Type", "application/json; charset=utf-8");
    h.set("Cache-Control", cacheControl);
    h.set("X-Content-Type-Options", "nosniff");
    h.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"); /* these are data, never pages */
    h.set("Referrer-Policy", "no-referrer");
    boolean empty = status == 304 || "HEAD".equals(x.getRequestMethod());
    x.sendResponseHeaders(status, empty ? -1 : body.length);
    if (!empty) {
      try (OutputStream o = x.getResponseBody()) {
        o.write(body);
      }
    }
  }

  static void fail(HttpExchange x, int status, String code, String message) throws IOException {
    send(x, status, Map.of("error", code, "message", message), "no-store");
  }

  /**
   * The visitor's address. The service listens on 127.0.0.1 behind Nginx or Caddy, which pass the real address in
   * X-Real-IP; that header is believed only when the request comes from this machine, so nobody can fake it from outside.
   */
  static String clientIp(HttpExchange x) {
    InetAddress remote = x.getRemoteAddress().getAddress();
    if (remote.isLoopbackAddress()) {
      String real = x.getRequestHeaders().getFirst("X-Real-IP");
      if (real != null && IP.matcher(real.trim()).matches()) return real.trim();
    }
    return remote.getHostAddress();
  }

  /** Browsers send Origin with every POST from a page; it must be our own site (blocks cross-site form posts). */
  static void requireOrigin(HttpExchange x, Set<String> origins) {
    String origin = x.getRequestHeaders().getFirst("Origin");
    if (origin == null || !origins.contains(origin.trim())) throw new Fail(403, "origin", "只接受从本站页面提交");
  }

  static String cookie(HttpExchange x, String name) {
    List<String> all = x.getRequestHeaders().get("Cookie");
    if (all == null) return null;
    for (String header : all) {
      for (String part : header.split(";")) {
        int eq = part.indexOf('=');
        if (eq > 0 && part.substring(0, eq).trim().equals(name)) return part.substring(eq + 1).trim();
      }
    }
    return null;
  }

  static Map<String, String> query(HttpExchange x) {
    Map<String, String> m = new HashMap<>();
    String raw = x.getRequestURI().getRawQuery();
    if (raw == null || raw.length() > 2000) return m;
    for (String pair : raw.split("&")) {
      int eq = pair.indexOf('=');
      if (eq <= 0) continue;
      try {
        m.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8), URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
      } catch (IllegalArgumentException ignored) {
        /* malformed escapes: ignore the pair */
      }
    }
    return m;
  }
}
