package blog.server;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Tells you about new comments, and about someone trying to sign in on a decoy admin page, through a webhook
 * (notify.url): WeCom / DingTalk / Feishu bots, Bark, ntfy, a Telegram bot and so on. The body is notify.template with
 * {{title}}, {{text}} and {{url}} filled in. At most 20 messages an hour, so a flood of spam cannot turn into a flood of
 * notifications. The admin page's secret address is never in a message (it passes through someone else's servers).
 */
final class Notifier {
  private final CommentsConfig cfg;
  private final Guard.Limiter limiter = new Guard.Limiter();
  private final HttpClient client;

  Notifier(CommentsConfig cfg) {
    this.cfg = cfg;
    this.client = cfg.notifyUrl.isEmpty() ? null
        : HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
  }

  void newComment(String post, String name, String content) {
    String excerpt = content.length() > 120 ? content.substring(0, 120) + "…" : content;
    send("新评论待审核", name + " 评论了《" + post + "》：" + excerpt + "（到后台的「评论」里审核）", cfg.siteUrl + "/blog/" + post + "/");
  }

  void send(String title, String text, String url) {
    if (client == null || !limiter.allow("notify", 20, 3_600_000L)) return;
    String body = cfg.notifyTemplate
        .replace("{{title}}", escape(title))
        .replace("{{text}}", escape(text))
        .replace("{{url}}", escape(url));
    Thread.ofVirtual().start(() -> {
      try {
        HttpRequest req = HttpRequest.newBuilder(URI.create(cfg.notifyUrl))
            .timeout(Duration.ofSeconds(8))
            .header("Content-Type", "application/json; charset=utf-8")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        HttpResponse<Void> res = client.send(req, HttpResponse.BodyHandlers.discarding());
        if (res.statusCode() >= 300) Log.warn("notification answered %d", res.statusCode());
      } catch (Exception e) {
        Log.warn("notification failed: %s", e.getClass().getSimpleName());
      }
    });
  }

  /** The value as it goes inside a JSON string. */
  private static String escape(String s) {
    String q = Json.write(s);
    return q.substring(1, q.length() - 1);
  }
}
